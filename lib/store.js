'use strict';

// State mutations for one service's parking session. Every function takes the
// full state ({ lot, session }), mutates it, and returns a result or throws a
// UserError. The server serializes calls, so assignments never race.

const core = require('./core');

class UserError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

function newSession(name) {
  return {
    name: name || 'Service',
    startedAt: new Date().toISOString(),
    nextTicket: 1,
    tickets: {},
    blocked: {},
  };
}

function getTicket(state, n) {
  const t = state.session.tickets[n];
  if (!t) throw new UserError(`No car with number ${n}`, 404);
  return t;
}

function describe(state, ticket, stationZoneId) {
  if (!ticket.spotId) return { ticket };
  const spot = core.expandLot(state.lot).byId[ticket.spotId];
  if (!spot) return { ticket };
  const zone = state.lot.zones.find((z) => z.id === spot.zoneId);
  return {
    ticket,
    spot: { id: spot.id, zoneId: spot.zoneId, note: spot.note },
    zoneName: zone ? zone.name : spot.zoneId,
    direction: core.parkDirection(spot, ticket.size),
    instruction: core.usherInstruction(state.lot, spot, stationZoneId),
  };
}

function assign(state, ticket, exclude) {
  const pick = core.chooseSpot(state.lot, state.session, ticket.size, { exclude });
  ticket.spotId = pick ? pick.spot.id : null;
  ticket.status = pick ? 'assigned' : 'overflow';
  return pick;
}

function createTicket(state, size) {
  if (!core.SIZE_RANK[size]) throw new UserError('Pick a car size');
  const s = state.session;
  const ticket = {
    n: s.nextTicket++,
    size,
    status: 'assigned',
    spotId: null,
    createdAt: new Date().toISOString(),
  };
  assign(state, ticket);
  s.tickets[ticket.n] = ticket;
  return describe(state, ticket);
}

function markParked(state, n) {
  const t = getTicket(state, n);
  if (t.status !== 'assigned' && t.status !== 'parked') {
    throw new UserError(`Car ${n} has no spot to park in`);
  }
  t.status = 'parked';
  t.parkedAt = new Date().toISOString();
  return describe(state, t);
}

/**
 * The assigned spot turned out to be unusable (someone without a number took
 * it, a cone, etc.). Optionally block that spot, then pick a new one.
 */
function reassign(state, n, blockOld) {
  const t = getTicket(state, n);
  if (t.status === 'cancelled') throw new UserError(`Car ${n} was cancelled`);
  const old = t.spotId;
  if (old && blockOld) state.session.blocked[old] = true;
  t.status = 'reassigning';
  assign(state, t, old ? [old] : []);
  t.reassignedFrom = old;
  return describe(state, t);
}

function changeSize(state, n, size) {
  if (!core.SIZE_RANK[size]) throw new UserError('Pick a car size');
  const t = getTicket(state, n);
  if (t.status === 'cancelled') throw new UserError(`Car ${n} was cancelled`);
  t.size = size;
  t.status = 'reassigning';
  assign(state, t);
  return describe(state, t);
}

function cancelTicket(state, n) {
  const t = getTicket(state, n);
  t.status = 'cancelled';
  t.spotId = null;
  return { ticket: t };
}

function toggleBlocked(state, spotId) {
  const ex = core.expandLot(state.lot);
  if (!ex.byId[spotId]) throw new UserError(`No spot ${spotId}`, 404);
  const occ = core.occupancy(state.session);
  if (occ[spotId]) {
    throw new UserError(`Car ${occ[spotId].n} is using ${spotId}; free it first`);
  }
  const b = state.session.blocked;
  if (b[spotId]) delete b[spotId];
  else b[spotId] = true;
  return { spotId, blocked: !!b[spotId] };
}

function resetSession(state, name) {
  state.session = newSession(name);
  return { session: state.session };
}

function activeTickets(state) {
  return Object.values(state.session.tickets).filter(
    (t) => t.status === 'assigned' || t.status === 'parked'
  );
}

function saveLot(state, lot, force) {
  const errors = core.validateLot(lot);
  if (errors.length) throw new UserError(errors.join('\n'));
  if (!force && activeTickets(state).length > 0) {
    throw new UserError(
      'Cars are parked in the current session. Start a new session to change the layout.',
      409
    );
  }
  state.lot = lot;
  if (force) state.session = newSession(state.session.name);
  return { lot };
}

module.exports = {
  UserError,
  newSession,
  describe,
  createTicket,
  markParked,
  reassign,
  changeSize,
  cancelTicket,
  toggleBlocked,
  resetSession,
  saveLot,
  getTicket,
};
