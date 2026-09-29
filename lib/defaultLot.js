'use strict';

// PBC's lot, traced from the lot sketch: an L-shaped lot with the Sanctuary
// in the north wing and the North and South Buildings in the main lot.
// All spots are diagonal, so every spot is pull-in forward.
//
// Zones are listed in the order a car drives past them. Assumed drive path
// (confirm with the parking team): enter at the bottom-left, drive east along
// the south lane, north through the middle rows, loop the Sanctuary wing,
// then come back west past L and the North Building to the exit.
//
// Fill order sends the first cars closest to the Sanctuary and deepest into
// the lot, so later cars never have to squeeze past someone parking.
// The end spot of each longer row is van-sized (open space on one side).
function row(id, label, zone, x, y, orientation, count, fillOrder, fillFrom, spots) {
  return {
    id, label, zone, x, y, orientation, count, fillOrder, fillFrom,
    angled: 'right', park: 'front', maxSize: 'large', spots: spots || {},
  };
}

const van = (...nums) => Object.fromEntries(nums.map((n) => [n, { maxSize: 'van' }]));

module.exports = {
  name: 'PBC Lot',
  overflowNote: 'Lot is full: send to overflow parking and have an usher walk them in.',
  zones: [
    { id: 'entrance', name: 'Entrance Lane' },
    { id: 'middle', name: 'Middle Rows' },
    { id: 'sanctuary', name: 'Sanctuary' },
    { id: 'exit', name: 'Exit Side' },
  ],
  markers: [
    { x: -7, y: 41, text: 'ENTRANCE ➜' },
    { x: -7, y: 28.8, text: '⬅ EXIT' },
    { x: 37.2, y: 13, text: 'SANCTUARY' },
    { x: 10.5, y: 35.6, text: 'NORTH BLDG' },
    { x: 41.6, y: 44.9, text: 'SOUTH BLDG' },
  ],
  rows: [
    // Sanctuary wing
    row('r-h', 'H', 'sanctuary', 32, 6, 'vertical', 15, 1, 'start'),
    row('r-i', 'I', 'sanctuary', 45.5, 6, 'vertical', 15, 2, 'start'),
    row('r-j', 'J', 'sanctuary', 35.5, 0, 'horizontal', 10, 3, 'start', van(1, 10)),
    // Middle rows
    row('r-f', 'F', 'middle', 26, 30, 'horizontal', 12, 4, 'end', van(12)),
    row('r-e', 'E', 'middle', 26, 34.5, 'horizontal', 12, 5, 'end', van(12)),
    row('r-d', 'D', 'middle', 26, 36.5, 'horizontal', 12, 6, 'end', van(12)),
    // Exit side
    row('r-l', 'L', 'exit', 21, 24.5, 'horizontal', 10, 7, 'start', van(1)),
    // Entrance lane
    row('r-a', 'A', 'entrance', 20, 42.5, 'horizontal', 18, 8, 'end', van(18)),
    row('r-m', 'M', 'entrance', 40, 39, 'vertical', 4, 9, 'start'),
    // Around the North Building (near the entrance and exit, so they fill last)
    row('r-g', 'G', 'exit', 20.5, 33, 'vertical', 5, 10, 'start'),
    row('r-c', 'C', 'exit', 6.5, 33, 'vertical', 5, 11, 'start'),
    row('r-k', 'K', 'entrance', 4.5, 42, 'horizontal', 10, 12, 'end', van(10)),
    row('r-b', 'B', 'exit', 0.5, 33, 'vertical', 5, 13, 'start'),
  ],
};
