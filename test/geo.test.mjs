import test from 'node:test';
import assert from 'node:assert/strict';
import { measureFeature, drawingTotals, effectiveInputs } from '../src/geo.js';

// helper: offsets in feet near Zanesville, OH
const LAT = 39.94, LNG = -82.01;
const ftLat = f => f / 364000;
const ftLng = f => f / (364000 * Math.cos(LAT * Math.PI / 180));
const pt = (x, y) => [LNG + ftLng(x), LAT + ftLat(y)];
const poly = (w, h, kind, props = {}) => ({ type: 'Feature', properties: { kind, ...props }, geometry: { type: 'Polygon', coordinates: [[pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)]] } });
const line = (len, kind, props = {}) => ({ type: 'Feature', properties: { kind, ...props }, geometry: { type: 'LineString', coordinates: [pt(0, 0), pt(len, 0)] } });

test('100 x 50 ft area measures about 5,000 sq ft and 300 ft around', () => {
  const m = measureFeature(poly(100, 50, 'seal'));
  assert.ok(Math.abs(m.sqft - 5000) < 50, String(m.sqft));
  assert.ok(Math.abs(m.perimeter - 300) < 3, String(m.perimeter));
});

test('a 90 ft stall row counts 10 stalls at 9 ft, 9 at 10 ft', () => {
  assert.equal(measureFeature(line(90, 'row')).stalls, 10);
  assert.equal(measureFeature(line(90, 'row', { stallWidth: 10 })).stalls, 9);
});

test('totals: seal minus an excluded island, cracks, rows, stencils', () => {
  const fc = { type: 'FeatureCollection', features: [poly(100, 100, 'seal'), poly(10, 10, 'seal', { exclude: true }), line(250, 'crack'), line(90, 'row', { style: 'double' }), { type: 'Feature', properties: { kind: 'stencil', stencil: 'arrow' }, geometry: { type: 'Point', coordinates: pt(1, 1) } }, { type: 'Feature', properties: { kind: 'stencil', stencil: 'arrow' }, geometry: { type: 'Point', coordinates: pt(2, 2) } }] };
  const t = drawingTotals(fc);
  assert.ok(Math.abs(t.sealSqft - 9900) < 100, String(t.sealSqft));
  assert.ok(Math.abs(t.crackLf - 250) < 3);
  assert.equal(t.stalls, 10);
  assert.equal(t.rows[0].style, 'double');
  assert.equal(t.stencils.arrow, 2);
});

test('typed numbers beat the map; blanks come from the map', () => {
  const fc = { type: 'FeatureCollection', features: [poly(100, 100, 'seal'), line(100, 'crack')] };
  const { inputs } = effectiveInputs({ seal: { sqft: 12345 }, crack: { lf: '' } }, fc);
  assert.equal(inputs.seal.sqft, 12345);
  assert.ok(Math.abs(inputs.crack.lf - 100) < 2);
  assert.equal(inputs.crack.fromMap, true);
});
