/**
 * Goals for the Expansion view: what the game asks you to deliver, and how far
 * your plan gets you. Two sources — HUB tier milestones straight from the
 * dataset, and the Space Elevator phases, which the dataset doesn't carry.
 *
 * Pure — no DOM, no engine imports, deterministic.
 * @typedef {import('./model.js').Dataset} Dataset
 */

const DEFAULT_FILL_MINUTES = 10;

/**
 * Space Elevator (Project Assembly) phase costs — hand-authored, because they are
 * genuinely absent from the dataset: Recipe_SpaceElevator_C holds only the
 * elevator building's own construction cost, and no schematic's `cost` references
 * any Desc_SpaceElevatorPart_*.
 *
 * Satisfactory 1.0, matching the pinned dataset commit. Verified against
 * https://satisfactory.wiki.gg/wiki/Space_Elevator and
 * https://satisfactory.wiki.gg/wiki/Project_Assembly, which agree.
 *
 * These are each phase's OWN cost, not a cumulative total: later parts are built
 * from earlier ones, so the roll-up is larger and depends on build order.
 */
export const SPACE_ELEVATOR_PHASES = [
  { id: 'phase-1', number: 1, name: 'Distribution Platform', cost: [
    { itemId: 'Desc_SpaceElevatorPart_1_C', amount: 50 },        // Smart Plating
  ] },
  { id: 'phase-2', number: 2, name: 'Construction Dock', cost: [
    { itemId: 'Desc_SpaceElevatorPart_1_C', amount: 1000 },      // Smart Plating
    { itemId: 'Desc_SpaceElevatorPart_2_C', amount: 1000 },      // Versatile Framework
    { itemId: 'Desc_SpaceElevatorPart_3_C', amount: 100 },       // Automated Wiring
  ] },
  { id: 'phase-3', number: 3, name: 'Main Body', cost: [
    { itemId: 'Desc_SpaceElevatorPart_2_C', amount: 2500 },      // Versatile Framework
    { itemId: 'Desc_SpaceElevatorPart_4_C', amount: 500 },       // Modular Engine
    { itemId: 'Desc_SpaceElevatorPart_5_C', amount: 100 },       // Adaptive Control Unit
  ] },
  { id: 'phase-4', number: 4, name: 'Propulsion', cost: [
    { itemId: 'Desc_SpaceElevatorPart_7_C', amount: 500 },       // Assembly Director System
    { itemId: 'Desc_SpaceElevatorPart_6_C', amount: 500 },       // Magnetic Field Generator
    { itemId: 'Desc_SpaceElevatorPart_8_C', amount: 250 },       // Thermal Propulsion Rocket
    { itemId: 'Desc_SpaceElevatorPart_9_C', amount: 100 },       // Nuclear Pasta
  ] },
  { id: 'phase-5', number: 5, name: 'Assembly', cost: [
    { itemId: 'Desc_SpaceElevatorPart_9_C', amount: 1000 },      // Nuclear Pasta
    { itemId: 'Desc_SpaceElevatorPart_10_C', amount: 1000 },     // Biochemical Sculptor
    { itemId: 'Desc_SpaceElevatorPart_12_C', amount: 256 },      // AI Expansion Server
    { itemId: 'Desc_SpaceElevatorPart_11_C', amount: 200 },      // Ballistic Warp Drive
  ] },
];

/**
 * Resolve cost entries against the dataset's items. An id the dataset doesn't
 * know is dropped with a warning rather than thrown: one renamed part after a
 * dataset bump must not take the whole panel down.
 */
function resolveCost(dataset, cost, goalLabel) {
  const out = [];
  for (const c of cost) {
    const item = dataset.items.get(c.itemId);
    if (!item) {
      console.warn(`goals: ${goalLabel} needs unknown item ${c.itemId}; skipping that line`);
      continue;
    }
    out.push({ itemId: c.itemId, name: item.name, slug: item.slug, fluid: !!item.liquid, amount: c.amount });
  }
  return out;
}

/**
 * Every goal you can work toward: milestones by tier, then Space Elevator phases.
 * A goal whose cost lines all fail to resolve is omitted.
 * @param {Dataset} dataset
 */
export function buildGoalCatalog(dataset) {
  const catalog = [];

  const milestones = [...(dataset.goals || [])].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  for (const m of milestones) {
    const label = m.tier > 0 ? `Tier ${m.tier} · ${m.name}` : m.name;
    const cost = resolveCost(dataset, m.cost, label);
    if (cost.length === 0) continue;
    catalog.push({ id: m.id, kind: 'milestone', label, order: m.tier, cost });
  }

  for (const p of SPACE_ELEVATOR_PHASES) {
    const label = `Phase ${p.number} · ${p.name}`;
    const cost = resolveCost(dataset, p.cost, label);
    if (cost.length === 0) continue;
    catalog.push({ id: p.id, kind: 'phase', label, order: p.number, cost });
  }

  return catalog;
}

/**
 * Score the selected goals against what the plan actually emits.
 *
 * A goal's ETA is the MAX across its parts — the slowest part gates delivery, so
 * a sum or an average would both understate it. Any unproduced part leaves the
 * goal ETA null: there's no honest number while something isn't being made.
 *
 * `uncovered` converts each unproduced part's cost (a stock) into a rate (a flow)
 * over `fillMinutes`, which is what a WANT row takes.
 *
 * @param {ReturnType<typeof buildGoalCatalog>} catalog
 * @param {string[]} selectedIds
 * @param {Map<string, number>} netOutput  per-item rate leaving the plan
 * @param {number} fillMinutes
 */
export function evaluateGoals(catalog, selectedIds, netOutput, fillMinutes) {
  const selected = new Set(selectedIds || []);
  const minutes = Number(fillMinutes) > 0 ? Number(fillMinutes) : DEFAULT_FILL_MINUTES;
  const round2 = (x) => Math.round(x * 100) / 100;

  return catalog.filter((g) => selected.has(g.id)).map((g) => {
    const parts = g.cost.map((c) => {
      const netRate = netOutput.get(c.itemId) || 0;
      const covered = netRate > 1e-6;
      return { ...c, netRate: round2(netRate), covered, etaMinutes: covered ? round2(c.amount / netRate) : null };
    });
    const uncovered = parts
      .filter((p) => !p.covered)
      .map((p) => ({ itemId: p.itemId, name: p.name, rate: round2(p.amount / minutes) }));
    const etaMinutes = uncovered.length > 0 ? null : Math.max(...parts.map((p) => p.etaMinutes));
    return { id: g.id, kind: g.kind, label: g.label, parts, etaMinutes, uncovered };
  });
}
