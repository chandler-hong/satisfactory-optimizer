import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../js/data/normalize.js';
import { miniRaw } from '../fixtures/mini-data.js';
import { codexRaw } from '../fixtures/codex-data.js';

test('maps items with the liquid flag and name', () => {
  const ds = normalize(miniRaw);
  assert.equal(ds.items.get('Desc_LiquidOil_C').liquid, true);
  assert.equal(ds.items.get('Desc_IronIngot_C').liquid, false);
  assert.equal(ds.items.get('Desc_IronIngot_C').name, 'Iron Ingot');
});

test('computes solid per-minute rates and building', () => {
  const ds = normalize(miniRaw);
  const iron = ds.recipes.find((r) => r.id === 'Recipe_IngotIron_C');
  assert.equal(iron.inputs[0].perMin, 30);   // 1 ore / 2s * 60
  assert.equal(iron.outputs[0].perMin, 30);
  assert.equal(iron.buildingId, 'Desc_SmelterMk1_C');
});

test('computes fluid per-minute rates (fluids already in m3, no x1000 scaling)', () => {
  const ds = normalize(miniRaw);
  const p = ds.recipes.find((r) => r.id === 'Recipe_Plastic_C');
  assert.equal(p.inputs.find((i) => i.itemId === 'Desc_LiquidOil_C').perMin, 30);   // 3 /6s*60
  assert.equal(p.outputs.find((o) => o.itemId === 'Desc_Plastic_C').perMin, 20);    // 2 /6s*60
  assert.equal(p.outputs.find((o) => o.itemId === 'Desc_HeavyOilResidue_C').perMin, 10); // 1 /6s*60
});

test('excludes non-machine recipes', () => {
  const ds = normalize(miniRaw);
  assert.equal(ds.recipes.find((r) => r.id === 'Recipe_Manual_Only_C'), undefined);
  assert.equal(ds.recipes.length, 2);
});

test('collects raw resource ids from resources', () => {
  const ds = normalize(miniRaw);
  assert.ok(ds.rawResourceIds.has('Desc_OreIron_C'));
  assert.ok(ds.rawResourceIds.has('Desc_LiquidOil_C'));
  assert.equal(ds.rawResourceIds.has('Desc_IronIngot_C'), false);
});

test('maps building base power and exponent (with default)', () => {
  const ds = normalize(miniRaw);
  assert.equal(ds.buildings.get('Desc_OilRefinery_C').basePowerMW, 30);
  assert.equal(ds.buildings.get('Desc_SmelterMk1_C').powerExponent, 1.321928);
  assert.equal(ds.buildings.get('Desc_ConstructorMk1_C').powerExponent, 1.321928); // default
});

test('normalize carries building slug', () => {
  const ds = normalize(miniRaw);
  assert.equal(ds.buildings.get('Desc_OilRefinery_C').slug, 'refinery');
});

test('carries item description, stack size and sink points', () => {
  const ds = normalize(codexRaw);
  const ingot = ds.items.get('Desc_IronIngot_C');
  assert.equal(ingot.description, 'Used for crafting.\nSmelted from Iron Ore.');
  assert.equal(ingot.stackSize, 100);
  assert.equal(ingot.sinkPoints, 2);
  assert.equal(ds.items.get('Desc_LiquidOil_C').energyValue, 320);
});

test('item description/stack/sink default when the raw data omits them', () => {
  const ds = normalize(miniRaw); // mini fixture has none of these fields
  const ore = ds.items.get('Desc_OreIron_C');
  assert.equal(ore.description, '');
  assert.equal(ore.stackSize, 0);
  assert.equal(ore.sinkPoints, 0);
});

test('keeps craft time and per-craft amounts alongside per-minute rates', () => {
  const ds = normalize(codexRaw);
  const plate = ds.recipes.find((r) => r.id === 'Recipe_IronPlate_C');
  assert.equal(plate.timeSec, 6);
  assert.equal(plate.inputs[0].amount, 3);
  assert.equal(plate.inputs[0].perMin, 30);  // 3 / 6s * 60
  assert.equal(plate.outputs[0].amount, 2);
  assert.equal(plate.outputs[0].perMin, 20); // 2 / 6s * 60
});

test('inverts schematics into recipeUnlocks, keeping every source', () => {
  const ds = normalize(codexRaw);
  const plateSources = ds.recipeUnlocks.get('Recipe_IronPlate_C');
  assert.equal(plateSources.length, 2);
  assert.deepEqual(
    [...plateSources].map((s) => s.type).sort(),
    ['EST_MAM', 'EST_Milestone'],
  );
  const milestone = plateSources.find((s) => s.type === 'EST_Milestone');
  assert.equal(milestone.name, 'Base Building');
  assert.equal(milestone.tier, 1);
  assert.equal(ds.recipeUnlocks.has('Recipe_IngotIron_C'), false);
});

test('recipeUnlocks is an empty Map when the dataset has no schematics', () => {
  const ds = normalize({ items: {}, buildings: {}, recipes: {}, resources: {} });
  assert.ok(ds.recipeUnlocks instanceof Map);
  assert.equal(ds.recipeUnlocks.size, 0);
});
