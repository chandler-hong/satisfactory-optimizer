/**
 * Expansion planner: you declare machine blocks you already have plus whatever
 * is already on your bus, and this works out what has to feed them.
 *
 * The Factory Optimizer solves the other direction — given ore nodes, maximize
 * output — which forces you to model the whole factory from ore up every time you
 * bolt something on. Here the blocks are *pinned* and only the residual is solved.
 *
 * Pure: no DOM, no storage, deterministic.
 * @typedef {import('../domain/model.js').Dataset} Dataset
 */
import { netPerMin } from '../domain/model.js';
import { hitTargets, maxSets } from './optimize.js';
import { RAW_CLAMP } from './lp-builder.js';
import { realize } from './physical-layer.js';
import { beltReport } from './belt-layer.js';
import { analyzeRequirements } from './requirements.js';
import { MINER_RATES, OIL_EXTRACTOR_RATES, WELL_SATELLITE_RATES, WATER_EXTRACTOR_RATE } from './resource-model.js';

const EPS = 1e-6;
const round6 = (x) => Math.round(x * 1e6) / 1e6;

const nameOf = (dataset, id) => dataset.items.get(id)?.name ?? id;
const slugOf = (dataset, id) => dataset.items.get(id)?.slug;
const fluidOf = (dataset, id) => !!dataset.items.get(id)?.liquid;

/** Every item a recipe touches, on either side, once. */
function touched(recipe) {
  return new Set([...recipe.inputs.map((e) => e.itemId), ...recipe.outputs.map((e) => e.itemId)]);
}

/** Accumulate `v` onto `map[k]`. */
function add(map, k, v) {
  map.set(k, (map.get(k) || 0) + v);
}

/**
 * Effective clock multiplier for a block row's raw `clock` field (1 = 100%):
 * the value itself when finite and positive, else 1. Single source of truth
 * for both blockLoad's load calc and blockView's displayed clockPct below —
 * they used to apply this test slightly differently (blockView's old `||`
 * check let a negative-but-truthy value like -0.5 survive as itself, so it
 * showed literally as -50% while the load calc silently fell back to 1/100%)
 * — so a bad clock value can no longer show one percentage while the plan
 * computes at another.
 */
export function normalizeClock(clock) {
  const n = Number(clock);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Resolve a block row to its recipe plus its machine-equivalent load (machines
 * × clock, clock defaulting to 1 when absent/invalid) — null for a stale row
 * whose recipeId isn't in the dataset. Both pinnedBalance and the graph-only
 * merge in planExpansion need this exact figure to agree, so it lives here
 * once instead of being recomputed twice.
 */
function blockLoad(byId, b) {
  const recipe = byId.get(b?.recipeId);
  if (!recipe) return null;                      // stale saved row: ignore rather than throw
  const machines = Math.max(0, Number(b.machines) || 0);
  const load = machines * normalizeClock(b.clock);
  return { recipe, machines, load };
}

/**
 * Gross per-minute output across every block row at its declared machine count
 * and clock. A block is already built and already fed, so only what leaves it
 * enters the plan — its own feedstock is covered externally by definition and
 * never shows up here, not even as a deficit.
 * @param {Dataset} dataset
 * @param {{recipeId: string, machines: number, clock?: number}[]} blockRows
 * @returns {Map<string, number>}
 */
export function pinnedBalance(dataset, blockRows) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const net = new Map();
  for (const b of blockRows || []) {
    const resolved = blockLoad(byId, b);
    if (!resolved || resolved.load <= 0) continue;
    const { recipe, load } = resolved;
    // A block is already built and already fed, so only what leaves it enters
    // the plan. Gross output, NOT max(0, net) — for a recipe with an item on
    // both sides the input side is covered externally by definition, so the
    // whole output rate is available. Entries carry per-minute rates already.
    for (const o of recipe.outputs || []) add(net, o.itemId, load * o.perMin);
  }
  for (const [k, v] of net) net.set(k, round6(v));
  return net;
}

/**
 * Primary-output item ids the given block rows declare. Used by
 * blockOutputExclusions below to decide which recipes the max-mode solver
 * must not use. (The max-mode binding readout in planExpansion no longer
 * consults this directly — see the comment on the `maximize` block there for
 * why "declared" alone is not a sound test for bindingness.)
 */
