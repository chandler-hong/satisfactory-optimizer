import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeState, DEFAULT_STATE, uncoveredToRows } from '../../js/ui/expansion.js';

test('sanitizeState: null / garbage falls back to defaults', () => {
  assert.deepEqual(sanitizeState(null), DEFAULT_STATE);
  assert.deepEqual(sanitizeState('nope'), DEFAULT_STATE);
  assert.deepEqual(sanitizeState({}), DEFAULT_STATE);
});

test('sanitizeState: drops rows with an unknown kind', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'r', machines: 2, clock: 1 },
    { kind: 'wat', itemId: 'x', rate: 5 },
  ] });
  assert.deepEqual(s.rows.map((r) => r.kind), ['block']);
});

test('sanitizeState: coerces numbers and drops non-numeric rates', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'r', machines: '6', clock: '1.5' },
    { kind: 'want', itemId: 'a', rate: 'abc' },
    { kind: 'have', itemId: 'b', rate: '300' },
  ] });
  assert.deepEqual(s.rows[0], { kind: 'block', recipeId: 'r', machines: 6, clock: 1.5 });
  assert.equal(s.rows.length, 2, 'the non-numeric rate row is dropped');
  assert.deepEqual(s.rows[1], { kind: 'have', itemId: 'b', rate: 300 });
});

test('sanitizeState: keeps only string goal ids and a positive fillMinutes', () => {
  const s = sanitizeState({ goals: ['a', 7, null, 'b'], fillMinutes: -3 });
  assert.deepEqual(s.goals, ['a', 'b']);
  assert.equal(s.fillMinutes, 10, 'a non-positive horizon falls back to the default');
});

test('uncoveredToRows: one want row per uncovered part, de-duplicated across goals', () => {
  const views = [
    { id: 'g1', uncovered: [{ itemId: 'a', name: 'A', rate: 20 }, { itemId: 'b', name: 'B', rate: 5 }] },
    { id: 'g2', uncovered: [{ itemId: 'a', name: 'A', rate: 50 }] },
  ];
  const rows = uncoveredToRows(views);
  assert.deepEqual(rows, [
    { kind: 'want', itemId: 'a', rate: 50 },
    { kind: 'want', itemId: 'b', rate: 5 },
  ], 'the same item across two goals takes the higher rate, not the sum');
});

test('uncoveredToRows: nothing uncovered yields no rows', () => {
  assert.deepEqual(uncoveredToRows([{ id: 'g', uncovered: [] }]), []);
});
