import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedBalance, splitDemand, computeNetOutput, planExpansion } from '../../js/engine/expansion.js';
import { buildGraph } from '../../js/engine/graph.js';
import { normalize } from '../../js/data/normalize.js';
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';
import { miniRaw } from '../fixtures/mini-data.js';

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const rateOf = (m, id) => r6(m.get(id) || 0);
const machinesOf = (plan, recipeId) => plan.buildRows.find((b) => b.recipeId === recipeId)?.machines ?? 0;
const rawFor = (p, itemId) => p.rawNeeded.find((r) => r.itemId === itemId);

const plan = (rows, extra = {}) => planExpansion({
  dataset: ironChain, rows, enabledRecipeIds: ALL_IRON_RECIPES, ...extra,
});

// Important 3 fixture: a block that PRODUCES a raw needs a recipe with no
// inputs. iron-chain.js has none and must not be touched (other tests depend
// on its exact shape), so this is a throwaway dataset built in this file only,
// reusing ironChain's items/buildings/rawResourceIds by reference and adding
// one synthetic recipe on top of a *copy* of its recipe list.
const oreMakerDataset = {
  ...ironChain,
  recipes: [...ironChain.recipes, { id: 'oreMaker', name: 'oreMaker', buildingId: 'b', alternate: false, inputs: [], outputs: [{ itemId: 'ore', perMin: 5 }] }],
};
const planOre = (rows) => planExpansion({
  dataset: oreMakerDataset, rows, enabledRecipeIds: new Set([...ALL_IRON_RECIPES, 'oreMaker']),
});

