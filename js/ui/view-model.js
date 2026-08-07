import { maxSets, hitTargets } from '../engine/optimize.js';
import { realize } from '../engine/physical-layer.js';
import { beltReport } from '../engine/belt-layer.js';
import { analyzeRequirements } from '../engine/requirements.js';
import { suggestAlternates } from '../engine/suggestions.js';
import { buildGraph } from '../engine/graph.js';

export const fmt1 = (x) => Math.round(x * 10) / 10;
export const fmt2 = (x) => Math.round(x * 100) / 100;

const nameOf = (dataset, id) => dataset.items.get(id)?.name ?? id;
const slugOf = (dataset, id) => dataset.items.get(id)?.slug;
const fluidOf = (dataset, id) => !!dataset.items.get(id)?.liquid;

function rawUsage(dataset, recipeRates) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const usage = new Map();
  for (const [rid, x] of recipeRates) {
    const r = byId.get(rid);
    if (!r) continue;
    for (const i of r.inputs) if (dataset.rawResourceIds.has(i.itemId)) usage.set(i.itemId, (usage.get(i.itemId) || 0) + x * i.perMin);
    for (const o of r.outputs) if (dataset.rawResourceIds.has(o.itemId)) usage.set(o.itemId, (usage.get(o.itemId) || 0) - x * o.perMin);
  }
  return usage;
}

/**
 * A single refinement option: one recipe that consumes `itemId`, scaled to eat
 * `surplusRate`/min of it, as a mini flow graph (inputs → recipe → outputs).
 */
function optionGraph(dataset, r, itemId, surplusRate) {
  const inEntry = r.inputs.find((i) => i.itemId === itemId);
  const inPerMin = inEntry ? inEntry.perMin : 0;
  // Whole machines only, rounded down — you can't build a fraction of a machine;
  // at least one so the option is meaningful. The +1e-6 absorbs floating-point
  // dust (e.g. a surplus of 79.9999999 that should divide evenly by 40).
  const machines = inPerMin > 0 ? Math.max(1, Math.floor(surplusRate / inPerMin + 1e-6)) : 1;
  const b = dataset.buildings.get(r.buildingId);
  const recId = `rec:${r.id}`;
  const nodes = [];
  const edges = [];
  for (const inp of r.inputs) {
    const rate = Math.floor(inp.perMin * machines); // whole materials, rounded down
    nodes.push({ id: `in:${inp.itemId}`, tier: 0, isInput: true, itemId: inp.itemId, name: nameOf(dataset, inp.itemId), slug: slugOf(dataset, inp.itemId), rate, fluid: fluidOf(dataset, inp.itemId) });
    edges.push({ from: `in:${inp.itemId}`, to: recId, itemId: inp.itemId, rate });
  }
  nodes.push({ id: recId, tier: 1, recipeName: r.name, buildingName: b?.name ?? '', buildingSlug: b?.slug, machines });
  for (const o of r.outputs) {
    const rate = Math.floor(o.perMin * machines); // whole materials, rounded down
    nodes.push({ id: `out:${o.itemId}`, tier: 2, isOutput: true, itemId: o.itemId, name: nameOf(dataset, o.itemId), slug: slugOf(dataset, o.itemId), rate, fluid: fluidOf(dataset, o.itemId) });
    edges.push({ from: recId, to: `out:${o.itemId}`, itemId: o.itemId, rate });
  }
  const richEdges = edges.map((e) => ({ ...e, itemName: nameOf(dataset, e.itemId), itemSlug: slugOf(dataset, e.itemId), fluid: fluidOf(dataset, e.itemId) }));
  return { recipeId: r.id, recipeName: r.name, alternate: !!r.alternate, graph: { nodes, edges: richEdges, tiers: 3 } };
}

/**
 * For every surplus (unrefined byproduct) node in `graph`, the ways to consume
 * it: each recipe that takes it as an input, scaled to the surplus rate. Base
 * recipes first, then alternates; capped so the results stay readable.
 */
function buildRefinements(dataset, graph) {
  const surplus = graph.nodes.filter((n) => n.isSurplus);
  if (surplus.length === 0) return [];
  const consumersOf = new Map();
  for (const r of dataset.recipes) {
    for (const inp of r.inputs) {
      if (!consumersOf.has(inp.itemId)) consumersOf.set(inp.itemId, []);
      consumersOf.get(inp.itemId).push(r);
    }
  }
  return surplus
    .map((s) => {
      const recipes = (consumersOf.get(s.itemId) || [])
        .slice()
        .sort((a, b) => (a.alternate === b.alternate ? a.name.localeCompare(b.name) : a.alternate ? 1 : -1))
        .slice(0, 6);
      return { itemId: s.itemId, name: s.name, slug: s.slug, rate: s.rate, fluid: s.fluid, options: recipes.map((r) => optionGraph(dataset, r, s.itemId, s.rate)) };
    })
    .filter((ref) => ref.options.length > 0);
}

