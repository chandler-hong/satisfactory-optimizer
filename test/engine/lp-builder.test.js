import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTargetRatesModel, buildMaxSetsModel, buildMinRawForSetsModel, supplyVarName, RAWCOST, SETS } from '../../js/engine/lp-builder.js';
import { ironChain, ALL_IRON_RECIPES, capsIron } from '../fixtures/iron-chain.js';

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

// buildVariables + rawConstraints are shared by every builder, so this pins the
// coefficient conventions once, through buildTargetRatesModel. The sign flip on
// raw items is the load-bearing part: a raw row holds NET CONSUMPTION against
// {max: cap}, a non-raw row holds NET PRODUCTION against a {min: 0} balance, and
// several comments in lp-builder.js and expansion.js reason from exactly that.
test('shared model shape: raw uses net-consumption coef + {max: cap}, non-raw uses netPerMin + {min: 0}', () => {
  const m = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 } });
  // raw constraint
  assert.deepEqual(m.constraints.ore, { max: 60 });
  // intermediate balance
  assert.deepEqual(m.constraints.ingot, { min: 0 });
  // ingot variable: consumes 30 ore (raw coef = input-output = 30), produces 30 ingot (net)
  assert.equal(m.variables.ingot.ore, 30);
  assert.equal(m.variables.ingot.ingot, 30);
  assert.equal(m.variables.ingot[RAWCOST], 30);
  // plate variable: consumes 30 ingot (net -30), makes 20 plate
  assert.equal(m.variables.plate.ingot, -30);
  assert.equal(m.variables.plate.plate, 20);
  assert.equal(m.variables.plate[RAWCOST], 0);   // consumes no raw directly
});

// `noWaste` is a live user-facing toggle ("No waste", js/ui/inputs.js) that
// reaches both surviving builders through hitTargets and maxSets, so both need
// to turn the intermediate balance into a hard equality.
test('noWaste turns an intermediate balance into {equal: 0} in both builders', () => {
  const rates = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 }, noWaste: true });
  assert.deepEqual(rates.constraints.ingot, { equal: 0 });
  const sets = buildMaxSetsModel({ dataset, caps, enabledRecipeIds: ALL, targets: [{ itemId: 'plate', weight: 1 }], noWaste: true });
  assert.deepEqual(sets.constraints.ingot, { equal: 0 });
});

// Pass 2 of the two-pass lexicographic solve: re-solve for minimum raw with the
// pass-1 optimum pinned as a floor, relaxed by `|x|*1e-9 + 1e-9` so floating
// point cannot make the pinned constraint infeasible. That give is exactly what
// bindingResources and supplyAtMax (optimize.js) must NOT be read against, so
// its shape is worth pinning directly rather than only in prose.
test('buildMinRawForSetsModel: minimizes rawcost with SETS lower-bounded at the pass-1 optimum', () => {
  const m = buildMinRawForSetsModel({ dataset, caps, enabledRecipeIds: ALL, targets: [{ itemId: 'plate', weight: 1 }] }, 20);
  assert.equal(m.optimize, RAWCOST);
  assert.equal(m.opType, 'min');
  assert.ok(m.constraints[SETS].min <= 20 && m.constraints[SETS].min > 19.9); // >= ~20 with tiny relax
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

// Guards the input-validation skip path in addSupplies (a non-positive/non-finite
// rate, or a missing itemId, must be dropped). Checked generically by prefix so
// this fails if the guard is ever weakened, regardless of which malformed field
// slips through.
test('buildTargetRatesModel: a malformed supply is skipped — no variable, no cap constraint', () => {
  const cases = [
    { label: 'zero rate', supply: { itemId: 'ingot', rate: 0, kind: 'have' } },
    { label: 'negative rate', supply: { itemId: 'ingot', rate: -5, kind: 'have' } },
    { label: 'non-numeric rate', supply: { itemId: 'ingot', rate: 'abc', kind: 'have' } },
    { label: 'missing rate', supply: { itemId: 'ingot', kind: 'have' } },
    { label: 'missing itemId', supply: { rate: 30, kind: 'have' } },
  ];
  for (const { label, supply } of cases) {
    const m = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 }, supplies: [supply] });
    assert.ok(!Object.keys(m.variables).some((k) => k.startsWith('_supply_')), `${label}: no supply variable should be created`);
    assert.ok(!Object.keys(m.constraints).some((k) => k.startsWith('_supcap_')), `${label}: no cap constraint should be created`);
  }
});

// --- buildMaxSetsModel: declared supplies -----------------------------------

// Expansion maximizes against what the user declared, not against ore, so the
// max model needs the same capped-supply primitive the target-rates model has.
test('buildMaxSetsModel: a declared supply becomes a capped variable', () => {
  const m = buildMaxSetsModel({
    dataset: ironChain,
    caps: capsIron(0),
    enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'rotor', weight: 1 }],
    supplies: [{ itemId: 'screw', rate: 80, kind: 'pinned' }],
  });
  const capKey = '_supcap_pinned_screw';
  assert.deepEqual(m.constraints[capKey], { max: 80 }, 'the supply is capped at its rate');
  const supVar = Object.keys(m.variables).find((k) => m.variables[k][capKey] === 1);
  assert.ok(supVar, 'a supply variable exists and consumes the cap');
  assert.equal(m.variables[supVar].screw, 1, 'and it contributes to the screw balance');
  assert.equal(m.variables[supVar][SETS], 0,
    'addSupplies must run BEFORE the SETS normalization loop, or this coefficient is missing');
});

// supplies is additive and shared with the live Factory Optimizer, so the
// omitted-argument model must be byte-identical to what it was before.
test('buildMaxSetsModel: omitting supplies changes nothing', () => {
  const args = {
    dataset: ironChain,
    caps: capsIron(360),
    enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'mf', weight: 1 }],
  };
  const bare = buildMaxSetsModel(args);
  const explicit = buildMaxSetsModel({ ...args, supplies: [] });
  assert.equal(JSON.stringify(bare), JSON.stringify(explicit),
    'an empty supplies array is inert');
  assert.equal(Object.keys(bare.constraints).some((k) => k.startsWith('_supcap_')), false,
    'and no supply-cap constraint appears');
});

// A target names an item the model can PRODUCE. Raw items hold a
// net-consumption budget in that same constraint slot, so writing a target
// constraint over one deletes the cap — the model-level cause of the
// `sets = Infinity` and "met by overdrawing the cap" bugs.
test('buildMaxSetsModel: a raw target leaves the {max: cap} constraint intact', () => {
  const m = buildMaxSetsModel({ dataset, caps, enabledRecipeIds: ALL, targets: [{ itemId: 'ore', weight: 1 }] });
  assert.deepEqual(m.constraints.ore, { max: 60 }, 'the raw cap must survive');
  assert.equal(m.variables.__sets__.ore, undefined, 'and SETS must not pull on a net-consumption row');
});

test('buildTargetRatesModel: a raw target leaves the {max: cap} constraint intact', () => {
  const m = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: new Map([['ore', 1000]]) });
  assert.deepEqual(m.constraints.ore, { max: 60 }, 'the raw cap must survive');
  assert.equal(m.variables._slack_ore, undefined, 'and no slack variable pretends the demand is representable');
});
