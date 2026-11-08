// LotBoss: parking layout designer. Give it the lot outline (and islands/buildings to skip) and it lays out
// 90° stall rows with two-way drive aisles, ADA + van spaces with access aisles by the entrance, arrows and counts.
// Works in local feet; turns the result back into map shapes. Pure functions, no UI.
import { adaRequired } from './calc.js';

const R_FT = 6371008.8 * 3.280839895;           // same earth size turf uses, so lengths match the map's measuring
const FT_PER_DEG = R_FT * Math.PI / 180;
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : NaN; };
const clamp = (v, lo, hi, d) => { const x = n(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };

export const LAYOUT_DEFAULTS = { stallWidth: 9, stallDepth: 18, aisleWidth: 24, setback: 2, endLane: 24, turn: false, style: 'single', arrows: true, wheelStops: 'ada' };

export function layoutOptions(o = {}) {
  const d = LAYOUT_DEFAULTS; o = o || {};
  return {
    stallWidth: clamp(o.stallWidth, 7.5, 13, d.stallWidth), stallDepth: clamp(o.stallDepth, 15, 24, d.stallDepth),
    aisleWidth: clamp(o.aisleWidth, 12, 40, d.aisleWidth), setback: clamp(o.setback, 0, 20, d.setback), endLane: clamp(o.endLane, 12, 40, n(o.aisleWidth) >= 12 ? Math.min(40, n(o.aisleWidth)) : d.endLane),
    turn: !!o.turn, style: o.style === 'double' ? 'double' : 'single', arrows: o.arrows !== false, wheelStops: ['none', 'ada', 'all'].includes(o.wheelStops) ? o.wheelStops : d.wheelStops
  };
}

// ---------- geometry helpers (local feet) ----------
const okRing = r => Array.isArray(r) && r.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).length >= 3;
function cleanRing(r) { const c = r.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [p[0], p[1]]); if (c.length > 1 && c[0][0] === c.at(-1)[0] && c[0][1] === c.at(-1)[1]) c.pop(); return c; }
function makeFrame(ring) {
  const lng0 = ring.reduce((t, p) => t + p[0], 0) / ring.length, lat0 = ring.reduce((t, p) => t + p[1], 0) / ring.length;
  const k = Math.cos(lat0 * Math.PI / 180);
  return { toFt: ([lng, lat]) => [(lng - lng0) * FT_PER_DEG * k, (lat - lat0) * FT_PER_DEG], toLL: ([x, y]) => [lng0 + x / (FT_PER_DEG * k), lat0 + y / FT_PER_DEG] };
}
const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const areaOf = pts => Math.abs(pts.reduce((t, p, i) => { const q = pts[(i + 1) % pts.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

// where a horizontal line at y is inside the polygon → [[x0,x1], ...]
function scan(pts, y) {
  const xs = [];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
  }
  xs.sort((a, b) => a - b); const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]]);
  return out;
}
const intersect = (A, B) => { const out = []; for (const [a0, a1] of A) for (const [b0, b1] of B) { const lo = Math.max(a0, b0), hi = Math.min(a1, b1); if (hi > lo) out.push([lo, hi]); } return out.sort((a, b) => a[0] - b[0]); };
const union = L => { const s = L.slice().sort((a, b) => a[0] - b[0]); const out = []; for (const iv of s) { const last = out.at(-1); if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else out.push([iv[0], iv[1]]); } return out; };
const subtract = (A, B) => { let cur = A.map(x => [...x]); for (const [b0, b1] of union(B)) { const nx = []; for (const [a0, a1] of cur) { if (b1 <= a0 || b0 >= a1) { nx.push([a0, a1]); continue; } if (b0 > a0) nx.push([a0, b0]); if (b1 < a1) nx.push([b1, a1]); } cur = nx; } return cur; };
// x-ranges where the whole band y0..y1 is inside the lot and outside every hole
function bandFree(lot, holes, y0, y1) {
  const ys = [y0 + 1e-4, (y0 + y1) / 2, y1 - 1e-4, ...lot.map(p => p[1]).filter(y => y > y0 && y < y1)];
  let free = null;
  for (const y of ys) { const iv = scan(lot, y); free = free === null ? iv : intersect(free, iv); }
  const blocked = [];
  for (const hole of holes) {
    const hy = hole.map(p => p[1]); if (Math.max(...hy) <= y0 || Math.min(...hy) >= y1) continue;
    for (const y of [...ys, ...hy.filter(v => v > y0 && v < y1)]) blocked.push(...scan(hole, y));
    // a hole that sits fully inside the band (tiny island): block its whole width
    if (Math.min(...hy) >= y0 && Math.max(...hy) <= y1) { const hx = hole.map(p => p[0]); blocked.push([Math.min(...hx), Math.max(...hx)]); }
  }
  return subtract(free || [], blocked);
}

