import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPackages, applyPackage, estimatePackages, includes } from '../src/packages.js';

const full = { seal: { on: true, sqft: 30000, coats: 2 }, crack: { on: true, lf: 800 }, stripe: { on: true, rows: [{ stalls: 44 }] } };

test('a sealcoat job gets Basic / Standard / Premium, priced low to high', () => {
  const list = suggestPackages(full);
  assert.deepEqual(list.map(p => p.name), ['Basic', 'Standard', 'Premium']);
  const r = estimatePackages(full, {}, [], list);
  assert.ok(r[0].est.total < r[1].est.total && r[1].est.total < r[2].est.total, r.map(x => x.est.total).join(' < '));
  assert.equal(r[0].est.seal.coats, 1); assert.equal(r[2].est.seal.coats, 3);
  assert.ok(!r[0].est.crack && !r[0].est.stripe, 'Basic is sealer only');
});
test('Standard matches the plain estimate exactly', async () => {
  const { estimate } = await import('../src/calc.js');
  const r = estimatePackages(full, {}, [], suggestPackages(full));
  assert.equal(r[1].est.total, estimate(full, {}, []).total);
});
test('crack + striping job (no sealcoat) gets 2 options', () => {
  const i = { crack: { on: true, lf: 500 }, stripe: { on: true, rows: [{ stalls: 20 }] } };
  const list = suggestPackages(i); assert.equal(list.length, 2);
  const r = estimatePackages(i, {}, [], list); assert.ok(r[0].est.total < r[1].est.total);
});
test('one-service job gets a single option', () => {
  assert.equal(suggestPackages({ crack: { on: true, lf: 5000 } }).length, 1);
});
test('an option cannot turn on a service with nothing measured', () => {
  const i = applyPackage({ seal: { on: false, sqft: 0 }, crack: { on: true, lf: 100 } }, { seal: { on: true, coats: 2 }, crack: { on: true } });
  assert.equal(i.seal.on, false);
});
test('option extras add to the price and show in the included list', () => {
  const pkg = { name: 'Plus', seal: { on: true, coats: 2 }, crack: { on: true }, stripe: { on: true }, extras: [{ label: 'Oil spot primer', amount: 150 }] };
  const [r] = estimatePackages(full, {}, [], [pkg]);
  const [plain] = estimatePackages(full, {}, [], [{ ...pkg, extras: [] }]);
  assert.equal(Math.round(r.est.total - plain.est.total), 150);
  assert.ok(r.includes.includes('Oil spot primer'));
});
test('junk options never crash', () => {
  assert.doesNotThrow(() => estimatePackages(full, {}, [], [null, {}, { seal: 'x', extras: 'y' }].filter(Boolean)));
  assert.doesNotThrow(() => applyPackage(null, null));
  assert.doesNotThrow(() => suggestPackages(null));
  assert.deepEqual(includes({}, { }), []);
});
test('inputs are not modified by applying an option', () => {
  const before = JSON.stringify(full); applyPackage(full, { seal: { on: true, coats: 3 } }); assert.equal(JSON.stringify(full), before);
});
