/**
 * @typedef {Object} Item
 * @property {string} id     className, e.g. "Desc_IronIngot_C"
 * @property {string} name
 * @property {string} slug
 * @property {boolean} liquid
 *
 * @typedef {Object} Building
 * @property {string} id
 * @property {string} name
 * @property {number} basePowerMW    // 0 if unknown
 * @property {number} powerExponent  // default 1.321928
 *
 * @typedef {Object} IOEntry
 * @property {string} itemId
 * @property {number} perMin
 *
 * @typedef {Object} Recipe
 * @property {string} id
 * @property {string} name
 * @property {string} buildingId
 * @property {boolean} alternate
 * @property {IOEntry[]} inputs
 * @property {IOEntry[]} outputs
 *
 * @typedef {Object} Dataset
 * @property {Map<string, Item>} items
 * @property {Map<string, Building>} buildings
 * @property {Recipe[]} recipes
 * @property {Set<string>} rawResourceIds
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
