// One-time build tool: vendor item + building icons into assets/icons/ so the
// site is self-contained (no runtime hotlink to satisfactorytools.com).
// Re-run after a dataset bump to pick up new/renamed slugs. Skips 404s and
// files already present. Run: node scripts/fetch-icons.mjs
import { loadDataset } from '../js/data/loader.js';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'icons');
const BASE = 'https://www.satisfactorytools.com/assets/images/items';

const ds = await loadDataset({ storage: { getItem: () => null, setItem: () => {} } });

// All item slugs (any item can be a target / flow / resource) + the slugs of
// buildings that actually produce a recipe (those are the ones the build
// table shows an icon for). This keeps the fetch targeted (~200), not ~700.
const slugs = new Set();
for (const it of ds.items.values()) if (it.slug) slugs.add(it.slug);
for (const bid of new Set(ds.recipes.map((r) => r.buildingId))) {
  const b = ds.buildings.get(bid);
  if (b?.slug) slugs.add(b.slug);
}
for (const g of ds.generators || []) if (g.slug) slugs.add(g.slug); // power generators
const list = [...slugs];
console.log(`Collected ${list.length} unique slugs.`);

await mkdir(OUT, { recursive: true });

let saved = 0;
let present = 0;
let notFound = 0;
let errored = 0;
let idx = 0;

async function worker() {
  while (idx < list.length) {
    const slug = list[idx++];
    const file = join(OUT, `${slug}_64.png`);
    try {
      await access(file);
      present++;
      continue;
    } catch {
      /* not yet downloaded */
    }
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(slug)}_64.png`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        notFound++;
        continue;
      }
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      saved++;
    } catch {
      errored++;
    }
  }
}

await Promise.all(Array.from({ length: 6 }, worker));
console.log(`Done: ${saved} saved, ${present} already present, ${notFound} not-found (404), ${errored} errored.`);
