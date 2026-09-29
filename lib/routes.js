'use strict';

// The JSON API as a table, shared by the real server and the in-browser demo.
// Each entry: [method, pattern, handler(params, body, url) -> result, mutates?]

const store = require('./store');

function createRoutes(state, snapshot) {
  return [
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
}

module.exports = { createRoutes };
