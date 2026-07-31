import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../js/data/normalize.js';
import { buildCodexModel } from '../../js/domain/codex.js';
import { codexRaw } from '../fixtures/codex-data.js';

const model = () => buildCodexModel(normalize(codexRaw));
const find = (m, name) => m.items.find((i) => i.name === name);

test('excludes special__ pseudo-items and sorts the rest alphabetically', () => {
  const m = model();
  assert.equal(m.items.some((i) => i.id.startsWith('special__')), false);
  assert.deepEqual(m.items.map((i) => i.name), [
    'Crude Oil', 'Heavy Oil Residue', 'Iron Ingot', 'Iron Ore', 'Iron Plate', 'Plastic', 'Somersloop',
  ]);
  assert.equal(m.byId.has('special__power'), false);
});

test('madeIn lists producers, standard recipes before alternates', () => {
  const plate = find(model(), 'Iron Plate');
  assert.deepEqual(plate.madeIn.map((r) => r.name), ['Iron Plate', 'Cast Plate']);
  assert.equal(plate.madeIn[0].alternate, false);
  assert.equal(plate.madeIn[1].alternate, true);
});

test('usedIn lists consumers; an item can be both made and used', () => {
  const ingot = find(model(), 'Iron Ingot');
  assert.deepEqual(ingot.madeIn.map((r) => r.name), ['Iron Ingot', 'Pure Iron Ingot']);
  assert.deepEqual(ingot.usedIn.map((r) => r.name), ['Iron Plate', 'Cast Plate']);
});

test('a byproduct-only product still lists its producer', () => {
  const residue = find(model(), 'Heavy Oil Residue');
  assert.deepEqual(residue.madeIn.map((r) => r.name), ['Plastic']);
  assert.deepEqual(residue.usedIn, []);
});

test('an item with no machine recipe has empty madeIn and usedIn', () => {
  const sloop = find(model(), 'Somersloop');
  assert.deepEqual(sloop.madeIn, []);
  assert.deepEqual(sloop.usedIn, []);
});

test('recipe rows carry per-craft amounts and craft time, not per-minute rates', () => {
  const r = find(model(), 'Iron Plate').madeIn[0];
  assert.equal(r.timeSec, 6);
  assert.equal(r.inputs[0].amount, 3);   // per craft; perMin would be 30
  assert.equal(r.outputs[0].amount, 2);  // per craft; perMin would be 20
  assert.equal(r.buildingName, 'Constructor');
  assert.equal(r.buildingSlug, 'constructor');
});

test('multi-product recipes keep every product', () => {
  const r = find(model(), 'Plastic').madeIn[0];
  assert.deepEqual(r.outputs.map((o) => o.name), ['Plastic', 'Heavy Oil Residue']);
  assert.deepEqual(r.outputs.map((o) => o.amount), [2, 1]);
});

test('fluid and raw flags propagate to items and to recipe io', () => {
  const m = model();
  const oil = find(m, 'Crude Oil');
  assert.equal(oil.liquid, true);
  assert.equal(oil.raw, true);
  assert.equal(oil.energyValue, 320);
  assert.equal(find(m, 'Iron Plate').raw, false);
  const input = find(m, 'Plastic').madeIn[0].inputs[0];
  assert.equal(input.name, 'Crude Oil');
  assert.equal(input.liquid, true);
  assert.equal(input.slug, 'crude-oil');
});

test('item description and stats come through', () => {
  const ingot = find(model(), 'Iron Ingot');
  assert.equal(ingot.stackSize, 100);
  assert.equal(ingot.sinkPoints, 2);
  assert.match(ingot.description, /Smelted from Iron Ore/);
});

test('unlock: a milestone source wins over a MAM source for the same recipe', () => {
  const r = find(model(), 'Iron Plate').madeIn.find((x) => x.name === 'Iron Plate');
  assert.equal(r.unlock.kind, 'milestone');
  assert.equal(r.unlock.tier, 1);
  assert.equal(r.unlock.label, 'Tier 1 · Base Building');
});

test('unlock: a MAM label carries its research name and tier', () => {
  const r = find(model(), 'Plastic').madeIn[0];
  assert.equal(r.unlock.kind, 'mam');
  assert.equal(r.unlock.label, 'MAM · Polymers · Tier 3');
});

