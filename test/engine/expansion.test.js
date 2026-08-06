import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedBalance, splitDemand, computeNetOutput, planExpansion, blockOutputExclusions } from '../../js/engine/expansion.js';
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

test('pinnedBalance: clock scales the load — 4 @150% equals 6 @100%', () => {
  const fast = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 4, clock: 1.5 }]);
  const many = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 6, clock: 1 }]);
  assert.deepEqual([...fast].sort(), [...many].sort());
  assert.equal(rateOf(fast, 'rip'), 30);
});

test('pinnedBalance: an unknown recipeId is ignored, not thrown', () => {
  const net = pinnedBalance(ironChain, [
    { kind: 'block', recipeId: 'no_such_recipe', machines: 3, clock: 1 },
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
  ]);
  assert.equal(rateOf(net, 'rip'), 10, 'the surviving block still counts');
});

test('splitDemand: negative non-raw becomes a target, positive becomes pinned supply', () => {
  const net = new Map([['plate', -60], ['screw', -120], ['rip', 10]]);
  const { targets, supplies, rawDemand } = splitDemand(ironChain, net, [], []);
  assert.equal(rateOf(targets, 'plate'), 60);
  assert.equal(rateOf(targets, 'screw'), 120);
  assert.deepEqual(supplies, [{ itemId: 'rip', rate: 10, kind: 'pinned' }]);
  assert.equal(rawDemand.size, 0);
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

/**
 * The multi-level whole-machine cascade, and the suite's only multi-machine
 * tiles.machines guard. Previously driven by a To-build block's feedstock;
 * a want row creates the same demand now that blocks no longer do. Without
 * this, clamping tiles.machines to Math.min(1, …) passes the whole suite.
 */
test('planExpansion: a want explodes to whole upstream machines', () => {
  const p = plan([{ kind: 'want', itemId: 'rip', rate: 10 }]);
  assert.equal(p.feasible, true);
  assert.equal(machinesOf(p, 'plate'), 3);
  assert.equal(machinesOf(p, 'screw'), 3);
  assert.equal(machinesOf(p, 'rod'), 2);
  assert.equal(machinesOf(p, 'ingot'), 4);
  assert.equal(machinesOf(p, 'rip'), 2, 'the LP builds the rip machines too, now that no block pins them');
  assert.equal(p.tiles.machines, 14);
});

// recipeRates/machinesById feed buildGraph (js/engine/graph.js) for the
// Expansion view's diagram, and were added alongside it. Checked
// against buildRows rather than hardcoded numbers: buildRows is already
// exhaustively tested above, so this only needs to confirm the two new fields
// agree with it and are scoped to the same LP-solved recipes.
test('planExpansion: recipeRates and machinesById mirror buildRows for the LP-solved recipes', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'rod', rate: 100 },
  ]);
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
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(p.recipeRates.has('rip'), false, 'sanity: rip itself is still never LP-solved');
  assert.equal(rateOf(p.graphRates, 'rip'), 2, "the block's own machine-equivalent load (2 machines @ 100%)");
  assert.equal(p.graphMachinesById.get('rip'), 2, "the block's own declared machine count");
});

// The other half of the same fix: a recipe that is BOTH pinned AND separately
// LP-solved (the block below covers only 40 of the 100 plate/min wanted, so
// the LP tops up the remaining 60/min with machines of its own) must sum in
// the graph maps, not have one side clobber the other.
test('planExpansion: graphRates/graphMachinesById sum a block and the LP for the same recipe rather than overwrite', () => {
  const p = plan([
    { kind: 'block', recipeId: 'plate', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'plate', rate: 100 },
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
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()]);
  assert.ok(graph.nodes.some((n) => n.id === 'rip'), "the pinned block's own recipe must be a node in the diagram");
  assert.ok(!graph.nodes.some((n) => n.itemId === 'plate' && n.isSurplus), 'plate now feeds the block in-graph, not spare capacity');
  assert.ok(!graph.nodes.some((n) => n.itemId === 'screw' && n.isSurplus), 'screw now feeds the block in-graph, not spare capacity');
});

// A block is a source in the diagram, not a consumer of its own inputs: the
// machines already exist and are already fed (pinnedBalance only ever adds
// gross output), so buildGraph must not wire the block's inputs as in-graph
// demand. Regression guard: graphRates/graphMachinesById used to merge a
// block's load in as if it were itself a real LP consumer, so buildGraph
// still drew an edge from whatever makes 'ingot' to 'plate' and subtracted
// plate's ingot appetite from netById — pushing ingot's net negative and
// making addSink drop the out:ingot sink entirely, even though netOutput
// (and the want row) both say 30 ingot/min genuinely leaves.
test("planExpansion: a block's own recipe is a source in the diagram, not a consumer of its inputs", () => {
  const p = plan([
    { kind: 'block', recipeId: 'plate', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'ingot', rate: 30 },
  ]);
  assert.equal(rateOf(p.netOutput, 'plate'), 40, "sanity: the block's gross output");
  assert.equal(rateOf(p.netOutput, 'ingot'), 30, 'sanity: the want is met');
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()], p.externallyFedLoad);
  assert.ok(graph.nodes.some((n) => n.id === 'out:ingot'), 'ingot leaves the system just like netOutput promises');
  assert.ok(!graph.edges.some((e) => e.from === 'ingot' && e.to === 'plate'),
    "plate's ingot appetite is covered externally, not drawn from the ingot recipe in-graph");
});

