// Normalized-Dataset shape for goal tests: two milestones with part costs, the
// items those costs name, one Space Elevator part so the hardcoded phase table
// resolves, and one phase-table item deliberately ABSENT so the drop path is
// exercised.
export const goalDataset = {
  items: new Map([
    ['Desc_IronPlateReinforced_C', { id: 'Desc_IronPlateReinforced_C', name: 'Reinforced Iron Plate', slug: 'reinforced-iron-plate', liquid: false }],
    ['Desc_Rotor_C', { id: 'Desc_Rotor_C', name: 'Rotor', slug: 'rotor', liquid: false }],
    ['Desc_Cable_C', { id: 'Desc_Cable_C', name: 'Cable', slug: 'cable', liquid: false }],
    ['Desc_SpaceElevatorPart_1_C', { id: 'Desc_SpaceElevatorPart_1_C', name: 'Smart Plating', slug: 'smart-plating', liquid: false }],
  ]),
  buildings: new Map(),
  recipes: [],
  rawResourceIds: new Set(),
  generators: [],
  recipeUnlocks: new Map(),
  goals: [
    { id: 'Schematic_3-1_C', name: 'Coal Power', tier: 3, timeSec: 480,
      cost: [{ itemId: 'Desc_IronPlateReinforced_C', amount: 150 }, { itemId: 'Desc_Rotor_C', amount: 50 }, { itemId: 'Desc_Cable_C', amount: 500 }] },
    { id: 'Schematic_2-2_C', name: 'Part Assembly', tier: 2, timeSec: 300,
      cost: [{ itemId: 'Desc_Rotor_C', amount: 100 }] },
  ],
};