/** Run the engine for `req` and shape a render-ready PlanView. */
export function computePlan(dataset, req) {
  const { mode, caps, enabledRecipeIds, shardBudget = 0, beltTier = 'Mk4', pipeTier = 'Mk2', noWaste = false } = req;
  let feasible = true;
  let headline = '';
  let shortfalls = [];
  let perPart = [];
  let recipeRates;
  // Which raw caps bind is the ENGINE's answer, not something to re-derive here.
  // This used to be a second, independent copy of the test (`used >= available
  // - 1e-6`) run against the reported build's own usage -- and it was the copy
  // that actually reached the screen, so the engine's `bindingResources` had no
  // production consumer and no way to be wrong out loud. In Maximize mode that
  // reported usage is pass 2's, which sits a relative sliver under every
  // binding cap, so the flat margin stopped detecting anything above roughly
  // 990/min: the meter rendered 100% full with no "maxed" chip and no
  // bottleneck highlight for any realistic node. maxSets now answers from
  // pass 1, where there is no give to model (see optimize.js); reading it here
  // makes that the single source of truth for both modes.
  let bindingRaw = new Set();

  if (mode === 'targets') {
    const r = hitTargets({ dataset, caps, enabledRecipeIds, targets: req.targets, noWaste });
    feasible = r.feasible;
    recipeRates = r.recipeRates;
    bindingRaw = new Set(r.bindingResources);
    shortfalls = [...r.shortfalls].map(([itemId, amount]) => ({ itemId, name: nameOf(dataset, itemId), amount: fmt2(amount), fluid: fluidOf(dataset, itemId) }));
    headline = feasible ? 'All target rates met' : `${shortfalls.length} target(s) short`;
  } else {
    // Maximize: one or more target parts as balanced (optionally weighted) sets.
    const targets = req.targets && req.targets.length
      ? req.targets
      : req.targetItemId
        ? [{ itemId: req.targetItemId, weight: 1 }]
        : [];
    const r = maxSets({ dataset, caps, enabledRecipeIds, targets, noWaste });
    feasible = r.feasible;
    recipeRates = r.recipeRates;
    bindingRaw = new Set(r.bindingResources);
    perPart = r.perPart.map((p) => ({ itemId: p.itemId, name: nameOf(dataset, p.itemId), slug: slugOf(dataset, p.itemId), rate: fmt2(p.rate), fluid: fluidOf(dataset, p.itemId) }));
    if (!feasible) headline = 'Infeasible with these resources';
    else if (perPart.length === 1) headline = `${perPart[0].rate}${perPart[0].fluid ? ' m³' : ''} ${perPart[0].name}/min`;
    else headline = `${fmt2(r.sets)} sets/min`;
  }

  const phys = realize({ dataset, recipeRates, shardBudget });
  const belts = beltReport({ dataset, recipeRates, beltTier, pipeTier });
  const usage = rawUsage(dataset, recipeRates);
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const machinesById = new Map(phys.perRecipe.map((pr) => [pr.recipeId, pr.machines]));

  const resourceMeters = [...caps]
    // Hide an unlimited (auto-water) resource unless the build actually draws it.
    .filter(([itemId, available]) => Number.isFinite(available) || (usage.get(itemId) || 0) > 1e-6)
    .map(([itemId, available]) => {
      const used = Math.max(0, usage.get(itemId) || 0);
      const unlimited = !Number.isFinite(available);
      return { itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), used: fmt2(used), available, unlimited, pct: unlimited || !(available > 0) ? 0 : Math.min(1, used / available), binding: bindingRaw.has(itemId), fluid: fluidOf(dataset, itemId) };
    });

  const buildRows = phys.perRecipe
    .map((pr) => {
      const r = byId.get(pr.recipeId);
      const b = dataset.buildings.get(pr.buildingId);
      const outId = r?.outputs?.[0]?.itemId;
      return {
        recipeId: pr.recipeId,
        recipeName: r?.name ?? pr.recipeId,
        buildingName: b?.name ?? '',
        buildingSlug: b?.slug,
        itemName: outId ? nameOf(dataset, outId) : '',
        itemSlug: outId ? slugOf(dataset, outId) : undefined,
        machines: pr.machines,
        clockPct: Math.floor(pr.clock * 100 + 1e-6), // whole %, rounded down (epsilon absorbs float dust near 100)
        shards: pr.shards,
        powerMW: fmt1(pr.powerMW),
      };
    })
    .sort((a, b) => b.machines - a.machines);

  // Total machines per building TYPE (summed across recipes) — a quick
  // "you'll need N of each machine" summary, sorted by count desc.
  const totalsByBuilding = new Map();
  for (const r of buildRows) {
    const t = totalsByBuilding.get(r.buildingName) || { buildingName: r.buildingName, buildingSlug: r.buildingSlug, machines: 0 };
    t.machines += r.machines;
    totalsByBuilding.set(r.buildingName, t);
  }
  const machineTotals = [...totalsByBuilding.values()].sort((a, b) => b.machines - a.machines);

  const beltRows = belts.map((f) => ({ itemId: f.itemId, name: nameOf(dataset, f.itemId), slug: slugOf(dataset, f.itemId), rate: f.rate, lines: f.lines, tier: f.tier, fluid: f.fluid, saturated: f.saturated }));

  const graph = buildGraph(dataset, recipeRates, machinesById, mode === 'targets' ? Object.keys(req.targets || {}) : perPart.map((p) => p.itemId));

  // --- Requirements / feasibility diagnostics (independent of the LP) -------
  const targetItemIds = mode === 'targets'
    ? Object.keys(req.targets || {})
    : perPart.map((p) => p.itemId);
  const availableRawIds = new Set();
  const userAddedRawIds = new Set();
  for (const [id, cap] of caps) {
    if (cap > 0) availableRawIds.add(id);
    if (Number.isFinite(cap) && cap > 0) userAddedRawIds.add(id); // excludes auto-unlimited water
  }
  const analysis = analyzeRequirements(dataset, enabledRecipeIds, availableRawIds, userAddedRawIds, targetItemIds);
  const shapeDep = (d) => ({ itemId: d.itemId, name: nameOf(dataset, d.itemId), slug: slugOf(dataset, d.itemId), added: d.added, fluid: fluidOf(dataset, d.itemId) });
  const shapeItem = (itemId) => ({ itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), fluid: fluidOf(dataset, itemId) });
  const shapeTarget = (t) => ({ itemId: t.itemId, name: nameOf(dataset, t.itemId), slug: slugOf(dataset, t.itemId), reason: t.reason, deps: t.deps.map(shapeDep), blockedItems: t.blockedItems.map(shapeItem) });
  const requirements = {
    hasIssues: analysis.anyImpossible || analysis.anyMissing,
    impossible: analysis.perTarget.filter((t) => t.status === 'impossible').map(shapeTarget),
    missing: analysis.perTarget.filter((t) => t.status === 'missing').map(shapeTarget),
  };
  const hasProduction = recipeRates.size > 0;
  // Only take over the headline when there's genuinely nothing to build. When a
  // partial plan still renders (e.g. target-rates with one good target), leave
  // the mode's own "N target(s) short" headline — the callout explains the rest.
  if (!hasProduction && requirements.impossible.length > 0) {
    feasible = false;
    headline = 'Can’t build from these resources';
  } else if (!hasProduction && requirements.missing.length > 0) {
    // 'Missing' is recoverable (just add resources), so keep the headline
    // non-critical (the amber callout carries the detail) rather than red.
    feasible = true;
    headline = 'Add the required resources';
  }

  // --- Alternate-recipe improvement suggestions (independent of the LP) ----
  // Defensive: suggestions are a non-essential extra, so a failure here must never
  // blank the whole plan — fall back to no suggestions and keep the build rendering.
  let suggestions = [];
  try {
    const suggestTargets = mode === 'targets'
      ? (req.targets || {})
      : (req.targets && req.targets.length ? req.targets : req.targetItemId ? [{ itemId: req.targetItemId, weight: 1 }] : []);
    suggestions = suggestAlternates({
      dataset, caps, enabledRecipeIds, mode, targets: suggestTargets, noWaste, shardBudget,
    }).suggestions.map((s) => ({
      recipeId: s.recipeId,
      recipeName: s.recipeName,
      outputSlug: slugOf(dataset, s.outputItemId),
      benefit: s.benefit,
    }));
  } catch (err) {
    console.error('suggestAlternates failed; continuing without suggestions:', err);
  }

  return {
    feasible,
    headline,
    hasProduction,
    requirements,
    suggestions,
    shortfalls,
    perPart,
    tiles: { machines: phys.totalMachines, powerMW: fmt1(phys.totalPowerMW), shards: phys.totalShardsUsed },
    resourceMeters,
    buildRows,
    machineTotals,
    beltRows,
    graph,
    refinements: buildRefinements(dataset, graph),
  };
}
