import test from 'node:test';
import assert from 'node:assert/strict';
import { planExpansion } from '../../js/engine/expansion.js';
import { hasContent, hasDiagnostics, hasFabricatedBuildOut } from '../../js/ui/expansion-render.js';
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';

test('hasContent: a truly empty plan (no rows) has nothing to show', () => {
  const p = planExpansion({ dataset: ironChain, rows: [], enabledRecipeIds: ALL_IRON_RECIPES });
  assert.equal(hasContent(p), false);
  assert.equal(hasDiagnostics(p), false, 'and nothing to explain either, so renderPlan shows the hint');
});

/**
 * Pins Fix 3: an unmakeable want produces zero build rows (nothing to feed into
 * the eight report panels) but a non-empty requirements/shortfalls, so renderPlan
 * must render the diagnostic rather than falling back to the "add a block"
 * empty-state hint. Same scenario test/engine/expansion.test.js already proves
 * produces both requirements.hasIssues and a shortfall simultaneously: only the
 * ingot recipe is enabled, so plate can never be made.
 *
 * The two flags are asserted separately on purpose. hasContent must be FALSE —
 * folding diagnostics into it is what made an unsatisfiable want render a panel
 * of zeroed tiles under its own error message.
 */
test('hasDiagnostics: an impossible target with no build rows has something to explain', () => {
  const p = planExpansion({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'plate', rate: 20 }],
    enabledRecipeIds: new Set(['ingot']),
  });
  assert.equal(p.buildRows.length, 0, 'sanity check: nothing can be built');
  assert.equal(p.requirements.hasIssues, true);
  assert.equal(p.shortfalls.length, 1);
  assert.equal(hasDiagnostics(p), true);
  assert.equal(hasContent(p), false, 'no build to show, so no tiles panel');
});

/**
 * No test for a shortfall WITHOUT a requirements issue, because the engine can't
 * currently produce one: planExpansion leaves raw resources uncapped on purpose
 * (node budgeting is the Optimizer's job), so anything producible is producible
 * at any rate, and the only way to miss a target is for it to be unmakeable —
 * which requirements already reports. Probed with a raw want, an all-recipes
 * want, a 1e6/min want and a have-only plan: shortfalls was 0 in every case
 * where requirements was clean. hasDiagnostics still checks shortfalls so it
 * stays correct if raws ever gain caps here, and to match the Optimizer, where
 * capped resources make the shortfall-only case ordinary.
 */

/**
 * hasFabricatedBuildOut — which half of `bounded: false` renderPlan must hide
 * the build panels for.
 *
 * Both halves report `bounded: false`, and renderPlan used to return on both.
 * Only the RUNAWAY half has anything fabricated to hide; on the ZERO half the
 * return was suppressing the user's own declared blocks, so a zero-output plan
 * showed a suggestions card in a pane with no "Your blocks" table in it.
 */
test('hasFabricatedBuildOut: a runaway max plan hides its clamp-scale build-out', () => {
  const freeStone = { id: 'freeStone', name: 'freeStone', buildingId: 'b', alternate: true, inputs: [], outputs: [{ itemId: 'stone', perMin: 1 }] };
  const dataset = { ...ironChain, recipes: [...ironChain.recipes, freeStone] };
  const p = planExpansion({
    dataset,
    rows: [
      { kind: 'block', recipeId: 'rod', machines: 1, clock: 1 },
      { kind: 'max', itemId: 'stone', weight: 1 },
    ],
    enabledRecipeIds: new Set([...ALL_IRON_RECIPES, 'freeStone']),
    mode: 'max',
  });
  assert.equal(p.maximize.bounded, false);
  assert.ok((p.maximize.sets ?? 0) > 1e-6, 'sanity: this is the unlimited half, not the zero half');
  assert.equal(hasFabricatedBuildOut(p), true);
});

test('hasFabricatedBuildOut: a zero-output max plan has nothing fabricated to hide', () => {
  const p = planExpansion({
    dataset: ironChain,
    rows: [
      { kind: 'block', recipeId: 'rod', machines: 1, clock: 1 },
      { kind: 'max', itemId: 'plate', weight: 1 },
    ],
    // No ingot recipe, so plate has no route at all and the answer is a
    // definite 0 rather than a raw-clamp artefact.
    enabledRecipeIds: new Set(['rod', 'screw']),
    mode: 'max',
  });
  assert.equal(p.maximize.bounded, false, 'a zero solve draws nothing, so it can never report bounded');
  assert.equal(p.maximize.sets, 0);
  assert.equal(hasFabricatedBuildOut(p), false);
  assert.equal(hasContent(p), true, 'and there is real content to show: the declared block itself');
  assert.equal(p.blockRows.length, 1, 'which renderPlan used to suppress');
  assert.equal(p.buildRows.length, 0, 'nothing fabricated: the LP built nothing at all');
});

test('hasFabricatedBuildOut: a bounded max plan and a targets plan both render normally', () => {
  const bounded = planExpansion({
    dataset: ironChain,
    rows: [
      { kind: 'block', recipeId: 'screw', machines: 2, clock: 1 },
      { kind: 'max', itemId: 'rotor', weight: 1 },
    ],
    enabledRecipeIds: ALL_IRON_RECIPES,
    mode: 'max',
  });
  assert.equal(bounded.maximize.bounded, true);
  assert.equal(hasFabricatedBuildOut(bounded), false);

  const targets = planExpansion({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'plate', rate: 20 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
  });
  assert.equal(targets.maximize, undefined, 'targets mode has no maximize block to dereference');
  assert.equal(hasFabricatedBuildOut(targets), false);
});
