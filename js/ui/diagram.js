import { iconUrl } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const COL_W = 210;
const ROW_H = 72;
const BOX_W = 168;
const BOX_H = 50;
const MARGIN = 16;

function svg(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function trunc(s, n) {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '';
}

/**
 * Render a tiered flow diagram of `graph` (from computePlan) into `container`
 * as SVG: raw sources + recipe boxes in columns by tier, connected by
 * producer→consumer flow edges. Rough layout — cubic edges, no overlap
 * avoidance. Icons via <image>; a missing icon just leaves the box text.
 * @param {HTMLElement} container
 * @param {{nodes:object[], edges:object[], tiers:number}} graph
 */
export function renderDiagram(container, graph) {
  container.replaceChildren();
  if (!graph || !graph.nodes || graph.nodes.length === 0) return;

  const tiers = new Map();
  for (const n of graph.nodes) {
    if (!tiers.has(n.tier)) tiers.set(n.tier, []);
    tiers.get(n.tier).push(n);
  }
  const pos = new Map();
  let maxRows = 1;
  for (const [tier, list] of tiers) {
    maxRows = Math.max(maxRows, list.length);
    list.forEach((n, i) => pos.set(n.id, { x: MARGIN + tier * COL_W, y: MARGIN + i * ROW_H }));
  }
  const width = MARGIN * 2 + graph.tiers * COL_W;
  const height = MARGIN * 2 + maxRows * ROW_H;

  const root = svg('svg', { class: 'diagram', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Factory flow diagram' });

  const defs = svg('defs', {});
  const marker = svg('marker', { id: 'diag-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  marker.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'diagram-arrow' }));
  defs.appendChild(marker);
  root.appendChild(defs);

  for (const e of graph.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + BOX_W;
    const y1 = a.y + BOX_H / 2;
    const x2 = b.x;
    const y2 = b.y + BOX_H / 2;
    const mx = (x1 + x2) / 2;
    root.appendChild(svg('path', {
      d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
      class: 'diagram-edge',
      'marker-end': 'url(#diag-arrow)',
    }));
  }

  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    const g = svg('g', { class: n.isRaw ? 'diagram-node diagram-node--raw' : 'diagram-node', transform: `translate(${p.x} ${p.y})` });
    g.appendChild(svg('rect', { x: 0, y: 0, width: BOX_W, height: BOX_H, rx: 8, class: 'diagram-box' }));

    const url = iconUrl(n.isRaw ? n.slug : n.buildingSlug);
    let textX = 12;
    if (url) {
      g.appendChild(svg('image', { x: 8, y: (BOX_H - 26) / 2, width: 26, height: 26, href: url, class: 'diagram-icon' }));
      textX = 42;
    }

    const title = svg('text', { x: textX, y: 20, class: 'diagram-title' });
    title.textContent = trunc(n.isRaw ? n.name : n.recipeName, 18);
    g.appendChild(title);

    const sub = svg('text', { x: textX, y: 37, class: 'diagram-sub' });
    sub.textContent = n.isRaw ? 'raw resource' : `${trunc(n.buildingName, 14)} ×${n.machines}`;
    g.appendChild(sub);

    root.appendChild(g);
  }

  container.appendChild(root);
}
