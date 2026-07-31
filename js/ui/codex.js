import { iconUrl } from './icons.js';
import { fmt1 } from './view-model.js';
import { buildCodexModel } from '../domain/codex.js';

const CODEX_STATE_KEY = 'sat-optimizer:codex:v1'; // last-viewed item (survives refresh)

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function fallbackIcon(kind) {
  const span = el('span', 'icon-fallback');
  span.textContent = kind === 'building' ? '⚙' : kind === 'fluid' ? '💧' : '📦';
  return span;
}

/** `<img class="icon">` for a slug, degrading to an emoji when it can't load. */
function icon(slug, kind) {
  const url = iconUrl(slug);
  if (!url) return fallbackIcon(kind);
  const img = el('img', 'icon');
  img.loading = 'lazy';
  img.src = url;
  img.alt = '';
  img.onerror = () => img.replaceWith(fallbackIcon(kind));
  return img;
}

const itemKind = (entry) => (entry.liquid ? 'fluid' : 'item');

/** Per-craft amount: "3× Iron Plate", or "3 m³ Crude Oil" for fluids. */
function amountLabel(io) {
  return io.liquid ? `${fmt1(io.amount)} m³ ${io.name}` : `${fmt1(io.amount)}× ${io.name}`;
}

/**
 * One ingredient/product chip. Chips for other items are buttons that jump to
 * that item's entry; the chip for the item being viewed is inert.
 */
function ioChip(io, currentItemId, onSelect) {
  const isSelf = io.itemId === currentItemId;
  const node = isSelf ? el('span', 'codex-io codex-io--self') : el('button', 'codex-io');
  if (!isSelf) {
    node.type = 'button';
    node.addEventListener('click', () => onSelect(io.itemId));
  }
  node.appendChild(icon(io.slug, itemKind(io)));
  const label = el('span');
  label.textContent = amountLabel(io);
  node.appendChild(label);
  return node;
}

/** A recipe as the game states it: ingredients → products, building, craft time. */
function recipeCard(recipe, currentItemId, onSelect) {
  const card = el('div', 'codex-recipe');

  const head = el('div', 'codex-recipe__head');
  const name = el('span', 'codex-recipe__name');
  name.textContent = recipe.name;
  head.appendChild(name);
  if (recipe.alternate) {
    const chip = el('span', 'chip codex-chip--alt');
    chip.textContent = 'Alternate';
    head.appendChild(chip);
  }
  if (recipe.unlock) {
    const chip = el('span', 'chip codex-chip--unlock');
    chip.textContent = recipe.unlock.label;
    head.appendChild(chip);
  }
  card.appendChild(head);

  const flow = el('div', 'codex-flow');
  for (const io of recipe.inputs) flow.appendChild(ioChip(io, currentItemId, onSelect));
  // Excited Photonic Matter (Converter) has no ingredients — only power.
  if (recipe.inputs.length > 0) {
    const arrow = el('span', 'codex-arrow');
    arrow.textContent = '→';
    flow.appendChild(arrow);
  }
  for (const io of recipe.outputs) flow.appendChild(ioChip(io, currentItemId, onSelect));
  card.appendChild(flow);

  const foot = el('div', 'codex-recipe__foot');
  foot.appendChild(icon(recipe.buildingSlug, 'building'));
  const meta = el('span');
  meta.textContent = `${recipe.buildingName} · ${fmt1(recipe.timeSec)}s`;
  foot.appendChild(meta);
  card.appendChild(foot);

  return card;
}

/**
 * Stack size / sink points / fuel energy, omitting what doesn't apply. Fluid
 * stackSize and sinkPoints in the dataset describe pipe buffers rather than real
 * stacks or sinkable items, so those two are solids-only.
 */
function statLine(item) {
  const parts = [];
  if (!item.liquid && item.stackSize > 0) parts.push(`Stack size ${item.stackSize}`);
  if (!item.liquid && item.sinkPoints > 0) parts.push(`${item.sinkPoints} sink points`);
  if (item.energyValue > 0) parts.push(`${fmt1(item.energyValue)} MJ${item.liquid ? '/m³' : ''}`);
  if (parts.length === 0) return null;
  const p = el('p', 'codex-stats');
  p.textContent = parts.join(' · ');
  return p;
}

function section(title) {
  const wrap = el('section', 'codex-section');
  const h = el('h3');
  h.textContent = title;
  wrap.appendChild(h);
  return wrap;
}

