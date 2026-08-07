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
 * Where the chain to `targetItemId` is actually severed: items in its
 * dependency ancestry — walked over EVERY recipe in the dataset, enabled or
 * not — that nothing currently enabled can make, but that some recipe could
 * make out of things you already can. In other words, the links that are one
 * recipe away from being closed.
 *
 * That "one recipe away" restriction is the whole point. The full set of
 * unmakeable ancestors is mostly noise (everything downstream of the real
 * break is unmakeable too, including the target itself), whereas this set is
 * the short list of things to go looking for in the recipe picker. On the
 * pinned dataset it never exceeds three items.
 *
 * Empty EXACTLY when no recipe set at all produces the target. Proof that a
 * blocked-but-reachable target always yields at least one: take the blocked
 * ancestor `b` that enters the all-recipes closure earliest. The recipe that
 * put it there had every input already in that closure; if any of those inputs
 * were not enabled-producible it would itself be a blocked ancestor that
 * entered earlier, contradicting the choice of `b`. So all of that recipe's
 * inputs are enabled-producible and `b` is in the frontier. Callers rely on
 * this: an empty result means "enabling recipes cannot help", not "no idea".
 *
 * @param {Set<string>} everyFired recipes that can fire with EVERYTHING enabled
 * @param {Set<string>} enabledProducible what the CURRENT recipe set can make
 * @returns {string[]} item ids, sorted for a stable render
 */
function blockedFrontier(dataset, everyFired, enabledProducible, targetItemId) {
  const producersOf = new Map(); // itemId -> [recipe]
  for (const r of dataset.recipes) {
    if (!everyFired.has(r.id)) continue;
    for (const o of r.outputs) {
      const list = producersOf.get(o.itemId);
      if (list) list.push(r);
      else producersOf.set(o.itemId, [r]);
    }
  }
  const frontier = new Set();
  const seen = new Set();
  const stack = [targetItemId];
  while (stack.length) {
    const item = stack.pop();
    if (seen.has(item)) continue;
    seen.add(item);
    // Already makeable: not a break, and nothing upstream of it is either.
    if (enabledProducible.has(item)) continue;
    for (const r of producersOf.get(item) || []) {
      if (r.inputs.every((i) => enabledProducible.has(i.itemId))) frontier.add(item);
      for (const i of r.inputs) stack.push(i.itemId);
    }
  }
  return [...frontier].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Classify each target as ok / missing / impossible against the available and
 * user-added raw resources. See module header + spec §5.3.
 *
 * Every result carries `blockedItems`, which is only ever populated on the
 * `no-recipe` path (see blockedFrontier) — the other paths are about resources,
 * not recipes, so there is nothing to name. It is always an array so consumers
 * never have to test for its presence.
 * @param {Dataset} dataset
 * @param {Set<string>} enabledRecipeIds
 * @param {Set<string>} availableRawIds  raws with cap>0, incl auto-water
 * @param {Set<string>} userAddedRawIds  explicitly-added raws, excl auto-water
 * @param {string[]} targetItemIds
 * @param {Iterable<string>} [extraSeedIds]  non-raw items you already hold that
 *   no recipe chain has to reach — Expansion's declared blocks and bus supply.
 *   Seeds both closures: a chain that starts from one of these is genuinely
 *   buildable, and calling it impossible would be a false alarm. The Optimizer
 *   has no such supplies and passes nothing.
 */
export function analyzeRequirements(dataset, enabledRecipeIds, availableRawIds, userAddedRawIds, targetItemIds, extraSeedIds) {
  const raw = dataset.rawResourceIds;
  const seeds = extraSeedIds ? [...extraSeedIds] : [];
  const availClosure = producibleClosure(dataset, enabledRecipeIds, [...availableRawIds, ...seeds]);
  // What the enabled set could make if raw scarcity were no object — the
  // baseline both the dependency walk and the frontier reason against.
  const enabledBest = producibleClosure(dataset, enabledRecipeIds, [...raw, ...seeds]);
  const allFired = enabledBest.firedRecipeIds;
  // Only the no-recipe path needs the with-everything-enabled closure, and that
  // path is the exception rather than the rule, so pay for it lazily.
  let everyFired = null;
  const firedWithEverything = () => {
    if (!everyFired) {
      const everyRecipeId = new Set(dataset.recipes.map((r) => r.id));
      everyFired = producibleClosure(dataset, everyRecipeId, [...raw, ...seeds]).firedRecipeIds;
    }
    return everyFired;
  };

  const perTarget = targetItemIds.map((itemId) => {
    // Target is itself a raw resource: buildable iff it's available.
    if (raw.has(itemId)) {
      const added = availableRawIds.has(itemId);
      return { itemId, status: added ? 'ok' : 'missing', reason: added ? 'buildable' : 'no-resources', deps: [{ itemId, added }], blockedItems: [] };
    }
    if (availClosure.producible.has(itemId)) {
      return { itemId, status: 'ok', reason: 'buildable', deps: [], blockedItems: [] };
    }
    const depSet = rawAncestors(dataset, allFired, itemId);
    const deps = depList(depSet, availableRawIds);
    if (depSet.size === 0) {
      // Reached exactly when the enabled recipes can't produce the target from
      // ANY raw, so `deps` is necessarily empty and says nothing. The useful
      // answer here is which links in the chain are severed, not which ores.
      return {
        itemId,
        status: 'impossible',
        reason: 'no-recipe',
        deps,
        blockedItems: blockedFrontier(dataset, firedWithEverything(), enabledBest.producible, itemId),
      };
    }
    let overlap = false;
    for (const d of depSet) if (userAddedRawIds.has(d)) { overlap = true; break; }
    if (overlap) return { itemId, status: 'missing', reason: 'partial', deps, blockedItems: [] };
    if (userAddedRawIds.size === 0) return { itemId, status: 'missing', reason: 'no-resources', deps, blockedItems: [] };
    return { itemId, status: 'impossible', reason: 'wrong-resources', deps, blockedItems: [] };
  });

  return {
    perTarget,
    anyImpossible: perTarget.some((p) => p.status === 'impossible'),
    anyMissing: perTarget.some((p) => p.status === 'missing'),
  };
}