function declaredPrimaryOutputs(dataset, blockRows) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const declared = new Set();
  for (const b of blockRows || []) {
    const resolved = blockLoad(byId, b);
    if (!resolved || resolved.load <= 0) continue;
    const primary = resolved.recipe.outputs?.[0]?.itemId;
    if (primary) declared.add(primary);
  }
  return declared;
}

/**
 * Recipe ids the solver must NOT use in max mode: anything producing a block
 * row's PRIMARY output. A block is a statement about your capacity for that item
 * ("my Motor line makes 30/min"), so letting the solver add more would make the
 * maximum unbounded — raws are free here, so it would just build more from ore.
 *
 * Scoped to outputs[0] deliberately when DECLARING what counts as capped. A
 * block's byproducts stay available: a Scrap line also outputs Water, and
 * excluding every water-producing recipe in the game because one block
 * mentions it would wreck the plan. Have rows are likewise untouched — "I can
 * draw 300/min off my bus" is a floor, not a claim that no more can exist.
 *
 * But the MATCH below is deliberately asymmetric with that: a candidate
 * recipe is excluded if ANY of its outputs — not just its own outputs[0] — is
 * in `declared`. So a recipe that emits a declared item only as a byproduct
 * loses its own unrelated primary output too, as collateral damage. That is
 * kept on purpose, not tightened to outputs[0] on both sides: a recipe runs
 * as one atomic unit, so keeping it enabled to preserve its primary would
 * also keep its declared-item byproduct flowing — reopening the exact
 * free-raws-into-capped-item hole this mechanism exists to close, just via a
 * byproduct instead of a primary. There is no way to disable one output of a
 * recipe while keeping another, so the whole recipe goes. This can zero out a
 * target that has no other route to it at all (feasible: true, sets: 0) —
 * see the "silent zero" test below; the maximize readout's `bounded` still
 * comes out false there, since nothing about that failure makes any supply
 * look fully drawn.
 *
 * This never removes the block itself: blocks are applied through pinnedBalance,
 * never through enabledRecipeIds.
 */
export function blockOutputExclusions(dataset, blockRows) {
  const declared = declaredPrimaryOutputs(dataset, blockRows);
  const excluded = new Set();
  if (declared.size === 0) return excluded;
  for (const r of dataset.recipes) {
    if ((r.outputs || []).some((o) => declared.has(o.itemId))) excluded.add(r.id);
  }
  return excluded;
}

/**
 * Sort the pinned balance and the user's rows into what the LP must solve for and
 * what it gets for free.
 *
 * Raw resources take a separate path in every direction. A negative net for a raw
 * item would have no upstream to build, and handing it to the LP as a target would
 * let the raw constraint absorb it — it would then be missing from the raw footer
 * entirely. `pinnedBalance` can't produce one any more — a block contributes gross
 * output only, never a deficit — so this branch is unreachable from `planExpansion`
 * today; it stays for `splitDemand`'s own hand-built-map unit tests and for any
 * future demand source that isn't gross-output-only. A block that instead nets a
 * *surplus* of a raw can't be an LP supply either — lp-builder.js's addSupplies
 * unconditionally skips raw supplies, since raw constraints hold net consumption —
 * so it goes to `rawCredit` instead of `supplies`, where it would silently vanish.
 * Likewise a raw HAVE row can't be an LP supply, so it is netted off in the footer
 * instead.
 */
