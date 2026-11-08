import test from 'node:test';
import assert from 'node:assert/strict';
import { designLayout, lotFromDrawing, applyLayout, layoutOptions } from '../src/layout.js';
import { drawingTotals, measureFeature } from '../src/geo.js';
import { adaRequired } from '../src/calc.js';

// build shapes in feet around Zanesville, turn into lng/lat the same way the map measures
const LAT = 39.94, LNG = -82.01, FT = 6371008.8 * 3.280839895 * Math.PI / 180, K = Math.cos(LAT * Math.PI / 180);
const ll = ([x, y]) => [LNG + x / (FT * K), LAT + y / FT];
const rect = (x, y, w, hgt, deg = 0) => { const a = deg * Math.PI / 180; return [[x, y], [x + w, y], [x + w, y + hgt], [x, y + hgt], [x, y]].map(([px, py]) => ll([px * Math.cos(a) - py * Math.sin(a), px * Math.sin(a) + py * Math.cos(a)])); };
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const corners = ([x, y, w, d]) => [[x + .01, y + .01], [x + w - .01, y + .01], [x + w - .01, y + d - .01], [x + .01, y + d - .01]];
const overlap = (a, b) => a[0] < b[0] + b[2] - .01 && b[0] < a[0] + a[2] - .01 && a[1] < b[1] + b[3] - .01 && b[1] < a[1] + a[3] - .01;
function checkFits(r, label) {
  const all = [...r.preview.stalls, ...r.preview.ada, ...r.preview.aisles];
  for (const s of all) for (const c of corners(s)) assert.ok(inside(c, r.preview.lot), `${label}: a space sticks out of the lot`);
  for (const s of all) for (const h of r.preview.holes) for (const c of corners(s)) assert.ok(!inside(c, h), `${label}: a space is on an island`);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), `${label}: two spaces overlap`);
}

