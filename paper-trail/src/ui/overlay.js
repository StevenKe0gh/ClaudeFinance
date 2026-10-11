import { html, mount, $, on } from './html.js';
import { ICON } from './icons.js';

/* ---------- Tooltip: any element with data-tip ---------- */
export function installTooltips() {
  const tip = $('#tip');
  let pinned = null;
  const show = (text, x, y) => {
    tip.textContent = text;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top + h > innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  };
  const hide = () => { tip.hidden = true; pinned = null; };
  document.addEventListener('pointermove', ev => {
    if (pinned) return;
    const t = ev.target.closest && ev.target.closest('[data-tip]');
    if (t) show(t.getAttribute('data-tip'), ev.clientX, ev.clientY); else hide();
  });
  document.addEventListener('pointerdown', ev => {
    const t = ev.target.closest && ev.target.closest('[data-tip]');
    if (t && ev.pointerType === 'touch') { pinned = t; show(t.getAttribute('data-tip'), ev.clientX, ev.clientY); }
    else if (!t) hide();
  });
  document.addEventListener('scroll', hide, { capture: true, passive: true });
  return { show, hide };
}

/* ---------- Toasts ---------- */
export function toast(message, tone = 'info', ms = 3200) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = tone;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ---------- Layered overlays (palette, drawer, modal) with Esc handling ---------- */
const stack = [];
function push(node, onClose) {
  const host = $('#overlays');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  host.append(scrim, node);
  const entry = { node, scrim, onClose, prevFocus: document.activeElement };
  stack.push(entry);
  scrim.addEventListener('click', () => close(entry));
  return entry;
}
function close(entry) {
  const i = stack.indexOf(entry);
  if (i < 0) return;
  stack.splice(i, 1);
  entry.node.remove();
  entry.scrim.remove();
  entry.onClose && entry.onClose();
  entry.prevFocus && entry.prevFocus.focus && entry.prevFocus.focus();
}
export const closeTop = () => { if (stack.length) { close(stack[stack.length - 1]); return true; } return false; };
export const overlayOpen = () => stack.length > 0;

export function openDrawer({ title, src = '', render, onClose }) {
  const node = document.createElement('aside');
  node.className = 'drawer';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', title);
  mount(node, html`<div class="panel-h"><h2>${title}</h2><span class="src">${src}</span><span class="grow"></span><button class="btn ghost sm" type="button" data-close aria-label="Close">${ICON.close}</button></div><div class="body"></div>`);
  const entry = push(node, onClose);
  node.querySelector('[data-close]').addEventListener('click', () => close(entry));
  render(node.querySelector('.body'), () => close(entry));
  node.querySelector('[data-close]').focus();
  return () => close(entry);
}

export function openModal({ title, content }) {
  const node = document.createElement('div');
  node.className = 'modal';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', title);
  mount(node, html`<div class="panel-h"><h2>${title}</h2><span class="grow"></span><button class="btn ghost sm" type="button" data-close aria-label="Close">${ICON.close}</button></div>${content}`);
  const entry = push(node);
  node.querySelector('[data-close]').addEventListener('click', () => close(entry));
  node.querySelector('[data-close]').focus();
  return () => close(entry);
}

/**
 * Command palette. `source()` returns [{kind, label, hint, run}] and is
 * re-queried on open so it always reflects current data.
 */
export function openPalette(source) {
  const node = document.createElement('div');
  node.className = 'palette';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', 'Command palette');
  mount(node, html`<input id="cmdk-q" type="text" placeholder="Jump to a ticker, member, insider or command" autocomplete="off" spellcheck="false" aria-label="Search"><ul role="listbox" id="cmdk-list"></ul><div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>`);
  const entry = push(node);
  const input = node.querySelector('input');
  const list = node.querySelector('ul');
  const all = source();
  let items = [];
  let sel = 0;
  const score = (item, q) => {
    const l = item.label.toLowerCase();
    if (!q) return item.rank ?? 1;
    if (l === q) return 100;
    if (l.startsWith(q)) return 60 - l.length * 0.01;
    const i = l.indexOf(q);
    if (i >= 0) return 30 - i * 0.1;
    const h = (item.hint || '').toLowerCase().indexOf(q);
    return h >= 0 ? 10 : -1;
  };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    items = all.map(it => ({ it, s: score(it, q) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.it);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    mount(list, items.length
      ? html`${items.map((it, i) => html`<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="k">${it.kind}</span><span class="m">${it.label}</span><span class="h">${it.hint || ''}</span></li>`)}`
      : html`<li aria-disabled="true"><span class="m muted">No matches</span></li>`);
    const cur = list.querySelector('[aria-selected="true"]');
    cur && cur.scrollIntoView({ block: 'nearest' });
  };
  const run = i => { const it = items[i]; if (!it) return; close(entry); it.run(); };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { run(sel); ev.preventDefault(); }
  });
  on(list, 'click', 'li[data-i]', (_, t) => run(+t.dataset.i));
  draw();
  input.focus();
}