export function splitDemand(dataset, netPinned, wantRows, haveRows) {
  const raw = dataset.rawResourceIds;
  const targets = new Map();
  const supplies = [];
  const rawDemand = new Map();
  const rawSupplied = new Map();
  const rawCredit = new Map();

  for (const [itemId, v] of netPinned) {
    if (v < -EPS) {
      if (raw.has(itemId)) add(rawDemand, itemId, -v);
      else add(targets, itemId, -v);
    } else if (v > EPS) {
      if (raw.has(itemId)) add(rawCredit, itemId, v);
      else supplies.push({ itemId, rate: v, kind: 'pinned' });
    }
  }
  for (const w of wantRows || []) {
    const rate = Math.max(0, Number(w?.rate) || 0);
    if (!w?.itemId || rate <= 0) continue;
    if (raw.has(w.itemId)) add(rawDemand, w.itemId, rate);
    else add(targets, w.itemId, rate);
  }
  // Accumulate non-raw HAVE rows by itemId before emitting — mirrors the raw
  // branch just above (`add(rawSupplied, ...)`) and is what the player means
  // by declaring "300 from plant A, 200 from plant B": one pool of 500, not
  // two competing rows. It also makes this function structurally incapable of
  // emitting a duplicate (itemId, 'have') pair. That closes the collision at
  // its source rather than downstream: lp-builder.js's addSupplies keys LP
  // variables on (itemId, kind), so two rows for one item would silently
  // overwrite each other's cap and report the same draw twice — claiming both
  // rows' supply was consumed while only sizing machines for one of them.
  // Map iteration order is insertion order, so
  // the emitted supplies stay in deterministic first-occurrence order, which
  // the positional pairing with supplyDrawn depends on.
  const haveTotals = new Map();
  for (const h of haveRows || []) {
    const rate = Math.max(0, Number(h?.rate) || 0);
    if (!h?.itemId || rate <= 0) continue;
    if (raw.has(h.itemId)) add(rawSupplied, h.itemId, rate);
    else add(haveTotals, h.itemId, rate);
  }
  for (const [itemId, rate] of haveTotals) supplies.push({ itemId, rate, kind: 'have' });
  return { targets, supplies, rawDemand, rawSupplied, rawCredit };
}

/**
 * What actually leaves the expansion, per item:
 *   netPinned + netFromLPRecipes + drawn['have']
 *
 * The drawn *pinned* supply is deliberately absent. An upstream machine eating a
 * block's surplus already shows up as a negative term inside netFromLPRecipes, so
 * subtracting the draw as well double-counts it — blocks netting +130 Rod with new
 * Screw machines taking 30 would report 70 instead of 100.
 *
 * Drawn *have* supply IS added: it's an inflow from outside the expansion that
 * neither of the other two terms knows about.
 */
export function computeNetOutput(dataset, netPinned, recipeRates, supplyDrawn) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const net = new Map(netPinned);
  for (const [rid, load] of recipeRates) {
    const recipe = byId.get(rid);
    if (!recipe) continue;
    for (const itemId of touched(recipe)) add(net, itemId, load * netPerMin(recipe, itemId));
  }
  for (const s of supplyDrawn || []) {
    if (s.kind === 'have') add(net, s.itemId, s.used);
  }
  const out = new Map();
  for (const [itemId, v] of net) {
    if (dataset.rawResourceIds.has(itemId)) continue;   // raws are the footer's job
    const r = round6(v);
    if (r > EPS) out.set(itemId, r);
  }
  return out;
}

/** Raw draw of the upstream machines, mirroring rawUsage in view-model.js. */
function lpRawUsage(dataset, recipeRates) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const usage = new Map();
  for (const [rid, load] of recipeRates) {
    const recipe = byId.get(rid);
    if (!recipe) continue;
    for (const i of recipe.inputs) if (dataset.rawResourceIds.has(i.itemId)) add(usage, i.itemId, load * i.perMin);
    for (const o of recipe.outputs) if (dataset.rawResourceIds.has(o.itemId)) add(usage, o.itemId, -load * o.perMin);
  }
  return usage;
}

const WATER_ID = 'Desc_Water_C';
const OIL_ID = 'Desc_LiquidOil_C';
const NITROGEN_ID = 'Desc_NitrogenGas_C';

/**
 * Whole extractors needed to cover `rate`/min of `itemId`, as labelled options.
 * Reuses the rate tables in resource-model.js rather than dataset.miners, whose
 * fluid entries are in the raw x1000 units.
 */
