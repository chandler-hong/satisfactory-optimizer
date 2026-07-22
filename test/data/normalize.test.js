import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../js/data/normalize.js';
import { miniRaw } from '../fixtures/mini-data.js';

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