// Round-2 regression: the guard above skips ALL input processing for a
// recipe id once ANY block touches it, which is right when a block is the
// only thing on that recipe id but wrong once graphRates' merge (see "sum a
// block and the LP" above) puts a genuine LP-solved share of load onto that
// SAME recipe id. Here the block covers only 30 of the 100 rod/min wanted,
// so the LP must build 70 rod/min of its own capacity on top of it; that LP
// share is a real consumer of ingot and must still show as one, not vanish
// into a phantom ingot surplus.
test("planExpansion: the diagram still wires a recipe's LP-solved share when a block covers only part of it", () => {
  const p = plan([
    { kind: 'block', recipeId: 'rod', machines: 2, clock: 1 },
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

// externallyFedLoad itself (see js/engine/expansion.js's comment on it) had
// no direct test, only indirect coverage through the graph-shape tests above.
// Pin its contents directly for a plan with two blocks on different
// recipes: every block contributes its own machine-equivalent load, so both
// recipe ids should appear in the map.
test("planExpansion: externallyFedLoad holds every block's machine-equivalent load, keyed by recipe id", () => {
  const p = plan([
    { kind: 'block', recipeId: 'rod', machines: 2, clock: 1 },
    { kind: 'block', recipeId: 'ingot', machines: 4, clock: 1 },
  ]);
  assert.equal(p.externallyFedLoad.get('rod'), 2, "the block's own machine-equivalent load");
  assert.equal(p.externallyFedLoad.get('ingot'), 4, "every block contributes externally-fed load now, not just a Built one");
});

// Important 1: the raw footer combines a direct raw want (bypassing the LP
// entirely) with whatever the LP separately needs for its own targets.
// Before this test, nothing exercised rawUsage with both sources active at
// once.
test('planExpansion: rawUsage combines a direct raw want with a separate LP residual draw', () => {
  const p = plan([
    { kind: 'want', itemId: 'ore', rate: 30 },      // direct raw demand, bypasses the LP entirely
    { kind: 'want', itemId: 'plate', rate: 40 },    // needs 60 ingot/min total, LP-solved
  ]);
  // The LP builds its own ingot machines for the full 60 ingot/min the plate
  // want needs; the raw want adds a separate 30 ore/min that never touches
  // the LP or any machine at all.
  assert.equal(rawFor(p, 'ore').needed, 90, '30 direct raw demand plus 60 from the LP-solved plate chain');
  assert.equal(machinesOf(p, 'ingot'), 2, 'the LP builds ingot machines only for the plate chain; the raw want touches no machines at all');
});

// Important 3: a block netting a raw surplus must reduce rawUsage instead of
// vanishing. Before the fix, the +50 credit was pushed into a dead 'pinned'
// supply entry and rawUsage stayed at the full 80.
test('planExpansion: a block netting a raw surplus credits rawUsage instead of vanishing', () => {
  const p = planOre([
    { kind: 'block', recipeId: 'oreMaker', machines: 10, clock: 1 },  // +50 ore/min
    { kind: 'want', itemId: 'ore', rate: 80 },
  ]);
  assert.equal(rawFor(p, 'ore').needed, 30, '80 wanted minus the 50 the block already makes');
});

test('planExpansion: rawUsage never goes negative when a raw credit exceeds demand', () => {
  const p = planOre([
    { kind: 'block', recipeId: 'oreMaker', machines: 20, clock: 1 },  // +100 ore/min
    { kind: 'want', itemId: 'ore', rate: 30 },
  ]);
  assert.equal(rateOf(p.rawUsage, 'ore'), 0, 'a surplus bigger than demand is not a negative need');
});

test('planExpansion: a have row covering demand removes that whole subtree', () => {
  const p = plan([
    { kind: 'want', itemId: 'screw', rate: 120 },
    { kind: 'have', itemId: 'screw', rate: 120 },
  ]);
  assert.equal(machinesOf(p, 'screw'), 0);
  assert.equal(machinesOf(p, 'rod'), 0, 'and the rod that fed it');
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 120, used: 120, capped: false }],
    'exhausted but nothing was built for it, so not flagged');
});

test('planExpansion: a have row partly covering demand flags the overflow', () => {
  const p = plan([
    { kind: 'want', itemId: 'screw', rate: 120 },
    { kind: 'have', itemId: 'screw', rate: 60 },
  ]);
  assert.equal(machinesOf(p, 'screw'), 2, 'ceil(1.5) whole machines');
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 60, used: 60, capped: true }]);
});

