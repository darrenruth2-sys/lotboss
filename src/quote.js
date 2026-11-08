// The customer-facing quote. Never shows your costs, wages or profit.
import { payInfo } from './books.js';
import { h, usd, num, longDate } from './ui.js';

export const DEFAULT_TERMS = [
  'Price good for 30 days.',
  'Payment due when the work is finished unless agreed otherwise in writing.',
  'Lot must be empty of vehicles during the work. Moving cars or towing is the owner\'s responsibility.',
  'Sealcoat needs 24 hours before traffic. Rain or temperatures under 50°F may move the date.',
  'Existing cracks, oil spots and pavement failures can show through new sealer; crack filling does not stop new cracks from forming.'
].join('\n');

export function scopeOfWork(est) {
  const s = [];
  if (est.seal) s.push(`Clean the pavement with power blowers and brooms, edge along curbs, and apply ${est.seal.coats} coat${est.seal.coats > 1 ? 's' : ''} of commercial-grade pavement sealer to about ${num(est.seal.sqft)} sq ft.`);
  if (est.crack) s.push(`Clean out and fill about ${num(est.crack.lf)} linear ft of cracks with hot-applied rubberized crack filler.`);
  if (est.stripe) {
    const st = est.stripe; const parts = [];
    if (st.stalls) parts.push(`${st.stalls} parking stalls`);
    if (st.ada.accessible) parts.push(`${st.ada.accessible} accessible space${st.ada.accessible > 1 ? 's' : ''} (${st.ada.van} van) with access aisles`);
    if (st.lf.stopBars) parts.push('stop bars');
    if (st.lf.hash) parts.push('hash (no-parking) areas');
    if (st.lf.curb) parts.push('curb painting');
    s.push(`Stripe ${parts.length ? parts.join(', ') : 'lines'} with traffic paint, about ${num(st.lf.total)} linear ft total.`);
    if (st.stencils.length) s.push('Paint stencils: ' + st.stencils.map(x => `${x.label} × ${x.qty}`).join(', ') + '.');
    if (st.signs) s.push(`Install ${st.signs} accessible-parking sign${st.signs > 1 ? 's' : ''} on posts.`);
    if (st.wheelStops) s.push(`Install ${st.wheelStops} wheel stop${st.wheelStops > 1 ? 's' : ''}.`);
  }
  return s;
}

// Everything the customer is allowed to see, frozen at the moment the quote is saved.
export function buildPublic({ company, job, est, options, recommended }) {
  const c = company || {}; const cust = job.customer || {};
  const terms = (c.settings?.terms || DEFAULT_TERMS).split('\n').map(t => t.trim()).filter(Boolean);
  const pub = {
    title: job.title || '', address: job.address || '',
    customer: { name: cust.name || '', company: cust.company || '', phone: cust.phone || '', email: cust.email || '' },
    scope: scopeOfWork(est), lines: est.lines.map(l => ({ label: l.label, amount: l.amount })),
    subtotal: est.subtotal, tax: est.tax, total: est.total, terms
  };
  if (options && options.length > 1) {
    pub.options = options.map(o => ({ name: o.pkg.name || 'Option', note: o.pkg.note || '', includes: o.includes, scope: scopeOfWork(o.est), lines: o.est.lines.map(l => ({ label: l.label, amount: l.amount })), subtotal: o.est.subtotal, tax: o.est.tax, total: o.est.total }));
    pub.recommended = Number.isInteger(recommended) && recommended >= 0 && recommended < options.length ? recommended : Math.min(1, options.length - 1);
  }
  return pub;
}

