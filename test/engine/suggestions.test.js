import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestAlternates } from '../../js/engine/suggestions.js';

const io = (itemId, perMin) => ({ itemId, perMin });
const R = (id, alternate, inputs, outputs) => ({ id, name: id, buildingId: 'b', alternate, inputs, outputs });
function ds(rawIds, itemNames, recipes) {
  return {
    items: new Map(Object.entries(itemNames).map(([id, name]) => [id, { id, name, slug: id, liquid: false }])),
    buildings: new Map([['b', { id: 'b', name: 'B', slug: 'b', basePowerMW: 4, powerExponent: 1.321928 }]]),
    rawResourceIds: new Set(rawIds),
    recipes,
  };
}

test('max: a higher-yield alternate is suggested with an output benefit', () => {
  const dataset = ds(['ore'], { ore: 'Ore', ingot: 'Ingot' }, [
    R('ingotBase', false, [io('ore', 60)], [io('ingot', 60)]),
    R('ingotAlt', true, [io('ore', 60)], [io('ingot', 120)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['ingotBase']),
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
  });
  assert.equal(out.suggestions.length, 1);
  assert.equal(out.suggestions[0].recipeId, 'ingotAlt');
  assert.equal(out.suggestions[0].benefit.kind, 'output');
  assert.ok(out.suggestions[0].benefit.deltaSets > 59, 'about +60 sets'); // 120-60
});

test('targets: a machine-saving alternate is suggested', () => {
  const dataset = ds(['ore'], { ore: 'Ore', screw: 'Screw' }, [
    R('screwBase', false, [io('ore', 10)], [io('screw', 40)]),
    R('screwCast', true, [io('ore', 12.5)], [io('screw', 100)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 1000]]), enabledRecipeIds: new Set(['screwBase']),
    mode: 'targets', targets: { screw: 200 },
  });
  const s = out.suggestions.find((x) => x.recipeId === 'screwCast');
  assert.ok(s, 'cast screw suggested');
  assert.equal(s.benefit.kind, 'machines');
  assert.equal(s.benefit.deltaMachines, 3); // 5 -> 2
});

test('targets: an alternate that resolves a shortfall is suggested', () => {
  const dataset = ds(['a', 'b'], { a: 'A', b: 'B', widget: 'Widget' }, [
    R('wBase', false, [io('b', 10)], [io('widget', 10)]),
    R('wAlt', true, [io('a', 10)], [io('widget', 10)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['a', 10]]), enabledRecipeIds: new Set(['wBase']), // only A available
    mode: 'targets', targets: { widget: 10 },
  });
  const s = out.suggestions.find((x) => x.recipeId === 'wAlt');
  assert.ok(s, 'alt using the available raw is suggested');
  assert.equal(s.benefit.kind, 'targets');
  assert.ok(s.benefit.deltaShortfall > 9, 'resolves ~10/min shortfall');
});

test('no suggestions when all alternates are already enabled', () => {
  const dataset = ds(['ore'], { ore: 'Ore', ingot: 'Ingot' }, [
    R('ingotBase', false, [io('ore', 60)], [io('ingot', 60)]),
    R('ingotAlt', true, [io('ore', 60)], [io('ingot', 120)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['ingotBase', 'ingotAlt']),
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
  });
  assert.deepEqual(out.suggestions, []);
  assert.equal(out.capped, false);
});

test('an alternate the optimum never uses is not suggested', () => {
  const dataset = ds(['ore'], { ore: 'Ore', ingot: 'Ingot' }, [
    R('ingotBase', false, [io('ore', 60)], [io('ingot', 60)]),
    R('ingotGood', true, [io('ore', 60)], [io('ingot', 120)]),
    R('ingotBad', true, [io('ore', 60)], [io('ingot', 30)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['ingotBase']),
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
  });
  assert.equal(out.suggestions.length, 1);
  assert.equal(out.suggestions[0].recipeId, 'ingotGood');
  assert.ok(!out.suggestions.some((s) => s.recipeId === 'ingotBad'));
});

test('respects the maxCandidates cap', () => {
  const dataset = ds(['ore'], { ore: 'Ore', sa: 'ScrewA', sb: 'ScrewB' }, [
    R('baseA', false, [io('ore', 10)], [io('sa', 40)]),
    R('baseB', false, [io('ore', 10)], [io('sb', 40)]),
    R('castA', true, [io('ore', 12.5)], [io('sa', 100)]),
    R('castB', true, [io('ore', 12.5)], [io('sb', 100)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 1000]]), enabledRecipeIds: new Set(['baseA', 'baseB']),
    mode: 'targets', targets: { sa: 200, sb: 200 },
  }, { maxCandidates: 1 });
  assert.equal(out.capped, true);
  assert.ok(out.suggestions.length <= 1);
});
