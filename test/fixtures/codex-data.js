// Raw dataset (greeny/SatisfactoryTools shape) for Codex tests. Covers what
// mini-data.js deliberately doesn't: item metadata (description / stack / sink /
// energy), per-craft amounts + craft time, schematic unlocks (milestone, MAM,
// hard-drive alternate with and without a tier), a recipe unlocked by two
// schematics, a byproduct, a fluid, a raw resource, an item with no machine
// recipe, and one of the `special__` pseudo-items the Codex must exclude.
export const codexRaw = {
  items: {
    Desc_OreIron_C:         { className: 'Desc_OreIron_C',         name: 'Iron Ore',          slug: 'iron-ore',          liquid: false, description: 'The most essential basic resource.',   stackSize: 100,   sinkPoints: 1,     energyValue: 0 },
    Desc_IronIngot_C:       { className: 'Desc_IronIngot_C',       name: 'Iron Ingot',        slug: 'iron-ingot',        liquid: false, description: 'Used for crafting.\nSmelted from Iron Ore.', stackSize: 100, sinkPoints: 2, energyValue: 0 },
    Desc_IronPlate_C:       { className: 'Desc_IronPlate_C',       name: 'Iron Plate',        slug: 'iron-plate',        liquid: false, description: 'One of the most basic parts.',         stackSize: 200,   sinkPoints: 6,     energyValue: 0 },
    Desc_LiquidOil_C:       { className: 'Desc_LiquidOil_C',       name: 'Crude Oil',         slug: 'crude-oil',         liquid: true,  description: 'Refined into Oil-based resources.',    stackSize: 50000, sinkPoints: 30000, energyValue: 320 },
    Desc_Plastic_C:         { className: 'Desc_Plastic_C',         name: 'Plastic',           slug: 'plastic',           liquid: false, description: 'A versatile polymer.',                 stackSize: 200,   sinkPoints: 75,    energyValue: 0 },
    Desc_HeavyOilResidue_C: { className: 'Desc_HeavyOilResidue_C', name: 'Heavy Oil Residue', slug: 'heavy-oil-residue', liquid: true,  description: 'A byproduct of oil refining.',         stackSize: 50000, sinkPoints: 0,     energyValue: 400 },
    Desc_Somersloop_C:      { className: 'Desc_Somersloop_C',      name: 'Somersloop',        slug: 'somersloop',        liquid: false, description: 'An alien artifact.',                   stackSize: 50,    sinkPoints: 0,     energyValue: 0 },
    special__power:         { className: 'special__power',         name: 'Power',             slug: 'power',             liquid: false, description: 'Power',                                stackSize: 1,     sinkPoints: 0,     energyValue: 0 },
  },
  buildings: {
    Desc_SmelterMk1_C:     { className: 'Desc_SmelterMk1_C',     name: 'Smelter',     slug: 'smelter',     metadata: { powerConsumption: 4 } },
    Desc_ConstructorMk1_C: { className: 'Desc_ConstructorMk1_C', name: 'Constructor', slug: 'constructor', metadata: { powerConsumption: 4 } },
    Desc_OilRefinery_C:    { className: 'Desc_OilRefinery_C',    name: 'Refinery',    slug: 'refinery',    metadata: { powerConsumption: 30 } },
  },
  resources: {
    Desc_OreIron_C:   { item: 'Desc_OreIron_C',   speed: 1 },
    Desc_LiquidOil_C: { item: 'Desc_LiquidOil_C', speed: 1 },
  },
  miners: {},
  generators: {},
  schematics: {
    // Iron Plate is granted by a tier-1 milestone AND (redundantly) by a MAM
    // research — the two-source case the Codex has to disambiguate.
    'Schematic_1-1_C':   { className: 'Schematic_1-1_C',   name: 'Base Building', type: 'EST_Milestone', tier: 1, unlock: { recipes: ['Recipe_IronPlate_C'] } },
    Research_Plastic_C:  { className: 'Research_Plastic_C', name: 'Polymers',     type: 'EST_MAM',       tier: 3, unlock: { recipes: ['Recipe_Plastic_C', 'Recipe_IronPlate_C'] } },
    Schematic_Alternate_CastPlate_C: { className: 'Schematic_Alternate_CastPlate_C', name: 'Alternate: Cast Plate', type: 'EST_Alternate', tier: 4, unlock: { recipes: ['Recipe_Alternate_CastPlate_C'] } },
    Schematic_Alternate_PureIngot_C: { className: 'Schematic_Alternate_PureIngot_C', name: 'Alternate: Pure Iron Ingot', type: 'EST_Alternate', tier: 0, unlock: { recipes: ['Recipe_Alternate_PureIngot_C'] } },
    // Unlocks nothing that survives normalize — must not break the inversion.
    Schematic_Cosmetic_C: { className: 'Schematic_Cosmetic_C', name: 'Paint', type: 'EST_Customization', tier: 2, unlock: { recipes: [] } },
  },
  recipes: {
    Recipe_IngotIron_C: {
      className: 'Recipe_IngotIron_C', name: 'Iron Ingot', slug: 'iron-ingot',
      alternate: false, inMachine: true, time: 2,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }],
      products:    [{ item: 'Desc_IronIngot_C', amount: 1 }],
      producedIn:  ['Desc_SmelterMk1_C'],
    },
    Recipe_Alternate_PureIngot_C: {
      className: 'Recipe_Alternate_PureIngot_C', name: 'Alternate: Pure Iron Ingot', slug: 'pure-iron-ingot',
      alternate: true, inMachine: true, time: 12,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 7 }],
      products:    [{ item: 'Desc_IronIngot_C', amount: 13 }],
      producedIn:  ['Desc_SmelterMk1_C'],
    },
    Recipe_IronPlate_C: {
      className: 'Recipe_IronPlate_C', name: 'Iron Plate', slug: 'iron-plate',
      alternate: false, inMachine: true, time: 6,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }],
      products:    [{ item: 'Desc_IronPlate_C', amount: 2 }],
      producedIn:  ['Desc_ConstructorMk1_C'],
    },
    Recipe_Alternate_CastPlate_C: {
      className: 'Recipe_Alternate_CastPlate_C', name: 'Alternate: Cast Plate', slug: 'cast-plate',
      alternate: true, inMachine: true, time: 16,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 1 }],
      products:    [{ item: 'Desc_IronPlate_C', amount: 2 }],
      producedIn:  ['Desc_ConstructorMk1_C'],
    },
    Recipe_Plastic_C: {
      className: 'Recipe_Plastic_C', name: 'Plastic', slug: 'plastic',
      alternate: false, inMachine: true, time: 6,
      ingredients: [{ item: 'Desc_LiquidOil_C', amount: 3 }],
      products:    [
        { item: 'Desc_Plastic_C', amount: 2 },
        { item: 'Desc_HeavyOilResidue_C', amount: 1 },
      ],
      producedIn: ['Desc_OilRefinery_C'],
    },
  },
};
