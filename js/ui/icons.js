const ICON_BASE = 'https://www.satisfactorytools.com/assets/images/items';

/** Icon URL for an item/building slug (64px). Returns null for a falsy slug. */
export function iconUrl(slug) {
  return slug ? `${ICON_BASE}/${encodeURIComponent(slug)}_64.png` : null;
}
