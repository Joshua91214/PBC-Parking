/*
 * Parking core: lot geometry, spot assignment, and park-direction logic.
 *
 * Shared by the server (authoritative assignment) and the browser (map
 * rendering and the layout editor preview), so it has no dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ParkingCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZES = ['small', 'medium', 'large', 'van'];
  const SIZE_RANK = { small: 1, medium: 2, large: 3, van: 4 };
  const SIZE_LABELS = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    van: 'Van',
  };
  const SIZE_HINTS = {
    small: 'Compact / small sedan',
    medium: 'Sedan / small SUV',
    large: 'Full SUV / minivan / pickup',
    van: 'Passenger or cargo van',
  };

  // Tuning for chooseSpot(). Scores are measured in "spots skipped": a car
  // will be sent this many usable spots further down the fill order to avoid
  // the corresponding problem.
  const WEIGHTS = {
    // Two big vehicles side by side (the "big, small, big, small" rule).
    crampedNeighbor: 12,
    // Using one of the few van-capable spots for a small/medium car.
    wastedBigSpot: 4,
  };

  // Spots are 1 map unit wide and 2 deep.
  const SPOT_W = 1;
  const SPOT_D = 2;

  function isBig(size) {
    return SIZE_RANK[size] >= SIZE_RANK.large;
  }

  function fits(size, maxSize) {
    return SIZE_RANK[size] <= SIZE_RANK[maxSize || 'van'];
  }

  function spotId(row, index) {
    return `${row.label}${index + 1}`;
  }

  /**
   * Flatten a lot definition into a list of concrete spots with geometry,
   * fill ranking, and neighbor links.
   */
  function expandLot(lot) {
    const zoneIndex = {};
    (lot.zones || []).forEach((z, i) => {
      zoneIndex[z.id] = i;
    });

    const spots = [];
    const byId = {};

    (lot.rows || []).forEach((row) => {
      const count = Math.max(0, Math.floor(row.count || 0));
      const overrides = row.spots || {};
      const rowSpots = [];
      for (let i = 0; i < count; i++) {
        const o = overrides[i + 1] || {};
        const horizontal = row.orientation !== 'vertical';
        const spot = {
          id: spotId(row, i),
          rowId: row.id,
          rowLabel: row.label,
          zoneId: row.zone,
          zoneOrder: zoneIndex[row.zone] ?? 999,
          number: i + 1,
          maxSize: o.maxSize || row.maxSize || 'large',
          park: o.park || row.park || 'auto',
          // Diagonal spots: which way the stripes lean ('left' | 'right').
          angled: row.angled === 'left' || row.angled === 'right' ? row.angled : '',
          reserved: !!o.reserved,
          note: o.note || '',
          x: horizontal ? row.x + i * SPOT_W : row.x,
          y: horizontal ? row.y : row.y + i * SPOT_W,
          w: horizontal ? SPOT_W : SPOT_D,
          h: horizontal ? SPOT_D : SPOT_W,
          fillOrder: row.fillOrder ?? 0,
          fillPos: row.fillFrom === 'end' ? count - 1 - i : i,
          neighbors: [],
        };
        rowSpots.push(spot);
        spots.push(spot);
        byId[spot.id] = spot;
      }
      for (let i = 0; i < rowSpots.length; i++) {
        if (i > 0) rowSpots[i].neighbors.push(rowSpots[i - 1].id);
        if (i < rowSpots.length - 1) rowSpots[i].neighbors.push(rowSpots[i + 1].id);
      }
    });

    const fillSorted = spots.slice().sort(
      (a, b) =>
        a.fillOrder - b.fillOrder ||
        a.fillPos - b.fillPos ||
        a.id.localeCompare(b.id)
    );
    fillSorted.forEach((s, i) => {
      s.fillRank = i;
    });

    return { spots, byId, fillSorted };
  }

  /** Map of spotId -> ticket for every car currently holding a spot. */
  function occupancy(session) {
    const occ = {};
    Object.values(session.tickets || {}).forEach((t) => {
      if (t.spotId && (t.status === 'assigned' || t.status === 'parked')) {
        occ[t.spotId] = t;
      }
    });
    return occ;
  }

  function spotAvailable(spot, occ, session, exclude) {
    return (
      !spot.reserved &&
      !occ[spot.id] &&
      !(session.blocked || {})[spot.id] &&
      !(exclude && exclude.includes(spot.id))
    );
  }

  /**
   * Pick the best free spot for a car of the given size.
   *
   * Walks spots in fill order and scores each usable one:
   *   score = (usable spots skipped to get here) + penalties
   * The lowest score wins, so a car normally takes the next spot in line but
   * will skip ahead to avoid parking two big vehicles side by side or burning
   * a van-sized spot on a small car.
   *
   * Returns { spot, score, reasons } or null when nothing fits.
   */
  function chooseSpot(lot, session, size, options) {
    const opts = options || {};
    const expanded = opts.expanded || expandLot(lot);
    const occ = occupancy(session);

    let best = null;
    let usable = 0;
    for (const spot of expanded.fillSorted) {
      if (!spotAvailable(spot, occ, session, opts.exclude)) continue;
      if (!fits(size, spot.maxSize)) continue;

      let score = usable;
      const reasons = [];

      if (isBig(size)) {
        for (const nid of spot.neighbors) {
          const neighborTicket = occ[nid];
          // A blocked spot is usually an unticketed car of unknown size;
          // treat it as ordinary, not big.
          if (neighborTicket && isBig(neighborTicket.size)) {
            score += WEIGHTS.crampedNeighbor;
            reasons.push(`next to a ${neighborTicket.size} vehicle in ${nid}`);
          }
        }
      }

      if (!isBig(size) && SIZE_RANK[spot.maxSize] >= SIZE_RANK.van) {
        score += WEIGHTS.wastedBigSpot;
        reasons.push('van-sized spot');
      }

      if (!best || score < best.score) best = { spot, score, reasons };
      usable++;
      // Every later spot scores at least `usable`, so none can win now.
      if (usable >= best.score) break;
    }
    return best;
  }

  /**
   * Recommend front-in vs back-in for a car in a spot.
   * Spots (or their rows) can force a direction; "auto" decides by vehicle.
   */
  function parkDirection(spot, size) {
    // Backing into a diagonal spot means reversing against the angle,
    // usually in a one-way lane, so angled spots are always nose-in.
    if (spot.angled) {
      return { dir: 'front', reason: 'Diagonal spot: pull in forward' };
    }
    if (spot.park === 'front') {
      return { dir: 'front', reason: 'Pull in nose-first here' };
    }
    if (spot.park === 'reverse') {
      return { dir: 'reverse', reason: 'Back in here' };
    }
    if (isBig(size)) {
      return {
        dir: 'front',
        reason: 'Big vehicles pull in nose-first (easier, faster)',
      };
    }
    return {
      dir: 'reverse',
      reason: 'Back in so leaving after service is quick',
    };
  }

  function directionLabel(dir) {
    return dir === 'reverse' ? 'Back in' : 'Pull in forward';
  }

  /**
   * What an usher standing in `stationZoneId` should tell the driver.
   * Zones are listed in the lot in the order a car drives past them.
   */
  function usherInstruction(lot, spot, stationZoneId) {
    const zones = lot.zones || [];
    const zoneName = (id) => (zones.find((z) => z.id === id) || {}).name || id;
    if (!stationZoneId) {
      return { action: 'info', text: `Spot ${spot.id} in ${zoneName(spot.zoneId)}` };
    }
    const here = zones.findIndex((z) => z.id === stationZoneId);
    const there = zones.findIndex((z) => z.id === spot.zoneId);
    if (here === there) {
      return { action: 'park', text: `Guide to spot ${spot.id}` };
    }
    if (there > here) {
      return {
        action: 'forward',
        text: `Keep going to ${zoneName(spot.zoneId)}`,
      };
    }
    return {
      action: 'back',
      text: `Spot is behind you, in ${zoneName(spot.zoneId)}`,
    };
  }

  /** Capacity left per car size, ignoring the neighbor rule. */
  function capacity(lot, session, expanded) {
    const ex = expanded || expandLot(lot);
    const occ = occupancy(session);
    const out = { total: ex.spots.length, used: 0, blocked: 0, reserved: 0 };
    SIZES.forEach((s) => (out[s] = 0));
    for (const spot of ex.spots) {
      if (spot.reserved) out.reserved++;
      else if (occ[spot.id]) out.used++;
      else if ((session.blocked || {})[spot.id]) out.blocked++;
      else SIZES.forEach((s) => fits(s, spot.maxSize) && out[s]++);
    }
    return out;
  }

  /** Returns a list of human-readable problems with a lot definition. */
  function validateLot(lot) {
    const errors = [];
    if (!lot || typeof lot !== 'object') return ['Lot must be an object'];
    if (!Array.isArray(lot.zones) || lot.zones.length === 0) {
      errors.push('Add at least one zone');
    }
    if (!Array.isArray(lot.rows) || lot.rows.length === 0) {
      errors.push('Add at least one row');
      return errors;
    }
    const zoneIds = new Set((lot.zones || []).map((z) => z.id));
    const labels = new Set();
    lot.rows.forEach((row, i) => {
      const name = row.label || `#${i + 1}`;
      if (!row.label || !/^[A-Za-z0-9-]{1,4}$/.test(row.label)) {
        errors.push(`Row ${name}: label must be 1-4 letters/numbers`);
      } else if (labels.has(row.label)) {
        errors.push(`Row ${name}: duplicate label`);
      }
      labels.add(row.label);
      if (!zoneIds.has(row.zone)) errors.push(`Row ${name}: unknown zone`);
      if (!(row.count >= 1 && row.count <= 200)) {
        errors.push(`Row ${name}: spot count must be 1-200`);
      }
      if (row.angled && row.angled !== 'left' && row.angled !== 'right') {
        errors.push(`Row ${name}: angle must be left or right`);
      }
      if (row.maxSize && !SIZE_RANK[row.maxSize]) {
        errors.push(`Row ${name}: bad max size`);
      }
      if (!Number.isFinite(row.x) || !Number.isFinite(row.y)) {
        errors.push(`Row ${name}: position must be numbers`);
      }
    });
    // Labels like "A" + "A1" could produce clashing spot ids ("A11").
    const ids = new Set();
    for (const s of expandLot(lot).spots) {
      if (ids.has(s.id)) {
        errors.push(`Spot id ${s.id} appears twice; rename a row`);
        break;
      }
      ids.add(s.id);
    }
    return errors;
  }

  return {
    SIZES,
    SIZE_RANK,
    SIZE_LABELS,
    SIZE_HINTS,
    WEIGHTS,
    SPOT_W,
    SPOT_D,
    isBig,
    fits,
    expandLot,
    occupancy,
    chooseSpot,
    parkDirection,
    directionLabel,
    usherInstruction,
    capacity,
    validateLot,
  };
});
