import { maxSets, hitTargets } from '../engine/optimize.js';
import { realize } from '../engine/physical-layer.js';
import { beltReport } from '../engine/belt-layer.js';

export const fmt1 = (x) => Math.round(x * 10) / 10;
export const fmt2 = (x) => Math.round(x * 100) / 100;

const nameOf = (dataset, id) => dataset.items.get(id)?.name ?? id;
const slugOf = (dataset, id) => dataset.items.get(id)?.slug;

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
 * Tiered flow graph of the build: nodes are raw sources (tier 0) + one per
 * active recipe; edges are item flows (producer -> consumer). Tiers are the
 * longest path from raw (relaxation, guarded against cycles). Pure — the
 * diagram renderer just lays this out.
 */
function buildGraph(dataset, recipeRates, machinesById) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const active = [...recipeRates.keys()].filter((id) => byId.has(id));
  const push = (map, k, v) => {
    const a = map.get(k);
    if (a) a.push(v);
    else map.set(k, [v]);
  };

  const producersOf = new Map();
  for (const rid of active) {
    for (const o of byId.get(rid).outputs) {
      if (!dataset.rawResourceIds.has(o.itemId)) push(producersOf, o.itemId, rid);
    }
  }

  const edges = [];
  const rawNeeded = new Set();
  const inEdges = new Map();
  for (const rid of active) {
    const x = recipeRates.get(rid);
    for (const inp of byId.get(rid).inputs) {
      const total = x * inp.perMin;
      if (dataset.rawResourceIds.has(inp.itemId)) {
        rawNeeded.add(inp.itemId);
        edges.push({ from: `raw:${inp.itemId}`, to: rid, itemId: inp.itemId, rate: total });
        push(inEdges, rid, `raw:${inp.itemId}`);
      } else {
        const prods = producersOf.get(inp.itemId) || [];
        for (const p of prods) {
          edges.push({ from: p, to: rid, itemId: inp.itemId, rate: total / prods.length });
          push(inEdges, rid, p);
        }
      }
    }
  }

  const tier = new Map();
  for (const res of rawNeeded) tier.set(`raw:${res}`, 0);
  for (let pass = 0; pass <= active.length; pass++) {
    let changed = false;
    for (const rid of active) {
      const ins = inEdges.get(rid) || [];
      const t = ins.length ? Math.max(...ins.map((f) => tier.get(f) ?? 0)) + 1 : 1;
      if ((tier.get(rid) ?? -1) < t) {
        tier.set(rid, t);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const nodes = [];
  for (const res of rawNeeded) {
    nodes.push({ id: `raw:${res}`, tier: 0, isRaw: true, name: nameOf(dataset, res), slug: slugOf(dataset, res) });
  }
  for (const rid of active) {
    const r = byId.get(rid);
    const b = dataset.buildings.get(r.buildingId);
    const outId = r.outputs[0]?.itemId;
    nodes.push({
      id: rid,
      tier: tier.get(rid) ?? 1,
      isRaw: false,
      recipeName: r.name,
      buildingName: b?.name ?? '',
      buildingSlug: b?.slug,
      itemName: outId ? nameOf(dataset, outId) : '',
      itemSlug: outId ? slugOf(dataset, outId) : undefined,
      machines: machinesById.get(rid) ?? 0,
    });
  }
  const tiers = Math.max(0, ...nodes.map((n) => n.tier)) + 1;
  const richEdges = edges.map((e) => ({ ...e, itemName: nameOf(dataset, e.itemId), itemSlug: slugOf(dataset, e.itemId) }));
  return { nodes, edges: richEdges, tiers };
}

/** Run the engine for `req` and shape a render-ready PlanView. */
export function computePlan(dataset, req) {
  const { mode, caps, enabledRecipeIds, shardBudget = 0, beltTier = 'Mk4', pipeTier = 'Mk2', noWaste = false } = req;
  let feasible = true;
  let headline = '';
  let shortfalls = [];
  let perPart = [];
  let recipeRates;

  if (mode === 'targets') {
    const r = hitTargets({ dataset, caps, enabledRecipeIds, targets: req.targets, noWaste });
    feasible = r.feasible;
    recipeRates = r.recipeRates;
    shortfalls = [...r.shortfalls].map(([itemId, amount]) => ({ itemId, name: nameOf(dataset, itemId), amount: fmt2(amount) }));
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
    perPart = r.perPart.map((p) => ({ itemId: p.itemId, name: nameOf(dataset, p.itemId), slug: slugOf(dataset, p.itemId), rate: fmt2(p.rate) }));
    if (!feasible) headline = 'Infeasible with these resources';
    else if (perPart.length === 1) headline = `${perPart[0].rate} ${perPart[0].name}/min`;
    else headline = `${fmt2(r.sets)} sets/min`;
  }

  const phys = realize({ dataset, recipeRates, shardBudget });
  const belts = beltReport({ dataset, recipeRates, beltTier, pipeTier });
  const usage = rawUsage(dataset, recipeRates);
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const machinesById = new Map(phys.perRecipe.map((pr) => [pr.recipeId, pr.machines]));

  const resourceMeters = [...caps].map(([itemId, available]) => {
    const used = Math.max(0, usage.get(itemId) || 0);
    return { itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), used: fmt2(used), available, pct: available ? Math.min(1, used / available) : 0, binding: available > 0 && used >= available - 1e-6 };
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
        clockPct: fmt1(pr.clock * 100),
        shards: pr.shards,
        powerMW: fmt1(pr.powerMW),
      };
    })
    .sort((a, b) => b.machines - a.machines);

  const beltRows = belts.map((f) => ({ itemId: f.itemId, name: nameOf(dataset, f.itemId), slug: slugOf(dataset, f.itemId), rate: f.rate, lines: f.lines, tier: f.tier, fluid: f.fluid, saturated: f.saturated }));

  return {
    feasible,
    headline,
    shortfalls,
    perPart,
    tiles: { machines: phys.totalMachines, powerMW: fmt1(phys.totalPowerMW), shards: phys.totalShardsUsed },
    resourceMeters,
    buildRows,
    beltRows,
    graph: buildGraph(dataset, recipeRates, machinesById),
  };
}