test('pinnedBalance: nets a block at its machine count', () => {
  // rip: 30 plate + 60 screw -> 5 rip, per machine
  const net = pinnedBalance(ironChain, [{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(rateOf(net, 'plate'), -60);
  assert.equal(rateOf(net, 'screw'), -120);
  assert.equal(rateOf(net, 'rip'), 10);
});

test('pinnedBalance: clock scales the load — 4 @150% equals 6 @100%', () => {
  const fast = pinnedBalance(ironChain, [{ kind: 'block', built: false, recipeId: 'rip', machines: 4, clock: 1.5 }]);
  const many = pinnedBalance(ironChain, [{ kind: 'block', built: false, recipeId: 'rip', machines: 6, clock: 1 }]);
  assert.deepEqual([...fast].sort(), [...many].sort());
  assert.equal(rateOf(fast, 'plate'), -180);
});

test('pinnedBalance: an unknown recipeId is ignored, not thrown', () => {
  const net = pinnedBalance(ironChain, [
    { kind: 'block', built: false, recipeId: 'no_such_recipe', machines: 3, clock: 1 },
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
  ]);
  assert.equal(rateOf(net, 'plate'), -60, 'the surviving block still counts');
});

test('splitDemand: negative non-raw becomes a target, positive becomes pinned supply', () => {
  const net = pinnedBalance(ironChain, [{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  const { targets, supplies, rawDemand } = splitDemand(ironChain, net, [], []);
  assert.equal(rateOf(targets, 'plate'), 60);
  assert.equal(rateOf(targets, 'screw'), 120);
  assert.deepEqual(supplies, [{ itemId: 'rip', rate: 10, kind: 'pinned' }]);
  assert.equal(rawDemand.size, 0);
});

// A block eating ore has no upstream to build. Routed through the LP it would be
// silently absorbed by the ore constraint and vanish from the raw footer.
test('splitDemand: a block consuming a raw goes to rawDemand, not to the LP', () => {
  const net = pinnedBalance(ironChain, [{ kind: 'block', built: false, recipeId: 'ingot', machines: 1, clock: 1 }]);
  const { targets, supplies, rawDemand } = splitDemand(ironChain, net, [], []);
  assert.equal(targets.size, 0);
  assert.equal(rateOf(rawDemand, 'ore'), 30);
  assert.deepEqual(supplies, [{ itemId: 'ingot', rate: 30, kind: 'pinned' }]);
});

// Important 3: before the fix, a positive-raw netPinned entry was pushed into
// `supplies` as a raw 'pinned' row — but lp-builder.js's addSupplies
// unconditionally skips every raw supply, so that entry was permanently dead
// and the credit vanished. It must go to `rawCredit` instead.
test('splitDemand: a block netting a raw surplus becomes rawCredit, not a dead pinned supply', () => {
  const { supplies, rawCredit } = splitDemand(ironChain, new Map([['ore', 20]]), [], []);
  assert.equal(supplies.length, 0, 'a raw cannot be an LP supply, so it must not be offered as one');
  assert.equal(rateOf(rawCredit, 'ore'), 20);
});

test('splitDemand: want rows add targets; a raw want becomes raw demand', () => {
  const { targets, rawDemand } = splitDemand(ironChain, new Map(), [
    { kind: 'want', itemId: 'rod', rate: 45 },
    { kind: 'want', itemId: 'ore', rate: 120 },
  ], []);
  assert.equal(rateOf(targets, 'rod'), 45);
  assert.equal(rateOf(rawDemand, 'ore'), 120);
});

test('splitDemand: have rows become have supply; a raw have becomes rawSupplied', () => {
  const { supplies, rawSupplied } = splitDemand(ironChain, new Map(), [], [
    { kind: 'have', itemId: 'screw', rate: 300 },
    { kind: 'have', itemId: 'ore', rate: 480 },
  ]);
  assert.deepEqual(supplies, [{ itemId: 'screw', rate: 300, kind: 'have' }]);
  assert.equal(rateOf(rawSupplied, 'ore'), 480);
});

// Two rows naming the same item is an ordinary thing to type ("300 from plant A,
// 200 from plant B"). Unmerged, they'd collide downstream: lp-builder.js's
// addSupplies keys the LP variable and its cap constraint on (itemId, kind), so
// two 'have' entries for the same itemId silently overwrite each other's cap.
test('splitDemand: two non-raw HAVE rows for the same item merge into one supply entry', () => {
  const { supplies } = splitDemand(ironChain, new Map(), [], [
    { kind: 'have', itemId: 'screw', rate: 50 },
    { kind: 'have', itemId: 'screw', rate: 40 },
  ]);
  assert.deepEqual(supplies, [{ itemId: 'screw', rate: 90, kind: 'have' }],
    'one pooled entry, not two competing ones');
});

test('splitDemand: two raw HAVE rows for the same item still sum into rawSupplied', () => {
  const { rawSupplied } = splitDemand(ironChain, new Map(), [], [
    { kind: 'have', itemId: 'ore', rate: 300 },
    { kind: 'have', itemId: 'ore', rate: 180 },
  ]);
  assert.equal(rateOf(rawSupplied, 'ore'), 480, 'the branch we did not touch keeps aggregating');
});

test('planExpansion: one block explodes to whole upstream machines', () => {
  const p = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(p.feasible, true);
  assert.equal(machinesOf(p, 'plate'), 3);
  assert.equal(machinesOf(p, 'screw'), 3);
  assert.equal(machinesOf(p, 'rod'), 2);
  assert.equal(machinesOf(p, 'ingot'), 4);
  assert.equal(p.tiles.machines, 12);
});

// Fix 4: a negative clock (typing "-50" into the Clock % box gives clock: -0.5)
// used to display as -50% in "Your blocks" while the load calculation silently
// fell back to 100% — the two disagreed. blockLoad and the blockRows view now
// share one normalizeClock helper, so an invalid clock both displays AND
// computes as 100%, matching the plan's actual clock:1 baseline above exactly.
test('planExpansion: an invalid clock displays and computes as 100%, not the raw value', () => {
  const invalid = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: -0.5 }]);
  const normal = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(invalid.blockRows.length, 1);
  assert.equal(invalid.blockRows[0].clockPct, 100, 'a negative clock must not display as -50%');
  assert.equal(machinesOf(invalid, 'plate'), machinesOf(normal, 'plate'),
    'the load calc must match what clockPct claims, not silently fall back differently');
});

// recipeRates/machinesById feed buildGraph (js/engine/graph.js) for the
// Expansion view's diagram, and were added alongside it. Checked
// against buildRows rather than hardcoded numbers: buildRows is already
// exhaustively tested above, so this only needs to confirm the two new fields
// agree with it and are scoped to the same LP-solved recipes.
test('planExpansion: recipeRates and machinesById mirror buildRows for the LP-solved recipes', () => {
  const p = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.ok(p.buildRows.length > 0, 'sanity: this scenario does build upstream machines');
  for (const row of p.buildRows) {
    assert.equal(p.machinesById.get(row.recipeId), row.machines, `machinesById must agree with buildRows for ${row.recipeId}`);
    assert.ok(p.recipeRates.has(row.recipeId), `recipeRates must have an entry for ${row.recipeId}`);
  }
  assert.equal(p.recipeRates.has('rip'), false, 'the pinned block itself never enters the LP, so it is not an LP-solved recipe');
});

// Fixes a diagram bug: recipeRates/machinesById are upstream-only (confirmed
// above), so buildGraph never saw a pinned block's own recipe — the block's
// inputs dangled with no consumer and drew as amber "surplus", telling the user
// a line feeding their own machines was spare capacity. graphRates/
// graphMachinesById add each block's own load/machines on top, for the diagram
// only; the upstream-only fields keep their meaning because realize/beltReport
// depend on it.
test('planExpansion: graphRates/graphMachinesById include a pinned block even though it never enters the LP', () => {
  const p = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(p.recipeRates.has('rip'), false, 'sanity: rip itself is still never LP-solved');
  assert.equal(rateOf(p.graphRates, 'rip'), 2, "the block's own machine-equivalent load (2 machines @ 100%)");
  assert.equal(p.graphMachinesById.get('rip'), 2, "the block's own declared machine count");
});

// The other half of the same fix: a recipe that is BOTH pinned AND separately
// LP-solved (the 'plate' block below only covers 40 of the 60 plate/min 'rip'
// needs, so the LP tops up the remaining 20/min with a machine of its own —
// see the "partly feeding" test below) must sum in the graph maps, not have
// one side clobber the other.
test('planExpansion: graphRates/graphMachinesById sum a block and the LP for the same recipe rather than overwrite', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', built: false, recipeId: 'plate', machines: 2, clock: 1 },
  ]);
  const lpRate = p.recipeRates.get('plate') || 0;
  const lpMachines = p.machinesById.get('plate') || 0;
  assert.ok(lpRate > 0, 'sanity: plate is genuinely LP-solved too, not just pinned');
  assert.equal(rateOf(p.graphRates, 'plate'), r6(lpRate + 2), "the block's load added onto the LP rate, not replacing it");
  assert.equal(p.graphMachinesById.get('plate'), lpMachines + 2, "the block's machines added onto the LP machine count, not replacing it");
});

