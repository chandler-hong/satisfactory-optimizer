import { buildMaxModel, buildMinRawModel, buildTargetRatesModel, buildMaxSetsModel, buildMinRawForSetsModel, supplyVarName } from './lp-builder.js';
import { solveModel } from './solver.js';

function ratesFrom(values, enabledRecipeIds) {
  const m = new Map();
  for (const [k, v] of Object.entries(values)) {
    if (enabledRecipeIds.has(k) && v > 1e-9) m.set(k, v);
  }
  return m;
}

function bindingResources(dataset, caps, recipeRates) {
  const usage = new Map();
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  for (const [rid, x] of recipeRates) {
    const r = byId.get(rid);
    if (!r) continue;
    for (const inp of r.inputs) {
      if (dataset.rawResourceIds.has(inp.itemId)) usage.set(inp.itemId, (usage.get(inp.itemId) || 0) + x * inp.perMin);
    }
    for (const out of r.outputs) {
      if (dataset.rawResourceIds.has(out.itemId)) usage.set(out.itemId, (usage.get(out.itemId) || 0) - x * out.perMin);
    }
  }
  const binding = [];
  for (const [res, cap] of caps) {
    if (cap > 0 && (usage.get(res) || 0) >= cap - 1e-6) binding.push(res);
  }
  return binding;
}

/** Maximize one target item's output. Two-pass lexicographic (max, then min raw). */
export function maxOutput({ dataset, caps, enabledRecipeIds, targetItemId, noWaste = false }) {
  const args = { dataset, caps, enabledRecipeIds, targetItemId, noWaste };
  const r1 = solveModel(buildMaxModel(args));
  if (!r1.feasible) return { feasible: false, maxRate: 0, recipeRates: new Map() };
  const maxRate = r1.objective;
  const r2 = solveModel(buildMinRawModel(args, maxRate));
  const chosen = r2.feasible ? r2 : r1;
  return { feasible: true, maxRate, recipeRates: ratesFrom(chosen.values, enabledRecipeIds) };
}

/**
 * Maximize balanced "sets" of one or more targets: max N with
 * flow(t) >= weight*N for each target. Two-pass (max sets, then min raw). A
 * single target with weight 1 reduces to maximizing that one part.
 * @param {{dataset, caps:Map, enabledRecipeIds:Set, targets:{itemId:string,weight:number}[],
 *          noWaste?:boolean, supplies?:{itemId:string,rate:number,kind?:'have'|'pinned'}[]}} params
 * @returns {{feasible:boolean, sets:number, recipeRates:Map<string,number>,
 *            perPart:{itemId:string,weight:number,rate:number}[], bindingResources:string[],
 *            supplyDrawn:{itemId:string,kind:string,used:number}[],
 *            supplyAtMax:{itemId:string,kind:string,used:number}[]}}
 *   `supplyDrawn` and `supplyAtMax` both carry one entry per input supply, in
 *   input order — see the comments in the body for why they are sourced from
 *   different passes and must not be conflated.
 */
