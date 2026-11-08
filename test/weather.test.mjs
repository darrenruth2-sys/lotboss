import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeDay, jobDates, parseOpenMeteo, servicesOf, forecast } from '../src/weather.js';

const day = (o = {}) => ({ date: '2026-11-10', hi: 68, lo: 48, rainPct: 5, windMph: 8, ...o });

test('a nice day is a go for everything', () => {
  assert.equal(judgeDay(['seal', 'crack', 'stripe'], day(), day()).level, 'go');
});
test('sealcoat at 47°F is a no-go, crack fill alone is fine', () => {
  assert.equal(judgeDay(['seal'], day({ hi: 47 })).level, 'no');
  assert.equal(judgeDay(['crack'], day({ hi: 47 })).level, 'go');
  assert.equal(judgeDay(['crack'], day({ hi: 38 })).level, 'no');
});
test('rain chance: 60% no-go, 35% risky', () => {
  assert.equal(judgeDay(['stripe'], day({ rainPct: 60 })).level, 'no');
  assert.equal(judgeDay(['stripe'], day({ rainPct: 35 })).level, 'risky');
});
test('sealcoat needs the next day dry too', () => {
  const r = judgeDay(['seal'], day(), day({ rainPct: 80 }));
  assert.equal(r.level, 'risky'); assert.ok(r.reasons.some(x => /next day/.test(x)));
  assert.equal(judgeDay(['stripe'], day(), day({ rainPct: 80 })).level, 'go');
});
test('cold night after sealing and high wind are warnings', () => {
  assert.equal(judgeDay(['seal'], day({ lo: 33 })).level, 'risky');
  assert.equal(judgeDay(['stripe'], day({ windMph: 30 })).level, 'risky');
  assert.equal(judgeDay(['crack'], day({ windMph: 30 })).level, 'go');
});
test('your own rules from settings win', () => {
  assert.equal(judgeDay(['seal'], day({ hi: 47 }), null, { sealMinF: 45 }).level, 'risky'); // allowed, but within 5°F of your minimum
  assert.equal(judgeDay(['seal'], day({ hi: 55 }), null, { sealMinF: 45 }).level, 'go');
  assert.equal(judgeDay(['seal'], day({ hi: 47 }), null, { sealMinF: 'junk' }).level, 'no');
});
test('no forecast = unknown, never crashes', () => {
  assert.equal(judgeDay(['seal'], null).level, 'unknown');
  assert.doesNotThrow(() => judgeDay(null, {}, undefined, null));
});
test('job dates span the right days, across a month end', () => {
  assert.deepEqual(jobDates('2026-11-29', 3), ['2026-11-29', '2026-11-30', '2026-12-01']);
  assert.deepEqual(jobDates('2026-11-10', 0.5), ['2026-11-10']);
  assert.deepEqual(jobDates(null, 2), []);
});
test('reads Open-Meteo answers and survives junk', () => {
  const days = parseOpenMeteo({ daily: { time: ['2026-11-10'], temperature_2m_max: [61], temperature_2m_min: [40], precipitation_probability_max: [20], precipitation_sum: [0], wind_speed_10m_max: [9], weather_code: [2] } });
  assert.deepEqual(days[0], { date: '2026-11-10', hi: 61, lo: 40, rainPct: 20, rainIn: 0, windMph: 9, code: 2 });
  assert.deepEqual(parseOpenMeteo(null), []); assert.deepEqual(parseOpenMeteo({ daily: {} }), []);
});
test('services come from what is turned on in the estimate', () => {
  assert.deepEqual(servicesOf({ seal: { on: true }, stripe: { on: true } }), ['seal', 'stripe']);
});
test('forecast: no location = null; network failure = null, no crash', async () => {
  assert.equal(await forecast(null, null), null);
  assert.equal(await forecast(39.9, -82, async () => { throw new Error('offline'); }), null);
});

test('forecast service sends garbage: never NaN on screen, never a crash', async () => {
  const bad = async () => ({ ok: true, json: async () => { throw new Error('not json'); } });
  assert.equal(await forecast(40.1, -82.1, bad), null);
  const partial = parseOpenMeteo({ daily: { time: ['2026-11-10', '2026-11-11'], temperature_2m_max: [null], precipitation_probability_max: ['x'] } });
  for (const d of partial) { const r = judgeDay(['seal'], d, null); assert.ok(['go', 'risky', 'no', 'unknown'].includes(r.level)); assert.ok(!r.reasons.join(' ').match(/NaN|undefined|null/), r.reasons.join(' ')); }
});
