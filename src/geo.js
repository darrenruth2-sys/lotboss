// Turns what you drew on the map into numbers. Geodesic math (turf), so feet are real feet.
import area from '@turf/area';
import length from '@turf/length';
import { polygon, lineString } from '@turf/helpers';
import kinks from '@turf/kinks';

export const SQFT_PER_SQM = 10.7639104;
export const FT_PER_KM = 3280.8399;

// feature kinds you can draw
export const KINDS = {
  seal: { label: 'Sealcoat area', geom: 'polygon', color: '#3b3f46', hint: 'Tap the corners of the paved area, then Finish.' },
  crack: { label: 'Crack', geom: 'line', color: '#ff8a00', hint: 'Tap along the crack, then Finish. Long cracks can be one line.' },
  row: { label: 'Stall row', geom: 'line', color: '#ffffff', hint: 'Tap the start and end of a row of stalls (along the front of the stalls).' },
  line: { label: 'Paint line', geom: 'line', color: '#ffd400', hint: 'Stop bars, lane lines, curbs. Tap along the line, then Finish.' },
  hash: { label: 'Hash zone', geom: 'polygon', color: '#ffd400', hint: 'Tap the corners of the no-parking / hash area, then Finish.' },
  stencil: { label: 'Stencil', geom: 'point', color: '#2f7bff', hint: 'Tap where the stencil goes.' },
  measure: { label: 'Measure', geom: 'line', color: '#00e0ff', hint: 'Tap two or more points to measure a distance.' },
  entrance: { label: 'Building entrance', geom: 'point', color: '#1d5fb4', hint: 'Tap the main door of the building. The layout designer puts ADA spaces closest to it.' }
};
export const PAINT_COLORS = ['white', 'yellow', 'blue', 'red', 'green', 'black'];
export const STENCILS = ['handicap', 'van', 'arrow', 'stop', 'noParking', 'fireLane', 'number', 'custom'];

export function ringClosed(coords) { const c = coords.slice(); if (c.length && (c[0][0] !== c.at(-1)[0] || c[0][1] !== c.at(-1)[1])) c.push(c[0]); return c; }
const okPt = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
// corners tapped out of order make a bow-tie; put them back in order around the middle
export function crosses(ring) { try { return kinks(polygon([ringClosed(ring)])).features.length > 0; } catch { return false; } }
export function untangle(ring) {
  const pts = ringClosed(ring).slice(0, -1);
  const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length, cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
  const k = Math.cos(cy * Math.PI / 180);
  const sorted = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, (a[0] - cx) * k) - Math.atan2(b[1] - cy, (b[0] - cx) * k));
  return [...sorted, sorted[0]];
}
export function measureFeature(f) {
  const g = f?.geometry; if (!g) return {};
  try {
    if (g.type === 'Polygon' && Array.isArray(g.coordinates?.[0]) && g.coordinates[0].length >= 3) {
      let ring = ringClosed(g.coordinates[0].filter(okPt)); if (ring.length < 4) return {};
      const selfCrossing = crosses(ring); if (selfCrossing) ring = untangle(ring);
      const sqft = area(polygon([ring])) * SQFT_PER_SQM;
      const perimeter = length(lineString(ring), { units: 'kilometers' }) * FT_PER_KM;
      if (!Number.isFinite(sqft) || !Number.isFinite(perimeter)) return {};
      return selfCrossing ? { sqft: Math.round(sqft), perimeter: Math.round(perimeter), selfCrossing } : { sqft: Math.round(sqft), perimeter: Math.round(perimeter) };
    }
    if (g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.filter(okPt).length >= 2) {
      const lf = length(lineString(g.coordinates.filter(okPt)), { units: 'kilometers' }) * FT_PER_KM;
      if (!Number.isFinite(lf)) return {};
      const out = { lf: Math.round(lf * 10) / 10 };
      if (f.properties?.kind === 'row') {
        const w = Number(f.properties.stallWidth) || 9;
        out.stalls = Math.max(0, Math.floor((lf + 0.5) / w));
      }
      return out;
    }
  } catch { return {}; }
  return {};
}

// Totals for the estimate, grouped the way the calculator wants them.
export function drawingTotals(fc) {
  const t = { sealSqft: 0, crackLf: 0, rows: [], lines: [], hash: [], stencils: {}, stalls: 0, features: 0 };
  for (const f of fc?.features || []) {
    const p = f.properties || {}; const m = measureFeature(f); t.features++;
    if (p.kind === 'seal') t.sealSqft += (p.exclude ? -1 : 1) * (m.sqft || 0);
    else if (p.kind === 'crack') t.crackLf += m.lf || 0;
    else if (p.kind === 'row') { const stalls = p.stalls != null && p.stalls !== '' ? Number(p.stalls) : m.stalls; t.rows.push({ stalls, style: p.style || 'single', depth: Number(p.depth) || undefined, color: p.color || 'white' }); t.stalls += stalls || 0; }
    else if (p.kind === 'line') t.lines.push({ lf: m.lf || 0, color: p.color || 'white', label: p.label || 'Line' });
    else if (p.kind === 'hash' && !p.ada) t.hash.push({ sqft: m.sqft || 0, perimeter: m.perimeter || 0, color: p.color || 'yellow' });
    else if (p.kind === 'stencil') { const k = p.stencil || 'custom'; t.stencils[k] = (t.stencils[k] || 0) + (Number(p.qty) || 1); }
  }
  t.sealSqft = Math.max(0, Math.round(t.sealSqft)); t.crackLf = Math.round(t.crackLf);
  return t;
}

// What the estimate uses: anything you typed wins; blanks are filled from the map.
const blank = v => v === null || v === undefined || v === '';
export function effectiveInputs(inputs = {}, drawing) {
  const t = drawingTotals(drawing);
  const i = structuredClone(inputs || {});
  i.seal = { on: t.sealSqft > 0, coats: undefined, ...(i.seal || {}) };
  if (blank(i.seal.sqft)) { i.seal.sqft = t.sealSqft; i.seal.fromMap = true; }
  i.crack = { on: t.crackLf > 0, ...(i.crack || {}) };
  if (blank(i.crack.lf)) { i.crack.lf = t.crackLf; i.crack.fromMap = true; }
  i.stripe = { on: t.stalls > 0 || t.lines.length > 0 || t.hash.length > 0 || Object.keys(t.stencils).length > 0, ...(i.stripe || {}) };
  if (!i.stripe.rows || !i.stripe.rows.length) { i.stripe.rows = t.rows; i.stripe.rowsFromMap = true; }
  i.stripe.lines = [...(t.lines || []), ...((inputs.stripe && inputs.stripe.extraLines) || [])];
  i.stripe.hash = [...(t.hash || []), ...((inputs.stripe && inputs.stripe.extraHash) || [])];
  const typed = (inputs.stripe && inputs.stripe.stencils) || {};
  const st = { ...t.stencils };
  for (const [k, v] of Object.entries(typed)) if (!blank(v)) st[k] = Number(v);
  i.stripe.stencils = st;
  return { inputs: i, totals: t };
}