export function maxSets({ dataset, caps, enabledRecipeIds, targets, noWaste = false, supplies = [] }) {
  const args = { dataset, caps, enabledRecipeIds, targets, noWaste, supplies };
  // Built once, up front, so the infeasible early return below carries the same
  // one-entry-per-input-supply shape as the feasible path — callers zip this
  // positionally against `supplies` (see js/engine/expansion.js), and a length
  // mismatch there would silently misalign rather than throw. Unfiltered: a
  // skipped supply (raw, or a non-positive rate) reports 0 rather than being
  // omitted, so the array stays aligned with `supplies` either way.
  //
  // Fix round 4: supplyAtMax mirrors supplyDrawn's exact shape/alignment but
  // is filled from pass 1 (r1), not `chosen` (pass 2). Two different
  // questions were conflated onto supplyDrawn alone since Task 2: "how much
  // did we use" (display — must track `chosen`, the min-raw pass, so the
  // figure matches the reported build; supplyDrawn keeps doing exactly this,
  // untouched) versus "is this the binding constraint" (detection). Detection
  // needs a draw with no give: buildMinRawForSetsModel (lp-builder.js) pins
  // SETS via `minSets - Math.abs(minSets)*1e-9 - 1e-9` — a give with both a
  // relative AND a flat term — so `chosen`'s own draw on a genuinely binding
  // supply can fall short of its rate by more than any margin tuned off the
  // rate alone once sets is small (the flat term dominates there,
  // non-monotonically — see js/engine/expansion.js's atLimitItems comment).
  // Pass 1 (buildMaxSetsModel) has no such constraint at all: SETS is the
  // direct objective, not a bound relaxed by a give, so a supply that truly
  // constrains the maximum is drawn to its rate here, at every scale, closely
  // enough for a plain absolute EPS (js/engine/expansion.js) to catch it as
  // fully drawn with no margin modelling required (verified empirically:
  // no measurable shortfall from weight 1 through 1e7, and independently via
  // a rate/SETS ratio up to 1.4e3-to-1, before this was relied on for
  // detection). See the round 5 correction below `supplyAtMax`'s fill loop
  // for why "closely enough," not "exactly."
  const supplyDrawn = (supplies || []).map((s) => ({ itemId: s?.itemId, kind: s?.kind === 'pinned' ? 'pinned' : 'have', used: 0 }));
  // Same zero-fill shape as supplyDrawn, kept as an independent array (not
  // derived from it) so the two can never alias or drift into sharing state.
  const supplyAtMax = (supplies || []).map((s) => ({ itemId: s?.itemId, kind: s?.kind === 'pinned' ? 'pinned' : 'have', used: 0 }));
  const r1 = solveModel(buildMaxSetsModel(args));
  if (!r1.feasible) return { feasible: false, sets: 0, recipeRates: new Map(), perPart: [], bindingResources: [], supplyDrawn, supplyAtMax };
  // Fix round 5, Critical: an UNBOUNDED pass 1 (feasible:true, bounded:false,
  // objective:Infinity -- reachable on the real dataset, e.g. a `have`
  // Alien Protein row feeding a max-Stone target through a route that
  // otherwise runs away, or the same shape via a pinned block row) still
  // hands back a finite vertex, and jsLPSolver is free to place that vertex
  // with every supply variable sitting exactly at its own cap -- not because
  // that supply constrains anything, but because the simplex has no reason
  // to move off it along the unbounded ray. Filling supplyAtMax from that
  // vertex made every declared supply look fully drawn, which filled
  // atLimitItems, which (combined with an unbounded ray that happens to
  // touch zero raw resources, leaving lpNetRaw empty and its `.every(...)`
  // vacuously true) made expansion.js report bounded:true on sets:Infinity --
  // the exact failure mode this whole fix (round 4) exists to prevent, now
  // arriving from the opposite direction. Rounds 2 and 3 never hit this:
  // they read `chosen` (pass 2), and pass 2's own constraint becomes
  // `{min: NaN}` when `minSets` is Infinity, which reliably left `chosen`'s
  // draw at 0 -- accidentally safe, for a reason that had nothing to do with
  // correctness and stopped applying the moment detection moved to pass 1.
  // Guarding the fill on r1.bounded leaves supplyAtMax all-zero on an
  // unbounded pass 1 (same as the already-handled infeasible path above), so
  // atLimitItems reads every supply as un-drawn and bounded correctly comes
  // back false. `sets` below can still read Infinity in this case (the
  // raw-resource-as-max-target edge case flagged out of scope since round
  // 1); bounded:false is the existing, already-relied-on signal callers use
  // to know not to trust it, unchanged by this fix.
  if (r1.bounded) {
    for (const d of supplyAtMax) {
      const used = r1.values[supplyVarName(d.itemId, d.kind)] || 0;
      d.used = Math.round(used * 1e6) / 1e6;
    }
  }
  // Round 5 correction: the comment above (and expansion.js's atLimitItems
  // comment) previously claimed pass 1 draws a binding supply to EXACTLY its
  // rate. False as stated -- there are two real error sources between pass
  // 1's true vertex and the `used` figure read out above. First, this loop's
  // own `Math.round(used * 1e6) / 1e6` loses up to ~4.9e-7 by itself (49% of
  // expansion.js's EPS=1e-6 -- only 2x headroom), at every scale, just from
  // landing on the wrong side of a rounding-grid line. Second, the solver
  // carries its own relative floating-point error on top of that, on the
  // order of `rate * 1.2e-16`. SUMMED, the two first exceed EPS at
  // `(1e-6 - 4.9e-7) / 1.2e-16` ~= 4.25e9 -- the round6 loss eats half the
  // budget before the solver term is charged anything at all. (An earlier
  // version of this comment put the crossover at ~8.31e9, which is
  // `EPS / 1.2e-16`: the solver term ALONE, i.e. the same sum with the round6
  // loss dropped from it.) The EPS margin in atLimitItems still holds today
  // only because nothing reachable gets remotely close: the UI clamps a
  // declared have/want row to MAX_RATE=1e6 (js/ui/expansion.js), and a
  // block's own ceiling (MAX_MACHINES=9999 x a 2.5x clock cap x an upper-end
  // recipe rate, roughly 1500/min -> ~3.75e7) sits about 113x below the
  // crossover. This is a real, load-bearing bound, not a decorative one --
  // the largest reachable rate has to grow by a bit over two orders of
  // magnitude to reach it, so a future reader raising MAX_RATE or
  // MAX_MACHINES that far needs to re-derive this margin rather than assume
  // EPS still clears it.
  const sets = r1.objective;
  const r2 = solveModel(buildMinRawForSetsModel(args, sets));
  const chosen = r2.feasible ? r2 : r1;
  const recipeRates = ratesFrom(chosen.values, enabledRecipeIds);
  const perPart = targets.map((t) => ({ itemId: t.itemId, weight: t.weight, rate: (t.weight > 0 ? t.weight : 1) * sets }));
  for (const d of supplyDrawn) {
    const used = chosen.values[supplyVarName(d.itemId, d.kind)] || 0;
    d.used = Math.round(used * 1e6) / 1e6;
  }
  return { feasible: true, sets, recipeRates, perPart, bindingResources: bindingResources(dataset, caps, recipeRates), supplyDrawn, supplyAtMax };
}

