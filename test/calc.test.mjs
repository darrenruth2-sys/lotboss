import test from 'node:test';
import assert from 'node:assert/strict';
import { adaRequired, sealcoat, tankMix, crackFill, striping, estimate, stallLines, hashLf, DEFAULTS, merge } from '../src/calc.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('ADA table 208.2 including van spaces', () => {
  const cases = [[0, 0, 0], [1, 1, 1], [25, 1, 1], [26, 2, 1], [45, 2, 1], [50, 2, 1], [51, 3, 1], [100, 4, 1], [101, 5, 1], [150, 5, 1], [200, 6, 1], [300, 7, 2], [400, 8, 2], [500, 9, 2], [501, 11, 2], [1000, 20, 4], [1001, 21, 4], [1100, 21, 4], [1101, 22, 4]];
  for (const [total, acc, van] of cases) assert.deepEqual(adaRequired(total), { accessible: acc, van }, `total ${total}`);
});

test('paint coverage: 4 in line at 15 mils is about 321 lf per gallon', () => {
  const r = striping({ lines: [{ lf: 321, color: 'white' }], adaAuto: false }, DEFAULTS.stripe);
  assert.equal(r.lfPerGal, 321);
  near(r.paint[0].gal, 1, 0.01);
});

test('stall lines: single row of 10 = 11 lines, double = 22 lines, 18 ft deep', () => {
  assert.equal(stallLines({ stalls: 10, style: 'single' }, DEFAULTS.stripe), 198);
  assert.equal(stallLines({ stalls: 10, style: 'double' }, DEFAULTS.stripe), 396);
  assert.equal(stallLines({ stalls: 0 }, DEFAULTS.stripe), 0);
});

test('hash: 300 sq ft at 24 in spacing + 70 ft border = 220 lf', () => {
  assert.equal(hashLf(300, 70, 24), 220);
});

test('crack fill: 5000 lf at 1/2 x 1/2 in needs 22 boxes of 30 lb', () => {
  const r = crackFill(5000, DEFAULTS.crack);
  near(r.lbPerLf, 0.12, 0.005);
  assert.equal(r.boxes, 22);
  assert.ok(r.lfPerBox >= 225 && r.lfPerBox <= 232, String(r.lfPerBox));
  assert.equal(r.price, 5000);
});

test('sealcoat: 10,000 sq ft x 2 coats', () => {
  const r = sealcoat(10000, 2, DEFAULTS.sealcoat);
  assert.equal(r.mixedGal, 250);
  assert.equal(r.concentrateGal, 178);
  assert.equal(r.materials.find(m => m.item === 'Sand').qty, 11);
  assert.equal(r.price, 1800);
  near(r.tankLoads, 250 / 550, 0.01);
});

test('tank mix fills a 550 gal tank exactly', () => {
  const t = tankMix(DEFAULTS.sealcoat);
  const vol = t.concentrateGal + t.waterGal + t.additiveGal + t.sandLb * 0.045;
  near(vol, 550, 1);
  assert.ok(t.concentrateGal > 380 && t.concentrateGal < 400);
});

test('Red Lobster restripe: 45 stalls, auto ADA adds 2 handicap + 1 van stencil + 2 signs', () => {
  const r = striping({ rows: [{ stalls: 35, style: 'single' }, { stalls: 10, style: 'single' }], stopBars: 4, stencils: { stop: 4, arrow: 2, noParking: 7 }, hash: [{ sqft: 300, perimeter: 0, color: 'white' }] }, DEFAULTS.stripe);
  assert.equal(r.stalls, 45);
  assert.equal(r.ada.accessible, 2); assert.equal(r.ada.van, 1);
  assert.equal(r.stencils.find(s => s.key === 'handicap').qty, 2);
  assert.equal(r.stencils.find(s => s.key === 'van').qty, 1);
  assert.equal(r.signs, 2);
  assert.equal(r.lf.stalls, (36 + 11) * 18);
  assert.equal(r.lf.stopBars, 48);
  assert.ok(r.paint.find(p => p.color === 'blue'));
});

test('ADA can be turned off for an exact restripe (e.g. 5 handicap 2 van already there)', () => {
  const r = striping({ rows: [{ stalls: 45 }], adaAuto: false, adaSpaces: 5, vanSpaces: 2, stencils: { handicap: 5, van: 2 }, signs: 0 }, DEFAULTS.stripe);
  assert.equal(r.ada.accessible, 5);
  assert.equal(r.signs, 0);
  assert.equal(r.stencils.find(s => s.key === 'handicap').qty, 5);
});

test('estimate: minimum job price kicks in and is shown as a line', () => {
  const e = estimate({ crack: { on: true, lf: 200 } }, {}, []);
  assert.equal(e.subtotal, 500);
  assert.ok(e.minimumApplied);
  assert.ok(e.lines.some(l => /Minimum/.test(l.label)));
});

test('estimate: 5000 lf crack job is way past minimum, with crew wages and profit', () => {
  const crew = [{ id: 'a', name: 'Mike', wage: 20 }, { id: 'b', name: 'Josh', wage: 18 }];
  const e = estimate({ crack: { on: true, lf: 5000 }, crewIds: ['a', 'b'] }, {}, crew);
  assert.equal(e.subtotal, 5000);
  assert.equal(e.overMinimumBy, 4500);
  assert.equal(e.crew.size, 2);
  assert.equal(e.crew.avgWage, 19);
  assert.ok(e.time.days >= 2 && e.time.days <= 3, String(e.time.days));
  assert.ok(e.cost.labor > 0 && e.cost.materials > 600);
  near(e.profit, e.subtotal - e.cost.total, 0.02);
  assert.ok(e.marginPct > 30);
});

test('estimate: losing money is flagged', () => {
  const e = estimate({ seal: { on: true, sqft: 20000, coats: 2 } }, { sealcoat: { pricePerSqft: 0.03 } }, []);
  assert.ok(e.warnings.some(w => /loses/.test(w)));
});

test('settings merge keeps nested defaults', () => {
  const s = merge(DEFAULTS, { stripe: { pricePerLf: 0.5 } });
  assert.equal(s.stripe.pricePerLf, 0.5);
  assert.equal(s.stripe.stencils.handicap.price, 25);
  assert.equal(s.sealcoat.coats, 2);
});

test('discount and tax', () => {
  const e = estimate({ seal: { on: true, sqft: 10000, coats: 2 }, discountPct: 10 }, { taxPct: 7 }, []);
  assert.equal(e.subtotal, 1620);
  near(e.tax, 113.4);
  near(e.total, 1733.4);
});

test('bad input never crashes and gives zero', () => {
  const e = estimate({ seal: { on: true, sqft: 'abc' }, crack: { on: true, lf: -5 }, stripe: { on: true, rows: [{ stalls: 'x' }] } }, null, null);
  assert.equal(e.subtotal, 0);
  assert.equal(e.total, 0);
});

test('driveway jobs skip the commercial minimum (each driveway has its own)', async () => {
  const { estimate } = await import('../src/calc.js');
  const e = estimate({ kind: 'driveway', extras: [{ label: 'Driveway', amount: 180 }, { label: 'Driveway', amount: 150 }] }, {});
  assert.equal(e.minimumApplied, false); assert.equal(e.subtotal, 330);
  assert.equal(estimate({ extras: [{ label: 'Small', amount: 180 }] }, {}).minimumApplied, true, 'lots still get the minimum');
});
