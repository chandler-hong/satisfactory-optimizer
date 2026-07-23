import { maxSets, hitTargets } from '../engine/optimize.js';
import { realize } from '../engine/physical-layer.js';
import { beltReport } from '../engine/belt-layer.js';

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
 * Tiered flow graph of the build: nodes are raw sources (tier 0), one per
 * active recipe, and one "output" sink per target part carrying the NET rate
 * that leaves the system (production minus internal consumption — e.g. the
 * wire set aside after cable-making). Edges are item flows (producer ->
 * consumer, and producer -> output). Tiers are the longest path from raw
 * (relaxation, guarded against cycles). Pure — the diagram renderer just lays
 * this out.
 */
function buildGraph(dataset, recipeRates, machinesById, targetItemIds) {
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
  // Net produced-minus-consumed for every item in the build.
  const netById = new Map();
  for (const rid of active) {
    const x = recipeRates.get(rid);
    const r = byId.get(rid);
    for (const o of r.outputs) netById.set(o.itemId, (netById.get(o.itemId) || 0) + x * o.perMin);
    for (const inp of r.inputs) netById.set(inp.itemId, (netById.get(inp.itemId) || 0) - x * inp.perMin);
  }

  // A sink node captures a positive net leaving the build: target parts as
  // "output" sinks, and any other leftover as "surplus" (an unrefined
  // byproduct, e.g. polymer resin with no recipe/resource to consume it).
  const addSink = (prefix, extra, itemId, net) => {
    const prods = producersOf.get(itemId) || [];
    if (net <= 1e-6 || prods.length === 0) return;
    const outTier = Math.max(...prods.map((p) => tier.get(p) ?? 1)) + 1;
    nodes.push({ id: `${prefix}:${itemId}`, tier: outTier, itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), rate: net, fluid: fluidOf(dataset, itemId), ...extra });
    for (const p of prods) edges.push({ from: p, to: `${prefix}:${itemId}`, itemId, rate: net / prods.length });
  };
  const targetSet = new Set(targetItemIds || []);
  for (const itemId of targetSet) {
    if (dataset.rawResourceIds.has(itemId)) continue;
    addSink('out', { isOutput: true }, itemId, netById.get(itemId) || 0);
  }
  for (const [itemId, net] of netById) {
    if (targetSet.has(itemId) || dataset.rawResourceIds.has(itemId)) continue;
    addSink('sur', { isSurplus: true }, itemId, net);
  }

  const tiers = Math.max(0, ...nodes.map((n) => n.tier)) + 1;
  const richEdges = edges.map((e) => ({ ...e, itemName: nameOf(dataset, e.itemId), itemSlug: slugOf(dataset, e.itemId), fluid: fluidOf(dataset, e.itemId) }));
  return { nodes, edges: richEdges, tiers };
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

  if (mode === 'targets') {
    const r = hitTargets({ dataset, caps, enabledRecipeIds, targets: req.targets, noWaste });
    feasible = r.feasible;
    recipeRates = r.recipeRates;
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
      return { itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), used: fmt2(used), available, unlimited, pct: unlimited || !(available > 0) ? 0 : Math.min(1, used / available), binding: !unlimited && available > 0 && used >= available - 1e-6, fluid: fluidOf(dataset, itemId) };
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

  const graph = buildGraph(dataset, recipeRates, machinesById, mode === 'targets' ? Object.keys(req.targets || {}) : perPart.map((p) => p.itemId));

  return {
    feasible,
    headline,
    shortfalls,
    perPart,
    tiles: { machines: phys.totalMachines, powerMW: fmt1(phys.totalPowerMW), shards: phys.totalShardsUsed },
    resourceMeters,
    buildRows,
    beltRows,
    graph,
    refinements: buildRefinements(dataset, graph),
  };
}
