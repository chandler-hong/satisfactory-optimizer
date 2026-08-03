import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoalCatalog, evaluateGoals, SPACE_ELEVATOR_PHASES } from '../../js/domain/goals.js';
import { goalDataset } from '../fixtures/goal-data.js';

const catalog = () => buildGoalCatalog(goalDataset);
const byId = (c, id) => c.find((g) => g.id === id);

test('buildGoalCatalog: milestones come from the dataset, ordered by tier', () => {
  const c = catalog();
  const milestones = c.filter((g) => g.kind === 'milestone');
  assert.deepEqual(milestones.map((g) => g.label), ['Tier 2 · Part Assembly', 'Tier 3 · Coal Power']);
});

test('buildGoalCatalog: cost entries carry display data resolved from items', () => {
  const g = byId(catalog(), 'Schematic_3-1_C');
  assert.deepEqual(g.cost[0], {
    itemId: 'Desc_IronPlateReinforced_C', name: 'Reinforced Iron Plate',
    slug: 'reinforced-iron-plate', fluid: false, amount: 150,
  });
});

test('buildGoalCatalog: phases follow milestones and are labelled by number and name', () => {
  const c = catalog();
  const phases = c.filter((g) => g.kind === 'phase');
  assert.equal(phases[0].label, 'Phase 1 · Distribution Platform');
  assert.ok(c.indexOf(phases[0]) > c.indexOf(byId(c, 'Schematic_3-1_C')), 'milestones sort first');
});

// A renamed part after a dataset bump must not take the panel down.
test('buildGoalCatalog: a phase cost id missing from items is dropped, not thrown', () => {
  const c = catalog();
  const phase1 = c.find((g) => g.id === 'phase-1');
  assert.deepEqual(phase1.cost.map((p) => p.itemId), ['Desc_SpaceElevatorPart_1_C'], 'the one present item survives');
  const phase3 = c.find((g) => g.id === 'phase-3');
  assert.equal(phase3, undefined, 'a phase with no resolvable cost drops entirely');
});

test('SPACE_ELEVATOR_PHASES: the five 1.0 phase costs', () => {
  assert.equal(SPACE_ELEVATOR_PHASES.length, 5);
  assert.deepEqual(SPACE_ELEVATOR_PHASES[0].cost, [{ itemId: 'Desc_SpaceElevatorPart_1_C', amount: 50 }]);
  assert.equal(SPACE_ELEVATOR_PHASES[1].cost.find((c) => c.itemId === 'Desc_SpaceElevatorPart_1_C').amount, 1000);
  assert.equal(SPACE_ELEVATOR_PHASES[4].cost.find((c) => c.itemId === 'Desc_SpaceElevatorPart_12_C').amount, 256);
});

test('evaluateGoals: only selected goals are returned, in catalog order', () => {
  const views = evaluateGoals(catalog(), ['Schematic_3-1_C'], new Map(), 10);
  assert.deepEqual(views.map((v) => v.id), ['Schematic_3-1_C']);
});

test('evaluateGoals: ETA is amount / net rate, and the goal ETA is the slowest part', () => {
  const net = new Map([
    ['Desc_IronPlateReinforced_C', 15],   // 150 / 15 = 10 min
    ['Desc_Rotor_C', 10],                 //  50 / 10 =  5 min
    ['Desc_Cable_C', 25],                 // 500 / 25 = 20 min  <- gates
  ]);
  const [v] = evaluateGoals(catalog(), ['Schematic_3-1_C'], net, 10);
  assert.deepEqual(v.parts.map((p) => p.etaMinutes), [10, 5, 20]);
  assert.equal(v.etaMinutes, 20, 'the slowest part gates delivery');
  assert.deepEqual(v.uncovered, []);
});

test('evaluateGoals: an unproduced part has no ETA and lands in uncovered', () => {
  const net = new Map([['Desc_Rotor_C', 10]]);
  const [v] = evaluateGoals(catalog(), ['Schematic_3-1_C'], net, 10);
  const plate = v.parts.find((p) => p.itemId === 'Desc_IronPlateReinforced_C');
  assert.equal(plate.covered, false);
  assert.equal(plate.etaMinutes, null);
  assert.equal(v.etaMinutes, null, 'the goal has no ETA while any part is unproduced');
  assert.deepEqual(v.uncovered.map((u) => u.itemId), ['Desc_IronPlateReinforced_C', 'Desc_Cable_C']);
});

test('evaluateGoals: uncovered rates convert the cost stock into a flow over fillMinutes', () => {
  const [v] = evaluateGoals(catalog(), ['Schematic_3-1_C'], new Map(), 10);
  assert.equal(v.uncovered.find((u) => u.itemId === 'Desc_Cable_C').rate, 50);   // 500 / 10
  const [v2] = evaluateGoals(catalog(), ['Schematic_3-1_C'], new Map(), 20);
  assert.equal(v2.uncovered.find((u) => u.itemId === 'Desc_Cable_C').rate, 25);  // 500 / 20
});

test('evaluateGoals: a non-positive or non-finite fillMinutes falls back to 10, but a numeric string is honored', () => {
  const rateFor = (fillMinutes) => {
    const [v] = evaluateGoals(catalog(), ['Schematic_3-1_C'], new Map(), fillMinutes);
    return v.uncovered.find((u) => u.itemId === 'Desc_Cable_C').rate;
  };
  assert.equal(rateFor(0), 50, 'zero falls back to 10 rather than dividing by zero');
  assert.equal(rateFor(Infinity), 50, 'Infinity falls back to 10 rather than amount/Infinity collapsing to 0');
  assert.equal(rateFor('Infinity'), 50, 'the string "Infinity" coerces the same way as the number');
  assert.equal(rateFor('20'), 25, 'a legitimate numeric string is honored, not coerced away by the Infinity guard');
});

test('evaluateGoals: an unknown selected id is skipped', () => {
  assert.deepEqual(evaluateGoals(catalog(), ['nope'], new Map(), 10), []);
});