test('planExpansion: a have row larger than demand is not flagged', () => {
  const p = plan([
    { kind: 'want', itemId: 'screw', rate: 120 },
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
    { kind: 'want', itemId: 'screw', rate: 120 },
    { kind: 'have', itemId: 'screw', rate: 120 },
  ]);
  const two = plan([
    { kind: 'want', itemId: 'screw', rate: 120 },
    { kind: 'have', itemId: 'screw', rate: 60 },
    { kind: 'have', itemId: 'screw', rate: 60 },
  ]);
  assert.equal(machinesOf(two, 'screw'), machinesOf(one, 'screw'));
  assert.deepEqual(two.supplyUsage, one.supplyUsage);
  assert.deepEqual(two.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 120, used: 120, capped: false }]);
});

test('computeNetOutput: an unconsumed block output leaves at its full rate', () => {
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(rateOf(p.netOutput, 'rip'), 10);
  assert.equal(rateOf(p.netOutput, 'plate'), 0, 'plate is fully consumed internally');
});

// The double-count guard: the upstream's consumption of the surplus is already a
// negative term in netFromLPRecipes, so subtracting the drawn supply too gives 70.
test('computeNetOutput: a block surplus partly eaten upstream reports the remainder', () => {
  const p = plan([
    { kind: 'want', itemId: 'screw', rate: 120 },                // wants 120 screw
    { kind: 'block', recipeId: 'rod', machines: 10, clock: 1 },  // makes 150 rod
  ]);
  // screw machines (3) consume 30 rod; 150 - 30 = 120 rod leaves.
  assert.equal(rateOf(p.netOutput, 'rod'), 120);
  assert.equal(machinesOf(p, 'rod'), 0, 'the block already covers all rod demand');
});

test('computeNetOutput: a block surplus counts toward a larger want rather than against it', () => {
  const p = plan([
    { kind: 'block', recipeId: 'screw', machines: 2, clock: 1 },  // makes 80 screw, eats 20 rod
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
    { kind: 'block', recipeId: 'screw', machines: 2, clock: 1 },  // +80 screw surplus
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
  // 10 rip/min (2 machines' worth) -> 120 ore/min (verified in the one-block test above).
  const p = plan([{ kind: 'want', itemId: 'rip', rate: 10 }]);
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
  // 150 ingot/min needs 150 ore/min directly (1:1 recipe, no other LP recipes involved).
  const p = plan([{ kind: 'want', itemId: 'ingot', rate: 150 }]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 150);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 3,
    'ceil(150 / 60) = 3, not floor(150 / 60) = 2');
});

test('rawNeeded: a raw have row is netted off, not shown as supply usage', () => {
  const p = plan([
    { kind: 'want', itemId: 'rip', rate: 10 },
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
    { kind: 'want', itemId: 'rip', rate: 10 },
    { kind: 'have', itemId: 'ore', rate: 500 },
  ]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.newRate, 0);
  assert.deepEqual(ore.options, [], 'nothing to build');
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
    { kind: 'block', recipeId: 'Recipe_IngotIron_C', machines: 2, clock: 1 },
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

// --- Block rows: fixed gross output, no demand -------------------------------

test('pinnedBalance: a block contributes its output and no demand', () => {
  // ingot: 30 ore -> 30 ingot per machine. A block means the ore already flows.
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'ingot', machines: 2, clock: 1 }]);
  assert.equal(rateOf(net, 'ingot'), 60);
  assert.equal(net.has('ore'), false, 'the ore it eats is not the plan\'s problem');
  for (const [itemId, v] of net) assert.ok(v >= 0, `a block emits no demand, but ${itemId} is ${v}`);
});

test('pinnedBalance: a block uses gross output, not positive net', () => {
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
  const net = pinnedBalance(loopDataset, [{ kind: 'block', recipeId: 'loop', machines: 1, clock: 1 }]);
  // Gross output is 5/min. Net would be 5 - 2 = 3/min, which under-reports.
  assert.equal(rateOf(net, 'goo'), 5, 'the whole output rate is available, not output minus its own input');
});

test('planExpansion: a block feeds a want without planning its own upstream', () => {
  // An ingot block + a want for plate, which ingots feed. The ingot recipe
  // must not be re-planned and its ore must not reach the footer.
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'plate', rate: 20 },
  ]);
  const built = p.buildRows.map((r) => r.recipeId);
  assert.equal(built.includes('ingot'), false, 'the block is not re-planned');
  assert.equal(p.rawNeeded.some((r) => r.itemId === 'ore'), false, 'and its ore is not in the footer');
  assert.ok(built.includes('plate'), 'but the want is planned');
});