// One layout for your preview, the printout, and the customer's link.
// meta: { number, date, expires, status }   pick: { selected, onSelect } turns options into choices (customer page)
export function renderQuote(pub, company, meta = {}, pick = null) {
  const c = company || {}; const cust = pub.customer || {}; const opts = Array.isArray(pub.options) ? pub.options : [];
  const choose = pick && opts.length;
  const optCards = opts.length ? h('section.q-options', h('h3', choose ? 'Pick your option' : 'Your options'),
    h('div.q-opt-grid', { role: choose ? 'radiogroup' : null, 'aria-label': choose ? 'Options' : null }, opts.map((o, i) => {
      const card = h(choose ? 'button.q-opt' : 'div.q-opt', { type: choose ? 'button' : null, role: choose ? 'radio' : null, 'aria-checked': choose ? String(pick.selected === i) : null, class: [i === pub.recommended ? 'rec' : '', choose && pick.selected === i ? 'picked' : ''].join(' '), onclick: choose ? () => pick.onSelect(i) : null },
        i === pub.recommended ? h('span.q-rec', 'Recommended') : null,
        h('span.q-opt-name', o.name), h('span.q-opt-price', usd(o.total)), o.note ? h('span.q-opt-note', o.note) : null,
        h('ul', (o.includes || []).map(t => h('li', t))));
      return card;
    }))) : null;
  return h('article.quote',
    h('header.q-head',
      h('div.q-brand', c.logo ? h('img.q-logo', { src: c.logo, alt: '' }) : null, h('div', h('h1.q-company', c.name || 'Your company'), h('p.q-contact', [c.address, c.phone, c.email, c.website].filter(Boolean).join('  |  ')))),
      h('div.q-meta', h('p.q-title', 'Quote'), h('p', meta.number ? `No. ${meta.number}` : 'Draft'), h('p', longDate(meta.date)), meta.expires ? h('p', `Good until ${longDate(meta.expires)}`) : null)),
    h('section.q-parties',
      h('div', h('h3', 'Prepared for'), h('p', cust.name || '—'), cust.company ? h('p', cust.company) : null, cust.phone ? h('p', cust.phone) : null, cust.email ? h('p', cust.email) : null),
      h('div', h('h3', 'Job site'), h('p', pub.title || ''), h('p', pub.address || ''))),
    optCards,
    opts.length ? null : h('section.q-scope', h('h3', 'Scope of work'), h('ul', (pub.scope || []).map(t => h('li', t)))),
    opts.length ? null : h('table.q-lines', h('thead', h('tr', h('th', 'Description'), h('th.num', 'Amount'))),
      h('tbody', (pub.lines || []).map(l => h('tr', h('td', l.label), h('td.num', usd(l.amount))))),
      h('tfoot',
        pub.tax ? h('tr', h('td', 'Subtotal'), h('td.num', usd(pub.subtotal))) : null,
        pub.tax ? h('tr', h('td', 'Sales tax'), h('td.num', usd(pub.tax))) : null,
        h('tr.q-total', h('td', 'Total'), h('td.num', usd(pub.total))))),
    opts.length ? h('details.q-detail', h('summary', 'Line-by-line pricing for each option'), opts.map(o => h('div', h('h4', `${o.name}: ${usd(o.total)}`), h('ul', (o.scope || []).map(t => h('li', t))), h('table.q-lines', h('tbody', (o.lines || []).map(l => h('tr', h('td', l.label), h('td.num', usd(l.amount))))))))) : null,
    h('section.q-terms', h('h3', 'Terms'), h('ul', (pub.terms || []).map(t => h('li', t)))),
    pick ? null : h('section.q-sign', h('div', h('span.line'), h('span', 'Accepted by (signature)')), h('div', h('span.line'), h('span', 'Date'))));
}

// older saved quotes (before 1.3) kept { est, job }
export function quoteDoc({ company, job, est, number, date, options, recommended, expires }) {
  return renderQuote(buildPublic({ company, job, est, options, recommended }), company, { number, date, expires });
}

// plain-text version for email/text
export function quoteText({ company, job, est, number, link, options }) {
  if (options && options.length > 1) {
    const out = [`Quote ${number ? 'No. ' + number + ' ' : ''}from ${company?.name || ''}`, `${job.title || ''}${job.address ? ', ' + job.address : ''}`, '', 'Your options:', ...options.map(o => `- ${o.pkg.name}: ${usd(o.est.total)} (${o.includes.join(', ')})`), '', link ? `See the details, pick one and sign here: ${link}` : '', company?.phone ? `Questions? Call ${company.phone}` : ''];
    return out.filter(Boolean).join('\n');
  }
  const lines = [`Quote ${number ? 'No. ' + number : ''} from ${company?.name || ''}`.trim(), `${job.title || ''}${job.address ? ', ' + job.address : ''}`, '', ...scopeOfWork(est).map(s => '- ' + s), '', ...est.lines.map(l => `${l.label}: ${usd(l.amount)}`), est.tax ? `Sales tax: ${usd(est.tax)}` : '', `Total: ${usd(est.total)}`, '', link ? `View and sign here: ${link}` : '', company?.phone ? `Questions? Call ${company.phone}` : ''];
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n').trim();
}

