// Icons are vendored under assets/icons/ (see scripts/fetch-icons.mjs) so the
// site is fully self-contained — no runtime hotlink. Path is relative to the
// page (index.html lives at the site root).
const ICON_BASE = 'assets/icons';

/** Icon URL for an item/building slug (64px). Returns null for a falsy slug. */
export function iconUrl(slug) {
  return slug ? `${ICON_BASE}/${encodeURIComponent(slug)}_64.png` : null;
}
