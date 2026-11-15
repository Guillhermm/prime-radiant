import { validateBbox } from './state.js';

// Name suggestions for the area form, from places.json (docs/data.md). Matching ignores case
// and accents, on the name and every alternate name.

export const SUGGEST_LIMIT = 8;
const KIND_ORDER = { region: 0, state: 1, country: 2 };
const KIND_LABEL = { region: 'Region', state: 'State or province', country: 'Country' };
const RANK = { exact: 0, prefix: 1, word: 2 };

/** Lowercase without diacritics: "São Paulo" -> "sao paulo". */
export const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const WORD_EDGE = /[^\p{L}\p{N}]/u;

/** How `key` (folded) matches `q` (folded): 'exact', 'prefix', 'word' (a later word starts with it) or null. */
export const matchKind = (key, q) => {
  if (!q) return null;
  if (key === q) return 'exact';
  if (key.startsWith(q)) return 'prefix';
  for (let i = key.indexOf(q, 1); i > 0; i = key.indexOf(q, i + 1)) {
    if (WORD_EDGE.test(key[i - 1])) return 'word';
  }
  return null;
};

/**
 * The searchable entries of a places file already checked with core's validatePlaces: each keeps
 * its folded keys, and entries whose bbox the app could not apply (west not below east) are left out.
 */
export const indexPlaces = (places) => (places?.entries ?? [])
  .filter((e) => validateBbox(e.bbox) === null)
  .map((e) => ({ ...e, keys: [e.name, ...(e.alt ?? [])].map(fold) }));

/**
 * Up to `limit` entries matching `query`, best first: exact, then prefix, then word start (the best
 * of the name and its alternates), ties broken by kind (region, state, country) and then by name.
 */
export const matchPlaces = (index, query, { limit = SUGGEST_LIMIT } = {}) => {
  const q = fold(query).trim();
  if (!q) return [];
  const hits = [];
  for (const e of index) {
    let best = Infinity;
    for (const k of e.keys) {
      const m = matchKind(k, q);
      if (m) best = Math.min(best, RANK[m]);
    }
    if (best !== Infinity) hits.push({ e, best });
  }
  hits.sort((a, b) => a.best - b.best || KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] || a.e.name.localeCompare(b.e.name, 'en'));
  return hits.slice(0, limit).map((x) => x.e);
};

/** The option's second line: "State or province · Brazil", or the kind alone. */
export const placeSub = (e) => (e.country && e.country !== e.name ? `${KIND_LABEL[e.kind]} · ${e.country}` : KIND_LABEL[e.kind]);
