import { html, raw } from './html.js';
import { companyOf } from '../core/directory.js';
import { shortCompany, hueOf, monogram } from '../core/names.js';

/**
 * Company identity: logo (or a monogram tile when no logo is stored) and
 * the company name first, ticker second. Logos arrive from the database
 * (logos/p<N>) and are set here once loaded.
 */
let LOGOS = {};
export function setLogos(map) { LOGOS = map || {}; }
export const hasLogo = key => !!LOGOS[key];
export const logoSrc = key => (key && LOGOS[key]) || null;

/** Best display name: directory → given name → ticker. */
export function nameOf(ticker, fallback = '') {
  return (ticker && companyOf(ticker)?.name) || shortCompany(fallback) || ticker || '';
}
export function sectorOf(ticker) { return (ticker && companyOf(ticker)?.sector) || ''; }

export function logo(key, name, size = 22) {
  const src = key && LOGOS[key];
  if (src) return raw(`<img class="logo" src="${src}" width="${size}" height="${size}" alt="" style="--s:${size}px">`);
  const h = hueOf(name || key || '?');
  return raw(`<span class="logo mono" aria-hidden="true" style="--s:${size}px;--h:${h}">${monogram(name, key).replace(/[<&>]/g, '')}</span>`);
}

/**
 * Logo + name (+ ticker line). `open` makes the name open the dossier.
 * @param {string} ticker
 * @param {{name?:string, size?:number, sub?:string|null, open?:boolean, logoKey?:string}} o
 */
export function brand(ticker, o = {}) {
  const name = o.name || nameOf(ticker);
  const size = o.size || 22;
  const sub = o.sub === undefined ? [ticker, sectorOf(ticker)].filter(Boolean).join(' · ') : o.sub;
  const label = o.open !== false && ticker
    ? html`<button class="nm" type="button" data-open="${ticker}" title="${name}">${name}</button>`
    : html`<span class="nm" title="${name}">${name}</span>`;
  return html`<span class="brand">${logo(o.logoKey || ticker, name, size)}<span class="bn">${label}${sub ? html`<span class="bs">${sub}</span>` : ''}</span></span>`;
}

/** Large header identity for dossiers and the inspector. */
export function brandHead(ticker, o = {}) {
  const name = o.name || nameOf(ticker);
  const meta = [ticker, sectorOf(ticker), companyOf(ticker)?.country].filter(Boolean).join(' · ');
  return html`<div class="brand-head">${logo(o.logoKey || ticker, name, o.size || 44)}<div class="bh"><h1 title="${name}">${name}</h1><span class="bs">${meta}</span></div></div>`;
}
