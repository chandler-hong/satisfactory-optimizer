/**
 * Tiered flow graph of a build: raw sources at tier 0, one node per active recipe,
 * and one sink per item leaving the system — "output" for targets, "surplus" for
 * anything else left over. Tiers are the longest path from raw, computed by
 * relaxation and guarded against cycles.
 *
 * Pure. Shared by the Optimizer (js/ui/view-model.js) and the Expansion view
 * (js/ui/expansion-render.js); js/ui/diagram.js lays out whatever this returns.
 */
const nameOf = (dataset, id) => dataset.items.get(id)?.name ?? id;
const slugOf = (dataset, id) => dataset.items.get(id)?.slug;
const fluidOf = (dataset, id) => !!dataset.items.get(id)?.liquid;

export function buildGraph(dataset, recipeRates, machinesById, targetItemIds, externallyFedLoad = new Map()) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const active = [...recipeRates.keys()].filter((id) => byId.has(id));
  const push = (map, k, v) => {
    const a = map.get(k);
    if (a) a.push(v);
    else map.set(k, [v]);
  };

  const producersOf = new Map();
  for (const rid of active) {
    for (const o of byId.get(rid).outputs) {
      if (!dataset.rawResourceIds.has(o.itemId)) push(producersOf, o.itemId, rid);
    }
  }

  // `externallyFedLoad` (e.g. the Expansion view's blocks — see
  // js/engine/expansion.js's externallyFedLoad) maps a recipe id to however
  // much of its load is already fed from outside this diagram: a source,
  // exactly like a raw or a have-supply. That load is not necessarily the
  // recipe's WHOLE load here — recipeRates deliberately merges a block and
  // the LP, or two block rows, onto one recipe id (see js/engine/expansion.js
  // on graphRates), so a recipe can be partly fed: only the non-fed remainder
  // (`inputLoad` below) is a real consumer of its own inputs. So every active
  // recipe still gets a node above and still contributes its FULL load to
  // netById's output side below (both loops compute the output side
  // unconditionally), but only `inputLoad` emits input edges and input
  // demand — skipped here, rather than dropped from `active` entirely, which
  // would also lose the recipe's own output node/edges (a different wrong
  // answer: addSink requires an entry in producersOf to create a sink at
  // all). Defaulted to empty so every existing caller (js/ui/view-model.js's
  // Optimizer graph, and any graph test that predates this parameter) is
  // unaffected.
  const edges = [];
  const rawNeeded = new Set();
  const inEdges = new Map();
  for (const rid of active) {
    const load = recipeRates.get(rid);
    const fed = externallyFedLoad.get(rid) || 0;
    const inputLoad = Math.max(0, load - fed);
    if (inputLoad <= 0) continue;
    for (const inp of byId.get(rid).inputs) {
      const total = inputLoad * inp.perMin;
      if (dataset.rawResourceIds.has(inp.itemId)) {
        rawNeeded.add(inp.itemId);
        edges.push({ from: `raw:${inp.itemId}`, to: rid, itemId: inp.itemId, rate: total });
        push(inEdges, rid, `raw:${inp.itemId}`);
      } else {
        const prods = producersOf.get(inp.itemId) || [];
        for (const p of prods) {
          edges.push({ from: p, to: rid, itemId: inp.itemId, rate: total / prods.length });
          push(inEdges, rid, p);
        }
      }
    }
  }

  const tier = new Map();
  for (const res of rawNeeded) tier.set(`raw:${res}`, 0);
  for (let pass = 0; pass <= active.length; pass++) {
    let changed = false;
    for (const rid of active) {
      const ins = inEdges.get(rid) || [];
      const t = ins.length ? Math.max(...ins.map((f) => tier.get(f) ?? 0)) + 1 : 1;
      if ((tier.get(rid) ?? -1) < t) {
        tier.set(rid, t);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const nodes = [];
  for (const res of rawNeeded) {
    nodes.push({ id: `raw:${res}`, tier: 0, isRaw: true, name: nameOf(dataset, res), slug: slugOf(dataset, res) });
  }
  for (const rid of active) {
    const r = byId.get(rid);
    const b = dataset.buildings.get(r.buildingId);
    const outId = r.outputs[0]?.itemId;
    nodes.push({
      id: rid,
      tier: tier.get(rid) ?? 1,
      isRaw: false,
      recipeName: r.name,
      buildingName: b?.name ?? '',
      buildingSlug: b?.slug,
      itemName: outId ? nameOf(dataset, outId) : '',
      itemSlug: outId ? slugOf(dataset, outId) : undefined,
      machines: machinesById.get(rid) ?? 0,
    });
  }
  // Net produced-minus-consumed for every item in the build. A recipe's FULL
  // load always counts on the output side; only its non-fed remainder
  // (`inputLoad`, same as above) counts on the input side — the fed share's
  // inputs are covered outside this diagram, so subtracting them would make a
  // real output look partly consumed and could push its net at or below zero
  // — and addSink below refuses to create a sink for a net that isn't
  // strictly positive, silently dropping an output the rest of the plan
  // (netOutput) says genuinely leaves.
  const netById = new Map();
  for (const rid of active) {
    const load = recipeRates.get(rid);
    const r = byId.get(rid);
    for (const o of r.outputs) netById.set(o.itemId, (netById.get(o.itemId) || 0) + load * o.perMin);
    const fed = externallyFedLoad.get(rid) || 0;
    const inputLoad = Math.max(0, load - fed);
    if (inputLoad <= 0) continue;
    for (const inp of r.inputs) netById.set(inp.itemId, (netById.get(inp.itemId) || 0) - inputLoad * inp.perMin);
  }

  // A sink node captures a positive net leaving the build: target parts as
  // "output" sinks, and any other leftover as "surplus" (an unrefined
  // byproduct, e.g. polymer resin with no recipe/resource to consume it).
  const addSink = (prefix, extra, itemId, net) => {
    const prods = producersOf.get(itemId) || [];
    if (net <= 1e-6 || prods.length === 0) return;
    const outTier = Math.max(...prods.map((p) => tier.get(p) ?? 1)) + 1;
    nodes.push({ id: `${prefix}:${itemId}`, tier: outTier, itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), rate: net, fluid: fluidOf(dataset, itemId), ...extra });
    for (const p of prods) edges.push({ from: p, to: `${prefix}:${itemId}`, itemId, rate: net / prods.length });
  };
  const targetSet = new Set(targetItemIds || []);
  for (const itemId of targetSet) {
    if (dataset.rawResourceIds.has(itemId)) continue;
    addSink('out', { isOutput: true }, itemId, netById.get(itemId) || 0);
  }
  for (const [itemId, net] of netById) {
    if (targetSet.has(itemId) || dataset.rawResourceIds.has(itemId)) continue;
    addSink('sur', { isSurplus: true }, itemId, net);
  }

  const tiers = Math.max(0, ...nodes.map((n) => n.tier)) + 1;
  const richEdges = edges.map((e) => ({ ...e, itemName: nameOf(dataset, e.itemId), itemSlug: slugOf(dataset, e.itemId), fluid: fluidOf(dataset, e.itemId) }));
  return { nodes, edges: richEdges, tiers };
}
