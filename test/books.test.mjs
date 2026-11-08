import test from 'node:test';
import assert from 'node:assert/strict';
import { cell, csv, qbInvoices, qbPayments, qbCustomers, serviceOf, moneyTotals, payInfo, payText, driveway } from '../src/books.js';

const jobs = [{ id: 'a', title: 'Kroger', customer: { name: 'Dan', company: 'Kroger Co', phone: '555', email: 'd@k.com' }, address: '1 Main' }, { id: 'b', title: 'Church', customer: { name: 'Karen' } }];
const inv = (n, job, extra = {}) => ({ number: n, job_id: job, status: 'open', issued: '2026-10-01', due_date: '2026-10-16', total: 1070, kind: 'full', data: { title: 'Lot', subtotal: 1000, tax: 70, lines: [{ label: 'Sealcoat: 5,000 sq ft', amount: 700 }, { label: 'Crack fill: 300 lf', amount: 300 }] }, payments: [{ amount: 500, date: '2026-10-10', method: 'check', ref: '#1001' }], ...extra });

test('CSV cells: quotes, commas, newlines, and no spreadsheet formulas', () => {
  assert.equal(cell('a "b", c'), '"a ""b"", c"');
  assert.equal(cell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(cell('+1 555'), `"'+1 555"`); assert.equal(cell('-12.50'), '"-12.50"', 'negative numbers stay numbers');
  assert.equal(cell('line1\nline2'), '"line1 line2"'); assert.equal(cell(null), '""');
  assert.equal(csv([['a', 1], ['b', 2]]), '"a","1"\r\n"b","2"\r\n');
});
test('QuickBooks invoices: a row per line, dates as MM/DD/YYYY, voids skipped, date range', () => {
  const rows = qbInvoices([inv(2001, 'a'), inv(2002, 'b', { status: 'void' }), inv(2003, 'b', { issued: '2025-01-05' })], jobs, { from: '2026-01-01' });
  assert.equal(rows.length, 3); assert.deepEqual(rows[0].slice(0, 4), ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate']);
  assert.deepEqual(rows[1].slice(0, 4), [2001, 'Kroger Co', '10/01/2026', '10/16/2026']);
  assert.equal(rows[1][6], 'Sealcoating'); assert.equal(rows[2][6], 'Crack Filling'); assert.equal(rows[1][11], '70.00'); assert.equal(rows[2][11], '');
});
test('services map to QuickBooks items', () => {
  assert.equal(serviceOf('Line striping, 900 lf'), 'Line Striping'); assert.equal(serviceOf('ADA sign + post × 2'), 'Line Striping');
  assert.equal(serviceOf('Less amount already billed'), 'Deposit Applied'); assert.equal(serviceOf('Oil spot primer'), 'Services');
});
test('payments and customers', () => {
  const p = qbPayments([inv(2001, 'a'), { number: 9, job_id: 'b', payments: [null, { amount: -5 }, { amount: 'x' }] }], jobs);
  assert.deepEqual(p[1], ['10/10/2026', 'Kroger Co', 2001, '500.00', 'Check', '#1001']); assert.equal(p.length, 2);
  const c = qbCustomers(jobs, [inv(2001, 'a'), inv(2005, 'a')]);
  assert.equal(c.length, 2, 'one row per billed customer'); assert.equal(c[1][0], 'Kroger Co');
});
test('totals for the year', () => {
  assert.deepEqual(moneyTotals([inv(1, 'a'), inv(2, 'a', { status: 'void' })]), { billed: 1070, collected: 500, open: 570 });
  assert.deepEqual(moneyTotals(null), { billed: 0, collected: 0, open: 0 });
});
test('how to pay: only safe links, clean handles', () => {
  const p = payInfo({ payments: { link: 'https://buy.stripe.com/abc', venmo: '@Rutherford-Paving', zelle: '740-555-0100', checksTo: 'Rutherford Paving, PO Box 1, New Concord OH', cashapp: '$rpave' } });
  assert.deepEqual(p.ways.map(w => w.kind), ['link', 'venmo', 'cashapp', 'zelle', 'check']);
  assert.equal(p.ways[1].url, 'https://venmo.com/u/Rutherford-Paving'); assert.equal(p.ways[2].value, '$rpave');
  assert.deepEqual(payInfo({ payments: { link: 'javascript:alert(1)' } }).ways, [], 'no javascript: links');
  assert.deepEqual(payInfo({ payments: { link: 'http://insecure.com' } }).ways, [], 'https only');
  assert.equal(payInfo({ payments: { venmo: '"><script>' } }).ways[0].value, '@script');
  assert.match(payText({ payments: { zelle: 'pay@me.com' } }, 250), /How to pay \$250\.00:\n- Zelle: pay@me\.com/);
  assert.equal(payText({}), '');
});
test('driveways: per sq ft, minimum, cracks, junk', () => {
  const r = driveway([{ length: 60, width: 12 }, { sqft: 300 }, { sqft: 1000, cracks: 40 }, { sqft: 'x' }], { driveway: { pricePerSqft: 0.25, minimum: 150, crackPerLf: 1.5 } });
  assert.deepEqual(r.items.map(x => x.price), [180, 150, 310, 0]);
  assert.ok(r.items[1].minimumApplied); assert.equal(r.total, 640); assert.equal(r.sqft, 2020);
  assert.equal(driveway([{ sqft: 1e12 }]).items[0].sqft, 100000, 'capped');
  assert.deepEqual(driveway(null), { items: [], total: 0, sqft: 0, hours: 0 });
});