test('planExpansion: a block line offsets what the LP has to build', () => {
  // 2 ingot machines put 60 ingot/min on the bus; the plate want needs
  // 30 ingot/min, so the LP should not have to build any ingot capacity.
  const withBlock = plan([
    { kind: 'block', recipeId: 'ingot', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'plate', rate: 20 },
  ]);
  const withoutBlock = plan([{ kind: 'want', itemId: 'plate', rate: 20 }]);
  const ingotMachines = (p) => p.buildRows.find((r) => r.recipeId === 'ingot')?.machines ?? 0;
  assert.ok(ingotMachines(withoutBlock) > 0, 'sanity: without the block line the LP builds ingots');
  assert.equal(ingotMachines(withBlock), 0, 'with it, the LP builds none');
});

// blockRows (blockView) is a display-only remap of the raw block rows, not
// filtered by validity the way pinnedBalance and the graphRates merge above
// both are via blockLoad's `load <= 0` check — so a `machines: 0` row used to
// render in "Your blocks" as a live 0-machine entry instead of being dropped
// like every other zero-load row in the plan.
test('planExpansion: blockRows drops a zero-machines row, consistent with pinnedBalance and the graph merge', () => {
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 0, clock: 1 },
    { kind: 'block', recipeId: 'rod', machines: 1, clock: 1 },
  ]);
  assert.deepEqual(p.blockRows.map((r) => r.recipeId), ['rod'], 'the zero-machines ingot row is dropped, the real rod row stays');
});

// The block branch multiplies by `load`, which comes from blockLoad — so it must
// go through the same normalizeClock the displayed clockPct uses. If the two ever
// diverge again, a garbage clock would display as 100% while the gross output was
// computed at something else.
test('planExpansion: an invalid clock on a block computes as it displays', () => {
  const invalid = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: -0.5 }]);
  const normal = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(invalid.blockRows[0].clockPct, 100, 'a negative clock must not display as -50%');
  assert.equal(rateOf(invalid.netOutput, 'rip'), rateOf(normal.netOutput, 'rip'),
    'and the gross-output rate must use that same normalized clock');
});

// The test above pins display-vs-compute agreement on garbage input, but -0.5
// and 1 both normalize to the same load as 2 bare machines, so it can't tell
// `load` (machines * clock) apart from `machines` alone. A fractional clock
// can: 2 machines @ 150% is 3 machine-equivalents, not 2.
test('planExpansion: a block\'s gross output scales with a fractional clock, not just machine count', () => {
  const p = plan([{ kind: 'block', recipeId: 'ingot', machines: 2, clock: 1.5 }]);
  assert.equal(rateOf(p.netOutput, 'ingot'), 90, '2 machines @ 150% clock is 3 machine-equivalents worth of output');
});

// --- Alternates gating -------------------------------------------------------

// 'fastrod' is an ALTERNATE that makes 'rod' more cheaply, plus 'gizmo' which
// ONLY an alternate can make. iron-chain.js has no alternates and must not be
// modified, so both live here.
const altDataset = {
  ...ironChain,
  recipes: [...ironChain.recipes,
    { id: 'fastrod', name: 'fastrod', buildingId: 'b', alternate: true, inputs: [{ itemId: 'ingot', perMin: 10 }], outputs: [{ itemId: 'rod', perMin: 20 }] },
    { id: 'gizmo', name: 'gizmo', buildingId: 'b', alternate: true, inputs: [{ itemId: 'rod', perMin: 5 }], outputs: [{ itemId: 'gizmo', perMin: 5 }] },
  ],
};
const BASE_ONLY = new Set(altDataset.recipes.filter((r) => !r.alternate).map((r) => r.id));
const WITH_ALTS = new Set(altDataset.recipes.map((r) => r.id));

test('planExpansion: a want only an alternate can make is unproducible with alternates off', () => {
  const off = planExpansion({
    dataset: altDataset,
    rows: [{ kind: 'want', itemId: 'gizmo', rate: 10 }],
    enabledRecipeIds: BASE_ONLY,
  });
  assert.equal(off.requirements.hasIssues, true, 'nothing can make it');

  const on = planExpansion({
    dataset: altDataset,
    rows: [{ kind: 'want', itemId: 'gizmo', rate: 10 }],
    enabledRecipeIds: WITH_ALTS,
  });
  assert.equal(on.requirements.hasIssues, false, 'enabling the alternate makes it producible');
  assert.ok(on.buildRows.some((r) => r.recipeId === 'gizmo'));
});

test('planExpansion: a block on a disabled alternate still plans normally', () => {
  // The picker gates what the LP may CHOOSE, never what the user may DECLARE.
  // Blocks are pinned, not solved, so an unchecked alternate is valid here.
  const p = planExpansion({
    dataset: altDataset,
    rows: [{ kind: 'block', recipeId: 'fastrod', machines: 2, clock: 1 }],
    enabledRecipeIds: BASE_ONLY,
  });
  assert.equal(p.blockRows.length, 1, 'the block is honoured despite its recipe being disabled');
  assert.ok(p.netOutputRows.some((r) => r.itemId === 'rod'), 'and its output reaches the plan');
});

// --- Wave B test hardening ---------------------------------------------------
// Each test below closes one mutation that survived the full suite (0/228
// kills) in the review pass that produced this file's other tests. Scenarios
// deliberately duplicate rows/fixtures from tests above rather than editing
// them in place.

