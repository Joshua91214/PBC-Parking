'use strict';

// Bundles the app into one self-contained HTML file that runs without the
// server (see scripts/demo-shim.js). Usage: npm run demo [-- out.html]

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'demo.html'));

function script(code) {
  if (/<\/script/i.test(code)) throw new Error('Source contains </script>; cannot inline');
  return `<script>\n${code}\n</script>`;
}

// Wrap the CommonJS lib files so they run in the browser.
const modules = ['store', 'routes', 'defaultLot']
  .map((name) => `def('${name}', function (module, exports, require) {\n${read(`lib/${name}.js`)}\n});`)
  .join('\n');

const loader = `
window.PBC = {};
(function () {
  var mods = {};
  function req(name) {
    var key = name.replace('./', '');
    return key === 'core' ? window.ParkingCore : mods[key];
  }
  function def(name, fn) {
    var module = { exports: {} };
    fn(module, module.exports, req);
    mods[name] = module.exports;
  }
  ${modules}
  PBC.store = mods.store;
  PBC.routes = mods.routes;
  PBC.defaultLot = mods.defaultLot;
})();`;

const banner = `
<div class="demo-banner">
  <span><b>Demo mode</b>: runs only on this device. Try Entrance, then look the number up under Usher.</span>
  <button type="button" onclick="PBC.resetDemo()">Reset demo</button>
</div>`;

const bannerCss = `
.demo-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 16px; background: #fff3cd; color: #5c4400; font-size: 0.85rem; }
.demo-banner button { font: inherit; font-weight: 600; padding: 6px 10px; border-radius: 8px;
  border: 1px solid #d9b650; background: #fff; color: #5c4400; cursor: pointer; }`;

let html = read('public/index.html');
html = html
  .replace('<title>PBC Parking</title>', '<title>PBC Parking Demo</title>')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="icon"[^>]*>/, '')
  .replace('<link rel="stylesheet" href="/styles.css">', `<style>\n${read('public/styles.css')}${bannerCss}\n</style>`)
  .replace('<main id="app">', `${banner}\n  <main id="app">`)
  .replace(
    /<script src="\/core.js"><\/script>\s*<script src="\/app.js"><\/script>/,
    [
      script(read('lib/core.js')),
      script(loader),
      script(read('scripts/demo-shim.js')),
      script(read('public/app.js')),
    ].join('\n')
  );

if (html.includes('src="/')) throw new Error('A script tag was not inlined');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${Math.round(html.length / 1024)} KB)`);
