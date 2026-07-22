// Minimal normalized Dataset for the standard iron chain (per-minute rates).
// Hand-verified answers from 360 iron ore: max Modular Frame = 15/min, max Rotor = 32/min.
const io = (itemId, perMin) => ({ itemId, perMin });
const R = (id, inputs, outputs) => ({ id, name: id, buildingId: 'b', alternate: false, inputs, outputs });

export const ironChain = {
  items: new Map(),        // unused by the LP engine
  buildings: new Map(),    // unused by the LP engine
  rawResourceIds: new Set(['ore']),
  recipes: [
    R('ingot', [io('ore', 30)], [io('ingot', 30)]),
    R('plate', [io('ingot', 30)], [io('plate', 20)]),
    R('rod',   [io('ingot', 15)], [io('rod', 15)]),
    R('screw', [io('rod', 10)], [io('screw', 40)]),
    R('rip',   [io('plate', 30), io('screw', 60)], [io('rip', 5)]),
    R('mf',    [io('rip', 3), io('rod', 12)], [io('mf', 2)]),
    R('rotor', [io('rod', 20), io('screw', 100)], [io('rotor', 4)]),
  ],
};

export const ALL_IRON_RECIPES = new Set(ironChain.recipes.map((r) => r.id));
export const capsIron = (n) => new Map([['ore', n]]);
