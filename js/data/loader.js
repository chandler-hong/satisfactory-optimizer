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
    url = DATASET_URL,
    cacheKey = CACHE_KEY,
  } = deps;

  // Resolve storage safely: reading globalThis.localStorage can itself throw
  // (SecurityError) in sandboxed or storage-disabled browser contexts.
  let storage = deps.storage;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = undefined; }
  }

  if (storage) {
    let cached = null;
    try { cached = storage.getItem(cacheKey); } catch { /* read blocked: treat as no cache */ }
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
