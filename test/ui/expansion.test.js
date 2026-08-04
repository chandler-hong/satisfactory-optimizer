import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeState, DEFAULT_STATE, uncoveredToRows, computeExpansionResult } from '../../js/ui/expansion.js';
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';

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

test('computeExpansionResult: ok:true with a plan/goalViews/shortfallRows for a normal input', () => {
  const result = computeExpansionResult({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'rod', rate: 15 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [],
    goals: [],
    fillMinutes: 10,
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.feasible, true);
  assert.deepEqual(result.goalViews, []);
  assert.deepEqual(result.shortfallRows, []);
});

/**
 * Pins the real bug behind Fix 1: a want rate big enough that the LP sizes
 * `rod`'s load past what physical-layer.js's allocateShards can handle blows
 * up with RangeError: Maximum call stack size exceeded (its shard search
 * spreads one options array per recipe into Math.max — see recipeOptions /
 * allocateShards in js/engine/physical-layer.js). This is the same class of
 * crash a large block-machines count or an extreme want rate can trigger
 * through the real dataset; reproduced here against the tiny iron-chain
 * fixture, at a rate rate that's already unreachable through any realistic
 * base/have/want combination, purely to force the LP to size `rod` that big.
 * computeExpansionResult must catch it and report `{ ok: false }` rather than
 * letting it propagate — that's what keeps recompute() (js/ui/expansion.js)
 * from wiping the rows pane the way buildSecondaryView's error path would.
 */
test('computeExpansionResult: an oversized want rate throws inside the engine, but is caught as ok:false', () => {
  const result = computeExpansionResult({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'rod', rate: 4_000_000 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [],
    goals: [],
    fillMinutes: 10,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof RangeError, `expected a RangeError, got ${result.error}`);
});
