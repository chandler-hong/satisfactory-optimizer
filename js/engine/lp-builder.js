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

function rawConstraints(touchedRaw, caps) {
  const c = {};
  for (const res of touchedRaw) c[res] = { max: caps.get(res) ?? 0 };
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