// The user-visible symptom, pinned directly: with buildGraph fed the OLD
// upstream-only recipeRates/machinesById, a lone 'rip' block (standing in for
// the real-world "6x Assembler->Motor" report) never got a node of its own
// (addSink skips a target sink with zero producers), while its direct inputs
// 'plate'/'screw' (standing in for Rotor/Stator) dangled with no in-graph
// consumer and rendered as false "surplus". graphRates/graphMachinesById fix
// this: 'rip' becomes an active recipe in the graph, which both gives it a
// node and makes it plate/screw's in-graph consumer, netting their leftover to
// ~0 so neither shows as surplus.
test('planExpansion: the diagram graph shows a pinned block\'s own recipe, and its direct inputs are not false surplus', () => {
  const p = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()]);
  assert.ok(graph.nodes.some((n) => n.id === 'rip'), "the pinned block's own recipe must be a node in the diagram");
  assert.ok(!graph.nodes.some((n) => n.itemId === 'plate' && n.isSurplus), 'plate now feeds the block in-graph, not spare capacity');
  assert.ok(!graph.nodes.some((n) => n.itemId === 'screw' && n.isSurplus), 'screw now feeds the block in-graph, not spare capacity');
});

// A Built block is a source in the diagram, not a consumer of its own inputs:
// the machines already exist and are already fed (pinnedBalance's Built branch
// above only ever adds gross output), so buildGraph must not wire the block's
// inputs as in-graph demand. Regression guard: graphRates/graphMachinesById
// used to merge a Built block's load in exactly like a To-build one, so
// buildGraph still drew an edge from whatever makes 'ingot' to 'plate' and
// subtracted plate's ingot appetite from netById — pushing ingot's net
// negative and making addSink drop the out:ingot sink entirely, even though
// netOutput (and the want row) both say 30 ingot/min genuinely leaves.
test("planExpansion: a Built block's own recipe is a source in the diagram, not a consumer of its inputs", () => {
  const p = plan([
    { kind: 'block', recipeId: 'plate', machines: 2, clock: 1, built: true },
    { kind: 'want', itemId: 'ingot', rate: 30 },
  ]);
  assert.equal(rateOf(p.netOutput, 'plate'), 40, "sanity: the Built block's gross output");
  assert.equal(rateOf(p.netOutput, 'ingot'), 30, 'sanity: the want is met');
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()], p.externallyFedLoad);
  assert.ok(graph.nodes.some((n) => n.id === 'out:ingot'), 'ingot leaves the system just like netOutput promises');
  assert.ok(!graph.edges.some((e) => e.from === 'ingot' && e.to === 'plate'),
    "plate's ingot appetite is covered externally, not drawn from the ingot recipe in-graph");
});

// Round-2 regression: the guard above skips ALL input processing for a
// recipe id once ANY Built row touches it, which is right for a pure Built
// recipe but wrong once graphRates' merge (see "sum a block and the LP"
// above) puts a genuine non-Built share of load onto that SAME recipe id.
// Here the Built block covers only 30 of the 100 rod/min wanted, so the LP
// must build 70 rod/min of its own capacity on top of it; that LP share is a
// real consumer of ingot and must still show as one, not vanish into a
// phantom ingot surplus.
test("planExpansion: the diagram still wires a recipe's non-Built share when a Built block covers only part of it", () => {
  const p = plan([
    { kind: 'block', recipeId: 'rod', machines: 2, clock: 1, built: true },
    { kind: 'want', itemId: 'rod', rate: 100 },
  ]);
  assert.equal(rawFor(p, 'ore').needed, 70, 'sanity: only the LP-built 70 rod/min needs fresh ore');
  assert.equal(machinesOf(p, 'ingot'), 3, 'sanity: ingot capacity for that 70 rod/min, rounded up to whole machines');
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()], p.externallyFedLoad);
  assert.ok(graph.edges.some((e) => e.from === 'ingot' && e.to === 'rod'),
    "the LP's 70 rod/min share is a genuine in-graph consumer of ingot");
  assert.ok(!graph.nodes.some((n) => n.id === 'sur:ingot'),
    'so ingot nets to zero rather than faking a surplus for the ingot the LP-built rod machines actually consume');
});

