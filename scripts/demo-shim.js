/*
 * Demo mode: runs the whole app inside one browser tab, with no server.
 * Stands in for fetch('/api/...') and the live EventSource stream using the
 * same routes and store logic as server.js. State is kept in localStorage.
 * Nothing is shared between devices in this mode.
 */
(function () {
  'use strict';
  const KEY = 'pbc-demo-state';

  function fresh() {
    return {
      lot: JSON.parse(JSON.stringify(PBC.defaultLot)),
      session: PBC.store.newSession('Demo Service'),
    };
  }

  let state = null;
  try {
    state = JSON.parse(localStorage.getItem(KEY));
  } catch (e) {
    /* storage blocked: start fresh */
  }
  if (!state || !state.lot || !state.session) state = fresh();

  let version = 1;
  const listeners = new Set();
  const snapshot = () => ({ version, lot: state.lot, session: state.session });
  const routes = PBC.routes.createRoutes(state, snapshot);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore */
    }
  }

  function broadcast() {
    version++;
    const snap = clone(snapshot());
    listeners.forEach((fn) => fn(snap));
  }

  function respond(status, data) {
    const body = clone(data);
    return { ok: status < 300, status, json: async () => body };
  }

  const realFetch = window.fetch;
  window.fetch = async function (url, opts) {
    // Resolve against a fixed base: embedded viewers can give the page an
    // opaque address (about:srcdoc, blob:) that URL() cannot resolve against.
    const u = new URL(String(url), 'http://demo.invalid');
    if (!u.pathname.startsWith('/api/')) return realFetch.apply(this, arguments);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    for (const [m, pattern, handler, mutates] of routes) {
      const match = u.pathname.match(pattern);
      if (!match || m !== method) continue;
      try {
        const result = handler(match.slice(1), body, u);
        if (mutates) {
          persist();
          setTimeout(broadcast);
        }
        return respond(200, result);
      } catch (err) {
        if (err instanceof PBC.store.UserError) return respond(err.status, { error: err.message });
        console.error(err);
        return respond(500, { error: 'Something went wrong' });
      }
    }
    return respond(404, { error: 'Not found' });
  };

  class DemoEventSource {
    constructor() {
      this.readyState = 1;
      this.onmessage = null;
      this.onerror = null;
      this._fn = (snap) => this.onmessage && this.onmessage({ data: JSON.stringify(snap) });
      listeners.add(this._fn);
      setTimeout(() => this._fn(clone(snapshot())));
    }
    close() {
      this.readyState = 2;
      listeners.delete(this._fn);
    }
  }
  DemoEventSource.CLOSED = 2;
  window.EventSource = DemoEventSource;

  // Some embedded viewers block confirm dialogs; in the demo every
  // "are you sure?" step just proceeds.
  window.confirm = () => true;

  window.PBC.demo = true;

  window.PBC.resetDemo = function () {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* ignore */
    }
    Object.assign(state, fresh());
    persist();
    broadcast();
  };
})();
