// LotBoss: who to follow up with today. Unsigned quotes, late payments, review requests, reseal reminders.
// Pure functions. The messages are sent from your own phone (sms:/mailto: links), so nothing here costs money.
import { invoiceState, balanceOf, daysLate, invoiceText } from './money.js';

const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00'));
const day = v => { if (!v) return null; const s = String(v); if (isDay(s.slice(0, 10))) return s.slice(0, 10); return null; };
const between = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
export const addDays = (d, k) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const first = name => String(name || '').trim().split(/\s+/)[0] || 'there';
const usd = v => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');

export const FOLLOW_DEFAULTS = { quoteNudgeDays: 3, quoteSecondNudgeDays: 10, reviewAfterDays: 1, reviewWindowDays: 45, resealYears: 3, resealLeadDays: 30, reviewLink: '' };
export const KIND_WORD = { lead: 'New website request', quote: 'Quote check-in', payment: 'Payment reminder', review: 'Ask for a review', reseal: 'Reseal reminder' };

// when a job's work finished: the wrap-up date, else the last scheduled day, else when it was last changed
export function doneDay(job, costs) {
  const w = day(costs?.data?.doneAt); if (w) return w;
  if (isDay(job?.scheduled_date)) return addDays(job.scheduled_date, Math.max(1, Math.ceil(Number(job.scheduled_days) || 1)) - 1);
  return day(job?.updated_at);
}

// state: { [job_id + '|' + key]: { state: 'done'|'snoozed'|'never', until } }
function hidden(state, jobId, key, today) {
  const s = state?.[jobId + '|' + key] || state?.[jobId + '|*'];
  if (!s) return false;
  if (s.state === 'never' || s.state === 'done') return true;
  if (s.state === 'snoozed') return !(isDay(s.until) && s.until <= today);
  return false;
}

/**
 * Build today's follow-up list.
 * jobs: [{ id, title, status, customer, inputs, scheduled_date, scheduled_days, updated_at }]
 * quotes: open quotes [{ id, job_id, number, status: 'sent'|'viewed', created_at, viewed_at, expires_at, share_token, total }]
 * invoices, costs: [{ job_id, data: { doneAt } }]
 */