// Same bug, reached a different way: two block ROWS on one recipe id, one
// Built and one To-build, merge into a single graphRates entry — this is the
// same merge as "sum a block and the LP" above, just with a Built row on one
// side instead of the LP. Only the Built row's 2-machine share is externally
// fed; the To-build row's 3 machines are a real consumer that must still
// draw an in-graph ingot edge.
test("planExpansion: the diagram still wires a To-build block's share when a Built block on the same recipe id covers the rest", () => {
  const p = plan([
    { kind: 'block', recipeId: 'rod', machines: 2, clock: 1, built: true },
    { kind: 'block', recipeId: 'rod', machines: 3, clock: 1, built: false },
  ]);
  assert.equal(rawFor(p, 'ore').needed, 45, "sanity: only the To-build row's 3 machines need fresh ore");
  assert.equal(machinesOf(p, 'ingot'), 2, "sanity: ingot capacity for the To-build row's 3 rod machines");
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()], p.externallyFedLoad);
  assert.ok(graph.edges.some((e) => e.from === 'ingot' && e.to === 'rod'),
    "the To-build row's 3-machine share is a genuine in-graph consumer of ingot");
  assert.ok(!graph.nodes.some((n) => n.id === 'sur:ingot'),
    "so ingot nets to zero rather than faking a surplus for the ingot the To-build row's rod machines actually consume");
});

// externallyFedLoad itself (renamed from the old builtRecipeIds Set to a
// Map<recipeId, load> — see js/engine/expansion.js's comment on it) had no
// direct test, only indirect coverage through the graph-shape tests above.
// Pin its contents directly for a mixed plan: a Built row and a To-build row
// on different recipes, so one recipe id should appear in the map and the
// other should not.
test('planExpansion: externallyFedLoad holds only the Built share, keyed by recipe id', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rod', machines: 2, clock: 1, built: true },
    { kind: 'block', recipeId: 'ingot', machines: 4, clock: 1, built: false },
  ]);
  assert.equal(p.externallyFedLoad.get('rod'), 2, "the Built row's own machine-equivalent load");
  assert.equal(p.externallyFedLoad.has('ingot'), false, 'the To-build row contributes no externally-fed load');
});

test('planExpansion: a block feeding another needs no upstream for the intermediate', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', built: false, recipeId: 'plate', machines: 3, clock: 1 },  // exactly the 60 plate/min rip wants
  ]);
  assert.equal(machinesOf(p, 'plate'), 0, 'plate nets to zero, so nothing upstream builds it');
  assert.equal(machinesOf(p, 'ingot'), 4, 'but the plate block itself now needs ingot');
  assert.equal(p.tiles.machines, 9);
});

test('planExpansion: a block partly feeding another covers only the deficit', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', built: false, recipeId: 'plate', machines: 2, clock: 1 },  // 40 of the 60 plate/min
  ]);
  assert.equal(machinesOf(p, 'plate'), 1, 'one more plate machine covers the missing 20/min');
  assert.equal(p.tiles.machines, 10);
});

// Important 1: the raw footer combines a block's own direct raw draw with
// whatever the LP separately needs for its own targets. Before this test,
// nothing exercised rawUsage with both sources active at once.
test('planExpansion: rawUsage combines a direct block draw with a separate LP residual draw', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'ingot', machines: 1, clock: 1 },  // 30 ore/min, direct
    { kind: 'want', itemId: 'plate', rate: 40 },                   // needs 60 ingot/min total
  ]);
  // The block's 30 ingot/min covers half of the want; the LP builds its own
  // ingot machine for the other 30 ingot/min (1 machine, not a duplicate of
  // the block's own machine, which is pinned and never enters buildRows).
  assert.equal(rawFor(p, 'ore').needed, 60, '30 from the block plus 30 from the LP residual');
  assert.equal(machinesOf(p, 'ingot'), 1, 'only the LP residual ingot machine, not the pinned block');
});

// Important 3: a block netting a raw surplus must reduce rawUsage instead of
// vanishing. Before the fix, the +50 credit was pushed into a dead 'pinned'
// supply entry and rawUsage stayed at the full 80.
test('planExpansion: a block netting a raw surplus credits rawUsage instead of vanishing', () => {
  const p = planOre([
    { kind: 'block', built: false, recipeId: 'oreMaker', machines: 10, clock: 1 },  // +50 ore/min
    { kind: 'want', itemId: 'ore', rate: 80 },
  ]);
  assert.equal(rawFor(p, 'ore').needed, 30, '80 wanted minus the 50 the block already makes');
});

test('planExpansion: rawUsage never goes negative when a raw credit exceeds demand', () => {
  const p = planOre([
    { kind: 'block', built: false, recipeId: 'oreMaker', machines: 20, clock: 1 },  // +100 ore/min
    { kind: 'want', itemId: 'ore', rate: 30 },
  ]);
  assert.equal(rateOf(p.rawUsage, 'ore'), 0, 'a surplus bigger than demand is not a negative need');
});

test('planExpansion: a have row covering demand removes that whole subtree', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 120 },
  ]);
  assert.equal(machinesOf(p, 'screw'), 0);
  assert.equal(machinesOf(p, 'rod'), 0, 'and the rod that fed it');
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 120, used: 120, capped: false }],
    'exhausted but nothing was built for it, so not flagged');
});

test('planExpansion: a have row partly covering demand flags the overflow', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 60 },
  ]);
  assert.equal(machinesOf(p, 'screw'), 2, 'ceil(1.5) whole machines');
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 60, used: 60, capped: true }]);
});