function extractorOptions(itemId, rate) {
  if (rate <= EPS) return [];
  const count = (per) => ({ count: Math.ceil(rate / per - 1e-9) });
  if (itemId === WATER_ID) return [{ label: 'Water Extractor', ...count(WATER_EXTRACTOR_RATE) }];
  if (itemId === OIL_ID) {
    return [
      { label: 'Oil Extractor · normal', ...count(OIL_EXTRACTOR_RATES.normal) },
      { label: 'Oil Extractor · pure', ...count(OIL_EXTRACTOR_RATES.pure) },
    ];
  }
  if (itemId === NITROGEN_ID) {
    return [
      { label: 'Well Satellite · normal', ...count(WELL_SATELLITE_RATES.normal) },
      { label: 'Well Satellite · pure', ...count(WELL_SATELLITE_RATES.pure) },
    ];
  }
  const options = [];
  for (const tier of ['Mk1', 'Mk2', 'Mk3']) {
    for (const purity of ['normal', 'pure']) {
      options.push({ label: `Miner ${tier.replace('Mk', 'Mk.')} · ${purity}`, ...count(MINER_RATES[tier][purity]) });
    }
  }
  return options;
}

/**
 * Raw resources the expansion draws, what an existing supply already covers, and
 * the extraction still to build. Uncapped by design — see spec §2.
 */
export function rawNeededRows(dataset, rawUsage, rawSupplied) {
  const rows = [];
  for (const [itemId, rawRate] of rawUsage) {
    const needed = round6(rawRate);
    if (needed <= EPS) continue;
    const supplied = round6(rawSupplied.get(itemId) || 0);
    const newRate = round6(Math.max(0, needed - supplied));
    rows.push({
      itemId,
      name: nameOf(dataset, itemId),
      slug: slugOf(dataset, itemId),
      fluid: fluidOf(dataset, itemId),
      needed,
      supplied,
      newRate,
      options: extractorOptions(itemId, newRate),
    });
  }
  return rows.sort((a, b) => b.needed - a.needed);
}

/**
 * Plan an expansion.
 * @param {{dataset: Dataset, rows: object[], enabledRecipeIds: Set<string>,
 *          shardBudget?: number, beltTier?: string, pipeTier?: string}} args
 */
