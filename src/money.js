// LotBoss: invoices, payments and job wrap-up math. Pure functions, no UI.
// Invoice: { id, number, kind: 'full'|'deposit'|'balance', status: 'open'|'void', issued, due_date, total,
//            data: { title, address, customer, lines:[{label, amount}], subtotal, tax, total, note }, payments: [{id, amount, date, method, ref}] }

const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const nn = v => Math.max(0, n(v));
export const r2 = v => Math.round(n(v) * 100) / 100;
const cap = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const addDays = (day, k) => { const x = new Date(day + 'T12:00:00'); x.setDate(x.getDate() + k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00'));

export const METHODS = { check: 'Check', cash: 'Cash', card: 'Card', ach: 'Bank transfer', other: 'Other' };
export const INVOICE_DEFAULTS = { dueDays: 15, depositPct: 30 };

const live = invs => (Array.isArray(invs) ? invs : []).filter(i => i && i.status !== 'void');
export const paidOn = inv => r2((Array.isArray(inv?.payments) ? inv.payments : []).reduce((t, p) => t + nn(p?.amount), 0));
export const balanceOf = inv => inv?.status === 'void' ? 0 : r2(Math.max(0, n(inv?.total) - paidOn(inv)));

// open | partial | overdue | paid | void
export function invoiceState(inv, today) {
  if (!inv || inv.status === 'void') return 'void';
  const bal = balanceOf(inv);
  if (n(inv.total) > 0 && bal <= 0.005) return 'paid';
  if (isDay(inv.due_date) && isDay(today) && inv.due_date < today) return 'overdue';
  return paidOn(inv) > 0 ? 'partial' : 'open';
}
export const STATE_WORD = { open: 'Unpaid', partial: 'Part paid', overdue: 'Overdue', paid: 'Paid', void: 'Void' };
export const daysLate = (inv, today) => invoiceState(inv, today) === 'overdue' ? Math.round((new Date(today + 'T12:00:00') - new Date(inv.due_date + 'T12:00:00')) / 864e5) : 0;

// What's already been billed on this job (open invoices only, void ones don't count)
export function billedSoFar(invoices) {
  const L = live(invoices);
  return { subtotal: r2(L.reduce((t, i) => t + n(i.data?.subtotal), 0)), tax: r2(L.reduce((t, i) => t + n(i.data?.tax), 0)), total: r2(L.reduce((t, i) => t + n(i.total), 0)), count: L.length };
}

// Build a new invoice from the job's price. kind: 'full' (or the rest, if something was billed already) | 'deposit'
export function invoiceDraft({ kind = 'full', job, est, settings, invoices = [], depositPct, today } = {}) {
  job = job || {}; est = est || {}; settings = settings || {};
  const day = isDay(today) ? today : addDays('2000-01-01', 0);
  const dueDays = cap(Math.round(nn(settings.invoiceDueDays ?? INVOICE_DEFAULTS.dueDays)), 0, 365);
  const contract = { subtotal: r2(nn(est.subtotal)), tax: r2(nn(est.tax)), total: r2(nn(est.total)) };
  const billed = billedSoFar(invoices);
  const left = { subtotal: r2(contract.subtotal - billed.subtotal), tax: r2(contract.tax - billed.tax), total: r2(contract.total - billed.total) };
  const base = { title: job.title || '', address: job.address || '', customer: { name: job.customer?.name || '', company: job.customer?.company || '', phone: job.customer?.phone || '', email: job.customer?.email || '' } };
  if (contract.total <= 0) return { error: 'This job has no price yet. Measure it or add items on the Estimate tab first.' };
  if (kind === 'deposit' && billed.count) return { error: 'There is already an invoice on this job. Bill the rest instead.' };
  if (left.total <= 0.005) return { error: 'This job is already fully billed. Void an invoice if you need to redo it.' };
  let lines, subtotal, tax;
  if (kind === 'deposit') {
    if (billed.count) return { error: 'There is already an invoice on this job. Bill the rest instead.' };
    const pct = cap(n(depositPct ?? settings.depositPct ?? INVOICE_DEFAULTS.depositPct), 1, 100);
    subtotal = r2(contract.subtotal * pct / 100); tax = r2(contract.tax * pct / 100);
    lines = [{ label: `Deposit (${pct}% of ${usdPlain(contract.total)}) to schedule the work`, amount: subtotal }];
  } else if (billed.count) {
    kind = 'balance'; subtotal = left.subtotal; tax = left.tax;
    lines = [...(est.lines || []).map(l => ({ label: String(l.label || ''), amount: r2(l.amount) })), { label: billed.count === 1 ? 'Less amount already billed' : `Less ${billed.count} invoices already billed`, amount: -billed.subtotal }];
  } else {
    kind = 'full'; subtotal = contract.subtotal; tax = contract.tax;
    lines = (est.lines || []).map(l => ({ label: String(l.label || ''), amount: r2(l.amount) }));
  }
  const total = r2(subtotal + tax);
  return { kind, status: 'open', issued: day, due_date: addDays(day, dueDays), total, payments: [], data: { ...base, lines, subtotal, tax, total, note: '' } };
}
const usdPlain = v => '$' + r2(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Check a payment before saving it. Returns an error message or null.
export function checkPayment(inv, p, today) {
  if (!inv || inv.status === 'void') return 'This invoice was voided.';
  const amt = Number(p?.amount);
  if (!Number.isFinite(amt) || amt <= 0) return 'Enter the amount paid.';
  if (Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-6) return 'Use dollars and cents (two decimals).';
  if (amt > 10000000) return 'That amount is too big.';
  const bal = balanceOf(inv);
  if (amt > bal + 0.005) return bal <= 0 ? 'This invoice is already paid in full.' : `That's more than what's owed (${usdPlain(bal)}).`;
  if (!isDay(p?.date)) return 'Pick the date it was paid.';
  if (isDay(today) && p.date > addDays(today, 1)) return 'The payment date is in the future.';
  if (!METHODS[p?.method]) return 'Pick how they paid.';
  return null;
}

// Totals for the Jobs page / money screen
export function moneySummary(invoices, today) {
  const L = live(invoices); const month = isDay(today) ? today.slice(0, 7) : '';
  let owed = 0, overdue = 0, overdueCount = 0, collectedMonth = 0, openCount = 0;
  for (const i of L) {
    const b = balanceOf(i); owed += b; if (b > 0) openCount++;
    if (invoiceState(i, today) === 'overdue') { overdue += b; overdueCount++; }
    for (const p of i.payments || []) if (month && String(p?.date || '').startsWith(month)) collectedMonth += nn(p.amount);
  }
  return { owed: r2(owed), overdue: r2(overdue), overdueCount, openCount, collectedMonth: r2(collectedMonth) };
}

// ---------------- job wrap-up: what it really took ----------------
// A snapshot of what the estimate said, saved with the wrap-up so later rate changes don't rewrite history.
export function estSnapshot(est = {}) {
  const crew = n(est.crew?.size) || 1; const t = est.time || {};
  return {
    subtotal: r2(est.subtotal), personHours: r2((n(t.onSiteHours) + n(t.mobilizationHours)) * crew), workHours: r2(t.personHours), days: n(t.days), crew,
    cost: { labor: r2(est.cost?.labor), materials: r2(est.cost?.materials), equipment: r2(est.cost?.equipment), overhead: r2(est.cost?.overhead), total: r2(est.cost?.total) },
    profit: r2(est.profit),
    seal: est.seal ? { sqft: n(est.seal.sqft), coats: n(est.seal.coats), sealerGal: r2(est.seal.concentrateGal), sandBags: n(est.seal.materials?.[1]?.qty), personHours: r2(est.seal.personHours) } : null,
    crack: est.crack ? { lf: n(est.crack.lf), boxes: n(est.crack.boxes), personHours: r2(est.crack.personHours) } : null,
    stripe: est.stripe ? { lf: n(est.stripe.lf?.total), paintGal: r2(est.stripe.paintGal), personHours: r2(est.stripe.personHours) } : null
  };
}

// actuals = { crew: [{id, name, wage, hours}], truckHours, sealerGal, sandBags, crackBoxes, paintGal, other: [{label, amount}] }
// Blank material = "used what we estimated".
export function wrapUp(snap, actuals = {}, settings = {}, revenue) {
  const s = snap || estSnapshot({}); const a = actuals && typeof actuals === 'object' ? actuals : {};
  const sc = settings.sealcoat || {}, ck = settings.crack || {}, st = settings.stripe || {};
  const blank = v => v === '' || v === null || v === undefined || !Number.isFinite(Number(v));
  const crew = (Array.isArray(a.crew) ? a.crew : []).filter(c => c && nn(c.hours) > 0);
  const personHours = r2(crew.reduce((t, c) => t + cap(nn(c.hours), 0, 400), 0));
  const burden = 1 + nn(settings.laborBurdenPct) / 100;
  const labor = r2(crew.reduce((t, c) => t + cap(nn(c.hours), 0, 400) * nn(c.wage), 0) * burden);
  const truckHours = blank(a.truckHours) ? r2(crew.length ? Math.max(...crew.map(c => nn(c.hours))) : 0) : nn(a.truckHours);
  const equipment = r2(truckHours * nn(settings.equipmentPerHour));
  const used = {
    sealerGal: s.seal ? (blank(a.sealerGal) ? s.seal.sealerGal : nn(a.sealerGal)) : nn(a.sealerGal),
    sandBags: s.seal ? (blank(a.sandBags) ? s.seal.sandBags : nn(a.sandBags)) : nn(a.sandBags),
    crackBoxes: s.crack ? (blank(a.crackBoxes) ? s.crack.boxes : nn(a.crackBoxes)) : nn(a.crackBoxes),
    paintGal: s.stripe ? (blank(a.paintGal) ? s.stripe.paintGal : nn(a.paintGal)) : nn(a.paintGal)
  };
  // start from what the estimate priced, then add/subtract only what was used differently (additive follows the sealer)
  const e = { sealerGal: s.seal?.sealerGal || 0, sandBags: s.seal?.sandBags || 0, crackBoxes: s.crack?.boxes || 0, paintGal: s.stripe?.paintGal || 0 };
  const perSealerGal = nn(sc.concentrateCost) + nn(sc.additivePct) / 100 * nn(sc.additiveCost);
  const materials = r2(Math.max(0, n(s.cost.materials) + (used.sealerGal - e.sealerGal) * perSealerGal + (used.sandBags - e.sandBags) * nn(sc.sandBagCost) + (used.crackBoxes - e.crackBoxes) * nn(ck.boxCost) + (used.paintGal - e.paintGal) * nn(st.paintCostPerGal)));
  const other = r2((Array.isArray(a.other) ? a.other : []).reduce((t, o) => t + n(o?.amount), 0));
  const direct = labor + materials + equipment + other;
  const overhead = r2(direct * nn(settings.overheadPct) / 100);
  const totalCost = r2(direct + overhead);
  const rev = Number.isFinite(Number(revenue)) && Number(revenue) > 0 ? r2(revenue) : s.subtotal;
  const profit = r2(rev - totalCost);
  const marginPct = rev > 0 ? Math.round(profit / rev * 1000) / 10 : 0;
  const pct = (act, est) => est > 0 ? Math.round((act - est) / est * 100) : null;
  const rows = [
    { key: 'hours', label: 'Crew hours', est: s.personHours, actual: personHours, unit: 'hrs', diffPct: crew.length ? pct(personHours, s.personHours) : null },
    { key: 'labor', label: 'Labor', est: s.cost.labor, actual: labor, money: true },
    { key: 'materials', label: 'Materials', est: s.cost.materials, actual: materials, money: true },
    { key: 'equipment', label: 'Equipment + fuel', est: s.cost.equipment, actual: equipment, money: true },
    other ? { key: 'other', label: 'Other costs', est: 0, actual: other, money: true } : null,
    { key: 'overhead', label: 'Overhead', est: s.cost.overhead, actual: overhead, money: true },
    { key: 'cost', label: 'Total cost', est: s.cost.total, actual: totalCost, money: true, strong: true },
    { key: 'profit', label: 'Profit', est: s.profit, actual: profit, money: true, strong: true }
  ].filter(Boolean);
  const qty = [
    s.seal ? { label: 'Sealer (concentrate)', est: s.seal.sealerGal, actual: used.sealerGal, unit: 'gal', diffPct: blank(a.sealerGal) ? null : pct(used.sealerGal, s.seal.sealerGal) } : null,
    s.seal ? { label: 'Sand', est: s.seal.sandBags, actual: used.sandBags, unit: 'bags', diffPct: blank(a.sandBags) ? null : pct(used.sandBags, s.seal.sandBags) } : null,
    s.crack ? { label: 'Crack filler', est: s.crack.boxes, actual: used.crackBoxes, unit: 'boxes', diffPct: blank(a.crackBoxes) ? null : pct(used.crackBoxes, s.crack.boxes) } : null,
    s.stripe ? { label: 'Paint', est: s.stripe.paintGal, actual: used.paintGal, unit: 'gal', diffPct: blank(a.paintGal) ? null : pct(used.paintGal, s.stripe.paintGal) } : null
  ].filter(Boolean);
  const notes = [];
  if (!crew.length) notes.push('Add the hours each person worked to see the real labor cost.');
  const hd = rows[0].diffPct;
  if (hd !== null && Math.abs(hd) >= 10) notes.push(hd > 0 ? `The crew took ${hd}% longer than estimated.` : `The crew finished ${-hd}% faster than estimated.`);
  for (const q of qty) if (q.diffPct !== null && Math.abs(q.diffPct) >= 10) notes.push(`${q.label}: used ${Math.abs(q.diffPct)}% ${q.diffPct > 0 ? 'more' : 'less'} than estimated.`);
  const diff = r2(profit - s.profit);
  const headline = crew.length ? `${profit >= 0 ? 'Made' : 'Lost'} $${Math.abs(Math.round(profit)).toLocaleString('en-US')} (${marginPct}%), ${Math.abs(diff) < 1 ? 'right on the estimate' : `$${Math.abs(Math.round(diff)).toLocaleString('en-US')} ${diff > 0 ? 'better' : 'worse'} than estimated`}.` : 'Fill in the hours to see how the job really did.';
  return { revenue: rev, personHours, truckHours, used, labor, materials, equipment, other, overhead, totalCost, profit, marginPct, rows, qty, notes, headline, complete: crew.length > 0 };
}

// Learn from finished jobs: suggest settings changes when the crew is consistently faster/slower or materials run over/under.
// jobs: [{ snap, actuals }]   Returns [{ path, label, from, to, why }]
export function learn(jobs, settings = {}) {
  const ok = (Array.isArray(jobs) ? jobs : []).filter(j => j?.snap && j?.actuals);
  const out = [];
  const avg = xs => xs.reduce((t, x) => t + x, 0) / xs.length;
  const hours = ok.map(j => { const h = (Array.isArray(j.actuals.crew) ? j.actuals.crew : []).reduce((t, c) => t + nn(c?.hours), 0); return h > 0 && j.snap.personHours > 0 ? h / j.snap.personHours : null; }).filter(x => x !== null && x > 0.2 && x < 5);
  if (hours.length >= 2) {
    const r = avg(hours);
    if (Math.abs(r - 1) >= 0.1) {
      const word = r > 1 ? `took ${Math.round((r - 1) * 100)}% longer` : `finished ${Math.round((1 - r) * 100)}% faster`;
      for (const [path, label] of [['sealcoat.sqftPerPersonHourPerCoat', 'Sealcoat production per person'], ['crack.lfPerPersonHour', 'Crack fill production per person'], ['stripe.lfPerPersonHour', 'Striping production per person']]) {
        const from = n(path.split('.').reduce((o, k) => o?.[k], settings)); if (from > 0) out.push({ path, label, from, to: Math.round(from / r / 10) * 10, why: `Across your last ${hours.length} finished jobs the crew ${word} than estimated.` });
      }
    }
  }
  const ratio = (pick, est) => ok.map(j => { const a = j.actuals[pick]; const e = est(j.snap); return a !== '' && a != null && Number.isFinite(Number(a)) && Number(a) > 0 && e > 0 ? Number(a) / e : null; }).filter(x => x !== null && x > 0.2 && x < 5);
  const seal = ratio('sealerGal', s => s.seal?.sealerGal || 0);
  if (seal.length >= 2 && Math.abs(avg(seal) - 1) >= 0.08 && n(settings.sealcoat?.sqftPerGalPerCoat) > 0) { const from = n(settings.sealcoat.sqftPerGalPerCoat); out.push({ path: 'sealcoat.sqftPerGalPerCoat', label: 'Sealcoat coverage', from, to: Math.round(from / avg(seal)), why: `You used ${Math.round(Math.abs(avg(seal) - 1) * 100)}% ${avg(seal) > 1 ? 'more' : 'less'} sealer than estimated on ${seal.length} jobs.` }); }
  const crack = ratio('crackBoxes', s => s.crack?.boxes || 0);
  if (crack.length >= 2 && Math.abs(avg(crack) - 1) >= 0.1) { const from = n(settings.crack?.wastePct); const to = Math.round(cap(((1 + from / 100) * avg(crack) - 1) * 100, 0, 100)); if (to !== from) out.push({ path: 'crack.wastePct', label: 'Crack filler waste', from, to, why: `You used ${Math.round(Math.abs(avg(crack) - 1) * 100)}% ${avg(crack) > 1 ? 'more' : 'less'} crack filler than estimated on ${crack.length} jobs.` }); }
  return out.filter(x => x.to > 0 && x.to !== x.from);
}

// plain text for a text message / email
export function invoiceText(inv, company, today) {
  const d = inv.data || {}; const bal = balanceOf(inv);
  const st = invoiceState(inv, today);
  return [
    `Invoice No. ${inv.number || ''} from ${company?.name || ''}`.trim(),
    `${d.title || ''}${d.address ? ', ' + d.address : ''}`,
    '',
    `Total: ${usdPlain(inv.total)}`,
    paidOn(inv) > 0 ? `Paid: ${usdPlain(paidOn(inv))}` : '',
    st === 'paid' ? 'Paid in full. Thank you!' : `Amount due: ${usdPlain(bal)}${inv.due_date ? ` by ${new Date(inv.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}`,
    st === 'overdue' ? `This invoice is ${daysLate(inv, today)} day${daysLate(inv, today) === 1 ? '' : 's'} past due.` : '',
    d.note ? '\n' + d.note : '',
    company?.phone ? `\nQuestions? Call ${company.phone}` : ''
  ].filter(x => x !== '').join('\n').replace(/\n{3,}/g, '\n\n');
}