test('300 x 200 ft lot: about 160 spaces, ADA to code, nothing sticks out or overlaps', () => {
  const r = designLayout(rect(0, 0, 300, 200), [], null);
  assert.ok(!r.error, r.error);
  assert.ok(r.stats.total >= 150 && r.stats.total <= 170, 'total ' + r.stats.total);
  assert.equal(r.stats.ada, adaRequired(r.stats.total).accessible);
  assert.ok(r.stats.van >= adaRequired(r.stats.total).van);
  assert.equal(r.stats.rows, 6);
  assert.ok(r.stats.sqftPerStall > 300 && r.stats.sqftPerStall < 450, 'sq ft per stall ' + r.stats.sqftPerStall);
  checkFits(r, 'rectangle');
});
test('the map counts exactly what the designer drew', () => {
  const r = designLayout(rect(0, 0, 300, 200), [], null);
  const t = drawingTotals({ type: 'FeatureCollection', features: r.features });
  assert.equal(t.stalls, r.stats.total);
  assert.equal(t.stencils.handicap + (t.stencils.van || 0), r.stats.ada);
  assert.equal(t.hash.length, 0, 'ADA aisles are priced by the ADA section, not counted twice');
  for (const f of r.features.filter(f => f.properties.kind === 'row')) assert.equal(f.properties.stalls, Math.min(f.properties.stalls, measureFeature(f).stalls + 1), 'row length matches its stall count');
});
test('a turned lot gets the same layout as a straight one', () => {
  const a = designLayout(rect(0, 0, 300, 200), [], null), b = designLayout(rect(0, 0, 300, 200, 33), [], null);
  assert.ok(Math.abs(a.stats.total - b.stats.total) <= 2, `${a.stats.total} vs ${b.stats.total}`);
  checkFits(b, 'turned');
});
test('an island in the middle: fewer spaces, none on the island', () => {
  const plain = designLayout(rect(0, 0, 300, 200), [], null);
  const r = designLayout(rect(0, 0, 300, 200), [rect(130, 80, 40, 40)], null);
  assert.ok(r.stats.total < plain.stats.total && r.stats.total > plain.stats.total * 0.6, `${r.stats.total} vs ${plain.stats.total}`);
  checkFits(r, 'island');
});
test('L-shaped lot works and stays inside', () => {
  const L = [[0, 0], [400, 0], [400, 120], [150, 120], [150, 300], [0, 300], [0, 0]].map(ll);
  const r = designLayout(L, [], null); assert.ok(!r.error && r.stats.total > 100, r.error || r.stats.total);
  checkFits(r, 'L-shape');
});
test('ADA spaces go by the entrance', () => {
  const ent = ll([300, 200]); // top-right corner
  const r = designLayout(rect(0, 0, 300, 200), [], ent);
  const ada = r.features.filter(f => f.properties.ada && f.properties.kind === 'row');
  const reg = r.features.filter(f => !f.properties.ada && f.properties.kind === 'row');
  const d = f => { const [lng, lat] = f.geometry.coordinates[0]; return Math.hypot((lng - ent[0]) * FT * K, (lat - ent[1]) * FT); };
  const avgAda = ada.reduce((t, f) => t + d(f), 0) / ada.length, avgReg = reg.reduce((t, f) => t + d(f), 0) / reg.length;
  assert.ok(avgAda < 80 && avgAda < avgReg, `ADA ${Math.round(avgAda)} ft from the door, regular rows ${Math.round(avgReg)}`);
  assert.ok(!r.warnings.some(w => /entrance/.test(w)));
  assert.ok(designLayout(rect(0, 0, 300, 200), [], null).warnings.some(w => /entrance/i.test(w)), 'warns when there is no entrance');
});
test('door in the middle of the lot edge: ADA spaces are right in front of it, not at the end of the row', () => {
  const door = ll([350, 450]);
  const r = designLayout(rect(0, 0, 700, 450), [], door);
  const ada = r.features.filter(f => f.properties.ada && f.properties.kind === 'row');
  const xs = ada.map(f => (f.geometry.coordinates[0][0] - LNG) * FT * K);
  const mid = (Math.min(...xs) + Math.max(...xs) + 8) / 2;
  assert.ok(Math.abs(mid - 350) < 15, `ADA block centered at ${Math.round(mid)} ft, door at 350`);
  checkFits(r, 'door middle');
  assert.equal(r.stats.ada, adaRequired(r.stats.total).accessible);
});
test('options: wider aisle or stalls = fewer spaces; turn changes direction; junk options are fixed', () => {
  const base = designLayout(rect(0, 0, 300, 200), [], null).stats.total;
  assert.ok(designLayout(rect(0, 0, 300, 200), [], null, { stallWidth: 10 }).stats.total < base);
  assert.ok(designLayout(rect(0, 0, 300, 200), [], null, { aisleWidth: 30 }).stats.total < base);
  const t = designLayout(rect(0, 0, 300, 200), [], null, { turn: true });
  assert.ok(!t.error && t.stats.total < base, 'turned rows fit fewer on this lot');
  assert.deepEqual(layoutOptions({ stallWidth: 'abc', aisleWidth: -5, stallDepth: 1e9, wheelStops: 'x' }), { ...layoutOptions({}), aisleWidth: 12, endLane: 24, stallDepth: 24 });
  assert.equal(designLayout(rect(0, 0, 300, 200), [], null, { wheelStops: 'all' }).stats.wheelStops, base);
});
test('too small, junk, or nothing drawn: a clear message, never a crash', () => {
  assert.match(designLayout(rect(0, 0, 30, 30), [], null).error, /too small/);
  for (const bad of [null, [], [[1, 2]], [[NaN, 1], [2, NaN], [3, 3]], 'x', [[0, 0], [0, 0], [0, 0]]]) {
    const r = designLayout(bad, null, 'junk'); assert.ok(r.error, JSON.stringify(bad));
  }
  assert.match(designLayout([[0, 0], [10, 0], [10, 10], [0, 0]].map(([x, y]) => [x, y]), [], null).error, /100 acres/);
  assert.doesNotThrow(() => designLayout(rect(0, 0, 300, 200), [null, 'x', [[1]]], [NaN, 1], null));
});
test('reading the lot off the map and swapping layouts', () => {
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { kind: 'seal' }, geometry: { type: 'Polygon', coordinates: [rect(0, 0, 100, 100)] } },
    { type: 'Feature', properties: { kind: 'seal' }, geometry: { type: 'Polygon', coordinates: [rect(0, 0, 300, 200)] } },
    { type: 'Feature', properties: { kind: 'seal', exclude: true }, geometry: { type: 'Polygon', coordinates: [rect(10, 10, 20, 20)] } },
    { type: 'Feature', properties: { kind: 'entrance' }, geometry: { type: 'Point', coordinates: ll([5, 5]) } },
    { type: 'Feature', properties: { kind: 'crack' }, geometry: { type: 'LineString', coordinates: [ll([0, 0]), ll([9, 9])] } }] };
  const lot = lotFromDrawing(fc);
  assert.equal(lot.lotCount, 2); assert.equal(lot.holes.length, 1); assert.ok(lot.entrance);
  assert.ok(Math.abs(lot.lot[1][0] - ll([300, 0])[0]) < 1e-9, 'picks the biggest area as the lot');
  const r = designLayout(lot.lot, lot.holes, lot.entrance);
  const once = applyLayout(fc, r.features), twice = applyLayout(once, r.features);
  assert.equal(twice.features.length, once.features.length, 'running it again replaces the old layout');
  assert.equal(twice.features.filter(f => !f.properties.gen).length, 5, 'your own shapes are kept');
  assert.deepEqual(lotFromDrawing(null), { lot: null, lotCount: 0, holes: [], entrance: null });
});
test('a big 3-acre lot is quick', () => {
  const t0 = Date.now(); const r = designLayout(rect(0, 0, 450, 300), [rect(100, 100, 30, 30), rect(300, 50, 20, 60)], ll([450, 150]));
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`); assert.ok(r.stats.total > 300); checkFits(r, '3 acres');
});
