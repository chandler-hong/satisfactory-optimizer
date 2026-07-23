import { maxSets, hitTargets } from './optimize.js';
import { realize } from './physical-layer.js';

const EPS = 1e-6;
const round1 = (x) => Math.round(x * 10) / 10;

/** Total raw units/min a build draws: sum of positive net raw consumption. */
function rawTotal(dataset, recipeRates) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const net = new Map();
  for (const [rid, x] of recipeRates) {
    const r = byId.get(rid);
    if (!r) continue;
    for (const i of r.inputs) if (dataset.rawResourceIds.has(i.itemId)) net.set(i.itemId, (net.get(i.itemId) || 0) + x * i.perMin);
    for (const o of r.outputs) if (dataset.rawResourceIds.has(o.itemId)) net.set(o.itemId, (net.get(o.itemId) || 0) - x * o.perMin);
  }
  let total = 0;
  for (const v of net.values()) if (v > 0) total += v;
  return total;
}

/** Solve the active mode for a given enabled-recipe set; normalized shape. */
function solveFor({ dataset, caps, mode, targets, noWaste }, recipeIds) {
  if (mode === 'targets') {
    const r = hitTargets({ dataset, caps, enabledRecipeIds: recipeIds, targets, noWaste });
    let shortfallTotal = 0;
    for (const v of r.shortfalls.values()) shortfallTotal += v;
    return { recipeRates: r.recipeRates, sets: 0, perPart: [], shortfallTotal, feasible: r.feasible };
  }
  const r = maxSets({ dataset, caps, enabledRecipeIds: recipeIds, targets, noWaste });
  return { recipeRates: r.recipeRates, sets: r.sets, perPart: r.perPart, shortfallTotal: 0, feasible: r.feasible };
}

function metricsFor(dataset, recipeRates, shardBudget) {
  const phys = realize({ dataset, recipeRates, shardBudget });
  return { totalMachines: phys.totalMachines, rawTotal: rawTotal(dataset, recipeRates) };
}

/** Primary benefit of `plus` vs `base` for the mode, or null if no real gain. */
function benefitOf(mode, base, baseM, plus, plusM, nameOf) {
  if (mode !== 'targets') {
    const deltaSets = plus.sets - base.sets;
    if (deltaSets <= EPS) return null;
    if (plus.perPart.length === 1) {
      const partName = nameOf(plus.perPart[0].itemId);
      if (base.sets <= EPS) return { kind: 'output', label: `builds this (0 → ${round1(plus.perPart[0].rate)}/min ${partName})`, deltaSets };
      const deltaRate = round1(plus.perPart[0].rate - (base.perPart[0]?.rate ?? 0));
      const pct = Math.round((deltaSets / base.sets) * 100);
      return { kind: 'output', label: `+${deltaRate}/min ${partName} (+${pct}%)`, deltaSets };
    }
    if (base.sets <= EPS) return { kind: 'output', label: `builds this (0 → ${round1(plus.sets)} sets/min)`, deltaSets };
    const pct = Math.round((deltaSets / base.sets) * 100);
    return { kind: 'output', label: `+${pct}% output (${round1(deltaSets)} sets/min)`, deltaSets };
  }
  if (base.shortfallTotal > EPS && plus.shortfallTotal < base.shortfallTotal - EPS) {
    const deltaShortfall = base.shortfallTotal - plus.shortfallTotal;
    const label = plus.shortfallTotal <= EPS
      ? `meets all targets (was short ${round1(base.shortfallTotal)}/min)`
      : `reduces shortfall by ${round1(deltaShortfall)}/min`;
    return { kind: 'targets', label, deltaShortfall };
  }
  if (plusM.totalMachines < baseM.totalMachines) {
    const deltaMachines = baseM.totalMachines - plusM.totalMachines;
    return { kind: 'machines', label: `−${deltaMachines} machines (${baseM.totalMachines} → ${plusM.totalMachines})`, deltaMachines };
  }
  if (plusM.rawTotal < baseM.rawTotal - EPS) {
    const deltaRaw = baseM.rawTotal - plusM.rawTotal;
    const pct = baseM.rawTotal > 0 ? Math.round((deltaRaw / baseM.rawTotal) * 100) : 0;
    return { kind: 'raw', label: `−${round1(deltaRaw)}/min raw (−${pct}%)`, deltaRaw };
  }
  return null;
}

const KIND_PRIORITY = { targets: 4, machines: 3, raw: 2, output: 1 };
const magnitude = (b) => b.deltaShortfall ?? b.deltaMachines ?? b.deltaRaw ?? b.deltaSets ?? 0;

/**
 * Suggest disabled alternate recipes that would improve the current build.
 * Composes the existing optimizer + physical layer; pure, no DOM.
 */
export function suggestAlternates(
  { dataset, caps, enabledRecipeIds, mode, targets, noWaste = false, shardBudget = 0 },
  { maxSuggestions = 4, maxCandidates = 12 } = {},
) {
  const disabledAlts = dataset.recipes.filter((r) => r.alternate && !enabledRecipeIds.has(r.id));
  if (disabledAlts.length === 0) return { suggestions: [], evaluatedCount: 0, capped: false };

  const params = { dataset, caps, mode, targets, noWaste };
  const base = solveFor(params, enabledRecipeIds);
  // Machine/raw metrics feed only the target-rates benefits; in Maximize mode the
  // benefit is output-only, so skip the realize() work entirely (baseM/plusM null).
  const baseM = mode === 'targets' ? metricsFor(dataset, base.recipeRates, shardBudget) : null;

  const allEnabled = new Set(enabledRecipeIds);
  for (const r of disabledAlts) allEnabled.add(r.id);
  const all = solveFor(params, allEnabled);

  // Only alternates the global optimum actually uses can help; rank by usage.
  let candidates = disabledAlts
    .filter((r) => (all.recipeRates.get(r.id) || 0) > 1e-9)
    .sort((x, y) => (all.recipeRates.get(y.id) || 0) - (all.recipeRates.get(x.id) || 0));
  const capped = candidates.length > maxCandidates;
  candidates = candidates.slice(0, maxCandidates);

  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const nameOf = (id) => dataset.items.get(id)?.name ?? id;
  const kept = [];
  for (const cand of candidates) {
    const plusSet = new Set(enabledRecipeIds);
    plusSet.add(cand.id);
    const plus = solveFor(params, plusSet);
    const plusM = mode === 'targets' ? metricsFor(dataset, plus.recipeRates, shardBudget) : null;
    const benefit = benefitOf(mode, base, baseM, plus, plusM, nameOf);
    if (benefit) kept.push({ recipeId: cand.id, recipeName: cand.name, outputItemId: byId.get(cand.id)?.outputs?.[0]?.itemId, benefit });
  }

  kept.sort((a, b) => {
    const pk = KIND_PRIORITY[b.benefit.kind] - KIND_PRIORITY[a.benefit.kind];
    return pk !== 0 ? pk : magnitude(b.benefit) - magnitude(a.benefit);
  });
  return { suggestions: kept.slice(0, maxSuggestions), evaluatedCount: candidates.length, capped };
}