// ---------- the layout in one orientation ----------
function stack(lot, holes, o) {
  const ys = lot.map(p => p[1]); const top = Math.max(...ys) - o.setback, bot = Math.min(...ys) + o.setback;
  const D = o.stallDepth, A = o.aisleWidth;
  const H = top - bot; const mod = 2 * D + A;
  if (H < D + A) return null;
  let full = Math.floor(H / mod); let rem = H - full * mod; const single = rem >= D + A;
  const used = full * mod + (single ? D + A : 0);
  let y = bot + (H - used) / 2;           // center the rows top-to-bottom
  const bands = [];                       // { y0, y1, face: 'up'|'down' (side the cars drive in from), aisle: [a0,a1] }
  for (let m = 0; m < full; m++) {
    bands.push({ y0: y, y1: y + D, face: 'up', aisle: [y + D, y + D + A] });
    bands.push({ y0: y + D + A, y1: y + 2 * D + A, face: 'down', aisle: [y + D, y + D + A] });
    y += mod;
  }
  if (single) bands.push({ y0: y + A, y1: y + A + D, face: 'down', aisle: [y, y + A] });
  const rows = [];
  for (const b of bands) {
    // the aisle in front has to be drivable too, and there must be a lane at each end to get between aisles
    const free = intersect(bandFree(lot, holes, b.y0, b.y1), bandFree(lot, holes, b.aisle[0], b.aisle[1]));
    for (const [a0, a1] of free) {
      const x0 = a0 + o.setback + o.endLane, x1 = a1 - o.setback - o.endLane; const len = x1 - x0;
      if (len >= o.stallWidth) rows.push({ ...b, x0, x1, len });
    }
  }
  return { rows, aisles: [...new Map(bands.map(b => [b.aisle.join(), b.aisle])).values()] };
}

// Fit regular + ADA spaces into the rows. ADA goes in the row nearest the entrance, starting at the end nearest it.
function fill(rows, o, ada, van, entrance) {
  const W = o.stallWidth;
  // ADA units: pairs share one aisle (van pair gets an 8 ft aisle), 8 ft spaces
  const types = [...Array(van).fill('van'), ...Array(Math.max(0, ada - van)).fill('car')];
  const units = []; for (let i = 0; i < types.length; i += 2) { const pair = types.slice(i, i + 2); units.push({ spaces: pair, aisle: pair.includes('van') ? 8 : 5, len: pair.length * 8 + (pair.includes('van') ? 8 : 5) }); }
  const front = r => r.face === 'up' ? r.y1 : r.y0;
  const dist = r => { if (!entrance) return front(r) * 1e-6 + r.x0 * 1e-9; const cx = Math.min(Math.max(entrance[0], r.x0), r.x1); return Math.hypot(entrance[0] - cx, entrance[1] - front(r)); };
  const order = rows.map((r, i) => i).sort((a, b) => dist(rows[a]) - dist(rows[b]));
  const plan = rows.map(r => ({ ...r, ada: [], adaLen: 0, bx: r.x0, regular: 0 }));
  let u = 0;
  for (const i of order) {
    if (u >= units.length) break;
    const r = plan[i]; let used = 0;
    while (u < units.length && used + units[u].len <= r.len) { r.ada.push(units[u]); used += units[u].len; u++; }
    r.adaLen = used;
    // center the ADA block on the door (or start of the row when there's no door), kept inside the row
    r.bx = entrance ? Math.min(Math.max(entrance[0] - used / 2, r.x0), r.x1 - used) : r.x0;
  }
  const placedAda = units.slice(0, u).reduce((t, x) => t + x.spaces.length, 0);
  const placedVan = units.slice(0, u).reduce((t, x) => t + x.spaces.filter(s => s === 'van').length, 0);
  for (const r of plan) {
    r.left = r.adaLen ? Math.max(0, Math.floor((r.bx - r.x0 + 1e-6) / W)) : 0;
    r.right = r.adaLen ? Math.max(0, Math.floor((r.x1 - r.bx - r.adaLen + 1e-6) / W)) : 0;
    r.regular = r.adaLen ? r.left + r.right : Math.max(0, Math.floor((r.len + 1e-6) / W));
  }
  return { plan, placedAda, placedVan, short: placedAda < ada };
}

function solve(lot, holes, o, entrance) {
  const st = stack(lot, holes, o); if (!st || !st.rows.length) return null;
  const base = fill(st.rows, o, 0, 0, entrance);
  let total = base.plan.reduce((t, r) => t + r.regular, 0);
  let req = adaRequired(total), res = base;
  for (let k = 0; k < 6 && total > 0; k++) {
    res = fill(st.rows, o, req.accessible, req.van, entrance);
    const t2 = res.plan.reduce((t, r) => t + r.regular, 0) + res.placedAda; const r2 = adaRequired(t2);
    total = t2; if (r2.accessible <= req.accessible && r2.van <= req.van) break; req = r2;
  }
  return { ...st, ...res, total, req };
}

