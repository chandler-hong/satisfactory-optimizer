import { iconUrl } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const ROW_H = 96; // vertical pitch between rows in a column
const BOX_H = 52;
const COL_GAP = 104; // horizontal gap between columns (room for edge labels)
const MARGIN = 20;
const ICON = 26;
const PAD_X = 12; // box inner horizontal padding
const ICON_GAP = 8;
const CHAR_W_TITLE = 7.5; // generous px/char at 600 12px (over- beats clipped)
const CHAR_W_SUB = 6.6; // px/char at 11px
const MIN_BOX_W = 128;

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

/**
 * Render a tiered flow diagram of `graph` (from computePlan) into `container`
 * as SVG. Layered (Sugiyama-lite) layout:
 *  - columns by tier; column width fits the widest full name in it;
 *  - edges that span more than one tier are routed through invisible dummy
 *    waypoints in the intermediate columns, so a flow like Iron Rod → Modular
 *    Frame bends through an empty channel instead of crossing the boxes in
 *    between (which read as false connections);
 *  - a few barycenter sweeps reduce edge crossings;
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
  // keep their current slot.
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

  // Column x (widths fit real nodes; dummy-only columns get a slim channel).
  const colWidth = layers.map((layer) => {
    let w = 0;
    for (const id of layer) if (!dummyTier.has(id)) w = Math.max(w, widthOf.get(id));
    return w || 44;
  });
  const colX = [];
  let x = MARGIN;
  for (let t = 0; t <= maxTier; t++) {
    colX[t] = x;
    x += colWidth[t] + COL_GAP;
  }
  const totalWidth = colX[maxTier] + colWidth[maxTier] + MARGIN;

  const layerHeight = layers.map((l) => l.length * ROW_H);
  const maxH = Math.max(ROW_H, ...layerHeight);
  const totalHeight = MARGIN * 2 + maxH;

  // Positions. Real nodes: box rect + edge anchors on left/right mid. Dummies:
  // a single routing point at the column's horizontal centre.
  const pos = new Map();
  for (let t = 0; t <= maxTier; t++) {
    const off = (maxH - layerHeight[t]) / 2;
    layers[t].forEach((id, i) => {
      const rowY = MARGIN + off + i * ROW_H;
      const cy = rowY + BOX_H / 2;
      if (dummyTier.has(id)) {
        pos.set(id, { dummy: true, left: colX[t], right: colX[t] + colWidth[t], cy });
      } else {
        pos.set(id, { dummy: false, x: colX[t], y: rowY, w: colWidth[t], left: colX[t], right: colX[t] + colWidth[t], cy });
      }
    });
  }

  const root = svg('svg', { class: 'diagram', viewBox: `0 0 ${totalWidth} ${totalHeight}`, width: totalWidth, height: totalHeight, role: 'img', 'aria-label': 'Factory flow diagram' });

  const defs = svg('defs', {});
  const marker = svg('marker', { id: 'diag-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  marker.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'diagram-arrow' }));
  defs.appendChild(marker);
  root.appendChild(defs);

  // Edges first (under the boxes). Orthogonal routing: horizontal runs along
  // clear lanes, vertical risers only in the gaps between columns, with rounded
  // right-angle corners. Every riser gets its own track x within its gap, so no
  // two edges ever share a line. The label anchor is on the final horizontal run
  // into the consumer, so a producer's split reads per-consumer.
  const CORNER = 9;
  // Give every edge its own attachment point (port) on the source's right edge
  // and the target's left edge, so multiple edges into/out of one box are
  // separate parallel arrows that never merge. Ports spread along the box edge,
  // ordered by the other end's height to reduce crossings.
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
  const cyOf = (id) => pos.get(id)?.cy ?? 0;
  const srcPortY = new Map();
  const tgtPortY = new Map();
  for (const [sid, chs] of outMap) {
    const sp = pos.get(sid);
    if (!sp || sp.dummy) continue;
    [...chs].sort((a, b) => cyOf(a.ids[a.ids.length - 1]) - cyOf(b.ids[b.ids.length - 1]))
      .forEach((ch, k) => srcPortY.set(ch, sp.y + (BOX_H * (k + 1)) / (chs.length + 1)));
  }
  for (const [tid, chs] of inMap) {
    const tp = pos.get(tid);
    if (!tp || tp.dummy) continue;
    [...chs].sort((a, b) => cyOf(a.ids[0]) - cyOf(b.ids[0]))
      .forEach((ch, k) => tgtPortY.set(ch, tp.y + (BOX_H * (k + 1)) / (chs.length + 1)));
  }
  // Box occupancy per column (real nodes only), for routing clearance checks.
  const colBoxes = layers.map(() => []);
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    colBoxes[n.tier].push([p.y, p.y + BOX_H]);
  }
  const clearAt = (y, cols) => cols.every((c) => colBoxes[c].every(([a, b]) => y < a - 4 || y > b + 4));

  // Route each edge: keep it flat at the source's exit height for as long as no
  // box blocks it, then a SINGLE riser to the target's entry height, placed in
  // the latest gap where both flat runs clear every box. This avoids the little
  // jogs you get from threading a line through per-row waypoints. Only when
  // neither height stays clear does it fall back to a clear mid-lane (two
  // risers). Each riser then gets its own track x within its gap, so no two
  // edges ever share a line.
  const gapRisers = new Map(); // gap-left-x -> [riser seg]
  const addRiser = (gapK, y0, y1) => {
    const seg = { x0: colX[gapK] + colWidth[gapK], x1: colX[gapK + 1], y0, y1 };
    if (!gapRisers.has(seg.x0)) gapRisers.set(seg.x0, []);
    gapRisers.get(seg.x0).push(seg);
    return seg;
  };
  const clearLaneCandidates = (cols) => {
    const ys = [];
    for (const c of cols) for (const [a, b] of colBoxes[c]) ys.push(a - 10, b + 10);
    return ys;
  };
  const routes = [];
  for (const chain of chains) {
    const s = pos.get(chain.ids[0]);
    const t = pos.get(chain.ids[chain.ids.length - 1]);
    const cs = tierOf(chain.ids[0]);
    const ct = tierOf(chain.ids[chain.ids.length - 1]);
    const sy = srcPortY.get(chain) ?? s.cy;
    const ty = tgtPortY.get(chain) ?? t.cy;
    const sx = s.right;
    const tlx = t.left;
    const inter = [];
    for (let c = cs + 1; c <= ct - 1; c++) inter.push(c);

    // Latest gap k where sy clears cols (cs+1..k) and ty clears cols (k+1..ct-1).
    let k = -1;
    for (let cand = ct - 1; cand >= cs; cand--) {
      if (clearAt(sy, inter.filter((c) => c <= cand)) && clearAt(ty, inter.filter((c) => c > cand))) {
        k = cand;
        break;
      }
    }
    const route = { edge: chain.edge };
    if (k >= 0 && Math.abs(ty - sy) < 0.5) {
      route.pts = [[sx, sy], [tlx, ty]];
    } else if (k >= 0) {
      const seg = addRiser(k, sy, ty);
      route.build = () => [[sx, sy], [seg.tx, sy], [seg.tx, ty], [tlx, ty]];
    } else {
      const mid = (sy + ty) / 2;
      let L = mid;
      let bestD = Infinity;
      for (const cand of [sy, ty, ...clearLaneCandidates(inter)]) {
        if (clearAt(cand, inter) && Math.abs(cand - mid) < bestD) {
          bestD = Math.abs(cand - mid);
          L = cand;
        }
      }
      const s1 = addRiser(cs, sy, L);
      const s2 = addRiser(ct - 1, L, ty);
      route.build = () => [[sx, sy], [s1.tx, sy], [s1.tx, L], [s2.tx, L], [s2.tx, ty], [tlx, ty]];
    }
    routes.push(route);
  }

  // Give each gap's risers their own track x, ordered by mid-height.
  for (const segs of gapRisers.values()) {
    const gapW = segs[0].x1 - segs[0].x0;
    segs.sort((p, q) => (p.y0 + p.y1) - (q.y0 + q.y1));
    segs.forEach((seg, i) => { seg.tx = seg.x0 + (gapW * (i + 1)) / (segs.length + 1); });
  }

  // Draw an axis-aligned polyline with rounded right-angle corners.
  const polyPath = (pts) => {
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
  };

  const edgeLabels = [];
  for (const route of routes) {
    const pts = route.pts ?? route.build();
    root.appendChild(svg('path', { d: polyPath(pts), class: 'diagram-edge', 'marker-end': 'url(#diag-arrow)' }));
    // Label on the final horizontal run into the consumer (sits in the gap).
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    edgeLabels.push({ x: (prev[0] + last[0]) / 2, y: last[1], edge: route.edge });
  }

  // Nodes.
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    const cls = n.isRaw ? 'diagram-node diagram-node--raw'
      : n.isOutput ? 'diagram-node diagram-node--output'
      : n.isSurplus ? 'diagram-node diagram-node--surplus'
      : n.isInput ? 'diagram-node diagram-node--input'
      : 'diagram-node';
    const g = svg('g', { class: cls, transform: `translate(${p.x} ${p.y})` });
    g.appendChild(svg('rect', { x: 0, y: 0, width: p.w, height: BOX_H, rx: 8, class: 'diagram-box' }));

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

  // Where a source fans out to 2+ consumers of the same item, estimate how many
  // of its machines feed each. Whole numbers via largest-remainder rounding so
  // the per-edge counts sum exactly to the source's machine count.
  const groups = new Map();
  for (const e of graph.edges) {
    const k = `${e.from}::${e.itemId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
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

  container.appendChild(root);
}
