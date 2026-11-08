// Throw garbage and extremes at the math. Nothing may crash or produce NaN/Infinity, and results must make physical sense.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, sealcoat, crackFill, striping, tankMix, adaRequired, DEFAULTS, merge } from '../src/calc.js';
import { measureFeature, drawingTotals, effectiveInputs } from '../src/geo.js';

const JUNK = [undefined, null, '', ' ', 'abc', NaN, Infinity, -Infinity, -1, -1e9, 0, 0.0001, 1e15, '12', '1e3', [], {}, true, false, '５', '1,000'];
const pick = () => JUNK[Math.floor(Math.random() * JUNK.length)];
function deepFinite(obj, path = '') {
  const bad = [];
  (function walk(v, p) {
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(p + '=' + v);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p + '.' + k);
  })(obj, path);
  return bad;
}
let seed = 7; Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('estimate never returns NaN/Infinity for 3000 random junk inputs', () => {
  for (let i = 0; i < 3000; i++) {
    const inputs = {
      seal: { on: pick(), sqft: pick(), coats: pick() },
      crack: { on: pick(), lf: pick(), widthIn: pick(), depthIn: pick() },
      stripe: { on: pick(), rows: [{ stalls: pick(), style: pick(), depth: pick() }], stopBars: pick(), stopBarLen: pick(), curbLf: pick(), stencils: { handicap: pick(), arrow: pick(), weird: pick() }, adaAuto: pick(), adaSpaces: pick(), vanSpaces: pick(), signs: pick(), wheelStops: pick(), hash: [{ sqft: pick(), perimeter: pick() }], lines: [{ lf: pick(), color: pick() }] },
      crewIds: pick(), crewSize: pick(), avgWage: pick(), discountPct: pick(), extras: [{ label: pick(), amount: pick() }]
    };
    const settings = { minimumJob: pick(), taxPct: pick(), overheadPct: pick(), sealcoat: { pricePerSqft: pick(), sqftPerGalPerCoat: pick(), tankGal: pick() }, crack: { boxLb: pick(), lfPerPersonHour: pick() }, stripe: { mils: pick(), lineWidthIn: pick(), lfPerPersonHour: pick(), stallWidth: pick() } };
    let e;
    try { e = estimate(inputs, settings, [{ id: 'a', name: 'A', wage: pick() }]); }
    catch (err) { assert.fail(`crashed on #${i}: ${err.message}\n${JSON.stringify({ inputs, settings })}`); }
    const bad = deepFinite(e);
    assert.deepEqual(bad, [], `non-finite on #${i}: ${bad.join(', ')}\n${JSON.stringify({ inputs, settings })}`);
  }
});

test('negative quantities never produce a negative price', () => {
  const e = estimate({ seal: { on: true, sqft: -5000 }, crack: { on: true, lf: -100 }, stripe: { on: true, rows: [{ stalls: -10 }], stopBars: -3, curbLf: -50, stencils: { arrow: -4 }, wheelStops: -2, signs: -1 } }, {}, []);
  assert.ok(e.subtotal >= 0, 'subtotal ' + e.subtotal);
  for (const l of e.lines) assert.ok(l.amount >= 0, `${l.label} = ${l.amount}`);
});

test('discount over 100% or negative does not make negative/odd totals', () => {
  const a = estimate({ crack: { on: true, lf: 5000 }, discountPct: 150 }, {}, []);
  assert.ok(a.total >= 0, 'total ' + a.total);
  const b = estimate({ crack: { on: true, lf: 5000 }, discountPct: -20 }, {}, []);
  assert.ok(b.subtotal <= 5000, 'negative discount must not raise price: ' + b.subtotal);
});

test('zero or junk rates in settings fall back to defaults instead of dividing by zero', () => {
  const r = sealcoat(10000, 2, { ...DEFAULTS.sealcoat, sqftPerGalPerCoat: 0, tankGal: 0, sqftPerPersonHourPerCoat: 0 });
  assert.ok(Number.isFinite(r.mixedGal) && r.mixedGal > 0 && r.mixedGal < 1e6, 'mixedGal ' + r.mixedGal);
  assert.ok(Number.isFinite(r.tankLoads), 'tankLoads ' + r.tankLoads);
  assert.ok(Number.isFinite(r.personHours), 'hours ' + r.personHours);
  const c = crackFill(1000, { ...DEFAULTS.crack, boxLb: 0, lfPerPersonHour: 0 });
  assert.ok(Number.isFinite(c.boxes) && Number.isFinite(c.lfPerBox) && Number.isFinite(c.personHours), JSON.stringify(c));
  const s = striping({ lines: [{ lf: 1000 }], adaAuto: false }, { ...DEFAULTS.stripe, mils: 0, lineWidthIn: 0, lfPerPersonHour: 0 });
  assert.ok(Number.isFinite(s.lfPerGal) && Number.isFinite(s.paintGal) && Number.isFinite(s.personHours), JSON.stringify({ g: s.lfPerGal, p: s.paintGal }));
});

test('more work always costs more (monotonic)', () => {
  let prev = -1;
  for (const sqft of [1000, 5000, 20000, 100000, 1000000]) { const e = estimate({ seal: { on: true, sqft } }, { minimumJob: 0 }, []); assert.ok(e.subtotal > prev && e.cost.total > 0); prev = e.subtotal; }
  prev = -1;
  for (const total of [0, 1, 25, 26, 50, 51, 100, 101, 500, 501, 1000, 1001, 5000]) { const a = adaRequired(total).accessible; assert.ok(a >= prev, `ADA dropped at ${total}`); prev = a; }
});