// ---------- public ----------
// lotRing: [[lng,lat],...]  holes: rings to skip (islands, buildings)  entrance: [lng,lat] or null
export function designLayout(lotRing, holeRings = [], entrance = null, opts = {}) {
  const o = layoutOptions(opts);
  if (!okRing(lotRing)) return { error: 'Draw the lot outline first: use Area and tap the corners of the paved lot.' };
  const ringLL = cleanRing(lotRing); const F = makeFrame(ringLL);
  const lot0 = ringLL.map(F.toFt); const holes0 = (Array.isArray(holeRings) ? holeRings : []).filter(okRing).map(r => cleanRing(r).map(F.toFt));
  const ent0 = Array.isArray(entrance) && Number.isFinite(entrance[0]) && Number.isFinite(entrance[1]) ? F.toFt(entrance) : null;
  const lotSqft = areaOf(lot0);
  if (!(lotSqft > 0)) return { error: 'The lot outline has no area. Redraw it.' };
  if (lotSqft > 5e6) return { error: 'That area is over 100 acres. Draw one lot at a time.' };
  // try the direction of each of the longest edges (and square to it); keep the one that fits the most cars
  const edges = lot0.map((p, i) => { const q = lot0[(i + 1) % lot0.length]; return { a: Math.atan2(q[1] - p[1], q[0] - p[0]), len: Math.hypot(q[0] - p[0], q[1] - p[1]) }; }).sort((a, b) => b.len - a.len).slice(0, 4);
  let best = null;
  for (const e of edges) for (const extra of [0, Math.PI / 2]) {
    const a = -(e.a + extra);
    const lot = lot0.map(p => rot(p, a)), holes = holes0.map(h => h.map(p => rot(p, a))), ent = ent0 ? rot(ent0, a) : null;
    const r = solve(lot, holes, o, ent); if (!r) continue;
    const cand = { ...r, a, extra, lot, holes };
    if (!best || cand.total > best.total + 0.5 || (Math.abs(cand.total - best.total) < 0.5 && extra === 0 && best.extra !== 0)) best = cand;
  }
  if (best && o.turn) { // same main direction, rows turned 90°
    const a = best.a + (best.extra ? Math.PI / 2 : -Math.PI / 2);
    const lot = lot0.map(p => rot(p, a)), holes = holes0.map(h => h.map(p => rot(p, a))), ent = ent0 ? rot(ent0, a) : null;
    const r = solve(lot, holes, o, ent); best = r ? { ...r, a, lot, holes } : { a, total: 0, rows: [], plan: [], lot, holes, req: adaRequired(0), placedAda: 0, placedVan: 0, aisles: [] };
  }
  if (!best || !best.total) return { error: `The lot is too small for a row of ${o.stallDepth} ft stalls with a ${o.aisleWidth} ft aisle${o.turn ? ' that way. Try the other direction.' : '.'}`, lotSqft: Math.round(lotSqft) };
  return build(best, o, F, ent0 !== null, lotSqft);
}

