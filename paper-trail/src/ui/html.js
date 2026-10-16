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

/** Replace an element's content outright. Use for one-off content that wires its own listeners. */
export function mount(el, content) {
  el.innerHTML = String(content);
  return el;
}

/**
 * Update an element's content to match new markup, reusing the nodes that
 * did not change. Unlike `mount`, what the viewer was doing survives a
 * redraw: an opened <details>, focus and caret in a field, scroll inside a
 * table. Elements match by tag and `id` / `data-key`. Listeners added
 * directly to nodes inside are kept on reused nodes, so content that wires
 * its own listeners after rendering must use `mount`; delegated `on()`
 * handlers work with both.
 */
export function patch(el, content) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(content);
  morphChildren(el, tpl.content);
  return el;
}

const keyOf = n => (n.nodeType === 1 ? n.id || n.getAttribute('data-key') || null : null);
const sameNode = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);

function morphChildren(from, to) {
  let a = from.firstChild;
  let b = to.firstChild;
  while (b) {
    const nextB = b.nextSibling;
    if (a && sameNode(a, b)) {
      morphNode(a, b);
      a = a.nextSibling;
    } else {
      const k = keyOf(b);
      let found = null;
      if (k) for (let c = a; c; c = c.nextSibling) if (sameNode(c, b)) { found = c; break; }
      if (found) { from.insertBefore(found, a); morphNode(found, b); }
      else from.insertBefore(b, a);
    }
    b = nextB;
  }
  while (a) { const n = a.nextSibling; from.removeChild(a); a = n; }
}

function morphNode(a, b) {
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  const tag = a.nodeName;
  for (const at of b.attributes) {
    if (a.getAttribute(at.name) === at.value) continue;
    if (at.namespaceURI) a.setAttributeNS(at.namespaceURI, at.name, at.value);
    else a.setAttribute(at.name, at.value);
  }
  // A <details> the viewer opened stays open; one the markup opens still opens.
  for (const at of [...a.attributes]) if (!b.hasAttribute(at.name) && !(tag === 'DETAILS' && at.name === 'open')) a.removeAttribute(at.name);
  const focused = a === document.activeElement;
  if (tag === 'TEXTAREA') {
    if (!focused && a.value !== b.value) a.value = b.value;
    return;
  }
  if (tag === 'INPUT') {
    if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
    else if (!focused && a.value !== (b.getAttribute('value') ?? '')) a.value = b.getAttribute('value') ?? '';
    return;
  }
  const want = tag === 'SELECT' ? [...b.querySelectorAll('option')].findIndex(o => o.hasAttribute('selected')) : -1;
  morphChildren(a, b);
  if (want >= 0 && !focused) a.selectedIndex = want;
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