test("buildGraph (D1): a block's own output still gets a sink, not just the LP's target", () => {
  const p = plan([
    { kind: 'block', recipeId: 'plate', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'ingot', rate: 30 },
  ]);
  assert.equal(rateOf(p.netOutput, 'plate'), 40, "sanity: the block's gross output");
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()], p.externallyFedLoad);
  assert.ok(graph.nodes.some((n) => n.id === 'out:plate'),
    "netById's output side must count the block's full load (40), not its non-fed remainder (0), or this sink is never created");
});

test("buildGraph (D2): the diagram's input edge carries only the LP's own share of a recipe split with a block", () => {
  const p = plan([
    { kind: 'block', recipeId: 'rod', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'rod', rate: 100 },
  ]);
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()], p.externallyFedLoad);
  const edge = graph.edges.find((e) => e.from === 'ingot' && e.to === 'rod');
  assert.ok(edge, 'sanity: the ingot->rod edge exists');
  assert.equal(r6(edge.rate), 70,
    'the edge must carry inputLoad (the LP-built 70 rod/min share only) — the full load would double-count the block\'s own share and read ~100');
});

test('planExpansion (D3): externallyFedLoad sums every block row on the same recipe id, not just the last one', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rod', machines: 2, clock: 1 },
    { kind: 'block', recipeId: 'rod', machines: 3, clock: 1 },
  ]);
  assert.equal(p.externallyFedLoad.get('rod'), 5, 'two block rows of 2 and 3 machines must accumulate to 5, not overwrite down to 3');
});

test('planExpansion (D4): a raw-producing block credits its output, rather than being ignored or charged as demand', () => {
  const p = planOre([
    { kind: 'block', recipeId: 'oreMaker', machines: 2, clock: 1 },
    { kind: 'want', itemId: 'ingot', rate: 30 },
  ]);
  // The want's 30 ore/min demand, minus the oreMaker block's own 10 ore/min
  // (2 machines x 5/min), is 20. Skipping the credit leaves the full 30;
  // negating it charges an extra 10 as demand instead, landing on 40.
  assert.equal(rawFor(p, 'ore').needed, 20,
    "the block's 10 ore/min must credit against the want's 30 ore/min, leaving 20 — not 30 (credit skipped) or 40 (credit negated into demand)");
});

const dualOutputDataset = {
  ...ironChain,
  recipes: [...ironChain.recipes,
    { id: 'dualOut', name: 'dualOut', buildingId: 'b', alternate: false, inputs: [], outputs: [{ itemId: 'plate', perMin: 3 }, { itemId: 'rod', perMin: 7 }] },
  ],
};

test('pinnedBalance (D5): a multi-output block reports every output at its full gross rate, not just the first', () => {
  const net = pinnedBalance(dualOutputDataset, [
    { kind: 'block', recipeId: 'dualOut', machines: 2, clock: 1 },
  ]);
  assert.equal(rateOf(net, 'plate'), 6, 'sanity: first output at gross rate (2 machines x 3/min)');
  assert.equal(rateOf(net, 'rod'), 14, 'the second output must also be reported (2 machines x 7/min), not dropped for only reading outputs[0]');
});

test("buildGraph (D6): an overclocked block is fed by its own load, not its raw machine count", () => {
  const p = plan([
    { kind: 'block', recipeId: 'rod', machines: 2, clock: 1.5 },
    { kind: 'want', itemId: 'ingot', rate: 10 },
  ]);
  assert.equal(rateOf(p.netOutput, 'rod'), 45, 'sanity: 2 machines @150% clock is 3 machine-equivalents worth of rod');
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()], p.externallyFedLoad);
  assert.ok(!graph.edges.some((e) => e.from === 'ingot' && e.to === 'rod'),
    "externallyFedLoad must use the block's load (3), not its machine count (2), or a phantom 15/min ingot->rod edge appears");
});

test('planExpansion (D7): a zero-machines block row is excluded from the graph merge, not merged in as a phantom entry', () => {
  const p = plan([{ kind: 'block', recipeId: 'screw', machines: 0, clock: 1 }]);
  assert.equal(p.graphRates.has('screw'), false, 'a 0-machine row must not create a graphRates entry at all');
  const graph = buildGraph(ironChain, p.graphRates, p.graphMachinesById, [...p.netOutput.keys()], p.externallyFedLoad);
  assert.ok(!graph.nodes.some((n) => n.id === 'screw'), 'a 0-machine block must not draw a phantom node in the diagram');
});

// --- Maximize mode -----------------------------------------------------------

const planMax = (rows, extra = {}) => planExpansion({
  dataset: ironChain, rows, enabledRecipeIds: ALL_IRON_RECIPES, mode: 'max', ...extra,
});

/**
 * The bound is what you declared. A Built screw block makes 80 screw/min; rotor
 * takes 100 screw per 4 rotor (25 each), so the most rotors is 3.2/min. rod is
 * built freely from uncapped ore, which is the point — you get told what to add.
 */