/** Hit target rates with minimum raw usage; slack variables report shortfalls. */
export function hitTargets({ dataset, caps, enabledRecipeIds, targets, noWaste = false, supplies = [] }) {
  const targetMap = targets instanceof Map ? targets : new Map(Object.entries(targets));
  const r = solveModel(buildTargetRatesModel({ dataset, caps, enabledRecipeIds, targets: targetMap, noWaste, supplies }));
  const shortfalls = new Map();
  for (const t of targetMap.keys()) {
    const s = r.values[`_slack_${t}`] || 0;
    if (s > 1e-6) shortfalls.set(t, s);
  }
  const recipeRates = ratesFrom(r.values, enabledRecipeIds);
  // How much of each on-hand supply the plan actually consumed. One entry per
  // input supply, in input order, so callers can pair it back up positionally
  // and report "used X of Y". A skipped supply (raw, or a non-positive rate)
  // reports 0 rather than being omitted, so the arrays stay aligned.
  const supplyDrawn = (supplies || []).map((s) => {
    const kind = s?.kind === 'pinned' ? 'pinned' : 'have';
    const used = r.values[supplyVarName(s?.itemId, kind)] || 0;
    return { itemId: s?.itemId, kind, used: Math.round(used * 1e6) / 1e6 };
  });
  return {
    // Defense-in-depth: the target-rates model is always feasible today (the
    // slack variables guarantee a feasible point), so this AND-clause is inert
    // now — but folding in solver feasibility means a future hard-constraint
    // change (e.g. noWaste={equal:0}) can never report a false success.
    feasible: r.feasible && shortfalls.size === 0,
    recipeRates,
    shortfalls,
    supplyDrawn,
    bindingResources: bindingResources(dataset, caps, recipeRates),
  };
}
