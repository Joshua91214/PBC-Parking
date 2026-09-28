'use strict';

// A sample lot so the app works out of the box. Replace it in Setup with your
// real layout. Zones are listed in the order a car drives past them.
module.exports = {
  name: 'PBC Main Lot',
  overflowNote: 'Lot is full: send to the overflow parking and have an usher walk them in.',
  zones: [
    { id: 'front', name: 'Front (Entrance)' },
    { id: 'middle', name: 'Middle' },
    { id: 'back', name: 'Back (by Church)' },
  ],
  markers: [
    { x: -3, y: 4.5, text: 'ENTRANCE ➜' },
    { x: 22, y: 17, text: '⛪ CHURCH' },
  ],
  rows: [
    {
      id: 'r1', label: 'A', zone: 'front', x: 0, y: 0, orientation: 'horizontal',
      count: 12, fillOrder: 5, fillFrom: 'end', park: 'auto', maxSize: 'large',
      spots: { 1: { maxSize: 'van' }, 12: { maxSize: 'van' } },
    },
    {
      id: 'r2', label: 'B', zone: 'front', x: 0, y: 6, orientation: 'horizontal',
      count: 12, fillOrder: 4, fillFrom: 'end', park: 'auto', maxSize: 'large',
      spots: {},
    },
    {
      id: 'r3', label: 'C', zone: 'middle', x: 0, y: 8, orientation: 'horizontal',
      count: 12, fillOrder: 3, fillFrom: 'end', park: 'auto', maxSize: 'large',
      spots: {},
    },
    {
      id: 'r4', label: 'D', zone: 'middle', x: 0, y: 14, orientation: 'horizontal',
      count: 12, fillOrder: 2, fillFrom: 'end', park: 'front', maxSize: 'large',
      spots: { 1: { maxSize: 'van' } },
    },
    {
      id: 'r5', label: 'E', zone: 'back', x: 16, y: 0, orientation: 'vertical',
      count: 12, fillOrder: 1, fillFrom: 'start', park: 'auto', maxSize: 'large',
      spots: {
        11: { reserved: true, note: 'Accessible' },
        12: { reserved: true, note: 'Accessible' },
      },
    },
  ],
};
