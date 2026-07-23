import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlan } from '../../js/ui/view-model.js';
import { ironChain, ALL_IRON_RECIPES, capsIron } from '../fixtures/iron-chain.js';

const approx = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

test('computePlan (max mode) shapes a PlanView from the iron chain', () => {
  const view = computePlan(ironChain, {
    mode: 'max', caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES,
    targetItemId: 'mf', shardBudget: 0, beltTier: 'Mk2', pipeTier: 'Mk2',
  });
  assert.equal(view.feasible, true);
  assert.match(view.headline, /15\b/);                 // 15 Modular Frames/min
  assert.equal(view.tiles.machines, 50);
  assert.equal(view.tiles.shards, 0);
  // ore meter: fully used and binding
  const ore = view.resourceMeters.find((m) => m.itemId === 'ore');
  assert.ok(approx(ore.used, 360));
  assert.equal(ore.available, 360);
  assert.equal(ore.binding, true);
  assert.ok(approx(ore.pct, 1));
  // build rows: one per active recipe, sorted by machines desc
  assert.equal(view.buildRows.length, 6);
  for (let i = 1; i < view.buildRows.length; i++) assert.ok(view.buildRows[i - 1].machines >= view.buildRows[i].machines);
  // belt rows include ore at 360 -> 3 lines on Mk2
  const oreBelt = view.beltRows.find((b) => b.itemId === 'ore');
  assert.equal(oreBelt.lines, 3);
});

test('computePlan (targets mode) reports shortfalls', () => {
  const view = computePlan(ironChain, {
    mode: 'targets', caps: capsIron(359), enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { rotor: 16, mf: 7.5 }, shardBudget: 0, beltTier: 'Mk2',
  });
  assert.equal(view.feasible, false);
  assert.ok(view.shortfalls.some((s) => s.itemId === 'mf' && s.amount > 0));
});

test('computePlan (max mode) builds a tiered flow graph', () => {
  const view = computePlan(ironChain, {
    mode: 'max', caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES,
    targetItemId: 'mf', shardBudget: 0, beltTier: 'Mk2',
  });
  const g = view.graph;
  assert.equal(g.nodes.length, 8); // 6 recipes + 1 raw (ore) + 1 output (out:mf)
  const rawOre = g.nodes.find((n) => n.id === 'raw:ore');
  assert.ok(rawOre && rawOre.tier === 0 && rawOre.isRaw);
  const ingot = g.nodes.find((n) => n.id === 'ingot');
  const mf = g.nodes.find((n) => n.id === 'mf');
  assert.ok(ingot.tier < mf.tier, 'mf is downstream of ingot');
  assert.ok(g.tiers >= 4);
  assert.ok(g.edges.some((e) => e.from === 'raw:ore' && e.to === 'ingot' && e.itemId === 'ore'));
  // explicit output sink for the target part, downstream of its producer
  const outMf = g.nodes.find((n) => n.id === 'out:mf');
  assert.ok(outMf && outMf.isOutput && outMf.tier > mf.tier);
  assert.ok(approx(outMf.rate, 15), 'output node carries the net rate (15 mf/min)');
  assert.ok(g.edges.some((e) => e.from === 'mf' && e.to === 'out:mf'));
});

test('computePlan (max mode, multiple targets) maximizes balanced sets', () => {
  const view = computePlan(ironChain, {
    mode: 'max', caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'mf', weight: 1 }, { itemId: 'rotor', weight: 1 }],
    shardBudget: 0, beltTier: 'Mk2',
  });
  assert.equal(view.feasible, true);
  assert.match(view.headline, /sets\/min/);
  assert.equal(view.perPart.length, 2);
  const mf = view.perPart.find((p) => p.itemId === 'mf');
  const rotor = view.perPart.find((p) => p.itemId === 'rotor');
  assert.ok(approx(mf.rate, rotor.rate, 1e-2), 'balanced: equal per-part rates');
});

test('computePlan surfaces m³ for fluids (headline + flags)', () => {
  const fuelChain = {
    items: new Map([
      ['oil', { id: 'oil', name: 'Crude Oil', slug: 'oil', liquid: true }],
      ['fuel', { id: 'fuel', name: 'Fuel', slug: 'fuel', liquid: true }],
    ]),
    buildings: new Map([['ref', { id: 'ref', name: 'Refinery', slug: 'ref', basePowerMW: 30, powerExponent: 1.321928 }]]),
    rawResourceIds: new Set(['oil']),
    recipes: [
      { id: 'fuelrec', name: 'Fuel', buildingId: 'ref', alternate: false, inputs: [{ itemId: 'oil', perMin: 60 }], outputs: [{ itemId: 'fuel', perMin: 40 }] },
    ],
  };
  const view = computePlan(fuelChain, {
    mode: 'max', caps: new Map([['oil', 60]]), enabledRecipeIds: new Set(['fuelrec']),
    targets: [{ itemId: 'fuel', weight: 1 }], shardBudget: 0, beltTier: 'Mk4', pipeTier: 'Mk2',
  });
  assert.equal(view.feasible, true);
  assert.match(view.headline, /m³/);              // "40 m³ Fuel/min", not "40 Fuel/min"
  assert.equal(view.perPart[0].fluid, true);
  assert.equal(view.resourceMeters.find((m) => m.itemId === 'oil').fluid, true);
  const outFuel = view.graph.nodes.find((n) => n.id === 'out:fuel');
  assert.ok(outFuel && outFuel.fluid === true, 'fluid output node flagged');
});
