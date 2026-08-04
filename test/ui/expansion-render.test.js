import test from 'node:test';
import assert from 'node:assert/strict';
import { planExpansion } from '../../js/engine/expansion.js';
import { hasContent } from '../../js/ui/expansion-render.js';
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';

test('hasContent: a truly empty plan (no rows) has nothing to show', () => {
  const p = planExpansion({ dataset: ironChain, rows: [], enabledRecipeIds: ALL_IRON_RECIPES });
  assert.equal(hasContent(p), false);
});

/**
 * Pins Fix 3: an unmakeable want produces zero build rows (nothing to feed
 * into the eight report panels) but a non-empty requirements/shortfalls, so
 * hasContent() must still return true — otherwise renderPlan falls back to
 * the "add a block" empty-state hint instead of the diagnostic callout.
 * Same scenario test/engine/expansion.test.js already proves produces both
 * requirements.hasIssues and a shortfall simultaneously: only the ingot
 * recipe is enabled, so plate can never be made.
 */
test('hasContent: an impossible target with no build rows still has content (the requirements callout)', () => {
  const p = planExpansion({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'plate', rate: 20 }],
    enabledRecipeIds: new Set(['ingot']),
  });
  assert.equal(p.buildRows.length, 0, 'sanity check: nothing can be built');
  assert.equal(p.requirements.hasIssues, true);
  assert.equal(p.shortfalls.length, 1);
  assert.equal(hasContent(p), true);
});
