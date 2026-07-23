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