test('planExpansion (max): a block bounds the maximum at its own output', () => {
  const p = planMax([
    { kind: 'block', recipeId: 'screw', machines: 2, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.equal(p.mode, 'max');
  assert.equal(p.maximize.bounded, true);
  assert.ok(Math.abs(p.maximize.sets - 3.2) < 1e-6, `expected 3.2, got ${p.maximize.sets}`);
  assert.equal(p.maximize.perPart.length, 1);
  assert.equal(p.maximize.perPart[0].itemId, 'rotor');
  assert.ok(Math.abs(p.maximize.perPart[0].rate - 3.2) < 1e-6);
  assert.deepEqual(p.maximize.bindingItems.map((b) => b.itemId), ['screw'],
    'and it names the line that bound the answer');
  assert.ok(machinesOf(p, 'rod') > 0, 'rod is still built for you from free ore');
});

/**
 * The test that would have caught the 21-million bug. Without the exclusion the
 * solver builds screws from uncapped ore and the answer runs to the 1e9 raw
 * clamp instead of being bounded by the declared line.
 */
test('planExpansion (max): excluding the block output recipe is what bounds it', () => {
  const p = planMax([
    { kind: 'block', recipeId: 'screw', machines: 2, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.ok(p.maximize.sets < 100,
    `a bounded answer must be small; ${p.maximize.sets} means the screw recipe was not excluded`);
});

test('planExpansion (max): with nothing declared, it reports unbounded and no rate', () => {
  const p = planMax([{ kind: 'max', itemId: 'rotor', weight: 1 }]);
  assert.equal(p.maximize.bounded, false, 'nothing declared can bound this');
  assert.deepEqual(p.maximize.bindingItems, []);
});

test('planExpansion (max): a declared line that the target does not need is not binding', () => {
  // A Built plate block cannot bound rotor here: plate sits on a side branch off
  // ingot (ingot -> plate) that rotor's chain never touches (rotor <- rod, screw
  // <- rod <- ingot <- ore), so the answer is unbounded, not sized to the block.
  const p = planMax([
    { kind: 'block', recipeId: 'plate', machines: 1, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.equal(p.maximize.bounded, false,
    'the plate line is not on rotor\'s dependency chain, so nothing is binding');
});

test('planExpansion (max): a HAVE row is a floor to draw on, not a ceiling', () => {
  // screw recipes stay enabled here (no screw block), so the have row caps
  // nothing — the solver may build more screws and the answer is unbounded.
  const p = planMax([
    { kind: 'have', itemId: 'screw', rate: 80 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.equal(p.maximize.bounded, false, 'a have row does not exclude the item\'s recipes');
});

test('planExpansion (max): balanced sets weight the targets against each other', () => {
  const p = planMax([
    { kind: 'block', recipeId: 'screw', machines: 4, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
    { kind: 'max', itemId: 'rod', weight: 2 },
  ]);
  assert.equal(p.maximize.perPart.length, 2);
  const rotor = p.maximize.perPart.find((x) => x.itemId === 'rotor');
  const rod = p.maximize.perPart.find((x) => x.itemId === 'rod');
  assert.ok(Math.abs(rod.rate - 2 * rotor.rate) < 1e-6,
    'weight 2 means twice as much rod as rotor, per set');
});

/**
 * Fix round 1, Critical. castScrew makes screw straight from ingot, bypassing
 * the declared rod line entirely (screw normally needs rod -> screw). maxSets'
 * first pass still fully drains rod as a side effect of maximizing SETS (rod is
 * cheap and helps, so pass 1 takes all of it) even though rip's real ceiling now
 * comes from the bypass route instead: rip needs plate + screw, plate is built
 * freely from uncapped ore, and now so is screw via castScrew, so rip is
 * genuinely unbounded and runs away to the raw clamp. "rod fully drawn" alone
 * must not be read as "rod bounds the answer".
 */
test('planExpansion (max): a bypass route around a declared line is unbounded, not falsely bound', () => {
  const castScrew = { id: 'castScrew', name: 'castScrew', buildingId: 'b', alternate: true, inputs: [{ itemId: 'ingot', perMin: 10 }], outputs: [{ itemId: 'screw', perMin: 20 }] };
  const bypassDataset = { ...ironChain, recipes: [...ironChain.recipes, castScrew] };
  const bypassEnabled = new Set([...ALL_IRON_RECIPES, 'castScrew']);
  const p = planExpansion({
    dataset: bypassDataset,
    rows: [
      { kind: 'block', recipeId: 'rod', machines: 1, clock: 1 },
      { kind: 'max', itemId: 'rip', weight: 1 },
    ],
    enabledRecipeIds: bypassEnabled,
    mode: 'max',
  });
  assert.ok(p.maximize.sets > 1e6,
    `expected a clamp-scale runaway answer (castScrew makes rip's screw need free), got ${p.maximize.sets}`);
  assert.equal(p.maximize.bounded, false,
    'rod being fully drawn does not mean rod bounds rip: castScrew gives rip a second, unbounded route');
});

/**
 * Fix round 1, Important 2. dual makes p (primary) and b (byproduct) from ore;
 * useB turns b into t. Declaring the dual block excludes dual — it is b's only
 * producer too, via blockOutputExclusions' any-output match — so once dual is
 * excluded, b has no remaining producer at all. b is then a genuine ceiling on
 * t, not a false positive: unlike a plain fully-drawn check, this must survive
 * b never being a block's own declared PRIMARY output.
 */
test('planExpansion (max): an orphaned byproduct with no other producer is a genuine ceiling', () => {
  const dual = { id: 'dual', name: 'dual', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 10 }], outputs: [{ itemId: 'p', perMin: 5 }, { itemId: 'b', perMin: 3 }] };
  const useB = { id: 'useB', name: 'useB', buildingId: 'b', alternate: false, inputs: [{ itemId: 'b', perMin: 1 }], outputs: [{ itemId: 't', perMin: 1 }] };
  const orphanDataset = { ...ironChain, recipes: [...ironChain.recipes, dual, useB] };
  const orphanEnabled = new Set([...ALL_IRON_RECIPES, 'dual', 'useB']);
  const p = planExpansion({
    dataset: orphanDataset,
    rows: [
      { kind: 'block', recipeId: 'dual', machines: 1, clock: 1 },
      { kind: 'max', itemId: 't', weight: 1 },
    ],
    enabledRecipeIds: orphanEnabled,
    mode: 'max',
  });
  assert.equal(p.maximize.bounded, true, 'b has no remaining producer once dual is excluded, so it is a real ceiling');
  assert.ok(Math.abs(p.maximize.sets - 3) < 1e-6, `expected 3 (dual's b output at 1 machine), got ${p.maximize.sets}`);
  assert.deepEqual(p.maximize.bindingItems.map((x) => x.itemId), ['b']);
});

test('planExpansion (max): the same byproduct is not a ceiling once an independent producer exists', () => {
  // Same shape as above, plus bMaker2 makes b directly from ore with no
  // connection to the declared dual block — b now has a real remaining
  // producer, so the previous ceiling disappears and t is unbounded again.
  const dual = { id: 'dual', name: 'dual', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 10 }], outputs: [{ itemId: 'p', perMin: 5 }, { itemId: 'b', perMin: 3 }] };
  const useB = { id: 'useB', name: 'useB', buildingId: 'b', alternate: false, inputs: [{ itemId: 'b', perMin: 1 }], outputs: [{ itemId: 't', perMin: 1 }] };
  const bMaker2 = { id: 'bMaker2', name: 'bMaker2', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 1 }], outputs: [{ itemId: 'b', perMin: 1 }] };
  const dataset2 = { ...ironChain, recipes: [...ironChain.recipes, dual, useB, bMaker2] };
  const enabled2 = new Set([...ALL_IRON_RECIPES, 'dual', 'useB', 'bMaker2']);
  const p = planExpansion({
    dataset: dataset2,
    rows: [
      { kind: 'block', recipeId: 'dual', machines: 1, clock: 1 },
      { kind: 'max', itemId: 't', weight: 1 },
    ],
    enabledRecipeIds: enabled2,
    mode: 'max',
  });
  assert.equal(p.maximize.bounded, false, 'b now has an independent producer, so nothing bounds t');
  assert.deepEqual(p.maximize.bindingItems, []);
});

/**
 * Fix round 1, Important 3 (pinning test — behavior was already correct).
 * horAlt is hor's only route; plasticR makes plastic AND hor together.
 * Declaring horAlt excludes every recipe that outputs hor ANYWHERE, including
 * plasticR (the asymmetric any-output match, see blockOutputExclusions above)
 * — so plastic loses its only recipe as collateral damage and the target is
 * stuck at 0, not merely capped. Nothing here looks "fully drawn", so bounded
 * must stay false rather than reading the zero as some kind of bound.
 */
test('planExpansion (max): excluding a recipe as collateral can zero out the target entirely', () => {
  const horAlt = { id: 'horAlt', name: 'horAlt', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 2 }], outputs: [{ itemId: 'hor', perMin: 1 }] };
  const plasticR = { id: 'plasticR', name: 'plasticR', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 4 }], outputs: [{ itemId: 'plastic', perMin: 2 }, { itemId: 'hor', perMin: 1 }] };
  const silentDataset = { ...ironChain, recipes: [...ironChain.recipes, horAlt, plasticR] };
  const silentEnabled = new Set([...ALL_IRON_RECIPES, 'horAlt', 'plasticR']);
  const p = planExpansion({
    dataset: silentDataset,
    rows: [
      { kind: 'block', recipeId: 'horAlt', machines: 1, clock: 1 },
      { kind: 'max', itemId: 'plastic', weight: 1 },
    ],
    enabledRecipeIds: silentEnabled,
    mode: 'max',
  });
  assert.equal(p.feasible, true);
  assert.equal(p.maximize.sets, 0, 'plasticR was excluded as collateral, so plastic has no route left at all');
  assert.equal(p.maximize.bounded, false, 'a zeroed-out target is not "bounded" in any meaningful sense');
});

/**
 * Fix round 1, Important 4. screw at 20 machines makes 800/min, far more than
 * rotor can use (100 screw per 4 rotor) — screw is drawn well below its
 * declared rate and must not be reported as binding. rod at 1 machine makes
 * 15/min and IS the true bottleneck (20 rod per 4 rotor too): only rod should
 * be fully drawn and only rod should be named.
 */
test('planExpansion (max): a partially-drawn declared line is not binding, only the fully-drawn one is', () => {
  const p = planMax([
    { kind: 'block', recipeId: 'rod', machines: 1, clock: 1 },
    { kind: 'block', recipeId: 'screw', machines: 20, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.equal(p.maximize.bounded, true);
  assert.deepEqual(p.maximize.bindingItems.map((x) => x.itemId), ['rod'],
    'screw is only 75 of its declared 800/min here, nowhere near its cap, so it must not appear');
});

/**
 * Tests blockOutputExclusions directly rather than through a plan. Going through
 * planExpansion here would need a disjunctive assertion ("bMaker was built OR the
 * answer was unbounded"), which passes trivially via the second clause and proves
 * nothing — exactly the non-discriminating shape that slipped through twice on
 * the previous round of this feature. The exclusion set is pure and exported, so
 * assert on it.
 */
test('blockOutputExclusions: only the primary output is excluded, not a byproduct', () => {
  // dualOut makes 'a' (primary) and 'b' (byproduct). bMaker also makes 'b'.
  const twoOut = {
    ...ironChain,
    recipes: [...ironChain.recipes,
      { id: 'dualOut', name: 'dualOut', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 10 }], outputs: [{ itemId: 'a', perMin: 5 }, { itemId: 'b', perMin: 3 }] },
      { id: 'bMaker', name: 'bMaker', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 2 }], outputs: [{ itemId: 'b', perMin: 4 }] },
      { id: 'aMaker', name: 'aMaker', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 9 }], outputs: [{ itemId: 'a', perMin: 5 }] },
    ],
  };
  const ex = blockOutputExclusions(twoOut, [{ kind: 'block', recipeId: 'dualOut', machines: 1, clock: 1 }]);
  assert.equal(ex.has('dualOut'), true, 'the declared line itself produces the primary output');
  assert.equal(ex.has('aMaker'), true, 'and so does any other route to that primary output');
  assert.equal(ex.has('bMaker'), false,
    "the byproduct 'b' is NOT a declared ceiling, so its other producer stays available");
});

