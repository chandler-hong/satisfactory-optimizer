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

test('strips the redundant "Alternate: " prefix from recipe names', () => {
  const ds = normalize({
    items: { A: { className: 'A', name: 'Part' } },
    buildings: { B: { className: 'B', name: 'Builder', slug: 'builder', metadata: {} } },
    resources: {},
    recipes: {
      R1: {
        className: 'R1', name: 'Alternate: Cast Plate', alternate: true, inMachine: true, time: 4,
        ingredients: [], products: [{ item: 'A', amount: 1 }], producedIn: ['B'],
      },
      R2: {
        className: 'R2', name: 'Iron Plate', alternate: false, inMachine: true, time: 4,
        ingredients: [], products: [{ item: 'A', amount: 1 }], producedIn: ['B'],
      },
    },
  });
  const alt = ds.recipes.find((r) => r.id === 'R1');
  assert.equal(alt.name, 'Cast Plate');
  assert.equal(alt.alternate, true, 'the alternate flag still carries the meaning');
  assert.equal(ds.recipes.find((r) => r.id === 'R2').name, 'Iron Plate');
});

// The unlock sort compares these with localeCompare, so a malformed schematic
// after a dataset bump must degrade rather than throw.
test('coerces a malformed schematic name/type instead of passing it through', () => {
  const ds = normalize({
    items: {}, buildings: {}, recipes: {}, resources: {},
    schematics: {
      S1: { className: 'S1', name: null, type: 42, tier: '3', unlock: { recipes: ['R1'] } },
    },
  });
  const [source] = ds.recipeUnlocks.get('R1');
  assert.equal(source.name, '');
  assert.equal(source.type, '');
  assert.equal(source.tier, 0, 'a non-numeric tier falls back to 0');
});

test('keeps milestone part costs as dataset.goals', () => {
  const ds = normalize({
    items: {}, buildings: {}, recipes: {}, resources: {},
    schematics: {
      'Schematic_3-1_C': {
        className: 'Schematic_3-1_C', name: 'Coal Power', type: 'EST_Milestone', tier: 3, time: 480,
        cost: [
          { item: 'Desc_IronPlateReinforced_C', amount: 150 },
          { item: 'Desc_Rotor_C', amount: 50 },
        ],
        unlock: { recipes: [] },
      },
    },
  });
  assert.equal(ds.goals.length, 1);
  assert.deepEqual(ds.goals[0], {
    id: 'Schematic_3-1_C',
    name: 'Coal Power',
    tier: 3,
    cost: [
      { itemId: 'Desc_IronPlateReinforced_C', amount: 150 },
      { itemId: 'Desc_Rotor_C', amount: 50 },
    ],
    timeSec: 480,
  });
});

test('dataset.goals excludes non-milestone schematic types', () => {
  const ds = normalize({
    items: {}, buildings: {}, recipes: {}, resources: {},
    schematics: {
      M:  { className: 'M',  name: 'Mile', type: 'EST_Milestone', tier: 1, cost: [{ item: 'A', amount: 5 }], unlock: { recipes: [] } },
      R1: { className: 'R1', name: 'Res',  type: 'EST_MAM',       tier: 3, cost: [{ item: 'B', amount: 10 }], unlock: { recipes: [] } },
      R2: { className: 'R2', name: 'Alt',  type: 'EST_Alternate', tier: 4, cost: [{ item: 'C', amount: 1 }],  unlock: { recipes: [] } },
      R3: { className: 'R3', name: 'Sink', type: 'EST_ResourceSink', tier: 0, cost: [{ item: 'D', amount: 1 }], unlock: { recipes: [] } },
    },
  });
  assert.deepEqual(ds.goals.map((g) => g.id), ['M']);
});

// A dataset bump must degrade, not throw — same posture as the schematic
// name/type coercion above.
test('dataset.goals drops malformed cost entries and cost-less milestones', () => {
  const ds = normalize({
    items: {}, buildings: {}, recipes: {}, resources: {},
    schematics: {
      Good:    { className: 'Good',    name: 'G', type: 'EST_Milestone', tier: '2', cost: [{ item: 'A', amount: '25' }, { item: 42, amount: 5 }, { item: 'B', amount: 0 }, { item: 'C' }], unlock: { recipes: [] } },
      NoCost:  { className: 'NoCost',  name: 'N', type: 'EST_Milestone', tier: 1, unlock: { recipes: [] } },
      Emptied: { className: 'Emptied', name: 'E', type: 'EST_Milestone', tier: 1, cost: [{ item: null, amount: 3 }], unlock: { recipes: [] } },
    },
  });
  assert.deepEqual(ds.goals.map((g) => g.id), ['Good'], 'a milestone with no usable cost is dropped entirely');
  assert.deepEqual(ds.goals[0].cost, [{ itemId: 'A', amount: 25 }], 'a numeric string amount coerces; bad item, zero amount, and missing amount drop');
  assert.equal(ds.goals[0].tier, 0, 'a non-numeric tier falls back to 0');
});