/** Rebuild the right-hand pane for `item`. All strings via textContent. */
function renderDetail(wrap, item, onSelect) {
  wrap.replaceChildren();

  const head = el('div', 'codex-detail__head');
  head.appendChild(icon(item.slug, itemKind(item)));
  const title = el('h2', 'codex-detail__name');
  title.textContent = item.name;
  head.appendChild(title);
  if (item.liquid) {
    const chip = el('span', 'chip');
    chip.textContent = 'Fluid';
    head.appendChild(chip);
  }
  if (item.raw) {
    const chip = el('span', 'chip');
    chip.textContent = 'Raw resource';
    head.appendChild(chip);
  }
  wrap.appendChild(head);

  if (item.description) {
    const desc = el('p', 'codex-desc');
    desc.textContent = item.description;
    wrap.appendChild(desc);
  }
  const stats = statLine(item);
  if (stats) wrap.appendChild(stats);

  const made = section('Made in');
  if (item.madeIn.length === 0) {
    const p = el('p', 'codex-empty');
    p.textContent = 'No machine recipe — made by hand, at the Equipment Workshop, or found in the world.';
    made.appendChild(p);
  } else {
    for (const r of item.madeIn) made.appendChild(recipeCard(r, item.id, onSelect));
  }
  wrap.appendChild(made);

  if (item.usedIn.length > 0) {
    const used = section('Used in');
    for (const r of item.usedIn) used.appendChild(recipeCard(r, item.id, onSelect));
    wrap.appendChild(used);
  }
}

function restoreSelection(items) {
  try {
    const saved = localStorage.getItem(CODEX_STATE_KEY);
    if (saved && items.some((i) => i.id === saved)) return saved;
  } catch {
    // Storage unavailable (sandboxed / disabled): fall through to the default.
  }
  return items[0].id;
}

function saveSelection(itemId) {
  try {
    localStorage.setItem(CODEX_STATE_KEY, itemId);
  } catch {
    // Storage unavailable: the selection just won't survive a refresh.
  }
}

/**
 * Build the standalone Codex reference into `container`: an alphabetical,
 * searchable item list on the left, and the selected item's entry on the right
 * (description, stats, the recipes that make it and the recipes that use it).
 * Ingredient/product chips cross-link to their own entries. Selection persists.
 */
export function buildCodex(dataset, container) {
  container.replaceChildren();
  const { items, byId } = buildCodexModel(dataset);
  if (items.length === 0) return;

  const panel = el('div', 'codex');
  container.appendChild(panel);

  const listPane = el('div', 'codex-list');
  const detailPane = el('div', 'codex-detail');
  panel.append(listPane, detailPane);

  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Search items…';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Search items');
  listPane.appendChild(search);

  const count = el('p', 'hint');
  listPane.appendChild(count);

  const listEl = el('div', 'codex-items');
  listPane.appendChild(listEl);

  const noMatches = el('p', 'search-empty');
  noMatches.textContent = 'No matches';
  noMatches.hidden = true;
  listPane.appendChild(noMatches);

  const rows = new Map();

  function select(itemId, { scroll = false } = {}) {
    const item = byId.get(itemId);
    if (!item) return;
    for (const [id, row] of rows) {
      const active = id === itemId;
      row.classList.toggle('is-selected', active);
      if (active) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
    renderDetail(detailPane, item, (id) => select(id, { scroll: true }));
    saveSelection(itemId);
    if (scroll) detailPane.scrollIntoView({ block: 'start' });
  }

  for (const item of items) {
    const row = el('button', 'codex-item');
    row.type = 'button';
    row.appendChild(icon(item.slug, itemKind(item)));
    const label = el('span');
    label.textContent = item.name;
    row.appendChild(label);
    row.addEventListener('click', () => select(item.id, { scroll: true }));
    rows.set(item.id, row);
    listEl.appendChild(row);
  }

  function filter() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const item of items) {
      const match = !q || item.name.toLowerCase().includes(q);
      rows.get(item.id).hidden = !match;
      if (match) shown += 1;
    }
    count.textContent = q
      ? `${shown} ${shown === 1 ? 'match' : 'matches'}`
      : `${items.length} items`;
    noMatches.hidden = shown > 0;
  }
  search.addEventListener('input', filter);

  filter();
  select(restoreSelection(items));
}
