/**
 * Reachability / dependency analysis over recipes — decides whether a target
 * can be produced from a set of available raw resources, and if not, why.
 * Pure: no DOM, no solver. Depends only on the Dataset shape.
 * @typedef {import('../domain/model.js').Dataset} Dataset
 */

/**
 * Forward producible closure. Starting from `seedIds`, a recipe in
 * `enabledRecipeIds` "fires" once all its inputs are producible, adding its
 * outputs. Iterated to a fixpoint, so cycles terminate (a pure A↔B loop never
 * bootstraps without a seed).
 * @param {Dataset} dataset
 * @param {Set<string>} enabledRecipeIds
 * @param {Iterable<string>} seedIds
 * @returns {{ producible: Set<string>, firedRecipeIds: Set<string> }}
 */
export function producibleClosure(dataset, enabledRecipeIds, seedIds) {
  const producible = new Set(seedIds);
  const firedRecipeIds = new Set();
  const recipes = dataset.recipes.filter((r) => enabledRecipeIds.has(r.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of recipes) {
      if (firedRecipeIds.has(r.id)) continue;
      if (r.inputs.every((i) => producible.has(i.itemId))) {
        firedRecipeIds.add(r.id);
        for (const o of r.outputs) producible.add(o.itemId);
        changed = true;
      }
    }
  }
  return { producible, firedRecipeIds };
}

/**
 * Raw resources reachable by walking backward from `targetItemId` over the
 * recipes in `firedRecipeIds` (recipes that can actually run). Stops at raws.
 * @returns {Set<string>} raw item ids the target depends on
 */
function rawAncestors(dataset, firedRecipeIds, targetItemId) {
  const raw = dataset.rawResourceIds;
  const producersOf = new Map(); // itemId -> [recipe]
  for (const r of dataset.recipes) {
    if (!firedRecipeIds.has(r.id)) continue;
    for (const o of r.outputs) {
      const list = producersOf.get(o.itemId);
      if (list) list.push(r);
      else producersOf.set(o.itemId, [r]);
    }
  }
  const deps = new Set();
  const seen = new Set();
  const stack = [targetItemId];
  while (stack.length) {
    const item = stack.pop();
    if (seen.has(item)) continue;
    seen.add(item);
    if (raw.has(item)) { deps.add(item); continue; } // raws have no producers
    for (const r of producersOf.get(item) || []) {
      for (const i of r.inputs) stack.push(i.itemId);
    }
  }
  return deps;
}

function depList(depSet, availableRawIds) {
  return [...depSet]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((itemId) => ({ itemId, added: availableRawIds.has(itemId) }));
}

/**
 * Classify each target as ok / missing / impossible against the available and
 * user-added raw resources. See module header + spec §5.3.
 * @param {Dataset} dataset
 * @param {Set<string>} enabledRecipeIds
 * @param {Set<string>} availableRawIds  raws with cap>0, incl auto-water
 * @param {Set<string>} userAddedRawIds  explicitly-added raws, excl auto-water
 * @param {string[]} targetItemIds
 */
export function analyzeRequirements(dataset, enabledRecipeIds, availableRawIds, userAddedRawIds, targetItemIds) {
  const raw = dataset.rawResourceIds;
  const availClosure = producibleClosure(dataset, enabledRecipeIds, availableRawIds);
  const allFired = producibleClosure(dataset, enabledRecipeIds, raw).firedRecipeIds;

  const perTarget = targetItemIds.map((itemId) => {
    // Target is itself a raw resource: buildable iff it's available.
    if (raw.has(itemId)) {
      const added = availableRawIds.has(itemId);
      return { itemId, status: added ? 'ok' : 'missing', reason: added ? 'buildable' : 'no-resources', deps: [{ itemId, added }] };
    }
    if (availClosure.producible.has(itemId)) {
      return { itemId, status: 'ok', reason: 'buildable', deps: [] };
    }
    const depSet = rawAncestors(dataset, allFired, itemId);
    const deps = depList(depSet, availableRawIds);
    if (depSet.size === 0) {
      return { itemId, status: 'impossible', reason: 'no-recipe', deps };
    }
    let overlap = false;
    for (const d of depSet) if (userAddedRawIds.has(d)) { overlap = true; break; }
    if (overlap) return { itemId, status: 'missing', reason: 'partial', deps };
    if (userAddedRawIds.size === 0) return { itemId, status: 'missing', reason: 'no-resources', deps };
    return { itemId, status: 'impossible', reason: 'wrong-resources', deps };
  });

  return {
    perTarget,
    anyImpossible: perTarget.some((p) => p.status === 'impossible'),
    anyMissing: perTarget.some((p) => p.status === 'missing'),
  };
}
