import test from 'node:test';
import assert from 'node:assert/strict';
import { beltReport, BELT_CAPACITY, PIPE_CAPACITY } from '../../js/engine/belt-layer.js';

const io = (itemId, perMin) => ({ itemId, perMin });
const dataset = {
  rawResourceIds: new Set(['ore']),
  buildings: new Map(),
  items: new Map([
    ['ore', { id: 'ore', name: 'Ore', slug: 'ore', liquid: false }],
    ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot', liquid: false }],
    ['water', { id: 'water', name: 'Water', slug: 'water', liquid: true }],
  ]),
  recipes: [
    { id: 'smelt', name: 'smelt', buildingId: 'b', alternate: false, inputs: [io('ore', 30)], outputs: [io('ingot', 30)] },
    { id: 'pump', name: 'pump', buildingId: 'b', alternate: false, inputs: [], outputs: [io('water', 300)] },
  ],
};

test('belt caps are the v1.2 tier values', () => {
  assert.equal(BELT_CAPACITY.Mk2, 120);
  assert.equal(BELT_CAPACITY.Mk4, 480);
  assert.equal(PIPE_CAPACITY.Mk2, 600);
});

test('beltReport: solid flow lines by tier', () => {
  const mk2 = beltReport({ dataset, recipeRates: new Map([['smelt', 12]]), beltTier: 'Mk2' });
  const ore2 = mk2.find((r) => r.itemId === 'ore');
  assert.equal(ore2.rate, 360);              // 12 * 30
  assert.equal(ore2.lines, 3);               // 360 / 120
  assert.equal(ore2.saturated, true);
  const mk4 = beltReport({ dataset, recipeRates: new Map([['smelt', 12]]), beltTier: 'Mk4' });
  assert.equal(mk4.find((r) => r.itemId === 'ore').lines, 1);   // 360 / 480
});

test('beltReport: fluids use pipe capacity', () => {
  const rep = beltReport({ dataset, recipeRates: new Map([['pump', 2]]), pipeTier: 'Mk2' });
  const w = rep.find((r) => r.itemId === 'water');
  assert.equal(w.fluid, true);
  assert.equal(w.rate, 600);                 // 2 * 300
  assert.equal(w.lines, 1);                  // 600 / 600
  assert.equal(w.saturated, false);
});

test('beltReport: sorted by rate descending', () => {
  const rep = beltReport({ dataset, recipeRates: new Map([['smelt', 12]]), beltTier: 'Mk2' });
  for (let i = 1; i < rep.length; i++) assert.ok(rep[i - 1].rate >= rep[i].rate);
});

test('beltReport: rate = max(produced, consumed) across the build', () => {
  const ds = {
    rawResourceIds: new Set(), buildings: new Map(),
    items: new Map([['x', { id: 'x', name: 'X', slug: 'x', liquid: false }]]),
    recipes: [
      { id: 'make', name: 'make', buildingId: 'b', alternate: false, inputs: [], outputs: [{ itemId: 'x', perMin: 10 }] },
      { id: 'use', name: 'use', buildingId: 'b', alternate: false, inputs: [{ itemId: 'x', perMin: 10 }], outputs: [] },
    ],
  };
  const rep = beltReport({ dataset: ds, recipeRates: new Map([['make', 3], ['use', 5]]), beltTier: 'Mk2' });
  const x = rep.find((r) => r.itemId === 'x');
  assert.equal(x.rate, 50);   // max(produced 30, consumed 50)
  assert.equal(x.lines, 1);
});

test('beltReport: item missing from items map defaults to solid (belt)', () => {
  const ds = {
    rawResourceIds: new Set(), buildings: new Map(), items: new Map(),
    recipes: [{ id: 'r', name: 'r', buildingId: 'b', alternate: false, inputs: [], outputs: [{ itemId: 'y', perMin: 240 }] }],
  };
  const rep = beltReport({ dataset: ds, recipeRates: new Map([['r', 1]]), beltTier: 'Mk2', pipeTier: 'Mk2' });
  const y = rep.find((r) => r.itemId === 'y');
  assert.equal(y.fluid, false);
  assert.equal(y.tier, 'Mk2');
  assert.equal(y.lines, 2);   // 240 / 120 belt cap
});

test('beltReport: unknown recipe id and non-positive load are skipped', () => {
  const ds = {
    rawResourceIds: new Set(), buildings: new Map(),
    items: new Map([['x', { id: 'x', name: 'X', slug: 'x', liquid: false }]]),
    recipes: [{ id: 'r', name: 'r', buildingId: 'b', alternate: false, inputs: [], outputs: [{ itemId: 'x', perMin: 10 }] }],
  };
  const rep = beltReport({ dataset: ds, recipeRates: new Map([['nope', 5], ['r', 0]]), beltTier: 'Mk2' });
  assert.equal(rep.length, 0);
});

test('beltReport: default tiers are Mk4 belt / Mk2 pipe', () => {
  const ds = {
    rawResourceIds: new Set(), buildings: new Map(),
    items: new Map([['w', { id: 'w', name: 'W', slug: 'w', liquid: true }], ['s', { id: 's', name: 'S', slug: 's', liquid: false }]]),
    recipes: [{ id: 'r', name: 'r', buildingId: 'b', alternate: false, inputs: [], outputs: [{ itemId: 'w', perMin: 600 }, { itemId: 's', perMin: 480 }] }],
  };
  const rep = beltReport({ dataset: ds, recipeRates: new Map([['r', 1]]) });
  assert.equal(rep.find((r) => r.itemId === 's').tier, 'Mk4');
  assert.equal(rep.find((r) => r.itemId === 's').lines, 1);
  assert.equal(rep.find((r) => r.itemId === 'w').tier, 'Mk2');
  assert.equal(rep.find((r) => r.itemId === 'w').lines, 1);
});

test('BELT/PIPE capacity tables have all v1.2 tiers', () => {
  assert.deepEqual(BELT_CAPACITY, { Mk1: 60, Mk2: 120, Mk3: 270, Mk4: 480, Mk5: 780, Mk6: 1200 });
  assert.deepEqual(PIPE_CAPACITY, { Mk1: 300, Mk2: 600 });
});

test('beltReport: sorts strictly by descending rate with distinct rates', () => {
  const ds = {
    rawResourceIds: new Set(), buildings: new Map(), items: new Map(),
    recipes: [{ id: 'r', name: 'r', buildingId: 'b', alternate: false, inputs: [{ itemId: 'lo', perMin: 10 }], outputs: [{ itemId: 'hi', perMin: 100 }] }],
  };
  const rep = beltReport({ dataset: ds, recipeRates: new Map([['r', 1]]), beltTier: 'Mk2' });
  assert.equal(rep[0].itemId, 'hi');
  assert.equal(rep[1].itemId, 'lo');
});

test('beltReport: throws on an unknown belt or pipe tier', () => {
  const ds = { rawResourceIds: new Set(), buildings: new Map(), items: new Map(), recipes: [] };
  assert.throws(() => beltReport({ dataset: ds, recipeRates: new Map(), beltTier: 'Mk7' }), /Unknown belt tier/);
  assert.throws(() => beltReport({ dataset: ds, recipeRates: new Map(), pipeTier: 'Mk9' }), /Unknown pipe tier/);
});