test('planExpansion: a have row larger than demand is not flagged', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 300 },
  ]);
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 300, used: 120, capped: false }]);
});

// The anchor: this is the assertion that would have caught the duplicate-HAVE-row
// collision. Before the fix, splitting the same 120/min across two rows (60+60)
// instead of one silently changed the plan — 2 screw machines instead of 0, and
// supplyUsage reporting {rate:60, used:60, capped:true} twice while claiming 120
// consumed. One pooled supply must plan identically regardless of how many rows
// the player used to declare it.
test('planExpansion: one HAVE row and two HAVE rows summing to the same total plan identically', () => {
  const one = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 120 },
  ]);
  const two = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 60 },
    { kind: 'have', itemId: 'screw', rate: 60 },
  ]);
  assert.equal(machinesOf(two, 'screw'), machinesOf(one, 'screw'));
  assert.deepEqual(two.supplyUsage, one.supplyUsage);
  assert.deepEqual(two.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 120, used: 120, capped: false }]);
});

test('computeNetOutput: an unconsumed block output leaves at its full rate', () => {
  const p = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(rateOf(p.netOutput, 'rip'), 10);
  assert.equal(rateOf(p.netOutput, 'plate'), 0, 'plate is fully consumed internally');
});

// The double-count guard: the upstream's consumption of the surplus is already a
// negative term in netFromLPRecipes, so subtracting the drawn supply too gives 70.
test('computeNetOutput: a block surplus partly eaten upstream reports the remainder', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },   // wants 120 screw
    { kind: 'block', built: false, recipeId: 'rod', machines: 10, clock: 1 },  // makes 150 rod
  ]);
  // screw machines (3) consume 30 rod; 150 - 30 = 120 rod leaves.
  assert.equal(rateOf(p.netOutput, 'rod'), 120);
  assert.equal(machinesOf(p, 'rod'), 0, 'the block already covers all rod demand');
});

test('computeNetOutput: a block surplus counts toward a larger want rather than against it', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'screw', machines: 2, clock: 1 },  // makes 80 screw, eats 20 rod
    { kind: 'want', itemId: 'screw', rate: 200 },
  ]);
  assert.equal(rateOf(p.netOutput, 'screw'), 200, 'not 120 — the 80 surplus is part of the 200');
});

// Important 2: computeNetOutput's `drawn['have']` term only becomes visible in
// the public netOutput map when the target is NOT already satisfied purely by
// the same item's own pinned surplus. In every have-row test above, the
// have-item's target is exactly that item's own netPinned deficit satisfied
// with no slack, so netOutput[item] collapses to netPinned[item] + target[item]
// = 0 whether or not the have-credit term fires — and the `r > EPS` filter
// reports both 0 and a negative value identically as absent. Deleting the term
// and rerunning confirms none of those tests notice. This scenario breaks the
// cancellation by layering an independent `want` on top of the block's own
// surplus, so the have-credit's contribution is the only way to reach 100.
test('computeNetOutput: the have-credit term is visible when a want exceeds the surplus it sits on top of', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'screw', machines: 2, clock: 1 },  // +80 screw surplus
    { kind: 'want', itemId: 'screw', rate: 100 },                   // 20 short of the want
    { kind: 'have', itemId: 'screw', rate: 50 },                    // covers the 20 gap, with room to spare
  ]);
  assert.equal(rateOf(p.netOutput, 'screw'), 100, 'without the have-credit term this reads 80');
});

test('planExpansion: an unreachable target reports a shortfall instead of throwing', () => {
  // Only the ingot recipe is enabled, so plate can never be made.
  const p = planExpansion({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'plate', rate: 20 }],
    enabledRecipeIds: new Set(['ingot']),
  });
  assert.equal(p.feasible, false);
  assert.deepEqual(p.shortfalls.map((s) => s.itemId), ['plate']);
});

// Confirmed gap: the spec's ExpansionPlan field table and step 5's "no recipe
// path" diagnostic callout both call for a `requirements` field, reusing
// analyzeRequirements the same way view-model.js's computePlan already does.
// Same scenario as the shortfall test above: only 'ingot' is enabled, so
// nothing can ever produce plate — a genuine no-recipe-path impossibility,
// not a resource-scarcity one (Expansion Mode has no such concept).
test('planExpansion: an unreachable target surfaces in requirements as an impossible, no-recipe target', () => {
  const p = planExpansion({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'plate', rate: 20 }],
    enabledRecipeIds: new Set(['ingot']),
  });
  assert.equal(p.requirements.hasIssues, true);
  assert.deepEqual(
    p.requirements.impossible.map((t) => ({ itemId: t.itemId, reason: t.reason })),
    [{ itemId: 'plate', reason: 'no-recipe' }],
  );
  assert.deepEqual(p.requirements.missing, []);
});

test('planExpansion: no rows yields an empty, feasible plan', () => {
  const p = plan([]);
  assert.equal(p.tiles.machines, 0);
  assert.deepEqual(p.buildRows, []);
  assert.equal(p.hasPlan, false);
});

test('planExpansion: no rows yields empty recipeRates and machinesById maps', () => {
  const p = plan([]);
  assert.equal(p.recipeRates.size, 0);
  assert.equal(p.machinesById.size, 0);
});