test('a giant job (1,000,000 sq ft Walmart-size) stays sane', () => {
  const e = estimate({ seal: { on: true, sqft: 1e6, coats: 2 }, crack: { on: true, lf: 50000 }, stripe: { on: true, rows: [{ stalls: 2000 }] }, crewSize: 8 }, {}, []);
  assert.equal(e.stripe.ada.accessible, 30); // 20 + 1 per 100 over 1000
  assert.ok(e.time.days > 5 && e.time.days < 60, 'days ' + e.time.days);
  assert.ok(e.seal.tankLoads > 40, 'tank loads ' + e.seal.tankLoads);
});

test('coats: 0, 1.5 and 7 are handled sensibly', () => {
  assert.equal(sealcoat(1000, 0, DEFAULTS.sealcoat).coats, 1);
  assert.equal(sealcoat(1000, 1.5, DEFAULTS.sealcoat).coats, 2);
  assert.equal(sealcoat(1000, 7, DEFAULTS.sealcoat).coats, 7);
});

test('price per coat: 3 coats should cost the customer more than 2', () => {
  const two = estimate({ seal: { on: true, sqft: 20000, coats: 2 } }, {}, []);
  const three = estimate({ seal: { on: true, sqft: 20000, coats: 3 } }, {}, []);
  assert.ok(three.subtotal > two.subtotal, `2 coats ${two.subtotal}, 3 coats ${three.subtotal}`);
});

test('tank mix with weird settings', () => {
  for (const s of [{ tankGal: 1 }, { tankGal: 5000, waterPct: 100, sandLbPerGal: 10 }, { waterPct: -10 }, { sandBagLb: 0 }]) {
    const t = tankMix({ ...DEFAULTS.sealcoat, ...s });
    assert.deepEqual(deepFinite(t), [], JSON.stringify(s));
    assert.ok(t.concentrateGal >= 0 && t.waterGal >= 0, JSON.stringify(t));
  }
});

// ---------- map geometry abuse ----------
const P = (x, y) => [-82.01 + x / 280000, 39.94 + y / 364000];
const F = (type, coordinates, props = {}) => ({ type: 'Feature', properties: props, geometry: { type, coordinates } });

test('broken geometries measure as zero, never crash', () => {
  const cases = [
    F('Polygon', [], { kind: 'seal' }), F('Polygon', [[P(0, 0)]], { kind: 'seal' }), F('Polygon', [[P(0, 0), P(1, 1)]], { kind: 'seal' }),
    F('LineString', [], { kind: 'crack' }), F('LineString', [P(0, 0)], { kind: 'crack' }), F('Point', [], { kind: 'stencil' }),
    F('Polygon', [[[NaN, NaN], [1, 1], [2, 2]]], { kind: 'seal' }), { type: 'Feature', properties: { kind: 'seal' } }, null, {}, F('Polygon', 'junk', { kind: 'seal' })
  ];
  for (const c of cases) { const m = measureFeature(c); assert.deepEqual(deepFinite(m), [], JSON.stringify(c)); }
  const t = drawingTotals({ features: cases.filter(Boolean) });
  assert.deepEqual(deepFinite(t), []);
  assert.doesNotThrow(() => drawingTotals(null)); assert.doesNotThrow(() => drawingTotals({ features: 'x' }));
});

test('same point tapped twice / zero-length row', () => {
  assert.equal(measureFeature(F('LineString', [P(0, 0), P(0, 0)], { kind: 'row' })).stalls, 0);
  assert.equal(measureFeature(F('Polygon', [[P(0, 0), P(0, 0), P(0, 0), P(0, 0)]], { kind: 'seal' })).sqft, 0);
});

test('self-crossing (bow-tie) area is not counted as near zero', () => {
  // corners tapped in the wrong order: 100x100 square tapped as a bow-tie
  const bow = measureFeature(F('Polygon', [[P(0, 0), P(100, 100), P(100, 0), P(0, 100), P(0, 0)]], { kind: 'seal' }));
  const sq = measureFeature(F('Polygon', [[P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 0)]], { kind: 'seal' }));
  assert.ok(sq.sqft > 9500);
  assert.ok(bow.selfCrossing === true, 'should flag a self-crossing shape, got ' + JSON.stringify(bow));
});

test('skip areas bigger than the paved area clamp to 0', () => {
  const t = drawingTotals({ features: [F('Polygon', [[P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(0, 0)]], { kind: 'seal' }), F('Polygon', [[P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 0)]], { kind: 'seal', exclude: 'true' })] });
  assert.equal(t.sealSqft, 0);
});

test('stall row override of 0 really means 0 stalls', () => {
  const t = drawingTotals({ features: [F('LineString', [P(0, 0), P(90, 0)], { kind: 'row', stalls: 0 })] });
  assert.equal(t.stalls, 0);
});

test('typed 0 beats the map (turning a measurement off)', () => {
  const fc = { features: [F('Polygon', [[P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 0)]], { kind: 'seal' })] };
  const { inputs } = effectiveInputs({ seal: { sqft: 0 } }, fc);
  assert.equal(inputs.seal.sqft, 0);
});

test('settings merge ignores junk overrides (null, strings, arrays)', () => {
  const s = merge(DEFAULTS, { sealcoat: null, crack: 'x', stripe: { stencils: null } });
  assert.equal(typeof s.sealcoat, 'object'); assert.equal(s.sealcoat.coats, 2);
  assert.equal(typeof s.crack, 'object');
  assert.equal(typeof s.stripe.stencils.handicap, 'object');
});
