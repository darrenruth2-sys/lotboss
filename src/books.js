// LotBoss: QuickBooks export + "how to pay us" + driveway pricing. Pure functions.
import { paidOn, balanceOf } from './money.js';

const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const d10 = v => String(v || '').slice(0, 10);
const mdY = s => isDay(s) ? `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}` : '';
const money2 = v => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);

// one CSV cell: quoted, and a leading = + - @ can't turn into a spreadsheet formula
export function cell(v) {
  let s = String(v ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export const csv = rows => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const customerName = (inv, job) => (inv?.data?.customer?.company || job?.customer?.company || inv?.data?.customer?.name || job?.customer?.name || job?.title || 'Customer').trim();

/**
 * QuickBooks Online "Import invoices" CSV: one row per invoice line.
 * invoices: lc_invoices rows; jobs: for customer names; range: { from, to } (YYYY-MM-DD, by invoice date)
 */
export function qbInvoices(invoices, jobs = [], range = {}) {
  const byId = Object.fromEntries((jobs || []).filter(Boolean).map(j => [j.id, j]));
  const rows = [['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'TaxAmount']];
  for (const inv of (invoices || []).filter(i => i && i.status !== 'void')) {
    const day = d10(inv.issued || inv.created_at);
    if (range.from && day < range.from) continue; if (range.to && day > range.to) continue;
    const job = byId[inv.job_id]; const lines = Array.isArray(inv.data?.lines) && inv.data.lines.length ? inv.data.lines : [{ label: inv.data?.title || 'Parking lot work', amount: inv.data?.subtotal ?? inv.total }];
    lines.forEach((l, i) => rows.push([inv.number, customerName(inv, job), mdY(day), mdY(d10(inv.due_date)), '', i === 0 ? `${inv.data?.title || job?.title || ''}${inv.kind === 'deposit' ? ' (deposit)' : ''}` : '', serviceOf(l.label), String(l.label || ''), 1, money2(l.amount), money2(l.amount), i === 0 ? money2(inv.data?.tax || 0) : '']));
  }
  return rows;
}
// map our line labels onto a few QuickBooks products/services
export function serviceOf(label) {
  const s = String(label || '').toLowerCase();
  if (/seal/.test(s)) return 'Sealcoating';
  if (/crack/.test(s)) return 'Crack Filling';
  if (/strip|line|stencil|ada|sign|wheel stop|paint/.test(s)) return 'Line Striping';
  if (/deposit/.test(s)) return 'Deposit';
  if (/already billed|less /.test(s)) return 'Deposit Applied';
  return 'Services';
}
export function qbPayments(invoices, jobs = [], range = {}) {
  const byId = Object.fromEntries((jobs || []).filter(Boolean).map(j => [j.id, j]));
  const rows = [['Date', 'Customer', 'InvoiceNo', 'Amount', 'Method', 'Reference']];
  for (const inv of invoices || []) for (const p of (inv?.payments || [])) {
    if (!p || !(Number(p.amount) > 0)) continue; const day = d10(p.date);
    if (range.from && day < range.from) continue; if (range.to && day > range.to) continue;
    rows.push([mdY(day), customerName(inv, byId[inv.job_id]), inv.number, money2(p.amount), { check: 'Check', cash: 'Cash', card: 'Credit Card', ach: 'Bank Transfer' }[p.method] || 'Other', p.ref || '']);
  }
  return rows;
}
export function qbCustomers(jobs = [], invoices = []) {
  const seen = new Map();
  const billed = new Set((invoices || []).map(i => i?.job_id));
  for (const j of jobs || []) {
    if (!j || !billed.has(j.id)) continue; const name = customerName(null, j); if (seen.has(name.toLowerCase())) continue;
    seen.set(name.toLowerCase(), ['', name, j.customer?.company || '', j.customer?.name || '', j.customer?.email || '', j.customer?.phone || '', j.address || '']);
  }
  return [['Title', 'Name', 'Company', 'Contact', 'Email', 'Phone', 'BillingAddress'], ...seen.values()].map(r => r.slice(1));
}
export function moneyTotals(invoices, range = {}) {
  let billed = 0, collected = 0, open = 0;
  for (const inv of (invoices || []).filter(i => i && i.status !== 'void')) {
    const day = d10(inv.issued || inv.created_at); if (range.from && day < range.from) continue; if (range.to && day > range.to) continue;
    billed += Number(inv.total) || 0; collected += paidOn(inv); open += balanceOf(inv);
  }
  return { billed: Math.round(billed * 100) / 100, collected: Math.round(collected * 100) / 100, open: Math.round(open * 100) / 100 };
}

// ---------- how customers can pay you ----------
export const PAY_DEFAULTS = { link: '', venmo: '', zelle: '', cashapp: '', checksTo: '', note: '' };
export function payInfo(s = {}) {
  const p = { ...PAY_DEFAULTS, ...(s?.payments || {}) };
  const clean = v => String(v || '').trim().slice(0, 160);
  const link = /^https:\/\/\S+$/.test(clean(p.link)) ? clean(p.link) : '';
  const venmo = clean(p.venmo).replace(/^@?/, '').replace(/[^\w-]/g, '');
  const cashapp = clean(p.cashapp).replace(/^\$?/, '').replace(/[^\w-]/g, '');
  const ways = [];
  if (link) ways.push({ kind: 'link', label: 'Pay online (card or bank)', value: link, url: link });
  if (venmo) ways.push({ kind: 'venmo', label: 'Venmo', value: '@' + venmo, url: `https://venmo.com/u/${encodeURIComponent(venmo)}` });
  if (cashapp) ways.push({ kind: 'cashapp', label: 'Cash App', value: '$' + cashapp, url: `https://cash.app/$${encodeURIComponent(cashapp)}` });
  if (clean(p.zelle)) ways.push({ kind: 'zelle', label: 'Zelle', value: clean(p.zelle) });
  if (clean(p.checksTo)) ways.push({ kind: 'check', label: 'Mail a check to', value: clean(p.checksTo) });
  return { ways, note: clean(p.note) };
}
export const payText = (s, amount) => { const { ways, note } = payInfo(s); if (!ways.length) return ''; return ['How to pay' + (amount ? ` ${'$' + money2(amount)}` : '') + ':', ...ways.map(w => `- ${w.label}: ${w.value}`), note].filter(Boolean).join('\n'); };

// ---------- driveways (homeowners) ----------
export const DRIVE_DEFAULTS = { pricePerSqft: 0.25, minimum: 150, crackPerLf: 1.5, edgePerLf: 0, sqftPerHour: 1500 };
/** items: [{ sqft | length+width, cracks (lf), edge (bool) }] → price per driveway and total */
export function driveway(items, s = {}) {
  const D = { ...DRIVE_DEFAULTS, ...(s?.driveway || {}) };
  const num = v => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  const out = (Array.isArray(items) ? items : []).slice(0, 200).map(it => {
    const sqft = Math.min(100000, num(it?.sqft) || Math.round(num(it?.length) * num(it?.width)));
    const cracks = Math.min(10000, num(it?.cracks));
    const seal = sqft * num(D.pricePerSqft), crack = cracks * num(D.crackPerLf), edge = it?.edge ? Math.sqrt(sqft) * 2 * num(D.edgePerLf) : 0;
    const raw = seal + crack + edge; const price = sqft || cracks ? Math.max(num(D.minimum), Math.round(raw / 5) * 5) : 0;
    return { sqft, cracks, price, minimumApplied: price > 0 && raw < num(D.minimum), hours: Math.round(sqft / (num(D.sqftPerHour) || 1500) * 10) / 10 };
  });
  return { items: out, total: out.reduce((t, x) => t + x.price, 0), sqft: out.reduce((t, x) => t + x.sqft, 0), hours: Math.round(out.reduce((t, x) => t + x.hours, 0) * 10) / 10 };
}
