import test from 'node:test';
import assert from 'node:assert/strict';
import { webPrice, cleanLead, cleanRing, webSettings } from '../src/webquote.js';
import { estimate, merge, DEFAULTS } from '../src/calc.js';

const on = { webForm: { on: true } };
test('price range brackets the real estimate by your range %', () => {
  const r = webPrice({ sqft: 30000, seal: true, crack: true, stripe: true, crackLevel: 'some' }, on);
  assert.ok(!r.error, r.error);
  assert.ok(r.low < r.total && r.total < r.high, `${r.low} < ${r.total} < ${r.high}`);
  assert.ok(Math.abs(r.low - r.total * 0.85) < 60 && Math.abs(r.high - r.total * 1.15) < 60);
  assert.equal(r.crackLf, 450); assert.equal(r.stalls, 91); assert.ok(r.guessedStalls);
  const exact = estimate({ seal: { on: true, sqft: 30000 }, crack: { on: true, lf: 450 }, stripe: { on: true, rows: [{ stalls: 91 }] } }, merge(DEFAULTS, on), []);
  assert.equal(r.total, Math.round(exact.total), 'same math as your own estimate');
});
test('your rates and range % are used', () => {
  const base = webPrice({ sqft: 20000, seal: true }, on);
  const pricey = webPrice({ sqft: 20000, seal: true }, { ...on, sealcoat: { pricePerSqft: 0.5 } });
  assert.ok(pricey.total > base.total);
  const tight = webPrice({ sqft: 20000, seal: true }, { webForm: { on: true, rangePct: 5 } });
  assert.ok(tight.high - tight.low < base.high - base.low);
  const wild = webPrice({ sqft: 20000, seal: true }, { webForm: { on: true, rangePct: 900 } });
  assert.ok(wild.low >= 0 && wild.high <= wild.total * 1.5 + 50, 'range % capped at 50');
});
test('typed stall count wins; services you turned off are ignored', () => {
  assert.equal(webPrice({ sqft: 20000, stripe: true, stalls: 40 }, on).stalls, 40);
  const off = webPrice({ sqft: 20000, seal: true, stripe: true }, { webForm: { on: true, services: { stripe: false } } });
  assert.equal(off.services.stripe, false); assert.equal(off.stalls, 0);
  assert.match(webPrice({ sqft: 20000, stripe: true }, { webForm: { on: true, services: { stripe: false } } }).error, /at least one/);
});
test('minimum job price applies to small lots', () => {
  const r = webPrice({ sqft: 600, seal: true }, { ...on, minimumJob: 750 });
  assert.equal(r.low, 750); assert.ok(r.high >= 750);
});
test('junk and attacks', () => {
  assert.match(webPrice({ sqft: 100, seal: true }, on).error, /Outline/);
  assert.match(webPrice({ sqft: 1e9, seal: true }, on).error, /too big/);
  assert.match(webPrice({ sqft: 'abc', seal: true }, on).error, /Outline/);
  assert.match(webPrice({ sqft: 20000 }, on).error, /at least one/);
  assert.doesNotThrow(() => webPrice(null, null));
  const r = webPrice({ sqft: 20000, crack: true, crackLevel: '__proto__', stalls: -5, stripe: true }, on);
  assert.equal(r.crackLevel, 'some'); assert.ok(r.stalls > 0);
});
test('cleaning what strangers type', () => {
  assert.match(cleanLead({}).error, /name/);
  assert.match(cleanLead({ name: 'Bo' }).error, /phone number or email/);
  assert.match(cleanLead({ name: 'Bo', phone: '123' }).error, /phone/);
  assert.match(cleanLead({ name: 'Bo', email: 'nope' }).error, /email/);
  assert.match(cleanLead({ name: 'Bo', phone: '740-555-0100' }).error, /address/);
  const ok = cleanLead({ name: '  Bo\u0000 <b>Smith</b>  ', phone: '(740) 555-0100', address: 'x'.repeat(500), note: 'line1\nline2' });
  assert.equal(ok.lead.name, 'Bo <b>Smith</b>'); assert.equal(ok.lead.address.length, 200); assert.equal(ok.lead.note, 'line1\nline2');
});
test('lot shape cleaning', () => {
  assert.equal(cleanRing(null), null); assert.equal(cleanRing([[0, 0], [1, 1]]), null);
  assert.equal(cleanRing([[0, 0], [1, 'x'], [999, 1], [2, 2]]), null);
  const r = cleanRing([[-82, 39.9], [-82.001, 39.9], [-82.001, 39.901]]);
  assert.equal(r.length, 4); assert.deepEqual(r[0], r[3]);
  assert.equal(cleanRing(Array.from({ length: 1000 }, (_, i) => [-82 + i * 1e-5, 39.9 + (i % 2) * 1e-5])).length, 201);
});
test('form settings defaults', () => {
  assert.deepEqual(webSettings({}).services, { seal: true, crack: true, stripe: true });
  assert.equal(webSettings({ webForm: { on: true } }).rangePct, 15);
});
