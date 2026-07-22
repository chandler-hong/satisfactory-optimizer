// Pinned community dataset (greeny/SatisfactoryTools) via jsDelivr.
// Pinned to a commit for reproducibility; bump deliberately.
export const DATASET_COMMIT = '2bd164690a29136365fcfda6f9adcaaf2d6de214';
export const DATASET_URL =
  `https://cdn.jsdelivr.net/gh/greeny/SatisfactoryTools@${DATASET_COMMIT}/data/data.json`;
// localStorage cache key; embeds the commit so a bump invalidates old cache.
export const CACHE_KEY = `sat-optimizer:dataset:${DATASET_COMMIT}`;