test('blockOutputExclusions: a have row excludes nothing', () => {
  const ex = blockOutputExclusions(ironChain, []);
  assert.equal(ex.size, 0, 'no blocks means no exclusions — have rows never exclude');
});

test('blockOutputExclusions: a stale or zero-machine block row excludes nothing', () => {
  const stale = blockOutputExclusions(ironChain, [{ kind: 'block', recipeId: 'no_such', machines: 2, clock: 1 }]);
  assert.equal(stale.size, 0, 'an unresolvable recipeId is skipped, matching pinnedBalance');
  const zero = blockOutputExclusions(ironChain, [{ kind: 'block', recipeId: 'screw', machines: 0, clock: 1 }]);
  assert.equal(zero.size, 0, 'a zero-load row declares no capacity, so it is not a ceiling');
});

test('planExpansion: mode defaults to targets, so every existing caller is unaffected', () => {
  const withoutMode = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  const withMode = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }], { mode: 'targets' });
  assert.equal(withoutMode.mode, 'targets', 'the default mode string itself must be "targets"');
  assert.equal(withoutMode.tiles.machines, withMode.tiles.machines);
  assert.equal(withoutMode.maximize, undefined, 'targets mode carries no maximize readout');
});

/**
 * Fix round 1, Important 5. The test above only ever calls plan() with a block
 * row and no max row, so isMax (mode === 'max' && maxTargets.length > 0) is
 * false there no matter what the mode default is — it cannot by itself catch a
 * flipped default. This uses plan() (not planMax(), which hardcodes mode:
 * 'max') with a max-kind row present and mode omitted, so a flipped default
 * would both report mode: 'max' AND turn on a real maximize readout.
 */
test('planExpansion: a max row is inert unless mode is explicitly "max"', () => {
  const rows = [
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ];
  const withoutMode = plan(rows);
  const withTargetsMode = plan(rows, { mode: 'targets' });
  assert.equal(withoutMode.mode, 'targets', 'omitting mode must default to targets, not max');
  assert.equal(withoutMode.maximize, undefined, 'a stray max row must not turn on the maximize readout by itself');
  assert.equal(withTargetsMode.maximize, undefined);
  assert.equal(withoutMode.tiles.machines, withTargetsMode.tiles.machines,
    'explicit targets mode and the default must solve identically');
});
