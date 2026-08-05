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

/**
 * State outlives the code that wrote it, so the clamp can't live only at the
 * input. A payload from an older build, hand-edited, or pasted from someone else
 * has to come back inside the same bounds the live inputs enforce — otherwise a
 * value the UI would now refuse gets replayed straight into the plan at boot.
 */
test('sanitizeState: clamps magnitudes a stored payload could still carry', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'r', machines: 1e12, clock: 1 },
    { kind: 'want', itemId: 'a', rate: 1e10 },
    { kind: 'have', itemId: 'b', rate: -5 },
    { kind: 'block', recipeId: 'r2', machines: 3, clock: -0.5 },
  ] });
  assert.equal(s.rows[0].machines, 9999, 'machines clamp to MAX_MACHINES');
  assert.equal(s.rows[1].rate, 1e6, 'rates clamp to MAX_RATE');
  assert.equal(s.rows[2].rate, 0, 'a negative rate floors at 0');
  assert.equal(s.rows[3].clock, 1, 'and an invalid clock normalizes to 100%, same as the engine');
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
 * A want rate this size used to blow up: the LP sized `rod`'s load past what
 * physical-layer.js's allocateShards could handle and it threw RangeError
 * (recipeOptions built one candidate object per integer machine count, and
 * allocateShards spread that array into Math.max). recipeOptions is bounded to
 * one candidate per shard level now, so the load no longer drives the
 * allocation size and this solves cleanly instead of throwing.
 *
 * Kept as a regression guard at the UI boundary: this rate is unreachable
 * through any realistic base/have/want combination, so if it ever throws again
 * something has reintroduced a load-proportional allocation.
 */
test('computeExpansionResult: an oversized want rate no longer crashes the engine', () => {
  const result = computeExpansionResult({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'rod', rate: 4_000_000 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [],
    goals: [],
    fillMinutes: 10,
  });
  assert.equal(result.ok, true, `expected a clean solve, got ${result.error}`);
  assert.equal(result.plan.feasible, true);
});

/**
 * Pins Fix 1's guard itself, independently of any particular engine crash. The
 * previous version of this test used an oversized want rate to trigger a real
 * RangeError, which pinned the catch only for as long as that specific crash
 * existed — bounding recipeOptions removed the crash and silently un-pinned the
 * guard. Injecting the fault instead keeps the contract under test: whatever
 * the engine throws, computeExpansionResult reports { ok: false } and hands the
 * error back, which is what stops recompute() (js/ui/expansion.js) from letting
 * it reach buildSecondaryView's error path and wipe the rows pane.
 */
test('computeExpansionResult: an engine throw is caught and reported as ok:false', () => {
  const exploding = Object.defineProperty({ ...ironChain }, 'recipes', {
    get() { throw new Error('dataset access exploded'); },
  });
  const result = computeExpansionResult({
    dataset: exploding,
    rows: [{ kind: 'want', itemId: 'rod', rate: 15 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [],
    goals: [],
    fillMinutes: 10,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.message, 'dataset access exploded');
});

test('sanitizeState: alts keeps known recipe id strings and nothing else', () => {
  const s = sanitizeState({ alts: ['ingot', 42, null, 'not-a-recipe', 'plate'] }, new Set(['ingot', 'plate']));
  assert.deepEqual(s.alts, ['ingot', 'plate'], 'non-strings and unknown ids are dropped');
});

test('sanitizeState: alts defaults to empty, so alternates start off', () => {
  assert.deepEqual(sanitizeState(null).alts, []);
  assert.deepEqual(sanitizeState({}).alts, []);
  assert.deepEqual(sanitizeState({ alts: 'nope' }).alts, []);
});

test('sanitizeState: without a known-id set, alt ids are kept as-is', () => {
  // The boot path passes the set; callers that don't care skip the filter.
  assert.deepEqual(sanitizeState({ alts: ['anything'] }).alts, ['anything']);
});

test('sanitizeState: a knownRecipeIds argument without a .has method is ignored, not thrown', () => {
  // Feature-test the second argument rather than trusting its type: an array
  // (one refactor away from the Set the boot path builds today) or a plain
  // object both lack .has, and must degrade to "skip the filter" like an
  // omitted argument — not throw. loadState wraps sanitizeState in try/catch,
  // so a throw here wouldn't just fail to filter; it would discard the user's
  // entire saved plan and fall back to defaults.
  assert.deepEqual(sanitizeState({ alts: ['ingot'] }, ['ingot']).alts, ['ingot']);
  assert.deepEqual(sanitizeState({ alts: ['ingot'] }, {}).alts, ['ingot']);
});

// --- Wave B test hardening ---------------------------------------------------

test('sanitizeState (D8): alts drops non-string entries even with no knownRecipeIds argument at all', () => {
  // The two existing alts tests above either supply a knownRecipeIds Set (whose
  // .has() safely returns false for a non-string, masking a missing type
  // filter) or supply only strings (which a missing type filter would also let
  // through unchanged). Neither can catch the type filter being removed; this
  // scenario — a non-string, no knownRecipeIds — can only pass if the
  // `typeof id === 'string'` filter itself is doing the work.
  assert.deepEqual(sanitizeState({ alts: ['x', 42] }).alts, ['x'], 'a non-string alt id must be dropped even when no known-id set is supplied');
});