export function planExpansion({ dataset, rows, enabledRecipeIds, shardBudget = 0, beltTier = 'Mk4', pipeTier = 'Mk2', mode = 'targets' }) {
  const all = rows || [];
  const blockRows = all.filter((r) => r?.kind === 'block');
  const wantRows = all.filter((r) => r?.kind === 'want');
  const haveRows = all.filter((r) => r?.kind === 'have');

  const netPinned = pinnedBalance(dataset, blockRows);
  const { targets, supplies, rawDemand, rawSupplied, rawCredit } = splitDemand(dataset, netPinned, wantRows, haveRows);

  // Raws are uncapped here by design — node budgeting is the Optimizer's job.
  // rawConstraints() clamps a non-finite cap to 1e9, which the LP never reaches.
  const caps = new Map();
  for (const r of dataset.recipes) {
    if (!enabledRecipeIds.has(r.id)) continue;
    for (const itemId of touched(r)) if (dataset.rawResourceIds.has(itemId)) caps.set(itemId, Infinity);
  }

  const maxRows = all.filter((r) => r?.kind === 'max');
  const maxTargets = maxRows
    .filter((r) => typeof r?.itemId === 'string' && r.itemId)
    .map((r) => ({ itemId: r.itemId, weight: Number(r.weight) > 0 ? Number(r.weight) : 1 }));
  const isMax = mode === 'max' && maxTargets.length > 0;

  // In max mode the solver may not add to a declared line's primary output.
  const excluded = isMax ? blockOutputExclusions(dataset, blockRows) : new Set();
  const solveEnabled = excluded.size > 0
    ? new Set([...enabledRecipeIds].filter((id) => !excluded.has(id)))
    : enabledRecipeIds;

  let solved;
  if (isMax) {
    solved = maxSets({ dataset, caps, enabledRecipeIds: solveEnabled, targets: maxTargets, supplies });
  } else if (targets.size > 0) {
    solved = hitTargets({ dataset, caps, enabledRecipeIds, targets, supplies });
  } else {
    solved = { feasible: true, recipeRates: new Map(), shortfalls: new Map(), supplyDrawn: supplies.map((s) => ({ itemId: s.itemId, kind: s.kind, used: 0 })) };
  }

  const recipeRates = solved.recipeRates;
  const phys = realize({ dataset, recipeRates, shardBudget });
  const belts = beltReport({ dataset, recipeRates, beltTier, pipeTier });
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const machinesById = new Map(phys.perRecipe.map((pr) => [pr.recipeId, pr.machines]));

  // Graph-only views: recipeRates/machinesById above stay upstream-only (LP-
  // solved recipes only) — realize(), beltReport(), and the tests all depend
  // on that exact shape. But buildGraph (js/engine/graph.js) needs the WHOLE
  // factory, including the blocks the user pinned directly. Omit them and a
  // block's own recipe never appears (addSink skips a target with zero
  // producers) while its direct inputs dangle with no in-graph consumer and
  // render as false "surplus" — worse than no diagram at all. So these are a
  // COPY of the upstream-only maps with each valid block's load/machines
  // ADDED onto that recipe's existing entry, never replacing it: a block and
  // the LP can legitimately both run the same recipe, and both should count.
  // Skips a stale recipeId exactly like pinnedBalance, and a zero-load row
  // (0 machines) exactly like pinnedBalance.
  //
  // A block, though, is a source in the diagram, not a consumer of its own
  // inputs — pinnedBalance already treats every block's feedstock as covered
  // externally, and the graph must agree or it disagrees with the balance
  // the rest of the plan is built from. But a recipe id's merged graphRates
  // load can come from more than one row (a block and the LP, or two block
  // rows on the same recipe id — see the "sum a block and the LP" test
  // below), and buildGraph needs to know how much of that merged load is
  // externally fed versus a genuine in-graph consumer. externallyFedLoad
  // maps each recipe id to the SUM of its blocks' own load — using the same
  // blockLoad resolution and validity/nonzero test as the merge loop below,
  // so it always agrees with graphRates on which rows count. buildGraph then
  // treats that much of the recipe's load as a producer-only source (a node
  // and its output edges, but no input edges/demand for that share); any
  // remainder (the LP's own share of the same recipe id) is wired in-graph
  // like any other consumer (js/ui/expansion-render.js passes this straight
  // through).
  const graphRates = new Map(recipeRates);
  const graphMachinesById = new Map(machinesById);
  const externallyFedLoad = new Map();
  for (const b of blockRows) {
    const resolved = blockLoad(byId, b);
    if (!resolved || resolved.load <= 0) continue;
    add(graphRates, resolved.recipe.id, resolved.load);
    add(graphMachinesById, resolved.recipe.id, resolved.machines);
    add(externallyFedLoad, resolved.recipe.id, resolved.load);
  }

  const buildRows = phys.perRecipe
    .map((pr) => {
      const recipe = byId.get(pr.recipeId);
      const building = dataset.buildings.get(pr.buildingId);
      const outId = recipe?.outputs?.[0]?.itemId;
      return {
        recipeId: pr.recipeId,
        recipeName: recipe?.name ?? pr.recipeId,
        buildingName: building?.name ?? '',
        buildingSlug: building?.slug,
        itemName: outId ? nameOf(dataset, outId) : '',
        itemSlug: outId ? slugOf(dataset, outId) : undefined,
        machines: pr.machines,
        clockPct: Math.floor(pr.clock * 100 + 1e-6),
        shards: pr.shards,
        powerMW: Math.round(pr.powerMW * 10) / 10,
      };
    })
    .sort((a, b) => b.machines - a.machines);

  const totalsByBuilding = new Map();
  for (const r of buildRows) {
    const t = totalsByBuilding.get(r.buildingName) || { buildingName: r.buildingName, buildingSlug: r.buildingSlug, machines: 0 };
    t.machines += r.machines;
    totalsByBuilding.set(r.buildingName, t);
  }

  // "Capped" means the supply ran dry AND machines were built for that item —
  // the signal that the declared supply is the reason you're building more.
  const builtItems = new Set();
  for (const rid of recipeRates.keys()) {
    for (const o of byId.get(rid)?.outputs || []) builtItems.add(o.itemId);
  }
  // Deliberate departure from the original design sketch, which mapped every
  // supply entry. Scoped to 'have' rows instead: an unfiltered map would
  // also surface a block's own unconsumed 'pinned' surplus, which is already
  // fully reported by netOutput — and the have-row tests below assert
  // supplyUsage holds only the declared (have-kind) row, so leaving the
  // pinned entry in breaks 3 of them.
  const supplyUsage = supplies
    .map((s, i) => {
      const used = solved.supplyDrawn[i]?.used ?? 0;
      return {
        itemId: s.itemId,
        kind: s.kind,
        rate: round6(s.rate),
        used: round6(used),
        capped: used >= s.rate - EPS && builtItems.has(s.itemId),
      };
    })
    .filter((s) => s.kind === 'have');

  const blockView = blockRows
    .map((b) => {
      const resolved = blockLoad(byId, b);
      if (!resolved || resolved.load <= 0) return null;
      const { recipe, machines } = resolved;
      const building = dataset.buildings.get(recipe.buildingId);
      const outId = recipe.outputs?.[0]?.itemId;
      return {
        recipeId: b.recipeId,
        recipeName: recipe.name,
        buildingName: building?.name ?? '',
        buildingSlug: building?.slug,
        machines,
        clockPct: Math.floor(normalizeClock(b.clock) * 100 + 1e-6),
        itemName: outId ? nameOf(dataset, outId) : '',
        itemSlug: outId ? slugOf(dataset, outId) : undefined,
      };
    })
    .filter(Boolean);

  const netOutput = computeNetOutput(dataset, netPinned, recipeRates, solved.supplyDrawn);

  // Raw need = the upstream's own draw plus any block that eats ore directly,
  // minus any block that nets a raw *surplus* (rawCredit — see splitDemand).
  // Floored at 0: a surplus that outweighs every other draw is not a negative
  // need, it's just fully covered.
  //
  // lpNetRaw is a snapshot of the LP's OWN net raw usage, taken before any of
  // that want/credit adjustment. Fix round 2, B: maximize.bounded (below) must
  // clamp-check THIS, not the adjusted rawUsage returned to callers — the
  // adjustment is real product surface (the raw footer needs it) but has
  // nothing to do with what rawConstraints() (lp-builder.js) actually bounded,
  // so checking the adjusted value reads a quantity the clamp never applied
  // to. Reproduced both leaks this let through: an oversized raw `want` row on
  // top of a genuinely bounded plan pushes the ADJUSTED total near RAW_CLAMP
  // and falsely reports unbounded; a block crediting ~1e6+/min of a runaway
  // raw (rawCredit) pulls the adjusted total back under the clamp threshold
  // and falsely reports bounded — reopening the bypass-route Critical (sets in
  // the tens of millions, bindingItems naming an unrelated declared line) by a
  // different route than the margin width fixed in round 1.
  const rawUsage = lpRawUsage(dataset, recipeRates);
  const lpNetRaw = new Map(rawUsage);
  for (const [itemId, v] of rawDemand) add(rawUsage, itemId, v);
  for (const [itemId, v] of rawCredit) add(rawUsage, itemId, -v);
  for (const [itemId, v] of rawUsage) rawUsage.set(itemId, Math.max(0, v));

  // maxSets (max mode) reports no shortfalls field at all — hitTargets is the
  // only solve path that ever populates one — so this must not assume it exists.
  const shortfalls = [...(solved.shortfalls || new Map())].map(([itemId, amount]) => ({
    itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId),
    amount: Math.round(amount * 100) / 100, fluid: fluidOf(dataset, itemId),
  }));

  // "No recipe path" diagnostic only (see requirements.js: analyzeRequirements's
  // `allFired` closure is always seeded from dataset.rawResourceIds internally).
  // Passing that same set as both availableRawIds and userAddedRawIds makes
  // availClosure identical to allFired's closure, which collapses the
  // 'missing'/'partial'/'wrong-resources' branches to unreachable — correct here
  // because Expansion Mode has no raw-scarcity concept; every raw is uncapped
  // (see the `caps` construction above).
  const analysis = analyzeRequirements(dataset, enabledRecipeIds, dataset.rawResourceIds, dataset.rawResourceIds, [...targets.keys()]);
  const shapeDep = (d) => ({ itemId: d.itemId, name: nameOf(dataset, d.itemId), slug: slugOf(dataset, d.itemId), added: d.added, fluid: fluidOf(dataset, d.itemId) });
  const shapeTarget = (t) => ({ itemId: t.itemId, name: nameOf(dataset, t.itemId), slug: slugOf(dataset, t.itemId), reason: t.reason, deps: t.deps.map(shapeDep) });
  const requirements = {
    hasIssues: analysis.anyImpossible || analysis.anyMissing,
    impossible: analysis.perTarget.filter((t) => t.status === 'impossible').map(shapeTarget),
    missing: analysis.perTarget.filter((t) => t.status === 'missing').map(shapeTarget),
  };

  // Binding = this declared supply was consumed to exhaustion AND the item has
  // no other way to be produced in this plan. Both halves are load-bearing;
  // neither alone is a sound test.
  //
  // "Fully drawn" alone is not enough. maxSets' first pass (maximize SETS,
  // ignoring cost) draws every usable supply to its cap whenever doing so can
  // only help the objective, regardless of whether that supply actually
  // constrains the final answer. A have row's own recipe stays enabled (only
  // a block's PRIMARY output is excluded — see blockOutputExclusions above),
  // so the solver can always draw a have row to `used === rate` as a pure
  // side effect, not because it is the true bottleneck. So this is gated on
  // the item having NO remaining producer in solveEnabled, the post-exclusion
  // recipe set actually handed to the solver:
  //   - a block's declared primary always clears this gate (its producers are
  //     excluded by construction, see blockOutputExclusions above);
  //   - a have row's item never does (its recipe is never excluded);
  //   - a block's byproduct clears it only when its producer got excluded as
  //     collateral (blockOutputExclusions' any-output asymmetry, documented
  //     there) and nothing else makes the item — an orphaned byproduct that
  //     is now a genuine ceiling, not a false positive.
  //
  // That gate still isn't sufficient by itself. When the max target has a
  // SECOND route that bypasses the declared item entirely (e.g. an alternate
  // recipe enabled elsewhere in the plan), pass 1 still fully drains the
  // declared supply — it clears the gate above and looks binding — while the
  // real answer independently runs away on the bypass route to the raw-
  // resource clamp (planExpansion sets every raw cap to Infinity above;
  // rawConstraints() clamps a non-finite cap to 1e9, so an unbounded answer
  // surfaces as a huge finite number near that clamp, not as infeasibility).
  // lpNetRaw (computed above, pre-want/credit) catches this independently: a
  // genuinely bounded plan never gets near RAW_CLAMP on any raw. Do NOT reach
  // for solved.bindingResources instead — planExpansion's raw caps are all
  // Infinity, so that comparison is always against Infinity and
  // bindingResources is therefore always empty.
  const maximize = !isMax ? undefined : (() => {
    const drawn = solved.supplyDrawn || [];
    const hasEnabledProducer = (itemId) =>
      dataset.recipes.some((r) => solveEnabled.has(r.id) && (r.outputs || []).some((o) => o.itemId === itemId));
    // Fix round 2, A: the "fully drawn" margin must be relative, not the flat
    // EPS (1e-6) this started as. buildMinRawForSetsModel's pass 2 (lp-builder.js)
    // pins SETS at `minSets - Math.abs(minSets) * 1e-9 - 1e-9` — a give that
    // scales with the declared rate, not a fixed absolute amount — so a supply
    // drawn to exhaustion can fall short of `s.rate` by more than a flat 1e-6
    // once the rate clears about 1000/min (EPS / 1e-9). Below that break point
    // the flat EPS still covers it; Math.max keeps this check exact there too.
    // Reproduced: a declared screw block read as bounded with the right
    // binding item at 1000/min and below, then silently flipped to
    // bounded:false with no binding item at 2000/min and above, despite the
    // reported sets being correct at every scale.
    const bindingItems = supplies
      .map((s, i) => ({ s, used: drawn[i]?.used ?? 0 }))
      .filter(({ s, used }) => s.rate > EPS && used >= s.rate - Math.max(EPS, s.rate * 1e-6) && !hasEnabledProducer(s.itemId))
      .map(({ s }) => ({ itemId: s.itemId, name: nameOf(dataset, s.itemId), rate: round6(s.rate) }));
    // Margin below RAW_CLAMP: relative (fix round 2, C1), not the flat `1e6`
    // round 1 shipped. The structural solver gap observed at clamp scale is
    // ~1 raw unit (pass 2's relative-1e-9 give against pass 1's max, at SETS
    // in the tens of millions+ — see the comment block above), so
    // `RAW_CLAMP * (1 - 1e-6)` keeps three orders of headroom over that gap
    // while shrinking the false-negative window 1000x versus a flat `1e6`,
    // and it scales automatically if RAW_CLAMP itself ever changes instead of
    // being a second number that has to be kept in sync by hand.
    //
    // Checked against lpNetRaw, NOT the adjusted rawUsage returned to callers
    // (fix round 2, B — see the comment where lpNetRaw is captured, above):
    // rawUsage folds in raw `want` rows and block rawCredit, neither of which
    // rawConstraints() (lp-builder.js) ever bounded.
    const bounded = bindingItems.length > 0
      && [...lpNetRaw.values()].every((v) => v < RAW_CLAMP * (1 - 1e-6));
    return {
      sets: round6(solved.sets || 0),
      perPart: (solved.perPart || []).map((p) => ({
        itemId: p.itemId,
        name: nameOf(dataset, p.itemId),
        slug: slugOf(dataset, p.itemId),
        fluid: fluidOf(dataset, p.itemId),
        weight: p.weight,
        rate: round6(p.rate),
      })),
      // Fix round 2, D: cleared to [] when unbounded rather than left naming
      // whatever was fully drawn. The bypass-route Critical is exactly a case
      // where something IS fully drawn (rod) while the real answer runs away
      // on a different route — bounded:false already says "ignore this", but
      // a renderer that lists bindingItems without checking bounded first
      // would print the very claim the Critical was about. The two fields can
      // no longer visually disagree.
      bindingItems: bounded ? bindingItems : [],
      bounded,
    };
  })();

  return {
    feasible: solved.feasible,
    mode,
    // Counts rows as SUBMITTED, before validation, so it's true for a plan whose
    // only row has a stale recipeId and therefore produces nothing. Not the flag
    // to branch on when deciding whether to render — expansion-render.js's
    // hasContent() checks the validated output arrays instead, and deliberately
    // ignores this. Kept because it's a cheap "did the user type anything at
    // all" signal, distinct from "did it yield a plan".
    hasPlan: blockRows.length > 0 || wantRows.length > 0,
    tiles: {
      machines: phys.totalMachines,
      powerMW: Math.round(phys.totalPowerMW * 10) / 10,
      shards: phys.totalShardsUsed,
    },
    recipeRates,      // Map<recipeId, ratePerMin> — LP-solved recipes only, upstream of the pinned blocks
    machinesById,     // Map<recipeId, machineCount> — ditto, upstream-only
    // graphRates/graphMachinesById: recipeRates/machinesById plus every pinned
    // block's own load/machines. For buildGraph only (js/engine/graph.js, via
    // js/ui/expansion-render.js's renderDiagramPanel) — the diagram needs the
    // whole factory, the rest of this plan does not. See the comment above
    // where these are built for why they must stay separate from the pair above.
    graphRates,
    graphMachinesById,
    // Per-recipe externally-fed load (see above) — passed to buildGraph by
    // js/ui/expansion-render.js as the externally-fed load, so the diagram
    // treats that much of each recipe's load as a source instead of a
    // consumer of its own inputs, even when only part of the recipe's merged
    // load comes from a block.
    externallyFedLoad,
    buildRows,
    machineTotals: [...totalsByBuilding.values()].sort((a, b) => b.machines - a.machines),
    blockRows: blockView,
    netOutput,
    netOutputRows: [...netOutput]
      .map(([itemId, rate]) => ({ itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), rate: round6(rate), fluid: fluidOf(dataset, itemId) }))
      .sort((a, b) => b.rate - a.rate),
    supplyUsage,
    // rawUsage is kept (not folded away entirely) because rawNeededRows below
    // skips any itemId whose needed <= EPS — which a merely-floored-to-0 value
    // and a left-negative one both satisfy identically — so the "never negative"
    // floor a few lines up is otherwise unobservable from outside this module.
    // rawSupplied has no such external reader and is passed straight through.
    rawUsage,        // Map<itemId, ratePerMin>
    rawNeeded: rawNeededRows(dataset, rawUsage, rawSupplied),
    shortfalls,
    requirements,
    maximize,
    beltRows: belts.map((f) => ({ itemId: f.itemId, name: nameOf(dataset, f.itemId), slug: slugOf(dataset, f.itemId), rate: f.rate, lines: f.lines, tier: f.tier, fluid: f.fluid, saturated: f.saturated })),
  };
}
