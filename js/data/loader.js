import { DATASET_URL, CACHE_KEY } from './constants.js';
import { normalize } from './normalize.js';

/**
 * Load + normalize the dataset, preferring a localStorage cache.
 * Dependencies are injected so this runs in tests without network/browser.
 * @param {{fetchImpl?: typeof fetch, storage?: Storage, url?: string, cacheKey?: string}} [deps]
 * @returns {Promise<import('../domain/model.js').Dataset>}
 */
export async function loadDataset(deps = {}) {
  const {
    fetchImpl = fetch,
    storage = (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined),
    url = DATASET_URL,
    cacheKey = CACHE_KEY,
  } = deps;

  if (storage) {
    const cached = storage.getItem(cacheKey);
    if (cached) {
      try { return normalize(JSON.parse(cached)); } catch { /* corrupt cache: refetch */ }
    }
  }

  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  const text = await res.text();
  if (storage) {
    try { storage.setItem(cacheKey, text); } catch { /* over quota: skip cache */ }
  }
  return normalize(JSON.parse(text));
}
