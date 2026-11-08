// Tiny DOM helpers. Text always goes in as text (never as HTML), so customer data can't inject anything.
export function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}
function add(el, kids) { for (const k of kids.flat(Infinity)) { if (k === null || k === undefined || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); } }
// replaceChildren that skips null/false (so a missing optional piece never shows the word "null")
export function put(el, ...kids) { if (!el) return; const box = document.createDocumentFragment(); add(box, kids); el.replaceChildren(box); }
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0Fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const usd = v => usdFmt.format(Number(v) || 0);
export const usd0 = v => usd0Fmt.format(Math.round(Number(v) || 0));
export const num = (v, d = 0) => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const dateStr = d => { if (!d) return ''; const x = new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00' : d); return isNaN(x) ? '' : x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
export const localDay = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const longDate = d => new Date(d || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

let toastTimer;
export function toast(msg, kind = 'ok', action) {
  let t = $('#toast'); if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg; t.className = 'toast show ' + kind;
  if (action?.label && action.run) t.append(' ', h('button.toast-act', { type: 'button', onclick: () => { t.className = 'toast ' + kind; action.run(); } }, action.label));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = 'toast ' + kind, action ? 6000 : kind === 'bad' ? 5000 : 2600);
}

// value() returning false keeps the window open; a plain button returns its result as-is (Cancel → null/false)
export function modal(title, body, actions = []) {
  return new Promise(resolve => {
    const close = v => { wrap.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = e => { if (e.key === 'Escape') close(null); };
    const dlg = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-head', h('h2', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, '✕')),
      h('div.sheet-body', body),
      actions.length ? h('div.sheet-actions', actions.map(a => h('button', { type: 'button', class: 'btn ' + (a.kind || ''), onclick: async () => { if (a.value) { const v = await a.value(); if (v === false) return; close(v ?? true); } else close('result' in a ? a.result : true); } }, a.label))) : null);
    const wrap = h('div.scrim', { onclick: e => { if (e.target === wrap) close(null); } }, dlg);
    document.body.append(wrap); document.addEventListener('keydown', esc);
    setTimeout(() => (dlg.querySelector('input,select,textarea') || dlg.querySelector('.sheet-actions .btn'))?.focus(), 30);
  });
}
export const confirmBox = (title, text, yes = 'Delete', kind = 'danger') => modal(title, h('p', text), [{ label: 'Cancel', result: false }, { label: yes, kind, result: true }]);

// labeled input; returns the wrapper, the <input> is .input
export function field(label, opts = {}) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  const tag = opts.type === 'select' ? 'select' : opts.type === 'textarea' ? 'textarea' : 'input';
  const input = h(tag, { id, name: opts.name, type: tag === 'input' ? (opts.type || 'text') : undefined, placeholder: opts.placeholder, inputmode: opts.inputmode || (opts.type === 'number' ? 'decimal' : undefined), step: opts.step || (opts.type === 'number' ? 'any' : undefined), min: opts.min, autocomplete: opts.autocomplete, required: opts.required, rows: opts.rows });
  if (tag === 'select') for (const o of opts.options || []) input.append(h('option', { value: o.value ?? o }, o.label ?? o));
  if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
  if (opts.oninput) input.addEventListener('input', opts.oninput);
  if (opts.onchange) input.addEventListener('change', opts.onchange);
  const wrap = h('label.field', { for: id, class: opts.class }, h('span.field-label', label), opts.suffix ? h('span.field-row', input, h('span.suffix', opts.suffix)) : input, opts.help ? h('span.help', opts.help) : null);
  wrap.input = input; return wrap;
}
export function toggle(label, checked, onchange, help) {
  const id = 't' + Math.random().toString(36).slice(2, 8);
  const input = h('input', { id, type: 'checkbox', role: 'switch', checked: !!checked, onchange: e => onchange(e.target.checked) });
  const w = h('label.toggle', { for: id }, input, h('span.track', h('span.knob')), h('span.toggle-text', h('span', label), help ? h('small', help) : null));
  w.input = input; return w;
}
export function busy(btn, on, text) { if (!btn) return; if (on) { btn.dataset.label = btn.textContent; btn.textContent = text || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; } }
export function download(name, text, type = 'text/plain') { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
export function debounce(fn, ms = 400) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); return fn(...a); }; return d; }
