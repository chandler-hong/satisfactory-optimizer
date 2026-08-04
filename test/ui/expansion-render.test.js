import test from 'node:test';
import assert from 'node:assert/strict';
import { planExpansion } from '../../js/engine/expansion.js';
import { hasContent, hasDiagnostics } from '../../js/ui/expansion-render.js';
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
