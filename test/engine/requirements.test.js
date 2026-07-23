import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../js/data/normalize.js';
import { miniRaw } from '../fixtures/mini-data.js';
import { producibleClosure } from '../../js/engine/requirements.js';

const ds = normalize(miniRaw);
const ALL = new Set(ds.recipes.map((r) => r.id)); // Recipe_IngotIron_C, Recipe_Plastic_C

test('producibleClosure: ore seed makes iron ingot, not plastic', () => {
  const { producible, firedRecipeIds } = producibleClosure(ds, ALL, ['Desc_OreIron_C']);
  assert.ok(producible.has('Desc_IronIngot_C'));
  assert.ok(!producible.has('Desc_Plastic_C'));
  assert.ok(firedRecipeIds.has('Recipe_IngotIron_C'));
  assert.ok(!firedRecipeIds.has('Recipe_Plastic_C'));
});

test('producibleClosure: oil seed makes plastic + heavy oil residue, not iron', () => {
  const { producible } = producibleClosure(ds, ALL, ['Desc_LiquidOil_C']);
  assert.ok(producible.has('Desc_Plastic_C'));
  assert.ok(producible.has('Desc_HeavyOilResidue_C'));
  assert.ok(!producible.has('Desc_IronIngot_C'));
});

test('producibleClosure: a disabled recipe never fires', () => {
  const onlyPlastic = new Set(['Recipe_Plastic_C']);
  const { producible } = producibleClosure(ds, onlyPlastic, ['Desc_OreIron_C']);
  assert.ok(!producible.has('Desc_IronIngot_C')); // iron recipe disabled
});

test('producibleClosure: seeds are always producible; terminates on a cycle', () => {
  // Inline dataset with an A<->B cycle that can only start from a seed.
  const cyc = {
    rawResourceIds: new Set(['seed']),
    recipes: [
      { id: 'ra', inputs: [{ itemId: 'b', perMin: 1 }], outputs: [{ itemId: 'a', perMin: 1 }] },
      { id: 'rb', inputs: [{ itemId: 'a', perMin: 1 }], outputs: [{ itemId: 'b', perMin: 1 }] },
      { id: 'seedA', inputs: [{ itemId: 'seed', perMin: 1 }], outputs: [{ itemId: 'a', perMin: 1 }] },
    ],
  };
  const { producible } = producibleClosure(cyc, new Set(['ra', 'rb', 'seedA']), ['seed']);
  assert.ok(producible.has('seed') && producible.has('a') && producible.has('b'));
  // Without the seed, the pure A<->B loop must NOT bootstrap itself.
  const none = producibleClosure(cyc, new Set(['ra', 'rb']), []);
  assert.ok(!none.producible.has('a') && !none.producible.has('b'));
});
