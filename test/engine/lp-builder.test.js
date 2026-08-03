import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaxModel, buildMinRawModel, buildTargetRatesModel, supplyVarName, OBJ, RAWCOST } from '../../js/engine/lp-builder.js';

// tiny synthetic dataset: ore(raw) -> ingot -> plate
const io = (itemId, perMin) => ({ itemId, perMin });
const dataset = {
  rawResourceIds: new Set(['ore']),
  recipes: [
    { id: 'ingot', name: 'ingot', buildingId: 'b', alternate: false, inputs: [io('ore', 30)], outputs: [io('ingot', 30)] },
    { id: 'plate', name: 'plate', buildingId: 'b', alternate: false, inputs: [io('ingot', 30)], outputs: [io('plate', 20)] },
  ],
};
const ALL = new Set(['ingot', 'plate']);
const caps = new Map([['ore', 60]]);

test('buildMaxModel: raw uses net-consumption coef + {max}, non-raw uses netPerMin + {min:0}, target excluded from constraints', () => {
  const m = buildMaxModel({ dataset, caps, enabledRecipeIds: ALL, targetItemId: 'plate' });
  assert.equal(m.optimize, OBJ);
  assert.equal(m.opType, 'max');
  // raw constraint
  assert.deepEqual(m.constraints.ore, { max: 60 });
  // intermediate balance
  assert.deepEqual(m.constraints.ingot, { min: 0 });
  // target (plate) is the objective, NOT a constraint
  assert.equal(m.constraints.plate, undefined);
  // ingot variable: consumes 30 ore (raw coef = input-output = 30), produces 30 ingot (net)
  assert.equal(m.variables.ingot.ore, 30);
  assert.equal(m.variables.ingot.ingot, 30);
  assert.equal(m.variables.ingot[RAWCOST], 30);
  assert.equal(m.variables.ingot[OBJ], 0);       // ingot recipe makes no plate
  // plate variable: consumes 30 ingot (net -30), makes 20 plate; objective coef = 20
  assert.equal(m.variables.plate.ingot, -30);
  assert.equal(m.variables.plate[OBJ], 20);
  assert.equal(m.variables.plate[RAWCOST], 0);   // consumes no raw directly
});

test('buildMaxModel: noWaste turns intermediate balance into {equal:0}', () => {
  const m = buildMaxModel({ dataset, caps, enabledRecipeIds: ALL, targetItemId: 'plate', noWaste: true });
  assert.deepEqual(m.constraints.ingot, { equal: 0 });
});

test('buildMinRawModel: minimizes rawcost with target lower-bounded', () => {
  const m = buildMinRawModel({ dataset, caps, enabledRecipeIds: ALL, targetItemId: 'plate' }, 20);
  assert.equal(m.optimize, RAWCOST);
  assert.equal(m.opType, 'min');
  assert.ok(m.constraints[OBJ].min <= 20 && m.constraints[OBJ].min > 19.9); // >= ~20 with tiny relax
});

test('buildTargetRatesModel: adds slack var + target min-constraint, minimizes rawcost', () => {
  const m = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 } });
  assert.equal(m.optimize, RAWCOST);
  assert.equal(m.opType, 'min');
  assert.deepEqual(m.constraints.plate, { min: 10 });
  assert.equal(m.variables._slack_plate.plate, 1);
  assert.equal(m.variables._slack_plate[RAWCOST], 1e6);
});

test('buildTargetRatesModel: a supply adds a capped producing variable at negligible cost', () => {
  const m = buildTargetRatesModel({
    dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 },
    supplies: [{ itemId: 'ingot', rate: 30, kind: 'have' }],
  });
  const v = m.variables[supplyVarName('ingot', 'have')];
  assert.equal(v.ingot, 1, 'produces the item');
  assert.equal(v[RAWCOST], 1e-6);
  assert.deepEqual(m.constraints._supcap_have_ingot, { max: 30 });
  assert.equal(v._supcap_have_ingot, 1, 'the variable is what the cap constrains');
});

test('buildTargetRatesModel: pinned supply is cheaper than have, and both are strictly positive', () => {
  const m = buildTargetRatesModel({
    dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 },
    supplies: [
      { itemId: 'ingot', rate: 30, kind: 'pinned' },
      { itemId: 'ingot', rate: 30, kind: 'have' },
    ],
  });
  const pinned = m.variables[supplyVarName('ingot', 'pinned')][RAWCOST];
  const have = m.variables[supplyVarName('ingot', 'have')][RAWCOST];
  assert.ok(pinned > 0, 'zero cost would leave the draw degenerate');
  assert.ok(have > pinned, 'consume your own byproduct before pulling from the bus');
  assert.ok(have < 1, 'must not perturb real raw costs');
  assert.notEqual(supplyVarName('ingot', 'pinned'), supplyVarName('ingot', 'have'));
});

// Raw constraints hold NET CONSUMPTION, so a +1 coefficient would invert the
// sign and loosen the ore cap instead of supplying ore.
test('buildTargetRatesModel: a supply for a raw resource is ignored', () => {
  const m = buildTargetRatesModel({
    dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 },
    supplies: [{ itemId: 'ore', rate: 500, kind: 'have' }],
  });
  assert.equal(m.variables[supplyVarName('ore', 'have')], undefined);
  assert.equal(m.constraints._supcap_have_ore, undefined);
  assert.deepEqual(m.constraints.ore, { max: 60 }, 'the ore cap is untouched');
});

test('buildTargetRatesModel: omitting supplies yields the pre-existing model exactly', () => {
  const withArg = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 }, supplies: [] });
  const without = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 } });
  assert.deepEqual(withArg, without);
});
