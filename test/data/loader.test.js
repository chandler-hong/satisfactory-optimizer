import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset } from '../../js/data/loader.js';
import { miniRaw } from '../fixtures/mini-data.js';

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}

test('fetches, normalizes, and caches raw text', async () => {
  const storage = fakeStorage();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => JSON.stringify(miniRaw) };
  };
  const ds = await loadDataset({ fetchImpl, storage, url: 'x', cacheKey: 'k' });
  assert.equal(ds.items.get('Desc_IronIngot_C').name, 'Iron Ingot');
  assert.equal(calls, 1);
  assert.ok(storage.getItem('k'));
});

test('uses cache on second load (no fetch)', async () => {
  const storage = fakeStorage({ k: JSON.stringify(miniRaw) });
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('should not fetch'); };
  const ds = await loadDataset({ fetchImpl, storage, url: 'x', cacheKey: 'k' });
  assert.equal(calls, 0);
  assert.equal(ds.recipes.length, 2);
});

test('throws on non-ok response', async () => {
  const storage = fakeStorage();
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' });
  await assert.rejects(() => loadDataset({ fetchImpl, storage, url: 'x', cacheKey: 'k' }));
});

test('refetches when the cached value is not valid JSON', async () => {
  const storage = fakeStorage({ k: '{not valid json' });
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => JSON.stringify(miniRaw) };
  };
  const ds = await loadDataset({ fetchImpl, storage, url: 'x', cacheKey: 'k' });
  assert.equal(calls, 1);              // corrupt cache -> fell through to network
  assert.equal(ds.recipes.length, 2); // valid Dataset returned
});

test('resolves even if writing the cache throws (quota exceeded)', async () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(miniRaw) });
  const ds = await loadDataset({ fetchImpl, storage, url: 'x', cacheKey: 'k' });
  assert.equal(ds.items.get('Desc_IronIngot_C').name, 'Iron Ingot');
});
