'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbc-'));
process.env.DATA_FILE = path.join(dir, 'state.json');
const { server } = require('../server');

let base;
test.before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('serves the app and core script', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /PBC Parking/);
  const core = await fetch(base + '/core.js');
  assert.match(await core.text(), /ParkingCore/);
});

test('full flow: new car, look up, park, persist', async () => {
  const created = await call('POST', '/api/tickets', { size: 'medium' });
  assert.equal(created.status, 200);
  const n = created.body.ticket.n;
  assert.ok(created.body.spot.id);

  const looked = await call('GET', `/api/tickets/${n}?station=front`);
  assert.equal(looked.body.spot.id, created.body.spot.id);
  assert.ok(['park', 'forward', 'back'].includes(looked.body.instruction.action));

  const parked = await call('POST', `/api/tickets/${n}/parked`);
  assert.equal(parked.body.ticket.status, 'parked');

  const saved = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  assert.equal(saved.session.tickets[n].status, 'parked');
});

test('rejects bad input', async () => {
  assert.equal((await call('POST', '/api/tickets', { size: 'bus' })).status, 400);
  assert.equal((await call('GET', '/api/tickets/9999')).status, 404);
  assert.equal((await call('PUT', '/api/lot', { lot: { zones: [], rows: [] } })).status, 400);
});

test('reset starts a clean session', async () => {
  const r = await call('POST', '/api/session/reset', { name: 'Sunday 11am' });
  assert.equal(r.body.session.name, 'Sunday 11am');
  const s = await call('GET', '/api/state');
  assert.deepEqual(s.body.session.tickets, {});
});
