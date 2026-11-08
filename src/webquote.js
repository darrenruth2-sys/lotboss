// LotBoss: the instant price range a customer sees on your website form.
// Runs on the server (so your rates stay private) and in the demo. Pure functions.
import { estimate, merge, DEFAULTS } from './calc.js';

export const WEB_DEFAULTS = { on: false, rangePct: 15, services: { seal: true, crack: true, stripe: true }, message: '' };
// cracks per 1,000 sq ft when the customer only says how bad it is
export const CRACK_LF_PER_1000 = { none: 0, light: 6, some: 15, lots: 30 };
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export const webSettings = s => ({ ...WEB_DEFAULTS, ...(s?.webForm || {}), services: { ...WEB_DEFAULTS.services, ...(s?.webForm?.services || {}) } });

/**
 * req: { sqft, seal, crack, stripe, crackLevel: 'none'|'light'|'some'|'lots', stalls }
 * companySettings: the company's saved settings (rates etc.)
 */
export function webPrice(req = {}, companySettings = {}) {
  const W = webSettings(companySettings);
  const sqft = Math.round(n(req?.sqft));
  if (sqft < 500) return { error: 'Outline your lot on the map first (tap each corner).' };
  if (sqft > 5_000_000) return { error: 'That area is too big. Outline just your lot.' };
  const want = { seal: !!req.seal && W.services.seal, crack: !!req.crack && W.services.crack, stripe: !!req.stripe && W.services.stripe };
  if (!want.seal && !want.crack && !want.stripe) return { error: 'Pick at least one service.' };
  const level = Object.hasOwn(CRACK_LF_PER_1000, String(req.crackLevel)) ? String(req.crackLevel) : 'some';
  const crackLf = want.crack ? Math.max(50, Math.round(sqft / 1000 * CRACK_LF_PER_1000[level])) : 0;
  const typed = Math.round(n(req.stalls));
  const stalls = want.stripe ? (typed > 0 && typed < 5000 ? typed : Math.max(4, Math.round(sqft / 330))) : 0;
  const inputs = { seal: { on: want.seal, sqft, coats: undefined }, crack: { on: want.crack, lf: crackLf }, stripe: { on: want.stripe, rows: stalls ? [{ stalls }] : [] } };
  const S = merge(DEFAULTS, companySettings || {});
  const est = estimate(inputs, S, []);
  const total = Math.max(0, n(est.total));
  if (!(total > 0)) return { error: 'We couldn\'t price that. Please call us.' };
  const pct = Math.min(50, Math.max(0, n(W.rangePct)));
  const round = v => v >= 2000 ? Math.round(v / 50) * 50 : Math.round(v / 10) * 10;
  const minimum = n(S.minimumJob);
  const low = Math.max(minimum, round(total * (1 - pct / 100))), high = Math.max(low, round(total * (1 + pct / 100)));
  return { low, high, total: Math.round(total), sqft, crackLf, stalls, guessedStalls: want.stripe && !(typed > 0), services: want, crackLevel: level, minimumApplied: !!est.minimumApplied };
}

// check and clean what a stranger typed into the form
export function cleanLead(f = {}) {
  const s = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const out = { name: s(f.name, 80), phone: s(f.phone, 30), email: s(f.email, 120), address: s(f.address, 200), business: s(f.business, 100), note: String(f.note ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 1000) };
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) return { error: 'That email doesn\'t look right.' };
  if (out.phone && (out.phone.replace(/\D/g, '').length < 10 || out.phone.replace(/\D/g, '').length > 15)) return { error: 'Check the phone number (10 digits).' };
  if (!out.name) return { error: 'Add your name.' };
  if (!out.phone && !out.email) return { error: 'Add a phone number or email so we can reach you.' };
  if (!out.address) return { error: 'Add the address of the lot.' };
  return { lead: out };
}

// a closed ring of [lng, lat] that's sane, or null
export function cleanRing(ring) {
  if (!Array.isArray(ring)) return null;
  const pts = ring.slice(0, 200).filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85).map(p => [Math.round(Number(p[0]) * 1e7) / 1e7, Math.round(Number(p[1]) * 1e7) / 1e7]);
  if (pts.length < 3) return null;
  if (pts[0][0] !== pts.at(-1)[0] || pts[0][1] !== pts.at(-1)[1]) pts.push([...pts[0]]);
  return pts.length >= 4 ? pts : null;
}
