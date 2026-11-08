import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, DEFAULTS, merge } from '../src/calc.js';
import { invoiceDraft, invoiceState, balanceOf, paidOn, checkPayment, moneySummary, billedSoFar, estSnapshot, wrapUp, learn, invoiceText } from '../src/money.js';

const S = merge(DEFAULTS, { taxPct: 7 });
const crew = [{ id: 'a', name: 'Al', wage: 20 }, { id: 'b', name: 'Bo', wage: 18 }];
const inputs = { seal: { on: true, sqft: 30000, coats: 2 }, crack: { on: true, lf: 800 }, stripe: { on: true, rows: [{ stalls: 44 }] }, crewIds: ['a', 'b'] };
const est = estimate(inputs, S, crew);
const job = { title: 'Red Lobster', address: 'Main St', customer: { name: 'Bob' } };
const T = '2026-11-07';
const pay = (inv, amount, date = T) => ({ ...inv, payments: [...(inv.payments || []), { id: String(Math.random()), amount, date, method: 'check' }] });

test('full invoice = the job total, due in your net days', () => {
  const inv = invoiceDraft({ job, est, settings: { invoiceDueDays: 15 }, today: T });
  assert.equal(inv.kind, 'full'); assert.equal(inv.total, est.total); assert.equal(inv.due_date, '2026-11-22');
  assert.equal(inv.data.tax, est.tax); assert.equal(inv.data.lines.length, est.lines.length);
});
test('deposit then balance adds up to exactly the job total, tax included', () => {
  const dep = { ...invoiceDraft({ kind: 'deposit', job, est, depositPct: 33, today: T }), id: 1 };
  assert.equal(dep.kind, 'deposit'); assert.ok(Math.abs(dep.total - est.total * 0.33) < 0.02);
  const bal = invoiceDraft({ job, est, invoices: [dep], today: T });
  assert.equal(bal.kind, 'balance');
  assert.equal(Math.round((dep.total + bal.total) * 100), Math.round(est.total * 100));
  assert.ok(bal.data.lines.some(l => l.amount < 0 && /already billed/.test(l.label)));
  const sum = bal.data.lines.reduce((t, l) => t + l.amount, 0); assert.ok(Math.abs(sum - bal.data.subtotal) < 0.02, 'lines add up to the subtotal');
});
test('can\'t bill more than the job, can\'t deposit twice, voided invoices don\'t count', () => {
  const full = { ...invoiceDraft({ job, est, today: T }), id: 1 };
  assert.match(invoiceDraft({ job, est, invoices: [full], today: T }).error, /fully billed/);
  assert.match(invoiceDraft({ kind: 'deposit', job, est, invoices: [full], today: T }).error, /already an invoice/);
  const again = invoiceDraft({ job, est, invoices: [{ ...full, status: 'void' }], today: T });
  assert.equal(again.kind, 'full'); assert.equal(again.total, est.total);
});
test('no price = no invoice', () => {
  assert.match(invoiceDraft({ job, est: estimate({}, S), today: T }).error, /no price/);
  assert.match(invoiceDraft({ job: null, est: null }).error, /no price/);
});
test('states: unpaid, part paid, overdue, paid, void', () => {
  const inv = { ...invoiceDraft({ job, est, today: T }), id: 1 };
  assert.equal(invoiceState(inv, T), 'open');
  assert.equal(invoiceState(pay(inv, 100), T), 'partial');
  assert.equal(invoiceState(inv, '2026-12-01'), 'overdue');
  assert.equal(invoiceState(pay(inv, inv.total), '2026-12-01'), 'paid');
  assert.equal(invoiceState({ ...inv, status: 'void' }, T), 'void');
  assert.equal(balanceOf({ ...inv, status: 'void' }), 0);
});
test('payments: no zero, negative, junk, overpay, future, or fractions of a cent', () => {
  const inv = { ...invoiceDraft({ job, est, today: T }), id: 1 };
  const ok = { amount: 100, date: T, method: 'check' };
  assert.equal(checkPayment(inv, ok, T), null);
  for (const amount of [0, -5, 'abc', NaN, Infinity, '', null]) assert.ok(checkPayment(inv, { ...ok, amount }, T), String(amount));
  assert.match(checkPayment(inv, { ...ok, amount: inv.total + 1 }, T), /more than what's owed/);
  assert.equal(checkPayment(inv, { ...ok, amount: inv.total }, T), null);
  assert.match(checkPayment(inv, { ...ok, amount: 10.005 }, T), /cents/);
  assert.match(checkPayment(inv, { ...ok, date: '2027-01-01' }, T), /future/);
  assert.match(checkPayment(inv, { ...ok, date: '2026-02-30x' }, T), /date/);
  assert.match(checkPayment(inv, { ...ok, method: 'bitcoin' }, T), /how they paid/);
  assert.match(checkPayment(pay(inv, inv.total), ok, T), /paid in full/);
  assert.match(checkPayment({ ...inv, status: 'void' }, ok, T), /voided/);
});
test('junk payments in saved data never make a balance go wrong', () => {
  const inv = { total: 100, payments: [{ amount: -50 }, { amount: 'x' }, null, { amount: 30 }] };
  assert.equal(paidOn(inv), 30); assert.equal(balanceOf(inv), 70);
  assert.equal(balanceOf({ total: 100, payments: 'nope' }), 100);
  assert.equal(balanceOf({ total: 100, payments: [{ amount: 500 }] }), 0);
});
test('money summary: owed, overdue, collected this month', () => {
  const a = pay({ ...invoiceDraft({ job, est, today: '2026-10-01' }), id: 1 }, 500, '2026-11-02');
  const b = { ...invoiceDraft({ job, est, today: T }), id: 2 };
  const c = { ...b, id: 3, status: 'void' };
  const m = moneySummary([a, b, c], T);
  assert.equal(m.owed, Math.round((a.total - 500 + b.total) * 100) / 100);
  assert.equal(m.overdueCount, 1); assert.equal(m.collectedMonth, 500); assert.equal(m.openCount, 2);
  assert.deepEqual(moneySummary(null, T), { owed: 0, overdue: 0, overdueCount: 0, openCount: 0, collectedMonth: 0 });
});
test('billed so far ignores void', () => {
  assert.equal(billedSoFar([{ total: 10, data: { subtotal: 10, tax: 0 } }, { total: 99, status: 'void', data: { subtotal: 99 } }]).total, 10);
});

// ---------- wrap-up ----------
const snap = estSnapshot(est);
const exactHours = [{ id: 'a', wage: 20, hours: snap.personHours / 2 }, { id: 'b', wage: 18, hours: snap.personHours / 2 }];
test('wrap-up with everything as estimated lands on the estimate', () => {
  const r = wrapUp(snap, { crew: exactHours, truckHours: est.time.onSiteHours + est.time.mobilizationHours }, S);
  assert.ok(Math.abs(r.labor - est.cost.labor) < 1, `labor ${r.labor} vs ${est.cost.labor}`);
  assert.ok(Math.abs(r.materials - est.cost.materials) < 0.01, `materials ${r.materials} vs ${est.cost.materials}`);
  assert.ok(Math.abs(r.equipment - est.cost.equipment) < 0.01);
  assert.ok(Math.abs(r.profit - est.profit) < 2, `profit ${r.profit} vs ${est.profit}`);
  assert.match(r.headline, /right on the estimate|better|worse/);
});
test('slower crew + extra sealer = less profit, and it says why', () => {
  const slow = exactHours.map(c => ({ ...c, hours: c.hours * 1.3 }));
  const r = wrapUp(snap, { crew: slow, sealerGal: snap.seal.sealerGal * 1.2 }, S);
  assert.ok(r.profit < est.profit);
  assert.ok(r.notes.some(n => /30% longer/.test(n)), r.notes.join(' | '));
  assert.ok(r.notes.some(n => /Sealer.*20% more/.test(n)), r.notes.join(' | '));
  assert.match(r.headline, /worse than estimated/);
});
test('wrap-up survives junk and blanks', () => {
  assert.doesNotThrow(() => wrapUp(null, null, {}));
  const r = wrapUp(snap, { crew: [{ hours: 'abc', wage: 20 }, { hours: -5, wage: 20 }, null, { hours: 1e9, wage: 20 }], sealerGal: -10, other: [{ amount: 'x' }, null] }, S);
  for (const k of ['labor', 'materials', 'equipment', 'other', 'overhead', 'totalCost', 'profit', 'marginPct']) assert.ok(Number.isFinite(r[k]), k + ' = ' + r[k]);
  assert.ok(r.personHours <= 400, 'one person can\'t log a billion hours');
  assert.equal(wrapUp(snap, {}, S).complete, false);
});
test('profit uses what was actually billed when there is one', () => {
  const r = wrapUp(snap, { crew: exactHours }, S, snap.subtotal + 1000);
  assert.ok(r.profit > wrapUp(snap, { crew: exactHours }, S).profit + 999);
});

test('learning: 2+ slow jobs suggests lower production numbers; 1 job suggests nothing', () => {
  const slow = { snap, actuals: { crew: exactHours.map(c => ({ ...c, hours: c.hours * 1.25 })) } };
  assert.deepEqual(learn([slow], S), []);
  const sug = learn([slow, slow], S);
  const seal = sug.find(s => s.path === 'sealcoat.sqftPerPersonHourPerCoat');
  assert.ok(seal && seal.to < seal.from, JSON.stringify(sug));
  assert.ok(Math.abs(seal.to - S.sealcoat.sqftPerPersonHourPerCoat / 1.25) <= 10);
  const onTarget = { snap, actuals: { crew: exactHours } };
  assert.deepEqual(learn([onTarget, onTarget, onTarget], S).filter(x => /production/.test(x.label)), []);
});
test('learning: sealer and crack filler', () => {
  const j = { snap, actuals: { crew: exactHours, sealerGal: snap.seal.sealerGal * 1.15, crackBoxes: snap.crack.boxes * 1.5 } };
  const sug = learn([j, j], S);
  const cov = sug.find(s => s.path === 'sealcoat.sqftPerGalPerCoat'); assert.ok(cov && cov.to < cov.from);
  const waste = sug.find(s => s.path === 'crack.wastePct'); assert.ok(waste && waste.to > waste.from);
  assert.deepEqual(learn(null, S), []); assert.deepEqual(learn([{}, { snap: null }], S), []);
});
test('invoice text reads right', () => {
  const inv = { ...invoiceDraft({ job, est, today: T }), number: 2001 };
  const t = invoiceText(pay(inv, 100), { name: 'Rutherford Paving', phone: '555' }, '2026-12-30');
  assert.match(t, /Invoice No\. 2001/); assert.match(t, /Paid: \$100\.00/); assert.match(t, /past due/); assert.ok(!/undefined|NaN|null/.test(t));
  assert.match(invoiceText(pay(inv, inv.total), {}, T), /Paid in full/);
});
