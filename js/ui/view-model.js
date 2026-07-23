import { maxOutput, hitTargets } from '../engine/optimize.js';
import { realize } from '../engine/physical-layer.js';
import { beltReport } from '../engine/belt-layer.js';

export const fmt1 = (x) => Math.round(x * 10) / 10;
export const fmt2 = (x) => Math.round(x * 100) / 100;

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

const nameOf = (dataset, id) => dataset.items.get(id)?.name ?? id;
const slugOf = (dataset, id) => dataset.items.get(id)?.slug;

/** Run the engine for `req` and shape a render-ready PlanView. */
export function computePlan(dataset, req) {
  const { mode, caps, enabledRecipeIds, shardBudget = 0, beltTier = 'Mk4', pipeTier = 'Mk2', noWaste = false } = req;
  let feasible = true, headline = '', shortfalls = [], recipeRates;

  if (mode === 'targets') {
    const r = hitTargets({ dataset, caps, enabledRecipeIds, targets: req.targets, noWaste });
    feasible = r.feasible;
    recipeRates = r.recipeRates;
    shortfalls = [...r.shortfalls].map(([itemId, amount]) => ({ itemId, name: nameOf(dataset, itemId), amount: fmt2(amount) }));
    headline = feasible ? 'All target rates met' : `${shortfalls.length} target(s) short`;
  } else {
    const r = maxOutput({ dataset, caps, enabledRecipeIds, targetItemId: req.targetItemId, noWaste });
    feasible = r.feasible;
    recipeRates = r.recipeRates;
    headline = feasible ? `${fmt2(r.maxRate)} ${nameOf(dataset, req.targetItemId)}/min` : 'Infeasible with these resources';
  }

  const phys = realize({ dataset, recipeRates, shardBudget });
  const belts = beltReport({ dataset, recipeRates, beltTier, pipeTier });
  const usage = rawUsage(dataset, recipeRates);
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));

  const resourceMeters = [...caps].map(([itemId, available]) => {
    const used = Math.max(0, usage.get(itemId) || 0);
    return { itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), used: fmt2(used), available, pct: available ? Math.min(1, used / available) : 0, binding: available > 0 && used >= available - 1e-6 };
  });

  const buildRows = phys.perRecipe.map((pr) => {
    const r = byId.get(pr.recipeId);
    const b = dataset.buildings.get(pr.buildingId);
    const outId = r?.outputs?.[0]?.itemId;
    return {
      recipeId: pr.recipeId, recipeName: r?.name ?? pr.recipeId,
      buildingName: b?.name ?? '', buildingSlug: b?.slug,
      itemName: outId ? nameOf(dataset, outId) : '', itemSlug: outId ? slugOf(dataset, outId) : undefined,
      machines: pr.machines, clockPct: fmt1(pr.clock * 100), shards: pr.shards, powerMW: fmt1(pr.powerMW),
    };
  }).sort((a, b) => b.machines - a.machines);

  const beltRows = belts.map((f) => ({ itemId: f.itemId, name: nameOf(dataset, f.itemId), slug: slugOf(dataset, f.itemId), rate: f.rate, lines: f.lines, tier: f.tier, fluid: f.fluid, saturated: f.saturated }));

  return {
    feasible, headline, shortfalls,
    tiles: { machines: phys.totalMachines, powerMW: fmt1(phys.totalPowerMW), shards: phys.totalShardsUsed },
    resourceMeters, buildRows, beltRows,
  };
}
