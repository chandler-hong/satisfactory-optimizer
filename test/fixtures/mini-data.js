// Minimal raw dataset shaped like greeny/SatisfactoryTools data.json.
// Encodes: a solid recipe, a fluid recipe (fluid amounts in m³, matching
// greeny's data), a byproduct, a hand-only recipe (excluded), building power.
export const miniRaw = {
  items: {
    Desc_OreIron_C:        { className: 'Desc_OreIron_C',        name: 'Iron Ore',          slug: 'iron-ore',           liquid: false },
    Desc_IronIngot_C:      { className: 'Desc_IronIngot_C',      name: 'Iron Ingot',        slug: 'iron-ingot',         liquid: false },
    Desc_LiquidOil_C:      { className: 'Desc_LiquidOil_C',      name: 'Crude Oil',         slug: 'crude-oil',          liquid: true  },
    Desc_Plastic_C:        { className: 'Desc_Plastic_C',        name: 'Plastic',           slug: 'plastic',            liquid: false },
    Desc_HeavyOilResidue_C:{ className: 'Desc_HeavyOilResidue_C',name: 'Heavy Oil Residue', slug: 'heavy-oil-residue',  liquid: true  },
  },
  buildings: {
    Desc_SmelterMk1_C:     { className: 'Desc_SmelterMk1_C',     name: 'Smelter',    slug: 'smelter',     metadata: { powerConsumption: 4,  powerConsumptionExponent: 1.321928 } },
    Desc_OilRefinery_C:    { className: 'Desc_OilRefinery_C',    name: 'Refinery',   slug: 'refinery',    metadata: { powerConsumption: 30, powerConsumptionExponent: 1.321928 } },
    Desc_ConstructorMk1_C: { className: 'Desc_ConstructorMk1_C', name: 'Constructor',slug: 'constructor', metadata: { powerConsumption: 4 } },
  },
  resources: {
    Desc_OreIron_C:   { item: 'Desc_OreIron_C',   speed: 1 },
    Desc_LiquidOil_C: { item: 'Desc_LiquidOil_C', speed: 1 },
  },
  miners: {},
  generators: {},
  schematics: {},
  recipes: {
    Recipe_IngotIron_C: {
      className: 'Recipe_IngotIron_C', name: 'Iron Ingot', slug: 'iron-ingot',
      alternate: false, inMachine: true, time: 2,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }],
      products:    [{ item: 'Desc_IronIngot_C', amount: 1 }],
      producedIn:  ['Desc_SmelterMk1_C'],
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
    Recipe_Manual_Only_C: {
      className: 'Recipe_Manual_Only_C', name: 'Handcraft Thing', slug: 'handcraft',
      alternate: false, inMachine: false, time: 1,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }],
      products:    [{ item: 'Desc_IronIngot_C', amount: 1 }],
      producedIn:  ['BP_WorkBenchComponent_C'],
    },
  },
};
