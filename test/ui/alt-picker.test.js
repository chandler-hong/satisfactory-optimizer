import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRows, bulkLabel } from '../../js/ui/alt-picker.js';

// createAltPicker itself needs a DOM, which the suite deliberately has no shim
// for (see README) — so the two decisions the bulk buttons got wrong are
// exported as pure functions and pinned here. `filterRows` is the single
// source of truth for "which rows is the user actually looking at": the search
// handler hides everything it excludes, and Enable/Disable all act on exactly
// what it returns. `bulkLabel` is what stops the two scopes being confusable.

const rows = [
  { name: 'Iron Alloy Ingot' },
  { name: 'Pure Iron Ingot' },
  { name: 'Coated Iron Plate' },
  { name: 'Copper Rotor' },
  { name: 'Steel Rod' },
];

test('filterRows: an empty query shows every row', () => {
  assert.equal(filterRows(rows, '').length, rows.length);
  assert.equal(filterRows(rows, '   ').length, rows.length);
  assert.equal(filterRows(rows, undefined).length, rows.length);
});

test('filterRows: case-insensitive substring match on the recipe name', () => {
  assert.deepEqual(filterRows(rows, 'iron').map((r) => r.name),
    ['Iron Alloy Ingot', 'Pure Iron Ingot', 'Coated Iron Plate']);
  assert.deepEqual(filterRows(rows, '  IRON ').map((r) => r.name),
    ['Iron Alloy Ingot', 'Pure Iron Ingot', 'Coated Iron Plate']);
  assert.deepEqual(filterRows(rows, 'rotor').map((r) => r.name), ['Copper Rotor']);
  assert.deepEqual(filterRows(rows, 'nothing matches this'), []);
});

test('filterRows: returns the rows themselves, so callers can act on them', () => {
  // Not names or indices — the bulk buttons tick the checkbox on each entry.
  assert.equal(filterRows(rows, 'rotor')[0], rows[3]);
});

test('bulkLabel: says "all" only when the list really is all of it', () => {
  assert.equal(bulkLabel('Enable', 110, 110), 'Enable all');
  assert.equal(bulkLabel('Disable', 110, 110), 'Disable all');
});

test('bulkLabel: names the narrowed scope while a filter is active', () => {
  // The bug this replaces: filter to `iron`, 11 of 110 rows visible, press
  // "Enable all", summary reads 110/110. Whichever scope the button uses, the
  // label has to say so.
  assert.equal(bulkLabel('Enable', 11, 110), 'Enable 11 shown');
  assert.equal(bulkLabel('Disable', 11, 110), 'Disable 11 shown');
  assert.equal(bulkLabel('Enable', 0, 110), 'Enable 0 shown');
  assert.equal(bulkLabel('Enable', 1, 110), 'Enable 1 shown');
});