// calendar file (.ics) for one or more scheduled jobs
export function ics(jobs, companyName = 'LotBoss') {
  const esc = s => String(s || '').replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const d = s => s.replace(/-/g, '');
  const addDays = (s, n) => { const x = new Date(s + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LotBoss//EN', 'CALSCALE:GREGORIAN'];
  for (const j of jobs.filter(x => x.scheduled_date)) {
    const days = Math.max(1, Math.ceil(Number(j.scheduled_days) || 1));
    out.push('BEGIN:VEVENT', `UID:${j.id}@lotcalc`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d(j.scheduled_date)}`, `DTEND;VALUE=DATE:${d(addDays(j.scheduled_date, days))}`, `SUMMARY:${esc(j.title)}`, `LOCATION:${esc(j.address)}`, `DESCRIPTION:${esc(`${companyName} job. ${j.customer?.name ? 'Customer: ' + j.customer.name + '. ' : ''}${j.customer?.phone ? 'Phone: ' + j.customer.phone : ''}`)}`, 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

// The invoice the customer gets (printout / PDF). Same look as the quote.
const METHOD_WORD = { check: 'Check', cash: 'Cash', card: 'Card', ach: 'Bank transfer', other: 'Other' };
export function renderInvoice(inv, company, today) {
  const c = company || {}; const d = inv.data || {}; const cust = d.customer || {};
  const pays = (Array.isArray(inv.payments) ? inv.payments : []).filter(p => p && Number(p.amount) > 0);
  const paid = pays.reduce((t, p) => t + Number(p.amount), 0);
  const due = Math.max(0, Math.round((Number(inv.total) - paid) * 100) / 100);
  const late = inv.status !== 'void' && due > 0 && inv.due_date && today && inv.due_date < today;
  return h('article.quote.invoice',
    h('header.q-head',
      h('div.q-brand', c.logo ? h('img.q-logo', { src: c.logo, alt: '' }) : null, h('div', h('h1.q-company', c.name || 'Your company'), h('p.q-contact', [c.address, c.phone, c.email, c.website].filter(Boolean).join('  |  ')))),
      h('div.q-meta', h('p.q-title', inv.status === 'void' ? 'Invoice (VOID)' : inv.kind === 'deposit' ? 'Deposit invoice' : 'Invoice'), h('p', inv.number ? `No. ${inv.number}` : 'Draft'), h('p', `Date ${longDate(inv.issued || inv.created_at)}`), inv.due_date ? h('p', { class: late ? 'late' : '' }, `Due ${longDate(inv.due_date + 'T12:00:00')}`) : h('p', 'Due on receipt'))),
    h('section.q-parties',
      h('div', h('h3', 'Bill to'), h('p', cust.name || '—'), cust.company ? h('p', cust.company) : null, cust.phone ? h('p', cust.phone) : null, cust.email ? h('p', cust.email) : null),
      h('div', h('h3', 'Job site'), h('p', d.title || ''), h('p', d.address || ''))),
    h('table.q-lines', h('thead', h('tr', h('th', 'Description'), h('th.num', 'Amount'))),
      h('tbody', (d.lines || []).map(l => h('tr', h('td', String(l.label ?? '')), h('td.num', usd(l.amount))))),
      h('tfoot',
        d.tax ? h('tr', h('td', 'Subtotal'), h('td.num', usd(d.subtotal))) : null,
        d.tax ? h('tr', h('td', 'Sales tax'), h('td.num', usd(d.tax))) : null,
        h('tr', h('td', 'Invoice total'), h('td.num', usd(inv.total))),
        ...pays.map(p => h('tr.paid-row', h('td', `Paid ${new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${METHOD_WORD[p.method] || 'payment'}${p.ref ? ' ' + p.ref : ''}`), h('td.num', '−' + usd(p.amount)))),
        h('tr.q-total', h('td', inv.status === 'void' ? 'Void' : due > 0 ? 'Amount due' : 'Paid in full'), h('td.num', usd(inv.status === 'void' ? 0 : due))))),
    d.note ? h('section.q-terms', h('h3', 'Note'), h('p', d.note)) : null,
    (() => { const P = payInfo(c.settings); const open = inv.status !== 'void' && due > 0;
      return h('section.q-terms.q-pay', h('h3', 'How to pay'),
        open && P.ways.length ? h('ul.pay-ways', P.ways.map(w => h('li', h('strong', w.label + ': '), w.url ? h('a', { href: w.url, target: '_blank', rel: 'noopener' }, w.value) : w.value))) : null,
        h('p', `${open && P.ways.length ? '' : `Make checks payable to ${c.name || 'us'}. `}${P.note ? P.note + ' ' : ''}${c.phone ? `Questions about this invoice? Call ${c.phone}.` : ''} Thank you for your business!`)); })());
}
