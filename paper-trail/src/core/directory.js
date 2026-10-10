import DIR from '../data/directory.json' with { type: 'json' };

/** Company directory for US listings, built by scripts/build-directory.mjs. */
export const directory = DIR;

export function companyOf(ticker) {
  const r = DIR.t[ticker];
  if (!r) return null;
  return { name: r[0], sector: DIR.sectors[r[1]] || '', country: DIR.countries[r[2]] || '' };
}
