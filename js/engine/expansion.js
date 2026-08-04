/**
 * Expansion planner: you declare machine blocks you've decided to build plus
 * whatever is already on your bus, and this works out what has to feed them.
 *
 * The Factory Optimizer solves the other direction — given ore nodes, maximize
 * output — which forces you to model the whole factory from ore up every time you
 * bolt something on. Here the blocks are *pinned* and only the residual is solved.
 *
 * Pure: no DOM, no storage, deterministic.
 * @typedef {import('../domain/model.js').Dataset} Dataset
 */
import { netPerMin } from '../domain/model.js';
import { hitTargets } from './optimize.js';
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
 * Net per-minute balance across every block row at its declared machine count and
 * clock. Positive = the blocks make a surplus; negative = something upstream has
 * to cover the difference.
 * @param {Dataset} dataset
 * @param {{recipeId: string, machines: number, clock?: number}[]} blockRows
 * @returns {Map<string, number>}
 */
export function pinnedBalance(dataset, blockRows) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const net = new Map();
  for (const b of blockRows || []) {
    const recipe = byId.get(b?.recipeId);
    if (!recipe) continue;                       // stale saved row: ignore rather than throw
    const machines = Math.max(0, Number(b.machines) || 0);
    const clock = Number(b.clock);
    const load = machines * (Number.isFinite(clock) && clock > 0 ? clock : 1);
    if (load <= 0) continue;
    for (const itemId of touched(recipe)) add(net, itemId, load * netPerMin(recipe, itemId));
  }
  for (const [k, v] of net) net.set(k, round6(v));
  return net;
}

/**
 * Sort the pinned balance and the user's rows into what the LP must solve for and
 * what it gets for free.
 *
 * Raw resources take a separate path in every direction. A block that eats ore
 * directly has no upstream to build, and handing it to the LP as a target would
 * let the ore constraint absorb it — it would then be missing from the raw footer
 * entirely. A block that instead nets a *surplus* of a raw can't be an LP supply
 * either — lp-builder.js's addSupplies unconditionally skips raw supplies, since
 * raw constraints hold net consumption — so it goes to `rawCredit` instead of
 * `supplies`, where it would silently vanish. Likewise a raw HAVE row can't be an
 * LP supply, so it is netted off in the footer instead.
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
  // emitting a duplicate (itemId, 'have') pair, closing the Task 2 collision
  // (lp-builder.js's addSupplies keys LP variables on (itemId, kind)) at its
  // source rather than downstream. Map iteration order is insertion order, so
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
export function planExpansion({ dataset, rows, enabledRecipeIds, shardBudget = 0, beltTier = 'Mk4', pipeTier = 'Mk2' }) {
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

  const solved = targets.size > 0
    ? hitTargets({ dataset, caps, enabledRecipeIds, targets, supplies })
    : { feasible: true, recipeRates: new Map(), shortfalls: new Map(), supplyDrawn: supplies.map((s) => ({ itemId: s.itemId, kind: s.kind, used: 0 })) };

  const recipeRates = solved.recipeRates;
  const phys = realize({ dataset, recipeRates, shardBudget });
  const belts = beltReport({ dataset, recipeRates, beltTier, pipeTier });
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const machinesById = new Map(phys.perRecipe.map((pr) => [pr.recipeId, pr.machines]));

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
  // DEVIATION FROM BRIEF (see task-3-report.md): scoped to 'have' rows. The
  // brief's own supplies.map(...) (no filter) surfaces every supply, including
  // a block's own unconsumed 'pinned' surplus — that's already fully reported
  // by netOutput, and the brief's own have-row tests assert supplyUsage holds
  // only the declared (have-kind) row. Left in, the pinned entry breaks 3 tests.
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
      const recipe = byId.get(b.recipeId);
      if (!recipe) return null;
      const building = dataset.buildings.get(recipe.buildingId);
      const outId = recipe.outputs?.[0]?.itemId;
      return {
        recipeId: b.recipeId,
        recipeName: recipe.name,
        buildingName: building?.name ?? '',
        buildingSlug: building?.slug,
        machines: Math.max(0, Number(b.machines) || 0),
        clockPct: Math.floor((Number(b.clock) || 1) * 100 + 1e-6),
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
  const rawUsage = lpRawUsage(dataset, recipeRates);
  for (const [itemId, v] of rawDemand) add(rawUsage, itemId, v);
  for (const [itemId, v] of rawCredit) add(rawUsage, itemId, -v);
  for (const [itemId, v] of rawUsage) rawUsage.set(itemId, Math.max(0, v));

  const shortfalls = [...solved.shortfalls].map(([itemId, amount]) => ({
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

  return {
    feasible: solved.feasible,
    hasPlan: blockRows.length > 0 || wantRows.length > 0,
    tiles: {
      machines: phys.totalMachines,
      powerMW: Math.round(phys.totalPowerMW * 10) / 10,
      shards: phys.totalShardsUsed,
    },
    recipeRates,      // Map<recipeId, ratePerMin> — for buildGraph (see js/engine/graph.js)
    machinesById,     // Map<recipeId, machineCount> — ditto
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
    beltRows: belts.map((f) => ({ itemId: f.itemId, name: nameOf(dataset, f.itemId), slug: slugOf(dataset, f.itemId), rate: f.rate, lines: f.lines, tier: f.tier, fluid: f.fluid, saturated: f.saturated })),
  };
}
