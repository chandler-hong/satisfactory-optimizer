import { netPerMin } from '../domain/model.js';

export const OBJ = '_objective_';
export const RAWCOST = '_rawcost_';

// Build the per-recipe variable coefficient maps + the raw/non-raw item sets.
// Shared by every mode. Returns { variables, touchedRaw, touchedNonRaw }.
function buildVariables(dataset, enabledRecipeIds) {
  const raw = dataset.rawResourceIds;
  const variables = {};
  const touchedRaw = new Set();
  const touchedNonRaw = new Set();
  for (const r of dataset.recipes) {
    if (!enabledRecipeIds.has(r.id)) continue;
    const v = {};
    const items = new Set([...r.inputs.map((e) => e.itemId), ...r.outputs.map((e) => e.itemId)]);
    let rawcost = 0;
    for (const itemId of items) {
      const net = netPerMin(r, itemId);          // output - input
      if (raw.has(itemId)) {
        v[itemId] = -net;                        // net consumption for the {max: cap} constraint
        touchedRaw.add(itemId);
        if (-net > 0) rawcost += -net;
      } else {
        v[itemId] = net;                         // net production for the {min: 0} balance
        touchedNonRaw.add(itemId);
      }
    }
    v[RAWCOST] = rawcost;
    variables[r.id] = v;
  }
  return { variables, touchedRaw, touchedNonRaw };
}

// A non-finite cap (e.g. auto-included Water) means "effectively unlimited":
// the solver needs a real number, so clamp to a large finite bound the LP will
// never actually reach.
function rawConstraints(touchedRaw, caps) {
  const c = {};
  for (const res of touchedRaw) {
    const cap = caps.get(res) ?? 0;
    c[res] = { max: Number.isFinite(cap) ? cap : 1e9 };
  }
  return c;
}

export function buildMaxModel({ dataset, caps, enabledRecipeIds, targetItemId, noWaste = false }) {
  const { variables, touchedRaw, touchedNonRaw } = buildVariables(dataset, enabledRecipeIds);
  for (const id of Object.keys(variables)) {
    const r = dataset.recipes.find((x) => x.id === id);
    variables[id][OBJ] = netPerMin(r, targetItemId);
  }
  const constraints = rawConstraints(touchedRaw, caps);
  for (const i of touchedNonRaw) {
    if (i === targetItemId) continue;            // target is the objective, not a constraint
    constraints[i] = noWaste ? { equal: 0 } : { min: 0 };
  }
  return { optimize: OBJ, opType: 'max', constraints, variables };
}

export function buildMinRawModel(args, minTarget) {
  const model = buildMaxModel(args);
  model.constraints[OBJ] = { min: minTarget - Math.abs(minTarget) * 1e-9 - 1e-9 };
  model.optimize = RAWCOST;
  model.opType = 'min';
  return model;
}

export function buildTargetRatesModel({ dataset, caps, enabledRecipeIds, targets, noWaste = false }) {
  const targetMap = targets instanceof Map ? targets : new Map(Object.entries(targets));
  const { variables, touchedRaw, touchedNonRaw } = buildVariables(dataset, enabledRecipeIds);
  const constraints = rawConstraints(touchedRaw, caps);
  for (const i of touchedNonRaw) {
    if (targetMap.has(i)) continue;              // targets get their own {min: d} below
    constraints[i] = noWaste ? { equal: 0 } : { min: 0 };
  }
  for (const [t, d] of targetMap) {
    constraints[t] = { min: d };
    variables[`_slack_${t}`] = { [t]: 1, [RAWCOST]: 1e6 };
  }
  return { optimize: RAWCOST, opType: 'min', constraints, variables };
}

export const SETS = '_sets_';

/**
 * Maximize balanced "sets": max N such that flow(itemId) >= weight*N for every
 * target. A single synthetic variable `__sets__` (= N) is the sole objective and
 * contributes -weight to each target item's balance constraint.
 * @param {{dataset, caps:Map, enabledRecipeIds:Set, targets:{itemId:string,weight:number}[], noWaste?:boolean}} args
 */
export function buildMaxSetsModel({ dataset, caps, enabledRecipeIds, targets, noWaste = false }) {
  const { variables, touchedRaw, touchedNonRaw } = buildVariables(dataset, enabledRecipeIds);
  const nVar = { [SETS]: 1, [RAWCOST]: 0 };
  for (const t of targets) {
    const w = t.weight > 0 ? t.weight : 1;
    nVar[t.itemId] = (nVar[t.itemId] || 0) - w;    // flow(t) - w*N >= 0
    touchedNonRaw.add(t.itemId);                   // ensure the target has a balance constraint
  }
  variables.__sets__ = nVar;
  for (const id of Object.keys(variables)) {
    if (id !== '__sets__') variables[id][SETS] = 0;
  }
  const constraints = rawConstraints(touchedRaw, caps);
  for (const i of touchedNonRaw) {
    constraints[i] = noWaste ? { equal: 0 } : { min: 0 };
  }
  return { optimize: SETS, opType: 'max', constraints, variables };
}

export function buildMinRawForSetsModel(args, minSets) {
  const model = buildMaxSetsModel(args);
  model.constraints[SETS] = { min: minSets - Math.abs(minSets) * 1e-9 - 1e-9 };
  model.optimize = RAWCOST;
  model.opType = 'min';
  return model;
}
