import { html } from './html.js';

/** One line describing a member's track record, or '' when none is known. */
export function trackLine(t) {
  if (!t || !t.n) return '';
  const ex = (t.ex * 100).toFixed(1);
  return `${t.ex >= 0 ? '+' : ''}${ex}% vs the S&P 500 ${t.horizon || 90} days after their purchases · ${t.n} trades · ${Math.round(t.hit * 100)}% beat it`;
}

/** Compact chip: excess return and sample size, coloured by direction once the sample is meaningful. */
export function trackChip(t) {
  if (!t || !t.n) return '';
  const tone = t.n < 8 ? 'thin' : t.score >= 0.6 ? 'pos' : t.score <= 0.4 ? 'neg' : 'flat';
  return html`<span class="trk" data-tone="${tone}" data-tip="${trackLine(t)}${t.n < 8 ? ' (small sample)' : ''}">${t.ex >= 0 ? '▲' : '▼'} ${(Math.abs(t.ex) * 100).toFixed(1)}% · ${t.n}</span>`;
}

export function trackOf(st, bioguide) {
  const T = st.cloud && st.cloud.track && st.cloud.track.members;
  return (T && bioguide && T[bioguide]) || null;
}