test('rawNeeded: reports the rate and whole miners for a solid', () => {
  // 2x rip -> 120 ore/min (verified in the one-block test above).
  const p = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 120);
  assert.equal(ore.supplied, 0);
  assert.equal(ore.newRate, 120);
  // Mk.1 normal = 60 -> 2; Mk.2 normal = 120 -> 1; Mk.1 pure = 120 -> 1
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 2);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.2 · normal').count, 1);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · pure').count, 1);
});

// Every rate above (120, 60, 240, 480) happens to divide its extractor rate
// exactly, so Math.ceil and Math.floor agree and neither is actually pinned.
// 150/min does not divide evenly by any miner tier: 150/60 = 2.5, which must
// round UP to 3 whole miners (a fraction of a miner cannot be built), not down
// to 2. This is the one assertion in the suite that discriminates ceil from
// floor — confirmed by temporarily swapping extractorOptions's Math.ceil for
// Math.floor and rerunning, which fails only this test.
test('rawNeeded: a rate that does not divide evenly still rounds up to a whole extractor', () => {
  // 5x ingot -> 150 ore/min, direct block draw (no LP recipes involved).
  const p = plan([{ kind: 'block', built: false, recipeId: 'ingot', machines: 5, clock: 1 }]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 150);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 3,
    'ceil(150 / 60) = 3, not floor(150 / 60) = 2');
});

test('rawNeeded: a raw have row is netted off, not shown as supply usage', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'ore', rate: 60 },
  ]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 120);
  assert.equal(ore.supplied, 60);
  assert.equal(ore.newRate, 60);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 1);
  assert.deepEqual(p.supplyUsage, [], 'raw supply never appears in supplyUsage');
});

test('rawNeeded: a raw have row covering everything needs no new extraction', () => {
  const p = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'ore', rate: 500 },
  ]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.newRate, 0);
  assert.deepEqual(ore.options, [], 'nothing to build');
});

test('rawNeeded: a block eating ore directly still reaches the footer', () => {
  const p = plan([{ kind: 'block', built: false, recipeId: 'ingot', machines: 3, clock: 1 }]);
  assert.equal(p.tiles.machines, 0, 'nothing upstream to build');
  assert.equal(rawFor(p, 'ore').needed, 90);
});

test('rawNeeded: water, oil, and nitrogen use their own extractors', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const fluids = {
    items: new Map([
      ['Desc_Water_C', { id: 'Desc_Water_C', name: 'Water', slug: 'water', liquid: true }],
      ['Desc_LiquidOil_C', { id: 'Desc_LiquidOil_C', name: 'Crude Oil', slug: 'crude-oil', liquid: true }],
      ['Desc_NitrogenGas_C', { id: 'Desc_NitrogenGas_C', name: 'Nitrogen Gas', slug: 'nitrogen-gas', liquid: true }],
      ['blend', { id: 'blend', name: 'Blend', slug: 'blend', liquid: false }],
    ]),
    buildings: new Map([['b', { id: 'b', name: 'Blender', slug: 'blender', basePowerMW: 75, powerExponent: 1.321928 }]]),
    rawResourceIds: new Set(['Desc_Water_C', 'Desc_LiquidOil_C', 'Desc_NitrogenGas_C']),
    recipes: [{ id: 'mix', name: 'Mix', buildingId: 'b', alternate: false, timeSec: 60,
      inputs: [io('Desc_Water_C', 240), io('Desc_LiquidOil_C', 120), io('Desc_NitrogenGas_C', 60)],
      outputs: [io('blend', 60)] }],
  };
  const p = planExpansion({ dataset: fluids, rows: [{ kind: 'want', itemId: 'blend', rate: 60 }], enabledRecipeIds: new Set(['mix']) });
  const find = (id) => p.rawNeeded.find((r) => r.itemId === id);
  assert.equal(find('Desc_Water_C').options.find((o) => o.label === 'Water Extractor').count, 2);      // 240/120
  assert.equal(find('Desc_LiquidOil_C').options.find((o) => o.label === 'Oil Extractor · normal').count, 1); // 120/120
  assert.equal(find('Desc_NitrogenGas_C').options.find((o) => o.label === 'Well Satellite · normal').count, 1); // 60/60
});

