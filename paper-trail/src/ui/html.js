/**
 * Escaping HTML templates. Every interpolated value is escaped unless it is
 * a Raw (produced by `html` itself or `raw()`), so filing data such as
 * insider names can never inject markup.
 *
 *   el.innerHTML = html`<b>${name}</b>${raw(svg)}`;
 */
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const raw = s => new Raw(String(s ?? ''));

function part(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

export function mount(el, content) {
  el.innerHTML = String(content);
  return el;
}

/** Event delegation: on(root, 'click', '[data-act]', (ev, target) => …). */
export function on(root, type, selector, fn, opts) {
  const h = ev => {
    const t = ev.target.closest && ev.target.closest(selector);
    if (t && root.contains(t)) fn(ev, t);
  };
  root.addEventListener(type, h, opts);
  return () => root.removeEventListener(type, h, opts);
}

/** Tiny Markdown subset for Claude output: headings, bullets, bold, italics, paragraphs. */
export function markdown(src) {
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  let out = '';
  let list = false;
  const close = () => { if (list) { out += '</ul>'; list = false; } };
  for (const line of String(src).split(/\r?\n/)) {
    const l = line.trim();
    if (/^#{1,6}\s/.test(l)) { close(); out += `<h4>${inline(l.replace(/^#+\s*/, ''))}</h4>`; continue; }
    if (/^([-*•]|\d+[.)])\s+/.test(l)) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(l.replace(/^([-*•]|\d+[.)])\s+/, ''))}</li>`; continue; }
    if (!l) { close(); continue; }
    close();
    out += `<p>${inline(l)}</p>`;
  }
  close();
  return raw(out);
}
