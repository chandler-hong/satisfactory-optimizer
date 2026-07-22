import { buildMaxModel, buildMinRawModel, buildTargetRatesModel } from './lp-builder.js';
import { solveModel } from './solver.js';

function ratesFrom(values, enabledRecipeIds) {
  const m = new Map();
  for (const [k, v] of Object.entries(values)) {
    if (enabledRecipeIds.has(k) && v > 1e-9) m.set(k, v);
  }
  return m;
}

function bindingResources(dataset, caps, recipeRates) {
  const usage = new Map();
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  for (const [rid, x] of recipeRates) {
    const r = byId.get(rid);
    if (!r) continue;
    for (const inp of r.inputs) {
      if (dataset.rawResourceIds.has(inp.itemId)) usage.set(inp.itemId, (usage.get(inp.itemId) || 0) + x * inp.perMin);
    }
    for (const out of r.outputs) {
      if (dataset.rawResourceIds.has(out.itemId)) usage.set(out.itemId, (usage.get(out.itemId) || 0) - x * out.perMin);
    }
  }
  const binding = [];
  for (const [res, cap] of caps) {
    if (cap > 0 && (usage.get(res) || 0) >= cap - 1e-6) binding.push(res);
  }
  return binding;
}

/** Maximize one target item's output. Two-pass lexicographic (max, then min raw). */
export function maxOutput({ dataset, caps, enabledRecipeIds, targetItemId, noWaste = false }) {
  const args = { dataset, caps, enabledRecipeIds, targetItemId, noWaste };
  const r1 = solveModel(buildMaxModel(args));
  if (!r1.feasible) return { feasible: false, maxRate: 0, recipeRates: new Map() };
  const maxRate = r1.objective;
  const r2 = solveModel(buildMinRawModel(args, maxRate));
  const chosen = r2.feasible ? r2 : r1;
  return { feasible: true, maxRate, recipeRates: ratesFrom(chosen.values, enabledRecipeIds) };
}

/** Hit target rates with minimum raw usage; slack variables report shortfalls. */
export function hitTargets({ dataset, caps, enabledRecipeIds, targets, noWaste = false }) {
  const targetMap = targets instanceof Map ? targets : new Map(Object.entries(targets));
  const r = solveModel(buildTargetRatesModel({ dataset, caps, enabledRecipeIds, targets: targetMap, noWaste }));
  const shortfalls = new Map();
  for (const t of targetMap.keys()) {
    const s = r.values[`_slack_${t}`] || 0;
    if (s > 1e-6) shortfalls.set(t, s);
  }
  const recipeRates = ratesFrom(r.values, enabledRecipeIds);
  return {
    feasible: shortfalls.size === 0,
    recipeRates,
    shortfalls,
    bindingResources: bindingResources(dataset, caps, recipeRates),
  };
}