// Fix 6: netOutputRows, machineTotals, blockRows, beltRows, tiles.powerMW, and
// tiles.shards were never exercised anywhere in this file, and no test ran
// planExpansion over the real normalize() output rather than a hand-built
// dataset. This drives one plan through normalize(miniRaw): a pinned Iron
// Ingot block whose output is left entirely unconsumed (disjoint from the
// rest of the fixture, so it shows up in blockRows AND netOutputRows for
// free), plus a Plastic want sized to need exactly 1.5 machine-equivalents —
// the load allocateShards prefers to cover with one overclocked Refinery (1
// shard) rather than two idle-half machines, so the shard budget actually
// drives the build instead of sitting unused.
test('planExpansion: normalize(miniRaw) end-to-end exercises output, machines, belts, and shards', () => {
  const dataset = normalize(miniRaw);
  const rows = [
    { kind: 'block', built: false, recipeId: 'Recipe_IngotIron_C', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'Desc_Plastic_C', rate: 30 },
  ];
  const enabledRecipeIds = new Set(['Recipe_IngotIron_C', 'Recipe_Plastic_C']);
  const p = planExpansion({ dataset, rows, enabledRecipeIds, shardBudget: 1 });

  assert.equal(p.feasible, true);

  assert.equal(p.blockRows.length, 1);
  assert.equal(p.blockRows[0].recipeId, 'Recipe_IngotIron_C');
  assert.equal(p.blockRows[0].machines, 2);
  assert.equal(p.blockRows[0].clockPct, 100);

  // Length asserted as well as the three lookups, so a spurious extra row can't
  // slip past three .find()s that each only check what they asked for.
  assert.equal(p.netOutputRows.length, 3, 'exactly these three leave the factory');
  const ironIngot = p.netOutputRows.find((r) => r.itemId === 'Desc_IronIngot_C');
  const plastic = p.netOutputRows.find((r) => r.itemId === 'Desc_Plastic_C');
  const residue = p.netOutputRows.find((r) => r.itemId === 'Desc_HeavyOilResidue_C');
  assert.equal(ironIngot?.rate, 60, "the block's Iron Ingot has no consumer, so it leaves at its full produced rate");
  assert.equal(plastic?.rate, 30, 'the want is fully met, not zero');
  assert.equal(residue?.rate, 15, 'Heavy Oil Residue is an unconsumed byproduct of the Plastic recipe');

  assert.equal(p.machineTotals.length, 1);
  assert.equal(p.machineTotals[0].buildingName, 'Refinery');
  assert.equal(p.machineTotals[0].machines, 1, 'one overclocked Refinery, not two machines at half load');

  assert.equal(p.tiles.machines, 1);
  assert.equal(p.tiles.shards, 1, 'load 1.5 is machine-minimal as 1 machine + 1 shard, not 2 machines + 0 shards');
  assert.equal(p.tiles.powerMW, 51.3, '30 base MW * 1.5^1.321928, rounded to one decimal');

  assert.equal(p.beltRows.length, 3);
  const oil = p.beltRows.find((b) => b.itemId === 'Desc_LiquidOil_C');
  const plasticBelt = p.beltRows.find((b) => b.itemId === 'Desc_Plastic_C');
  const residueBelt = p.beltRows.find((b) => b.itemId === 'Desc_HeavyOilResidue_C');
  assert.equal(oil?.rate, 45, '30 crude oil/min per machine at 100% load * 1.5 machine-equivalents');
  assert.equal(plasticBelt?.rate, 30);
  assert.equal(residueBelt?.rate, 15);
});

// --- Built vs To-build blocks ------------------------------------------------

test('pinnedBalance: a Built block contributes its output and no demand', () => {
  // ingot: 30 ore -> 30 ingot per machine. Built means the ore already flows.
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'ingot', machines: 2, clock: 1, built: true }]);
  assert.equal(rateOf(net, 'ingot'), 60);
  assert.equal(net.has('ore'), false, 'the ore it eats is not the plan\'s problem');
  for (const [itemId, v] of net) assert.ok(v >= 0, `Built emits no demand, but ${itemId} is ${v}`);
});

test('pinnedBalance: an absent built flag means Built, not To-build', () => {
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'ingot', machines: 2, clock: 1 }]);
  assert.equal(net.has('ore'), false, 'a saved row with no flag reads as Built');
  assert.equal(rateOf(net, 'ingot'), 60);
});

test('pinnedBalance: Built uses gross output, not positive net', () => {
  // A recipe with the same item on both sides. The real dataset has three
  // (Encased Uranium Cell, Alternate: Instant Scrap, Alternate: Distilled
  // Silica); iron-chain.js has none and must not be modified, so this is a
  // throwaway dataset built here — same pattern as oreMakerDataset above.
  const loopDataset = {
    ...ironChain,
    recipes: [...ironChain.recipes, {
      id: 'loop', name: 'loop', buildingId: 'b', alternate: false,
      inputs: [{ itemId: 'ore', perMin: 10 }, { itemId: 'goo', perMin: 2 }],
      outputs: [{ itemId: 'goo', perMin: 5 }],
    }],
  };
  const net = pinnedBalance(loopDataset, [{ kind: 'block', recipeId: 'loop', machines: 1, clock: 1, built: true }]);
  // Gross output is 5/min. Net would be 5 - 2 = 3/min, which under-reports.
  assert.equal(rateOf(net, 'goo'), 5, 'the whole output rate is available, not output minus its own input');
});

test('planExpansion: a Built block feeds a want without planning its own upstream', () => {
  // Built ingot block + a want for plate, which ingots feed. The ingot recipe
  // must not be re-planned and its ore must not reach the footer.
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 2, clock: 1, built: true },
    { kind: 'want', itemId: 'plate', rate: 20 },
  ]);
  const built = p.buildRows.map((r) => r.recipeId);
  assert.equal(built.includes('ingot'), false, 'the Built block is not re-planned');
  assert.equal(p.rawNeeded.some((r) => r.itemId === 'ore'), false, 'and its ore is not in the footer');
  assert.ok(built.includes('plate'), 'but the want is planned');
});