test('unlock: hard-drive alternates drop the redundant name; tier 0 is omitted', () => {
  const m = model();
  const cast = find(m, 'Iron Plate').madeIn.find((r) => r.name === 'Cast Plate');
  assert.equal(cast.unlock.kind, 'alternate');
  assert.equal(cast.unlock.label, 'Hard Drive · Tier 4');
  const pure = find(m, 'Iron Ingot').madeIn.find((r) => r.name === 'Pure Iron Ingot');
  assert.equal(pure.unlock.label, 'Hard Drive');
});

test('unlock is null when no schematic grants the recipe', () => {
  const r = find(model(), 'Iron Ingot').madeIn.find((x) => x.name === 'Iron Ingot');
  assert.equal(r.unlock, null);
});

test('building name falls back to the raw id when the building is unknown', () => {
  const ds = {
    items: new Map([['a', { id: 'a', name: 'A', slug: 'a', liquid: false }]]),
    buildings: new Map(),
    rawResourceIds: new Set(),
    recipeUnlocks: new Map(),
    recipes: [{
      id: 'r', name: 'R', buildingId: 'Desc_Missing_C', alternate: false, timeSec: 4,
      inputs: [], outputs: [{ itemId: 'a', perMin: 60, amount: 4 }],
    }],
  };
  const r = buildCodexModel(ds).byId.get('a').madeIn[0];
  assert.equal(r.buildingName, 'Desc_Missing_C');
  assert.equal(r.buildingSlug, undefined);
});

// Real cases: Encased Uranium Cell (Sulfuric Acid in and out) and two of the
// water-recycling alternates.
test('an item on both sides of one recipe is listed once in each direction', () => {
  const ds = {
    items: new Map([
      ['acid', { id: 'acid', name: 'Sulfuric Acid', slug: 'acid', liquid: true }],
      ['cell', { id: 'cell', name: 'Encased Uranium Cell', slug: 'cell', liquid: false }],
    ]),
    buildings: new Map([['b', { id: 'b', name: 'Blender', slug: 'blender' }]]),
    rawResourceIds: new Set(),
    recipeUnlocks: new Map(),
    recipes: [{
      id: 'r', name: 'Encased Uranium Cell', buildingId: 'b', alternate: false, timeSec: 12,
      inputs: [{ itemId: 'acid', perMin: 40, amount: 8 }],
      outputs: [
        { itemId: 'cell', perMin: 25, amount: 5 },
        { itemId: 'acid', perMin: 10, amount: 2 },
      ],
    }],
  };
  const acid = buildCodexModel(ds).byId.get('acid');
  assert.equal(acid.madeIn.length, 1, 'listed once as a product');
  assert.equal(acid.usedIn.length, 1, 'listed once as an ingredient');
  assert.equal(acid.madeIn[0], acid.usedIn[0], 'the same recipe row in both lists');
});

test('unlock: a HUB tutorial reads as Onboarding; an unknown type keeps the schematic name', () => {
  const recipe = (id) => ({
    id, name: id, buildingId: 'b', alternate: false, timeSec: 2,
    inputs: [], outputs: [{ itemId: 'a', perMin: 30, amount: 1 }],
  });
  const ds = {
    items: new Map([['a', { id: 'a', name: 'Part', slug: 'a', liquid: false }]]),
    buildings: new Map([['b', { id: 'b', name: 'Constructor', slug: 'constructor' }]]),
    rawResourceIds: new Set(),
    recipeUnlocks: new Map([
      ['tutorial', [{ name: 'HUB Upgrade 3', type: 'EST_Tutorial', tier: 0 }]],
      ['unknown', [{ name: 'Mystery Program', type: 'EST_Something_New', tier: 5 }]],
    ]),
    recipes: [recipe('tutorial'), recipe('unknown')],
  };
  const rows = buildCodexModel(ds).byId.get('a').madeIn;
  const tutorial = rows.find((r) => r.id === 'tutorial');
  assert.equal(tutorial.unlock.kind, 'tutorial');
  assert.equal(tutorial.unlock.label, 'Onboarding · HUB Upgrade 3');
  const unknown = rows.find((r) => r.id === 'unknown');
  assert.equal(unknown.unlock.kind, 'other');
  assert.equal(unknown.unlock.label, 'Mystery Program');
});
