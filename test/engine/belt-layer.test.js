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
