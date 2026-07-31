/**
 * @typedef {Object} Item
 * @property {string} id     className, e.g. "Desc_IronIngot_C"
 * @property {string} name
 * @property {string} slug
 * @property {boolean} liquid
 * @property {number} energyValue  // MJ; 0 when not a fuel
 * @property {string} description  // game blurb, may contain newlines; '' if absent
 * @property {number} stackSize    // 0 if absent; a pipe buffer for fluids, not a real stack
 * @property {number} sinkPoints   // AWESOME Sink value; 0 if absent
 *
 * @typedef {Object} Building
 * @property {string} id
 * @property {string} name
 * @property {string} [slug]
 * @property {number} basePowerMW    // 0 if unknown
 * @property {number} powerExponent  // default 1.321928
 *
 * @typedef {Object} IOEntry
 * @property {string} itemId
 * @property {number} perMin  // derived: amount / timeSec * 60
 * @property {number} amount  // per craft, as the game states the recipe
 *
 * @typedef {Object} Recipe
 * @property {string} id
 * @property {string} name    // any "Alternate: " prefix is stripped; see `alternate`
 * @property {string} buildingId
 * @property {boolean} alternate
 * @property {number} timeSec  // seconds per craft
 * @property {IOEntry[]} inputs
 * @property {IOEntry[]} outputs
 *
 * @typedef {Object} Fuel
 * @property {string} itemId
 * @property {string|null} supplementalItemId  // water, for the generators that need it
 * @property {string|null} byproductItemId
 * @property {number} byproductAmount
 *
 * @typedef {Object} Generator
 * @property {string} id
 * @property {string} name
 * @property {string} [slug]
 * @property {number} powerMW
 * @property {number} waterToPowerRatio
 * @property {Fuel[]} fuels
 *
 * @typedef {Object} UnlockSource
 * @property {string} name  // schematic name, e.g. "Part Assembly"
 * @property {string} type  // raw schematic type, e.g. "EST_Milestone"
 * @property {number} tier  // 0 when the data gives no tier
 *
 * @typedef {Object} Dataset
 * @property {Map<string, Item>} items
 * @property {Map<string, Building>} buildings
 * @property {Recipe[]} recipes
 * @property {Set<string>} rawResourceIds
 * @property {Generator[]} generators
 * @property {Map<string, UnlockSource[]>} recipeUnlocks  // every schematic that unlocks a recipe
 */

/**
 * Net production per minute of `itemId` for one machine of `recipe` at 100%.
 * Positive = net produced, negative = net consumed.
 * @param {Recipe} recipe
 * @param {string} itemId
 * @returns {number}
 */
export function netPerMin(recipe, itemId) {
  let net = 0;
  for (const o of recipe.outputs) if (o.itemId === itemId) net += o.perMin;
  for (const i of recipe.inputs) if (i.itemId === itemId) net -= i.perMin;
  return net;
}
