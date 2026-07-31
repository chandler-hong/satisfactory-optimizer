/**
 * Codex view model: every item paired with the machine recipes that make it,
 * the recipes that use it, and how each recipe is unlocked. Pure — no DOM, no
 * engine imports, deterministic.
 */

// The dataset carries two `special__` pseudo-entries ("Power", "Sink point")
// that aren't real items — no icon, no recipes, nothing to reference.
const isPseudoItem = (id) => id.startsWith('special__');

const UNLOCK_KIND = {
  EST_Milestone: 'milestone',
  EST_MAM: 'mam',
  EST_Alternate: 'alternate',
  EST_Tutorial: 'tutorial',
};

// Lower sorts first. A few recipes are granted by several schematics (e.g.
// Packaged Turbofuel comes with a MAM research and with two hard-drive
// alternates); the most informative source wins.
const KIND_ORDER = { milestone: 0, mam: 1, tutorial: 2, alternate: 3, other: 4 };

/** Human label for an unlock source. Tier is shown only when the data has one. */
function unlockLabel({ kind, tier, name }) {
  const withTier = (text) => (tier > 0 ? `${text} · Tier ${tier}` : text);
  switch (kind) {
    case 'milestone':
      return tier > 0 ? `Tier ${tier} · ${name}` : name;
    case 'mam':
      return withTier(`MAM · ${name}`);
    case 'tutorial':
      return `Onboarding · ${name}`;
    case 'alternate':
      // The schematic name is always "Alternate: <recipe name>", which the row's
      // recipe name and Alternate chip already say.
      return withTier('Hard Drive');
    default:
      return name;
  }
}

/** The single unlock source to show for a recipe, or null when data has none. */
function pickUnlock(sources) {
  if (!sources || sources.length === 0) return null;
  const best = sources
    .map((s) => ({ kind: UNLOCK_KIND[s.type] || 'other', tier: s.tier || 0, name: s.name }))
    .sort((a, b) => (
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || a.tier - b.tier
      || a.name.localeCompare(b.name)
    ))[0];
  return { ...best, label: unlockLabel(best) };
}

function ioOf(dataset, entry) {
  const item = dataset.items.get(entry.itemId);
  return {
    itemId: entry.itemId,
    name: item?.name ?? entry.itemId,
    slug: item?.slug,
    liquid: !!item?.liquid,
    amount: entry.amount ?? 0,
  };
}

function recipeRowOf(dataset, recipe) {
  const building = dataset.buildings.get(recipe.buildingId);
  return {
    id: recipe.id,
    name: recipe.name,
    alternate: !!recipe.alternate,
    buildingName: building?.name ?? recipe.buildingId,
    buildingSlug: building?.slug,
    timeSec: recipe.timeSec ?? 0,
    inputs: recipe.inputs.map((e) => ioOf(dataset, e)),
    outputs: recipe.outputs.map((e) => ioOf(dataset, e)),
    unlock: pickUnlock(dataset.recipeUnlocks?.get(recipe.id)),
  };
}

/** Standard recipes before alternates, alphabetical within each group. */
function byRecipeOrder(a, b) {
  return (a.alternate ? 1 : 0) - (b.alternate ? 1 : 0) || a.name.localeCompare(b.name);
}

/**
 * Build the Codex model from a normalized dataset.
 * @param {import('./model.js').Dataset} dataset
 * @returns {{items: object[], byId: Map<string, object>}}
 */
export function buildCodexModel(dataset) {
  const byId = new Map();
  for (const item of dataset.items.values()) {
    if (isPseudoItem(item.id)) continue;
    byId.set(item.id, {
      id: item.id,
      name: item.name,
      slug: item.slug,
      liquid: !!item.liquid,
      raw: dataset.rawResourceIds.has(item.id),
      description: item.description ?? '',
      stackSize: item.stackSize ?? 0,
      sinkPoints: item.sinkPoints ?? 0,
      energyValue: item.energyValue ?? 0,
      madeIn: [],
      usedIn: [],
    });
  }

  for (const recipe of dataset.recipes) {
    const row = recipeRowOf(dataset, recipe);
    // Sets: a recipe may list the same item twice, and unpackaging recipes have
    // an item as both input and output — one row per list either way.
    for (const itemId of new Set(recipe.outputs.map((o) => o.itemId))) {
      byId.get(itemId)?.madeIn.push(row);
    }
    for (const itemId of new Set(recipe.inputs.map((i) => i.itemId))) {
      byId.get(itemId)?.usedIn.push(row);
    }
  }

  for (const entry of byId.values()) {
    entry.madeIn.sort(byRecipeOrder);
    entry.usedIn.sort(byRecipeOrder);
  }

  const items = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { items, byId };
}
