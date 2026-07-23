import { iconUrl } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const ROW_H = 96; // cross pitch between rows in a column (horizontal mode)
const BOX_H = 52;
const COL_GAP = 104; // horizontal main-gap between tiers (room for edge labels)
const V_MAIN_GAP = 104; // vertical main-gap between tier rows (room for risers + labels)
const V_CROSS_GAP = 52; // horizontal gap between boxes within a tier row (vertical mode)
const H_CROSS_GAP = ROW_H - BOX_H; // 44 — gap between boxes within a column (horizontal mode)
const DUMMY_CROSS_V = 60; // routing-channel width a dummy reserves in a tier row (vertical mode)
const MARGIN = 20;
const ICON = 26;
const PAD_X = 12; // box inner horizontal padding
const ICON_GAP = 8;
const CHAR_W_TITLE = 7.5; // generous px/char at 600 12px (over- beats clipped)
const CHAR_W_SUB = 6.6; // px/char at 11px
const MIN_BOX_W = 128;
const CORNER = 9; // rounded corner radius on edge bends

function svg(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function rateStr(rate, fluid) {
  return `${Math.round(rate * 10) / 10}${fluid ? ' m³' : ''}/min`;
}
function titleOf(n) {
  return n.isRaw || n.isOutput || n.isSurplus || n.isInput ? n.name : n.recipeName;
}
function subOf(n) {
  if (n.isRaw) return 'raw resource';
  if (n.isOutput) return `output · ${rateStr(n.rate, n.fluid)}`;
  if (n.isSurplus) return `surplus · ${rateStr(n.rate, n.fluid)}`;
  if (n.isInput) return rateStr(n.rate, n.fluid);
  return `${n.buildingName} ×${n.machines}`;
}

/** Width a node box needs to show its full title + sub on one line (no truncation). */
function nodeWidth(n) {
  const textW = Math.max(titleOf(n).length * CHAR_W_TITLE, subOf(n).length * CHAR_W_SUB);
  return Math.max(MIN_BOX_W, Math.ceil(PAD_X + ICON + ICON_GAP + textW + PAD_X));
}

/** Draw an axis-aligned polyline (screen [x,y] points) with rounded right-angle corners. */
function polyPath(pts) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const inX = Math.sign(x1 - x0);
    const inY = Math.sign(y1 - y0);
    const outX = Math.sign(x2 - x1);
    const outY = Math.sign(y2 - y1);
    const r = Math.min(CORNER, Math.hypot(x1 - x0, y1 - y0) / 2, Math.hypot(x2 - x1, y2 - y1) / 2);
    d += ` L ${x1 - inX * r} ${y1 - inY * r} Q ${x1} ${y1}, ${x1 + outX * r} ${y1 + outY * r}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/**
 * Render a tiered flow diagram of `graph` (from computePlan) into `container`
 * as SVG. Layered (Sugiyama-lite) layout along a generic "main" axis (the tier
 * progression) and "cross" axis (position within a tier):
 *  - orientation is chosen responsively — horizontal (flow left→right) when it
 *    fits the container width, otherwise vertical (flow top→bottom) so tall,
 *    deep chains scroll DOWN instead of far to the right (better on single /
 *    portrait monitors). A ResizeObserver re-flows on resize.
 *  - a few barycenter sweeps reduce edge crossings (orientation-independent);
 *  - edges stay flat at their exit lane, then take a single box-aware riser to
 *    the target's entry lane; each riser gets its own track so none merge;
 *  - arrowheads sit only on the final segment, i.e. the true consumer.
 * @param {HTMLElement} container
 * @param {{nodes:object[], edges:object[], tiers:number}} graph
 */
export function renderDiagram(container, graph) {
  container.replaceChildren();
  if (!graph || !graph.nodes || graph.nodes.length === 0) return;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const maxTier = Math.max(0, ...graph.nodes.map((n) => n.tier));
  const widthOf = new Map(graph.nodes.map((n) => [n.id, nodeWidth(n)]));

  // Layers hold both real node ids and dummy waypoint ids.
  const layers = Array.from({ length: maxTier + 1 }, () => []);
  for (const n of graph.nodes) layers[n.tier].push(n.id);

  const dummyTier = new Map(); // dummyId -> tier
  const chains = []; // { edge, ids:[from, ...dummies, to] }
  let dummyCount = 0;
  for (const e of graph.edges) {
    const u = nodeById.get(e.from);
    const v = nodeById.get(e.to);
    if (!u || !v) continue;
    const ids = [e.from];
    for (let t = u.tier + 1; t < v.tier; t++) {
      const id = `__d${dummyCount++}`;
      dummyTier.set(id, t);
      layers[t].push(id);
      ids.push(id);
    }
    ids.push(e.to);
    chains.push({ edge: e, ids });
  }

  const tierOf = (id) => (dummyTier.has(id) ? dummyTier.get(id) : nodeById.get(id).tier);

  // Adjacency between consecutive tiers (both directions), from chain segments.
  const up = new Map();
  const down = new Map();
  const pushTo = (m, k, val) => {
    const a = m.get(k);
    if (a) a.push(val);
    else m.set(k, [val]);
  };
  for (const { ids } of chains) {
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = ids[i];
      const b = ids[i + 1];
      if (tierOf(b) === tierOf(a) + 1) {
        pushTo(down, a, b);
        pushTo(up, b, a);
      }
    }
  }

  // Barycenter crossing reduction: order each layer by the mean position of its
  // neighbours in the adjacent (already-ordered) layer; nodes with no neighbour
  // keep their current slot. Orientation-independent — done once.
  function reorder(t, neighbourMap, refLayer) {
    const idx = new Map(refLayer.map((id, i) => [id, i]));
    const cur = layers[t];
    const key = new Map();
    cur.forEach((id, i) => {
      const vals = (neighbourMap.get(id) || []).map((n) => idx.get(n)).filter((x) => x != null);
      key.set(id, vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : i);
    });
    layers[t] = [...cur].sort((a, b) => key.get(a) - key.get(b));
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let t = 1; t <= maxTier; t++) reorder(t, up, layers[t - 1]);
    for (let t = maxTier - 1; t >= 0; t--) reorder(t, down, layers[t + 1]);
  }

  // Column widths (fit the widest real node in the tier) — used for the
  // horizontal main-band size and to measure whether horizontal fits.
  const colWidth = layers.map((layer) => {
    let w = 0;
    for (const id of layer) if (!dummyTier.has(id)) w = Math.max(w, widthOf.get(id));
    return w || 44;
  });
  const horizontalWidth = 2 * MARGIN + colWidth.reduce((s, w) => s + w, 0) + COL_GAP * maxTier;

  // Chain grouping for per-edge attachment ports (orientation-independent).
  const outMap = new Map();
  const inMap = new Map();
  for (const chain of chains) {
    const s = chain.ids[0];
    const t = chain.ids[chain.ids.length - 1];
    if (!outMap.has(s)) outMap.set(s, []);
    outMap.get(s).push(chain);
    if (!inMap.has(t)) inMap.set(t, []);
    inMap.get(t).push(chain);
  }

  // Where a source fans out to 2+ consumers of the same item, estimate how many
  // of its machines feed each (largest-remainder rounding → whole numbers that
  // sum to the source machine count). Orientation-independent.
  const groups = new Map();
  for (const e of graph.edges) {
    const gk = `${e.from}::${e.itemId}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(e);
  }
  const edgeShare = new Map();
  for (const es of groups.values()) {
    const src = nodeById.get(es[0].from);
    if (!src || !(src.machines > 0) || es.length < 2) continue;
    const total = es.reduce((s, e) => s + e.rate, 0);
    if (!(total > 0)) continue;
    const rows = es.map((e) => {
      const exact = (e.rate / total) * src.machines;
      return { e, exact, base: Math.floor(exact), rem: exact - Math.floor(exact) };
    });
    let leftover = Math.round(src.machines) - rows.reduce((s, r) => s + r.base, 0);
    for (const r of [...rows].sort((a, b) => b.rem - a.rem)) {
      if (leftover <= 0) break;
      r.base += 1;
      leftover -= 1;
    }
    for (const r of rows) edgeShare.set(r.e, { base: r.base, exact: r.exact });
  }

  const nodeClass = (n) => (n.isRaw ? 'diagram-node diagram-node--raw'
    : n.isOutput ? 'diagram-node diagram-node--output'
    : n.isSurplus ? 'diagram-node diagram-node--surplus'
    : n.isInput ? 'diagram-node diagram-node--input'
    : 'diagram-node');

  // Lay out + draw for a given orientation ('h' left→right, 'v' top→bottom).
  function renderInto(orientation) {
    const V = orientation === 'v';
    const XY = V ? (main, cross) => [cross, main] : (main, cross) => [main, cross];
    const crossGap = V ? V_CROSS_GAP : H_CROSS_GAP;
    const mainGap = V ? V_MAIN_GAP : COL_GAP;
    const crossSizeOf = (id) => (V ? (dummyTier.has(id) ? DUMMY_CROSS_V : widthOf.get(id)) : BOX_H);
    const bandSize = layers.map((_, t) => (V ? BOX_H : colWidth[t]));

    // Main-axis band per tier.
    const bandMain = [];
    let m = MARGIN;
    for (let t = 0; t <= maxTier; t++) {
      bandMain[t] = m;
      m += bandSize[t] + mainGap;
    }
    const mainTotal = bandMain[maxTier] + bandSize[maxTier] + MARGIN;

    // Cross-axis extents (for centring each tier within the tallest/widest).
    const tierExtent = layers.map((layer) => {
      if (!layer.length) return 0;
      let sum = 0;
      for (const id of layer) sum += crossSizeOf(id);
      return sum + crossGap * (layer.length - 1);
    });
    const maxCross = Math.max(0, ...tierExtent);
    const crossTotal = 2 * MARGIN + maxCross;

    // Positions: each node/dummy gets a main band + a cross position.
    const pos = new Map();
    for (let t = 0; t <= maxTier; t++) {
      let c = MARGIN + (maxCross - tierExtent[t]) / 2;
      for (const id of layers[t]) {
        const size = crossSizeOf(id);
        pos.set(id, {
          dummy: dummyTier.has(id),
          t,
          near: bandMain[t],
          far: bandMain[t] + bandSize[t],
          crossPos: c,
          crossSize: size,
          crossCenter: c + size / 2,
        });
        c += size + crossGap;
      }
    }
    const crossCenterOf = (id) => pos.get(id)?.crossCenter ?? 0;

    // Per-edge ports: spread attachment points along each box's exit/entry
    // edge so multiple edges never share a point, ordered by the other end's
    // cross position to reduce crossings.
    const srcPort = new Map();
    const tgtPort = new Map();
    for (const [sid, chs] of outMap) {
      const sp = pos.get(sid);
      if (!sp || sp.dummy) continue;
      [...chs].sort((a, b) => crossCenterOf(a.ids[a.ids.length - 1]) - crossCenterOf(b.ids[b.ids.length - 1]))
        .forEach((ch, k) => srcPort.set(ch, sp.crossPos + (sp.crossSize * (k + 1)) / (chs.length + 1)));
    }
    for (const [tid, chs] of inMap) {
      const tp = pos.get(tid);
      if (!tp || tp.dummy) continue;
      [...chs].sort((a, b) => crossCenterOf(a.ids[0]) - crossCenterOf(b.ids[0]))
        .forEach((ch, k) => tgtPort.set(ch, tp.crossPos + (tp.crossSize * (k + 1)) / (chs.length + 1)));
    }

    // Box occupancy per tier along the cross axis, for routing clearance.
    const tierBoxes = layers.map(() => []);
    for (const n of graph.nodes) {
      const p = pos.get(n.id);
      tierBoxes[n.tier].push([p.crossPos, p.crossPos + p.crossSize]);
    }
    const clearAt = (cross, tiers) => tiers.every((c) => tierBoxes[c].every(([a, b]) => cross < a - 4 || cross > b + 4));
    const clearLaneCandidates = (tiers) => {
      const cs = [];
      for (const c of tiers) for (const [a, b] of tierBoxes[c]) cs.push(a - 10, b + 10);
      return cs;
    };

    // Route each edge flat at its exit lane, then a single box-aware riser to
    // the entry lane in the latest gap where both flat runs clear every box.
    const gapRisers = new Map(); // gapK -> [riser seg]
    const addRiser = (gapK, c0, c1) => {
      const seg = { m0: bandMain[gapK] + bandSize[gapK], m1: bandMain[gapK + 1], c0, c1 };
      if (!gapRisers.has(gapK)) gapRisers.set(gapK, []);
      gapRisers.get(gapK).push(seg);
      return seg;
    };
    const routes = [];
    for (const chain of chains) {
      const s = pos.get(chain.ids[0]);
      const t = pos.get(chain.ids[chain.ids.length - 1]);
      const cs = tierOf(chain.ids[0]);
      const ct = tierOf(chain.ids[chain.ids.length - 1]);
      const sc = srcPort.get(chain) ?? s.crossCenter;
      const tc = tgtPort.get(chain) ?? t.crossCenter;
      const em = s.far; // exit main (far edge of source box)
      const nm = t.near; // enter main (near edge of target box)
      const inter = [];
      for (let c = cs + 1; c <= ct - 1; c++) inter.push(c);

      let k = -1;
      for (let cand = ct - 1; cand >= cs; cand--) {
        if (clearAt(sc, inter.filter((c) => c <= cand)) && clearAt(tc, inter.filter((c) => c > cand))) {
          k = cand;
          break;
        }
      }
      const route = { edge: chain.edge, em, cs, sc };
      if (k >= 0 && Math.abs(tc - sc) < 0.5) {
        route.mc = [[em, sc], [nm, tc]];
        route.firstSeg = null;
      } else if (k >= 0) {
        const seg = addRiser(k, sc, tc);
        route.firstSeg = seg;
        route.build = () => [[em, sc], [seg.track, sc], [seg.track, tc], [nm, tc]];
      } else {
        const mid = (sc + tc) / 2;
        let L = mid;
        let bestD = Infinity;
        for (const cand of [sc, tc, ...clearLaneCandidates(inter)]) {
          if (clearAt(cand, inter) && Math.abs(cand - mid) < bestD) {
            bestD = Math.abs(cand - mid);
            L = cand;
          }
        }
        const s1 = addRiser(cs, sc, L);
        const s2 = addRiser(ct - 1, L, tc);
        route.firstSeg = s1;
        route.build = () => [[em, sc], [s1.track, sc], [s1.track, L], [s2.track, L], [s2.track, tc], [nm, tc]];
      }
      routes.push(route);
    }
    // Give each gap's risers their own track along the main axis (ordered by
    // cross mid-position so tracks don't cross).
    for (const segs of gapRisers.values()) {
      const span = segs[0].m1 - segs[0].m0;
      segs.sort((p, q) => (p.c0 + p.c1) - (q.c0 + q.c1));
      segs.forEach((seg, i) => { seg.track = segs[0].m0 + (span * (i + 1)) / (segs.length + 1); });
    }

    // "×N" label sits at the START of each line (near the source, since it
    // counts the source's machines feeding that line): midway along the leaving
    // run, but never past the first gap — so it stays clearly at the origin end
    // and always lands on the line, whether the riser is near or far.
    for (const route of routes) {
      const firstRiserMain = route.firstSeg ? route.firstSeg.track : Infinity;
      const cap = bandMain[route.cs + 1];
      route.labelMC = [(route.em + Math.min(firstRiserMain, cap)) / 2, route.sc];
    }

    const width = V ? crossTotal : mainTotal;
    const height = V ? mainTotal : crossTotal;
    const root = svg('svg', { class: 'diagram', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Factory flow diagram' });
    const defs = svg('defs', {});
    const marker = svg('marker', { id: 'diag-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    marker.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'diagram-arrow' }));
    defs.appendChild(marker);
    root.appendChild(defs);

    // Edges (under the boxes).
    const edgeLabels = [];
    for (const route of routes) {
      const pts = (route.mc ?? route.build()).map(([main, cross]) => XY(main, cross));
      root.appendChild(svg('path', { d: polyPath(pts), class: 'diagram-edge', 'marker-end': 'url(#diag-arrow)' }));
      const [lx, ly] = XY(route.labelMC[0], route.labelMC[1]);
      edgeLabels.push({ x: lx, y: ly, edge: route.edge });
    }

    // Nodes (boxes are always upright; only their position/width vary).
    for (const n of graph.nodes) {
      const p = pos.get(n.id);
      const [bx, by] = XY(p.near, p.crossPos);
      const boxW = V ? p.crossSize : bandSize[p.t];
      const g = svg('g', { class: nodeClass(n), transform: `translate(${bx} ${by})` });
      g.appendChild(svg('rect', { x: 0, y: 0, width: boxW, height: BOX_H, rx: 8, class: 'diagram-box' }));

      const url = iconUrl(n.isRaw || n.isOutput || n.isSurplus || n.isInput ? n.slug : n.buildingSlug);
      let tx = PAD_X;
      if (url) {
        g.appendChild(svg('image', { x: PAD_X, y: (BOX_H - ICON) / 2, width: ICON, height: ICON, href: url, class: 'diagram-icon' }));
        tx = PAD_X + ICON + ICON_GAP;
      }
      const title = svg('text', { x: tx, y: 21, class: 'diagram-title' });
      title.textContent = titleOf(n);
      g.appendChild(title);
      const sub = svg('text', { x: tx, y: 38, class: 'diagram-sub' });
      sub.textContent = subOf(n);
      g.appendChild(sub);
      root.appendChild(g);
    }

    // Haloed "×N" text (no box): how many of the source's machines feed this edge.
    for (const L of edgeLabels) {
      const sh = edgeShare.get(L.edge);
      if (!sh) continue;
      const src = nodeById.get(L.edge.from);
      const t = svg('text', { x: L.x, y: L.y, class: 'diagram-elabel', 'text-anchor': 'middle' });
      t.textContent = `×${sh.base >= 1 ? sh.base : Math.round(sh.exact * 10) / 10}`;
      const title = svg('title', {});
      title.textContent = `≈${Math.round(sh.exact * 10) / 10} ${src.buildingName || 'machine'}(s) → ${nodeById.get(L.edge.to)?.recipeName || nodeById.get(L.edge.to)?.name || ''}`;
      t.appendChild(title);
      root.appendChild(t);
    }

    container.replaceChildren(root);
  }

  // Pick orientation by whether the horizontal layout fits the available width.
  const decide = () => {
    let avail = container.clientWidth || 0;
    if (!avail) {
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
      avail = vw >= 900 ? vw - 360 : vw - 32; // rough: minus sidebar/padding
    }
    return horizontalWidth <= avail + 1 ? 'h' : 'v';
  };

  container.__diagOrientation = decide();
  renderInto(container.__diagOrientation);

  // Re-flow when the container's width crosses the fit threshold.
  if (typeof ResizeObserver !== 'undefined' && !container.__diagRO) {
    const ro = new ResizeObserver(() => {
      if (!container.clientWidth) return;
      const want = decide();
      if (want !== container.__diagOrientation) {
        container.__diagOrientation = want;
        renderInto(want);
      }
    });
    ro.observe(container);
    container.__diagRO = ro;
  }
}