test('planExpansion: the same block flipped to To-build brings its upstream back', () => {
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 2, clock: 1, built: false },
    { kind: 'want', itemId: 'plate', rate: 20 },
  ]);
  assert.ok(p.rawNeeded.some((r) => r.itemId === 'ore'), 'ore returns to the footer');
});

test('planExpansion: a Built line offsets what the LP has to build', () => {
  // 2 Built ingot machines put 60 ingot/min on the bus; the plate want needs
  // 30 ingot/min, so the LP should not have to build any ingot capacity.
  const withBuilt = plan([
    { kind: 'block', recipeId: 'ingot', machines: 2, clock: 1, built: true },
    { kind: 'want', itemId: 'plate', rate: 20 },
  ]);
  const withoutBuilt = plan([{ kind: 'want', itemId: 'plate', rate: 20 }]);
  const ingotMachines = (p) => p.buildRows.find((r) => r.recipeId === 'ingot')?.machines ?? 0;
  assert.ok(ingotMachines(withoutBuilt) > 0, 'sanity: without the Built line the LP builds ingots');
  assert.equal(ingotMachines(withBuilt), 0, 'with it, the LP builds none');
});

test('planExpansion: blockRows report which kind each block is', () => {
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 1, clock: 1, built: true },
    { kind: 'block', recipeId: 'rod', machines: 1, clock: 1, built: false },
    { kind: 'block', recipeId: 'screw', machines: 1, clock: 1 },  // no `built` key at all: a legacy row, defaults to Built
  ]);
  assert.deepEqual(p.blockRows.map((r) => r.built), [true, false, true]);
});

// blockRows (blockView) is a display-only remap of the raw block rows, not
// filtered by validity the way pinnedBalance and the graphRates merge above
// both are via blockLoad's `load <= 0` check — so a `machines: 0` row used to
// render in "Your blocks" as a live 0-machine entry instead of being dropped
// like every other zero-load row in the plan.
test('planExpansion: blockRows drops a zero-machines row, consistent with pinnedBalance and the graph merge', () => {
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 0, clock: 1, built: true },
    { kind: 'block', recipeId: 'rod', machines: 1, clock: 1, built: true },
  ]);
  assert.deepEqual(p.blockRows.map((r) => r.recipeId), ['rod'], 'the zero-machines ingot row is dropped, the real rod row stays');
});

// Added after Task 2's review: annotating all 38 existing rows To-build left the
// two behaviours below proven ONLY in To-build form, even though both also
// govern Built. Without these, the Built path inherits no guard for either.

// computeNetOutput's double-count guard: the upstream's consumption of a block's
// surplus is already a negative term in netFromLPRecipes, so subtracting the
// drawn supply as well would under-report. That has to hold for a Built block's
// gross output exactly as it does for a To-build block's net surplus.
test('computeNetOutput: the double-count guard holds for a Built block too', () => {
  const asBuilt = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },  // wants 120 screw
    { kind: 'block', built: true, recipeId: 'rod', machines: 10, clock: 1 },  // makes 150 rod
  ]);
  const asPlanned = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', built: false, recipeId: 'rod', machines: 10, clock: 1 },
  ]);
  // 150 rod made, 30 eaten by the screw machines feeding rip, so 120 leaves —
  // the same either way. What changes is whether the rod block's own ingot (and
  // the ore behind it) is the plan's problem.
  assert.equal(rateOf(asBuilt.netOutput, 'rod'), 120);
  assert.equal(rateOf(asPlanned.netOutput, 'rod'), 120, 'unchanged from the To-build case');
  assert.ok(rawFor(asBuilt, 'ore').needed < rawFor(asPlanned, 'ore').needed,
    'but the Built line stops driving ore for its own ingot');
});

// The Built branch multiplies by `load`, which comes from blockLoad — so it must
// go through the same normalizeClock the displayed clockPct uses. If the two ever
// diverge again, a garbage clock would display as 100% while the gross output was
// computed at something else.
test('planExpansion: an invalid clock on a Built block computes as it displays', () => {
  const invalid = plan([{ kind: 'block', built: true, recipeId: 'rip', machines: 2, clock: -0.5 }]);
  const normal = plan([{ kind: 'block', built: true, recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(invalid.blockRows[0].clockPct, 100, 'a negative clock must not display as -50%');
  assert.equal(rateOf(invalid.netOutput, 'rip'), rateOf(normal.netOutput, 'rip'),
    'and the gross-output rate must use that same normalized clock');
});

// The test above pins display-vs-compute agreement on garbage input, but -0.5
// and 1 both normalize to the same load as 2 bare machines, so it can't tell
// `load` (machines * clock) apart from `machines` alone. A fractional clock
// can: 2 machines @ 150% is 3 machine-equivalents, not 2.
test('planExpansion: a Built block\'s gross output scales with a fractional clock, not just machine count', () => {
  const p = plan([{ kind: 'block', built: true, recipeId: 'ingot', machines: 2, clock: 1.5 }]);
  assert.equal(rateOf(p.netOutput, 'ingot'), 90, '2 machines @ 150% clock is 3 machine-equivalents worth of output');
});
