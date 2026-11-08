import test from 'node:test';
import assert from 'node:assert/strict';
import { jobDays, weekOf, offOn, cleanOff, jobsOn, problems, bookingWarnings, freeOn, weekText, myCrew, addDays } from '../src/crewplan.js';

const crew = [{ id: 'a', name: 'Tyler', time_off: [{ from: '2026-11-12', to: '2026-11-13', note: 'Deer season' }] }, { id: 'b', name: 'Bo', time_off: [] }, { id: 'c', name: 'Cody' }];
const J = (id, date, days, ids, extra = {}) => ({ id, title: 'Job ' + id, scheduled_date: date, scheduled_days: days, crew_ids: ids, status: 'scheduled', ...extra });

test('job days: partial days round up, month ends roll over, lost/blank jobs have none', () => {
  assert.deepEqual(jobDays(J(1, '2026-11-29', 2.5, [])), ['2026-11-29', '2026-11-30', '2026-12-01']);
  assert.deepEqual(jobDays(J(1, '2026-11-10', 0, [])), ['2026-11-10']);
  assert.deepEqual(jobDays(J(1, '2026-11-10', 1, [], { status: 'lost' })), []);
  assert.deepEqual(jobDays(J(1, null, 1, [])), []); assert.deepEqual(jobDays(J(1, '2026-02-30x', 1, [])), []);
  assert.equal(jobDays(J(1, '2026-11-10', 1e9, [])).length, 60, 'a junk day count can\'t make a million days');
  assert.deepEqual(jobDays(null), []);
});
test('week: Monday to Sunday, across a year end, Sunday belongs to the week before', () => {
  assert.deepEqual(weekOf('2026-11-11'), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  assert.equal(weekOf('2026-11-15')[0], '2026-11-09');
  assert.deepEqual(weekOf('2026-12-31').slice(-3), ['2027-01-01', '2027-01-02', '2027-01-03']);
  assert.equal(weekOf('junk').length, 7);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});
test('time off: ranges, single days, junk ignored', () => {
  assert.equal(offOn(crew[0], '2026-11-12').note, 'Deer season'); assert.ok(offOn(crew[0], '2026-11-13')); assert.equal(offOn(crew[0], '2026-11-14'), null);
  assert.deepEqual(cleanOff([null, { from: 'x' }, { from: '2026-11-01' }, { from: '2026-11-05', to: '2026-11-01' }, 'junk']), [{ from: '2026-11-01', to: '2026-11-01', note: '' }, { from: '2026-11-05', to: '2026-11-05', note: '' }]);
  assert.equal(offOn({ time_off: 'nope' }, '2026-11-12'), null); assert.equal(offOn(null, '2026-11-12'), null);
});
test('double-booked and booked-on-a-day-off are both caught; finished jobs don\'t count', () => {
  const jobs = [J(1, '2026-11-10', 2, ['a', 'b']), J(2, '2026-11-11', 1, ['b']), J(3, '2026-11-12', 1, ['a']), J(4, '2026-11-11', 1, ['b'], { status: 'done' })];
  const p = problems(jobs, crew, weekOf('2026-11-10'));
  assert.deepEqual(p.filter(x => x.type === 'double').map(x => `${x.name} ${x.day}`), ['Bo 2026-11-11']);
  assert.deepEqual(p.filter(x => x.type === 'off').map(x => `${x.name} ${x.day}`), ['Tyler 2026-11-12']);
  assert.deepEqual(problems(null, null, null), []);
});
test('booking warnings name the person, the job and the days', () => {
  const jobs = [J(1, '2026-11-10', 3, ['b'])];
  const w = bookingWarnings(J(9, '2026-11-11', 2, ['a', 'b', 'zzz']), jobs, crew);
  assert.ok(w.some(x => /^Bo is already on Job 1 2026-11-11 to 2026-11-12\.$/.test(x)), w.join(' | '));
  assert.ok(w.some(x => /^Tyler is off 2026-11-12 \(Deer season\)\.$/.test(x)), w.join(' | '));
  assert.equal(w.length, 2);
  assert.deepEqual(bookingWarnings(J(1, '2026-11-10', 3, ['b']), jobs, crew), [], 'a job never conflicts with itself');
  assert.deepEqual(bookingWarnings(J(9, null, 1, ['b']), jobs, crew), [], 'no date, no warnings');
  assert.deepEqual(bookingWarnings(J(9, '2026-11-11', 1, null), jobs, crew), []);
});
test('who\'s free', () => {
  const jobs = [J(1, '2026-11-12', 1, ['b'])];
  assert.deepEqual(freeOn(jobs, crew, '2026-11-12').map(c => c.name), ['Cody']);
});
test('week text for a crew member', () => {
  const jobs = [J(1, '2026-11-10', 2, ['a'], { address: '3500 Maple Ave' }), J(2, '2026-11-14', 1, ['b'])];
  const t = weekText(crew[0], jobs, weekOf('2026-11-10'), 'Rutherford Paving');
  assert.match(t, /^Tyler schedule from Rutherford Paving:/);
  assert.match(t, /2026-11-10: Job 1, 3500 Maple Ave \(day 1 of 2\)/);
  assert.match(t, /2026-11-11: Job 1, 3500 Maple Ave \(day 2 of 2\)/);
  assert.match(t, /2026-11-12: off \(Deer season\)/);
  assert.ok(!/Job 2/.test(t), 'only their own jobs');
  assert.match(weekText(crew[2], jobs, weekOf('2026-11-10')), /Nothing scheduled/);
  assert.ok(!/undefined|null|NaN/.test(weekText(null, null, null)));
});
test('finding your own crew record', () => {
  assert.equal(myCrew([{ id: 'a' }, { id: 'b', is_me: true }]).id, 'b');
  assert.equal(myCrew([{ id: 'a', user_id: 'u1' }], 'u1').id, 'a');
  assert.equal(myCrew([{ id: 'a' }], 'u1'), null); assert.equal(myCrew(null), null);
});
test('jobsOn ignores junk jobs', () => {
  assert.deepEqual(jobsOn([null, { crew_ids: 'a' }, J(1, '2026-11-10', 1, ['a'])], 'a', '2026-11-10').map(j => j.id), [1]);
});
