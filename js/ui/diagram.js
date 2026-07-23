import { iconUrl } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const ROW_H = 78; // vertical pitch between rows in a column
const BOX_H = 52;
const COL_GAP = 60; // horizontal gap between columns
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
  return n.isRaw || n.isOutput || n.isSurplus ? n.name : n.recipeName;
}
function subOf(n) {
  if (n.isRaw) return 'raw resource';
  if (n.isOutput) return `output · ${rateStr(n.rate, n.fluid)}`;
  if (n.isSurplus) return `surplus · ${rateStr(n.rate, n.fluid)}`;
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
        pos.set(id, { dummy: true, cx: colX[t] + colWidth[t] / 2, cy });
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

  // Edges first (under the boxes).
  for (const chain of chains) {
    const pts = chain.ids.map((id, i) => {
      const p = pos.get(id);
      if (p.dummy) return [p.cx, p.cy];
      if (i === 0) return [p.right, p.cy];
      return [p.left, p.cy];
    });
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
    }
    root.appendChild(svg('path', { d, class: 'diagram-edge', 'marker-end': 'url(#diag-arrow)' }));
  }

  // Nodes.
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    const cls = n.isRaw ? 'diagram-node diagram-node--raw'
      : n.isOutput ? 'diagram-node diagram-node--output'
      : n.isSurplus ? 'diagram-node diagram-node--surplus'
      : 'diagram-node';
    const g = svg('g', { class: cls, transform: `translate(${p.x} ${p.y})` });
    g.appendChild(svg('rect', { x: 0, y: 0, width: p.w, height: BOX_H, rx: 8, class: 'diagram-box' }));

    const url = iconUrl(n.isRaw || n.isOutput || n.isSurplus ? n.slug : n.buildingSlug);
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

  container.appendChild(root);
}
