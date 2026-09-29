'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core');
const store = require('../lib/store');
const defaultLot = require('../lib/defaultLot');

function oneRowLot(count, extra) {
  return {
    name: 'Test',
    zones: [{ id: 'z1', name: 'Zone 1' }, { id: 'z2', name: 'Zone 2' }],
    rows: [
      { id: 'r1', label: 'A', zone: 'z1', x: 0, y: 0, count, fillOrder: 1, maxSize: 'large', park: 'auto', ...extra },
    ],
  };
}

function freshState(lot) {
  return { lot, session: store.newSession('Test') };
}

test('default lot is valid', () => {
  assert.deepEqual(core.validateLot(defaultLot), []);
});

test('cars fill spots in fill order', () => {
  const state = freshState(oneRowLot(5));
  const spots = ['small', 'medium', 'small'].map((s) => store.createTicket(state, s).spot.id);
  assert.deepEqual(spots, ['A1', 'A2', 'A3']);
});

test('fillFrom end fills the row backwards', () => {
  const state = freshState(oneRowLot(5, { fillFrom: 'end' }));
  assert.equal(store.createTicket(state, 'small').spot.id, 'A5');
  assert.equal(store.createTicket(state, 'small').spot.id, 'A4');
});

test('big vehicles are not parked side by side (big, small, big, small)', () => {
  const state = freshState(oneRowLot(8));
  const a = store.createTicket(state, 'large').spot.id; // A1
  const b = store.createTicket(state, 'large').spot.id; // skips A2
  const c = store.createTicket(state, 'small').spot.id; // fills the gap
  assert.equal(a, 'A1');
  assert.equal(b, 'A3');
  assert.equal(c, 'A2');
});

test('big vehicles double up when there is no other choice', () => {
  const state = freshState(oneRowLot(2));
  store.createTicket(state, 'large');
  assert.equal(store.createTicket(state, 'large').spot.id, 'A2');
});

test('vans only go in van-capable spots', () => {
  const state = freshState(oneRowLot(4, { spots: { 3: { maxSize: 'van' } } }));
  assert.equal(store.createTicket(state, 'van').spot.id, 'A3');
  const none = store.createTicket(state, 'van');
  assert.equal(none.ticket.status, 'overflow');
  assert.equal(none.ticket.spotId, null);
});

test('small cars avoid van spots while regular spots remain', () => {
  const state = freshState(oneRowLot(4, { spots: { 1: { maxSize: 'van' } } }));
  assert.equal(store.createTicket(state, 'small').spot.id, 'A2');
});

test('reserved and blocked spots are skipped', () => {
  const state = freshState(oneRowLot(4, { spots: { 1: { reserved: true } } }));
  store.toggleBlocked(state, 'A2');
  assert.equal(store.createTicket(state, 'small').spot.id, 'A3');
});

test('reassign blocks the old spot and picks another', () => {
  const state = freshState(oneRowLot(4));
  const first = store.createTicket(state, 'medium');
  assert.equal(first.spot.id, 'A1');
  const moved = store.reassign(state, first.ticket.n, true);
  assert.equal(moved.spot.id, 'A2');
  assert.equal(state.session.blocked.A1, true);
});

test('cancel frees the spot for the next car', () => {
  const state = freshState(oneRowLot(3));
  const t = store.createTicket(state, 'small');
  store.cancelTicket(state, t.ticket.n);
  assert.equal(store.createTicket(state, 'small').spot.id, 'A1');
});

test('ticket numbers keep counting up', () => {
  const state = freshState(oneRowLot(3));
  assert.equal(store.createTicket(state, 'small').ticket.n, 1);
  assert.equal(store.createTicket(state, 'small').ticket.n, 2);
});

test('park direction: row setting wins, auto depends on size', () => {
  const spot = { park: 'auto' };
  assert.equal(core.parkDirection(spot, 'small').dir, 'reverse');
  assert.equal(core.parkDirection(spot, 'van').dir, 'front');
  assert.equal(core.parkDirection({ park: 'front' }, 'small').dir, 'front');
  assert.equal(core.parkDirection({ park: 'reverse' }, 'van').dir, 'reverse');
});

test('diagonal spots are always pull-in forward', () => {
  const lot = oneRowLot(3, { angled: 'left', park: 'reverse' });
  const spot = core.expandLot(lot).byId.A1;
  assert.equal(spot.angled, 'left');
  assert.equal(core.parkDirection(spot, 'small').dir, 'front');
  assert.deepEqual(core.validateLot(lot), []);
  assert.match(core.validateLot(oneRowLot(3, { angled: 'up' })).join(' '), /angle/);
});

test('usher instruction depends on where the usher stands', () => {
  const lot = oneRowLot(2);
  lot.rows.push({ id: 'r2', label: 'B', zone: 'z2', x: 0, y: 5, count: 2, fillOrder: 2 });
  const spotB = core.expandLot(lot).byId.B1;
  assert.equal(core.usherInstruction(lot, spotB, 'z1').action, 'forward');
  assert.equal(core.usherInstruction(lot, spotB, 'z2').action, 'park');
  const spotA = core.expandLot(lot).byId.A1;
  assert.equal(core.usherInstruction(lot, spotA, 'z2').action, 'back');
});

test('validateLot catches bad layouts', () => {
  const lot = oneRowLot(3);
  lot.rows.push({ ...lot.rows[0], id: 'r2' });
  assert.match(core.validateLot(lot).join(' '), /duplicate label/);
  assert.match(core.validateLot({ zones: [], rows: [] }).join(' '), /zone/);
});

test('layout cannot change mid-service without force', () => {
  const state = freshState(oneRowLot(3));
  store.createTicket(state, 'small');
  assert.throws(() => store.saveLot(state, oneRowLot(5)), /new session/);
  store.saveLot(state, oneRowLot(5), true);
  assert.equal(Object.keys(state.session.tickets).length, 0);
});
