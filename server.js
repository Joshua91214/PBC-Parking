'use strict';

// PBC Parking server: serves the web app, a small JSON API, and a live
// Server-Sent Events stream so every usher's phone sees changes instantly.
// No dependencies; state is kept in memory and saved to data/state.json.

const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const defaultLot = require('./lib/defaultLot');

const PORT = Number(process.env.PORT) || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const DATA_FILE =
  process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- persistence ----------

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (saved.lot && saved.session) return saved;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read state:', err.message);
  }
  return { lot: structuredClone(defaultLot), session: store.newSession('Sunday Service') };
}

const state = loadState();
let version = 1;

function saveState() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- live updates ----------

const clients = new Set();

function snapshot() {
  return { version, lot: state.lot, session: state.session };
}

function broadcast() {
  version++;
  const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(msg);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000).unref();

// ---------- http helpers ----------

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new store.UserError('Request too large', 413));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new store.UserError('Invalid JSON'));
      }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  let file;
  if (pathname === '/core.js') file = path.join(__dirname, 'lib', 'core.js');
  else {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Forbidden' });
  }
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function authorized(req, url) {
  if (!ACCESS_CODE) return true;
  const code = req.headers['x-access-code'] || url.searchParams.get('code');
  return code === ACCESS_CODE;
}

// ---------- routes ----------

// [method, pattern, handler(params, body, url) -> result, mutates?]
const routes = [
  ['GET', /^\/api\/state$/, () => snapshot(), false],
  ['POST', /^\/api\/tickets$/, (p, b) => store.createTicket(state, b.size), true],
  ['GET', /^\/api\/tickets\/(\d+)$/, (p, b, url) =>
    store.describe(state, store.getTicket(state, p[0]), url.searchParams.get('station')), false],
  ['POST', /^\/api\/tickets\/(\d+)\/parked$/, (p) => store.markParked(state, p[0]), true],
  ['POST', /^\/api\/tickets\/(\d+)\/reassign$/, (p, b) =>
    store.reassign(state, p[0], b.blockOld !== false), true],
  ['POST', /^\/api\/tickets\/(\d+)\/size$/, (p, b) => store.changeSize(state, p[0], b.size), true],
  ['POST', /^\/api\/tickets\/(\d+)\/cancel$/, (p) => store.cancelTicket(state, p[0]), true],
  ['POST', /^\/api\/spots\/([A-Za-z0-9-]+)\/block$/, (p) => store.toggleBlocked(state, p[0]), true],
  ['POST', /^\/api\/session\/reset$/, (p, b) => store.resetSession(state, b.name), true],
  ['PUT', /^\/api\/lot$/, (p, b) => store.saveLot(state, b.lot, !!b.force), true],
];

async function handleApi(req, res, url) {
  if (!authorized(req, url)) return send(res, 401, { error: 'Access code required' });

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  for (const [method, pattern, handler, mutates] of routes) {
    const m = url.pathname.match(pattern);
    if (!m || req.method !== method) continue;
    try {
      const body = method === 'GET' ? {} : await readBody(req);
      const result = handler(m.slice(1), body, url);
      if (mutates) {
        saveState();
        broadcast();
      }
      return send(res, 200, result);
    } catch (err) {
      if (err instanceof store.UserError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Server error' });
    }
  }
  send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  serveStatic(req, res, url.pathname);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`PBC Parking running on http://localhost:${PORT}`);
    if (ACCESS_CODE) console.log('Access code is required to use the app.');
  });
}

module.exports = { server, state };