function build(best, o, F, hasEntrance, lotSqft) {
  const back = p => F.toLL(rot(p, -best.a));
  const W = o.stallWidth, D = o.stallDepth;
  const feats = []; const gen = 'layout';
  const pre = { lot: best.lot, holes: best.holes, stalls: [], ada: [], aisles: [], arrows: [] };
  let regular = 0, adaN = 0, vanN = 0, rowsN = 0;
  for (const r of best.plan) {
    const fy = r.face === 'up' ? r.y1 : r.y0, by = r.face === 'up' ? r.y0 : r.y1;
    const addRun = (s0, k) => {
      if (k <= 0) return; const s1 = s0 + k * W;
      feats.push({ type: 'Feature', properties: { kind: 'row', stalls: k, stallWidth: W, depth: D, color: 'white', style: o.style, gen, back: [[s0, by], [s1, by]].map(back) }, geometry: { type: 'LineString', coordinates: [[s0, fy], [s1, fy]].map(back) } });
      for (let i = 0; i < k; i++) pre.stalls.push([s0 + i * W, Math.min(fy, by), W, D]);
      regular += k;
    };
    // ADA block (by the door), then regular stalls on each side of it
    let x = r.bx;
    for (const u of r.ada) {
      const parts = u.spaces.length === 2 ? [['space', u.spaces[0]], ['aisle'], ['space', u.spaces[1]]] : [['space', u.spaces[0]], ['aisle']];
      for (const [what, type] of parts) {
        const w = what === 'aisle' ? u.aisle : 8; const lo = x, hi = x + w;
        if (what === 'aisle') {
          feats.push({ type: 'Feature', properties: { kind: 'hash', color: 'blue', ada: true, gen }, geometry: { type: 'Polygon', coordinates: [[[lo, fy], [hi, fy], [hi, by], [lo, by], [lo, fy]].map(back)] } });
          pre.aisles.push([lo, Math.min(fy, by), hi - lo, D]);
        } else {
          feats.push({ type: 'Feature', properties: { kind: 'row', stalls: 1, stallWidth: 8, depth: D, color: 'blue', style: 'single', ada: true, van: type === 'van', gen, back: [[lo, by], [hi, by]].map(back) }, geometry: { type: 'LineString', coordinates: [[lo, fy], [hi, fy]].map(back) } });
          feats.push({ type: 'Feature', properties: { kind: 'stencil', stencil: type === 'van' ? 'van' : 'handicap', ada: true, gen }, geometry: { type: 'Point', coordinates: back([(lo + hi) / 2, (fy + by) / 2]) } });
          pre.ada.push([lo, Math.min(fy, by), hi - lo, D, type]); adaN++; if (type === 'van') vanN++;
        }
        x = hi;
      }
    }
    if (r.adaLen) { addRun(r.bx - r.left * W, r.left); addRun(r.bx + r.adaLen, r.right); }
    else { const pad = (r.len - r.regular * W) / 2; addRun(r.x0 + pad, r.regular); }
  }
  rowsN = best.plan.filter(r => r.regular || r.ada.length).length;
  // arrows at both ends of each aisle that has stalls on it
  if (o.arrows) for (const [a0, a1] of best.aisles) {
    const on = best.plan.filter(r => r.aisle[0] === a0 && (r.regular || r.ada.length)); if (!on.length) continue;
    const xs = [Math.min(...on.map(r => r.x0)), Math.max(...on.map(r => r.x1))]; const ym = (a0 + a1) / 2;
    for (const x of [xs[0] + 6, xs[1] - 6]) { feats.push({ type: 'Feature', properties: { kind: 'stencil', stencil: 'arrow', gen }, geometry: { type: 'Point', coordinates: back([x, ym]) } }); pre.arrows.push([x, ym]); }
  }
  const total = regular + adaN; const req = adaRequired(total);
  const warnings = [];
  if (adaN < req.accessible) warnings.push(`Only room for ${adaN} of the ${req.accessible} required accessible spaces. Make the lot outline bigger or check the rows.`);
  if (!hasEntrance && adaN) warnings.push('No building entrance marked, so ADA spaces went at the end of the first row. Put a Door marker on the main entrance and run it again to put them by the door.');
  if (o.aisleWidth < 22) warnings.push(`A ${o.aisleWidth} ft aisle is tight for two-way traffic with 90° stalls (24 ft is standard). Check your local code.`);
  if (W < 8.5) warnings.push(`${W} ft stalls are narrow. Most codes want 8.5 to 9 ft.`);
  const wheelStops = o.wheelStops === 'all' ? total : o.wheelStops === 'ada' ? adaN : 0;
  const deg = Math.round(((-best.a * 180 / Math.PI) % 180 + 180) % 180);
  return {
    features: feats, preview: pre,
    stats: { total, regular, ada: adaN, van: vanN, required: req, rows: rowsN, aisles: best.aisles.length, lotSqft: Math.round(lotSqft), sqftPerStall: total ? Math.round(lotSqft / total) : 0, angle: deg, wheelStops, arrows: pre.arrows.length },
    warnings
  };
}

// Pull the lot outline, islands and entrance out of what's drawn on the map
export function lotFromDrawing(fc) {
  const f = (fc?.features || []).filter(x => x?.properties?.gen !== 'layout');
  const areaLL = r => { try { const F = makeFrame(cleanRing(r)); return areaOf(cleanRing(r).map(F.toFt)); } catch { return 0; } };
  const seals = f.filter(x => x.properties?.kind === 'seal' && x.geometry?.type === 'Polygon' && okRing(x.geometry.coordinates?.[0]));
  const lots = seals.filter(x => !x.properties.exclude).sort((a, b) => areaLL(b.geometry.coordinates[0]) - areaLL(a.geometry.coordinates[0]));
  const holes = seals.filter(x => x.properties.exclude).map(x => x.geometry.coordinates[0]);
  const ent = f.filter(x => x.properties?.kind === 'entrance' && x.geometry?.type === 'Point').at(-1);
  return { lot: lots[0]?.geometry.coordinates[0] || null, lotCount: lots.length, holes, entrance: ent ? ent.geometry.coordinates : null };
}

// Swap in a new layout: drop the old generated shapes, keep everything you drew yourself
export function applyLayout(fc, features) {
  const keep = (fc?.features || []).filter(x => x?.properties?.gen !== 'layout');
  return { type: 'FeatureCollection', features: [...keep, ...(features || [])] };
}
