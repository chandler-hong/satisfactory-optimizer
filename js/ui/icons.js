// Icons are vendored under assets/icons/ (see scripts/fetch-icons.mjs) so the
// site is fully self-contained — no runtime hotlink. Path is relative to the
// page (index.html lives at the site root).
const ICON_BASE = 'assets/icons';

const FALLBACK_EMOJI = { building: '⚙', fluid: '💧', item: '📦' };

/** Icon URL for an item/building slug (64px). Returns null for a falsy slug. */
export function iconUrl(slug) {
  return slug ? `${ICON_BASE}/${encodeURIComponent(slug)}_64.png` : null;
}

/**
 * Emoji stand-in for an icon that isn't there, sized by `.icon-fallback`.
 * @param {'building'|'fluid'|'item'} kind
 */
export function fallbackIcon(kind) {
  const span = document.createElement('span');
  span.className = 'icon-fallback';
  span.textContent = FALLBACK_EMOJI[kind] || FALLBACK_EMOJI.item;
  return span;
}

/**
 * `<img class="icon">` for `slug`, degrading to a `.icon-fallback` emoji when
 * there's no icon URL or the image fails to load. Never throws — a missing
 * icon never breaks a row.
 * @param {string|undefined} slug
 * @param {'building'|'fluid'|'item'} [kind]  picks the fallback emoji
 * @param {string} [alt]  alt text (set as a property, never parsed as HTML)
 */
export function iconEl(slug, kind = 'item', alt = '') {
  const url = iconUrl(slug);
  if (!url) return fallbackIcon(kind);
  const img = document.createElement('img');
  img.className = 'icon';
  img.loading = 'lazy';
  img.src = url;
  img.alt = alt;
  img.onerror = () => {
    img.replaceWith(fallbackIcon(kind));
  };
  return img;
}
