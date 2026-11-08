import test from 'node:test';
import assert from 'node:assert/strict';
import { followUps, doneDay, smsLink, mailLink, addDays } from '../src/followups.js';

const T = '2026-11-08';
const co = { name: 'Rutherford Paving', phone: '740-555-0100' };
const job = (id, extra = {}) => ({ id, title: 'Job ' + id, status: 'quoted', customer: { name: 'Karen Walsh', phone: '740-555-0147', email: 'k@x.com' }, inputs: {}, ...extra });
const q = (job_id, daysAgo, extra = {}) => ({ id: 'q' + job_id, job_id, number: 1001, status: 'sent', created_at: addDays(T, -daysAgo) + 'T10:00:00Z', share_token: 'abc', total: 4200, ...extra });
const run = (o = {}) => followUps({ company: co, me: 'Darren', today: T, quoteUrl: t => 'https://x/#/q/' + t, ...o });

test('unsigned quote: nothing at 2 days, check-in at 3, second at 10', () => {
  assert.equal(run({ jobs: [job('a')], quotes: [q('a', 2)] }).length, 0);
  const one = run({ jobs: [job('a')], quotes: [q('a', 3)] });
  assert.equal(one.length, 1); assert.equal(one[0].kind, 'quote');
  assert.match(one[0].message, /^Hi Karen, it's Darren with Rutherford Paving\. Just checking that you got the quote for Job a \(\$4,200\)/);
  assert.match(one[0].message, /https:\/\/x\/#\/q\/abc$/);
  assert.match(one[0].why, /not opened yet/);
  const two = run({ jobs: [job('a')], quotes: [q('a', 12, { status: 'viewed', expires_at: addDays(T, -1) + 'T00:00:00Z' })] });
  assert.equal(two.length, 1); assert.ok(two[0].key.endsWith('-2')); assert.match(two[0].message, /expired, but I can honor/); assert.ok(two[0].hot, 'opened but not signed goes to the top');
});
test('no quote nudge once they signed, declined, or the job moved on', () => {
  assert.equal(run({ jobs: [job('a', { status: 'won' })], quotes: [q('a', 5)] }).length, 0);
  assert.equal(run({ jobs: [job('a')], quotes: [q('a', 5, { status: 'accepted' })] }).length, 0);
  assert.equal(run({ jobs: [job('a')], quotes: [q('a', 5, { status: 'declined' })] }).length, 0);
  assert.equal(run({ jobs: [], quotes: [q('a', 5)] }).length, 0, 'quote for a deleted job');
  const newer = run({ jobs: [job('a')], quotes: [q('a', 20, { number: 1001 }), q('a', 4, { number: 1002, id: 'q2' })] });
  assert.equal(newer.length, 1); assert.match(newer[0].why, /Quote 1002 sent 4 days/, 'only the newest quote counts');
});
test('done / snoozed / never', () => {
  const base = { jobs: [job('a')], quotes: [q('a', 4)] };
  const key = run(base)[0].key;
  assert.equal(run({ ...base, state: { ['a|' + key]: { state: 'done' } } }).length, 0);
  assert.equal(run({ ...base, state: { ['a|' + key]: { state: 'snoozed', until: addDays(T, 3) } } }).length, 0);
  assert.equal(run({ ...base, state: { ['a|' + key]: { state: 'snoozed', until: T } } }).length, 1, 'snooze ends');
  assert.equal(run({ ...base, state: { 'a|*': { state: 'never' } } }).length, 0, 'never follow up on this job');
  assert.equal(run({ jobs: [job('a')], quotes: [q('a', 11)], state: { ['a|' + key]: { state: 'done' } } }).length, 1, 'doing the first check-in still brings the second one later');
});
test('late payments: reminder, then again at 14 and 30 days', () => {
  const inv = (late, paid = 0) => ({ job_id: 'a', number: 2001, status: 'open', total: 1000, due_date: addDays(T, -late), payments: paid ? [{ amount: paid, date: T, method: 'cash' }] : [], data: { title: 'Job a' } });
  assert.equal(run({ jobs: [job('a', { status: 'done' })], invoices: [inv(0)] }).filter(x => x.kind === 'payment').length, 0, 'not late yet');
  const p = run({ jobs: [job('a', { status: 'done' })], invoices: [inv(5, 400)] }).find(x => x.kind === 'payment');
  assert.match(p.why, /\$600 is 5 days late/); assert.match(p.message, /Friendly reminder on invoice 2001/);
  assert.ok(run({ jobs: [job('a', { status: 'done' })], invoices: [inv(31)] }).find(x => x.kind === 'payment').key.endsWith('-30'));
  assert.equal(run({ jobs: [job('a', { status: 'done' })], invoices: [inv(10, 1000)] }).filter(x => x.kind === 'payment').length, 0, 'paid up');
  assert.equal(run({ jobs: [job('a', { status: 'done' })], invoices: [{ ...inv(10), status: 'void' }] }).filter(x => x.kind === 'payment').length, 0, 'void');
});
test('review request the day after, for 45 days, with your link', () => {
  const done = (ago) => job('a', { status: 'done', scheduled_date: addDays(T, -ago), scheduled_days: 1 });
  assert.equal(run({ jobs: [done(0)] }).length, 0);
  const r = run({ jobs: [done(2)], settings: { reviewLink: 'https://g.page/r/xyz/review' } });
  assert.equal(r[0].kind, 'review'); assert.match(r[0].message, /https:\/\/g\.page\/r\/xyz\/review/); assert.ok(!r[0].needsLink);
  assert.ok(run({ jobs: [done(2)] })[0].needsLink, 'flags that the review link is missing');
  assert.equal(run({ jobs: [done(60)] }).filter(x => x.kind === 'review').length, 0, 'too long ago to ask');
});
test('reseal reminder about 3 years later, only for sealcoat jobs, within a year of due', () => {
  const sealed = (ago, seal = true) => job('a', { status: 'done', scheduled_date: addDays(T, -ago), scheduled_days: 1, inputs: { seal: { on: seal } } });
  assert.equal(run({ jobs: [sealed(700)] }).filter(x => x.kind === 'reseal').length, 0, '2 years: not yet');
  const r = run({ jobs: [sealed(3 * 365 - 10)] }).find(x => x.kind === 'reseal');
  assert.ok(r); assert.match(r.message, /about 3 years since we sealed Job a/);
  assert.equal(run({ jobs: [sealed(3 * 365, false)] }).filter(x => x.kind === 'reseal').length, 0, 'crack-only job: no reseal');
  assert.equal(run({ jobs: [sealed(6 * 365)] }).filter(x => x.kind === 'reseal').length, 0, 'way overdue: dropped after a year');
  assert.ok(run({ jobs: [sealed(2 * 365 - 10)], settings: { resealYears: 2 } }).find(x => x.kind === 'reseal'), 'your own reseal years');
});
test('done day prefers the wrap-up date', () => {
  assert.equal(doneDay({ scheduled_date: '2026-01-01', scheduled_days: 3 }, { data: { doneAt: '2026-02-01' } }), '2026-02-01');
  assert.equal(doneDay({ scheduled_date: '2026-01-01', scheduled_days: 2.5 }), '2026-01-03');
  assert.equal(doneDay({ updated_at: '2026-03-04T10:00:00Z' }), '2026-03-04');
  assert.equal(doneDay(null), null);
});
test('order: hot first, then payments, quotes, reviews, reseals', () => {
  const jobs = [job('a'), job('b', { status: 'done', scheduled_date: addDays(T, -3) }), job('c', { status: 'done' }), job('d')];
  const items = run({ jobs, quotes: [q('a', 4), q('d', 4, { status: 'viewed' })], invoices: [{ job_id: 'c', number: 9, total: 50, due_date: addDays(T, -3), payments: [], status: 'open' }] });
  assert.deepEqual(items.map(x => x.kind + ':' + x.jobId), ['quote:d', 'payment:c', 'quote:a', 'review:b']);
});
test('junk never crashes, messages never say undefined', () => {
  assert.doesNotThrow(() => followUps({}));
  assert.doesNotThrow(() => followUps({ jobs: [null, {}, { id: 'x', status: 'done', inputs: null }], quotes: [null, { job_id: 'x' }], invoices: [null, {}], costs: [null] }));
  const items = run({ jobs: [job('a', { customer: null, title: '' })], quotes: [q('a', 4, { share_token: null, total: null })] });
  assert.ok(!/undefined|null|NaN/.test(items[0].message), items[0].message);
  assert.match(items[0].message, /^Hi there/);
});
test('text and email links', () => {
  assert.equal(smsLink('(740) 555-0147', 'Hi & bye'), 'sms:7405550147?&body=Hi%20%26%20bye');
  assert.equal(smsLink('', 'x'), null);
  assert.match(mailLink('k@x.com', 'Sub', 'Body'), /^mailto:k%40x\.com\?subject=Sub&body=Body$/);
  assert.equal(mailLink('not an email', 's', 'b'), null);
});

test('new website requests come first, for 2 weeks', () => {
  const web = (ago, extra = {}) => job('w', { status: 'lead', address: '1240 Military Rd', inputs: { source: 'web', web: { low: 2600, high: 3500, at: addDays(T, -ago) + 'T10:00:00Z' } }, ...extra });
  const r = run({ jobs: [web(1), job('a')], quotes: [q('a', 4)] });
  assert.equal(r[0].kind, 'lead'); assert.ok(r[0].hot);
  assert.match(r[0].message, /Thanks for asking about 1240 Military Rd/); assert.match(r[0].why, /\$2,600-\$3,500/);
  assert.equal(run({ jobs: [web(20)] }).length, 0, 'too old');
  assert.equal(run({ jobs: [web(1, { status: 'quoted' })] }).filter(x => x.kind === 'lead').length, 0, 'once you quote it, it is a quote follow-up instead');
  assert.equal(run({ jobs: [job('x', { status: 'lead' })] }).length, 0, 'leads you typed in yourself don\'t show');
});