export function followUps({ jobs = [], quotes = [], invoices = [], costs = [], state = {}, settings = {}, company = {}, me = '', today, quoteUrl = t => t }) {
  const S = { ...FOLLOW_DEFAULTS, ...(settings || {}) };
  const T = isDay(today) ? today : new Date().toISOString().slice(0, 10);
  const byJob = Object.fromEntries((jobs || []).filter(j => j && j.id).map(j => [j.id, j]));
  const costOf = Object.fromEntries((costs || []).filter(Boolean).map(c => [c.job_id, c]));
  const items = [];
  const sig = `${me ? me + ' with ' : ''}${company.name || 'us'}`.trim();
  const add = (job, kind, key, due, extra) => { if (hidden(state, job.id, key, T)) return; items.push({ id: job.id + '|' + key, jobId: job.id, key, kind, due, overdueDays: Math.max(0, between(due, T)), title: job.title || 'Job', customer: job.customer || {}, ...extra }); };

  // 0. new requests from your website form: call them while they're hot
  for (const job of jobs || []) {
    if (!job || job.status !== 'lead' || job.inputs?.source !== 'web') continue;
    const at = day(job.inputs?.web?.at) || day(job.created_at); if (!at || between(at, T) > 14) continue;
    const w = job.inputs.web || {};
    add(job, 'lead', 'web-lead', at, { why: `Asked for a price on your website ${between(at, T) === 0 ? 'today' : between(at, T) + ' day' + (between(at, T) === 1 ? '' : 's') + ' ago'}${w.low ? `; saw ${usd(w.low)}-${usd(w.high)}` : ''}.`, message: `Hi ${first(job.customer?.name)}, it's ${sig}. Thanks for asking about ${job.address || job.title}. I'd like to swing by and take a quick look so I can give you an exact price. What day works for you?`, subject: `Your quote request${job.address ? ' for ' + job.address : ''}`, hot: true });
  }

  // 1. quotes nobody answered
  const latest = {};
  for (const q of quotes || []) { if (!q || !byJob[q.job_id] || !['sent', 'viewed'].includes(q.status)) continue; if (!latest[q.job_id] || q.number > latest[q.job_id].number) latest[q.job_id] = q; }
  for (const q of Object.values(latest)) {
    const job = byJob[q.job_id]; if (['won', 'scheduled', 'done', 'lost'].includes(job.status)) continue;
    const sent = day(q.created_at); if (!sent) continue;
    const age = between(sent, T); const expired = q.expires_at && day(q.expires_at) < T;
    const stage = age >= S.quoteSecondNudgeDays ? 2 : age >= S.quoteNudgeDays ? 1 : 0; if (!stage) continue;
    const key = `quote-${q.number}-${stage}`;
    const viewed = q.status === 'viewed' || !!q.viewed_at;
    const link = q.share_token ? quoteUrl(q.share_token) : '';
    const msg = stage === 1
      ? `Hi ${first(job.customer?.name)}, it's ${sig}. Just checking that you got the quote for ${job.title}${q.total ? ` (${usd(q.total)})` : ''}. Happy to answer any questions or walk the lot with you.${link ? ' ' + link : ''}`
      : `Hi ${first(job.customer?.name)}, ${sig} again. Wanted to follow up one more time on ${job.title}. ${expired ? 'Your quote expired, but I can honor that price if we get you on the schedule this month.' : 'The quote is still good if you\'d like to get on the schedule.'}${link ? ' ' + link : ''}`;
    add(job, 'quote', key, addDays(sent, stage === 1 ? S.quoteNudgeDays : S.quoteSecondNudgeDays), { why: `Quote ${q.number} sent ${age} day${age === 1 ? '' : 's'} ago${viewed ? ', they opened it' : ', not opened yet'}${expired ? ', now expired' : ''}.`, message: msg, subject: `Your quote for ${job.title}`, hot: viewed });
  }

  // 2. late payments
  for (const inv of invoices || []) {
    const job = byJob[inv?.job_id]; if (!job || invoiceState(inv, T) !== 'overdue') continue;
    const late = daysLate(inv, T); const bucket = late >= 30 ? 30 : late >= 14 ? 14 : 1;
    add(job, 'payment', `pay-${inv.number}-${bucket}`, addDays(inv.due_date, bucket === 1 ? 1 : bucket), { why: `Invoice ${inv.number}: ${usd(balanceOf(inv))} is ${late} day${late === 1 ? '' : 's'} late.`, message: `Hi ${first(job.customer?.name)}, it's ${sig}. Friendly reminder on invoice ${inv.number} for ${job.title}.\n\n${invoiceText(inv, company, T)}`, subject: `Invoice ${inv.number} from ${company.name || ''}`.trim(), hot: late >= 30 });
  }

  // 3 + 4. finished jobs: review request, then reseal reminder years later
  for (const job of jobs || []) {
    if (!job || job.status !== 'done') continue;
    const done = doneDay(job, costOf[job.id]); if (!done) continue;
    const age = between(done, T);
    if (age >= S.reviewAfterDays && age <= S.reviewWindowDays) {
      add(job, 'review', 'review', addDays(done, S.reviewAfterDays), { why: `Finished ${age} day${age === 1 ? '' : 's'} ago.`, message: `Hi ${first(job.customer?.name)}, thanks for choosing ${company.name || 'us'} for ${job.title}! If you're happy with how it turned out, would you leave us a quick review? ${S.reviewLink || '[add your Google review link in Settings]'} It really helps a small business. Thank you!`, subject: `Thanks from ${company.name || 'us'}`, needsLink: !S.reviewLink });
    }
    if (job.inputs?.seal?.on) {
      const due = addDays(done, Math.round(S.resealYears * 365) - S.resealLeadDays);
      if (due <= T && between(due, T) <= 365) {
        const yrs = Math.max(1, Math.round(age / 365));
        add(job, 'reseal', `reseal-${done.slice(0, 4)}`, due, { why: `Sealed ${done.slice(0, 7)}, about ${yrs} year${yrs === 1 ? '' : 's'} ago.`, message: `Hi ${first(job.customer?.name)}, it's ${sig}. It's been about ${yrs} year${yrs === 1 ? '' : 's'} since we sealed ${job.title}. Resealing every ${S.resealYears} years or so keeps the cracks and potholes away and the lot looking sharp. Want me to swing by and send you a fresh quote?`, subject: `Time to reseal ${job.title}?`, hot: false });
      }
    }
  }
  const rank = { lead: 0, payment: 1, quote: 2, review: 3, reseal: 4 };
  return items.sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || rank[a.kind] - rank[b.kind] || a.due.localeCompare(b.due));
}

// links that open the person's own texting / email app with the message filled in
export function smsLink(phone, text) { const p = String(phone || '').replace(/[^\d+]/g, ''); return p ? `sms:${p}?&body=${encodeURIComponent(text)}` : null; }
export function mailLink(email, subject, text) { const e = String(email || '').trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? `mailto:${encodeURIComponent(e)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : null; }
