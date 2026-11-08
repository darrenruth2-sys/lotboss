// Good / Better / Best: each option switches services on/off and sets coats on top of the job's estimate.
import { estimate, DEFAULTS, merge } from './calc.js';

const clone = o => JSON.parse(JSON.stringify(o ?? null));
const has = (i, k) => !!i?.[k]?.on && (k !== 'seal' || Number(i.seal.sqft) > 0) && (k !== 'crack' || Number(i.crack.lf) > 0);

// sensible starting options from what the job has
export function suggestPackages(inputs, settings = {}) {
  const S = merge(DEFAULTS, settings);
  const base = Math.max(1, Math.round(Number(inputs?.seal?.coats) || S.sealcoat.coats || 2));
  const seal = has(inputs, 'seal'), crack = has(inputs, 'crack'), stripe = !!inputs?.stripe?.on;
  const opt = (name, s, c, st, coats, note) => ({ name, seal: { on: s, coats }, crack: { on: c }, stripe: { on: st }, extras: [], note });
  if (seal) return [
    opt('Basic', true, false, false, 1, 'One coat of sealer. Good for a lot in decent shape on a budget.'),
    opt('Standard', true, crack, stripe, base, 'What we recommend: cracks filled, two coats, fresh lines.'),
    opt('Premium', true, crack, stripe, Math.min(base + 1, 4), 'An extra coat in the high-traffic areas for a longer-lasting finish.')
  ];
  const on = [crack && 'crack', stripe && 'stripe'].filter(Boolean);
  if (on.length >= 2) return [
    opt('Crack fill only', false, true, false, base, 'Seal the cracks to keep water out.'),
    opt('Crack fill + striping', false, true, true, base, 'Cracks filled and fresh, sharp lines.')
  ];
  return [opt('Standard', seal, crack, stripe, base, '')];
}

export function applyPackage(inputs, pkg) {
  const i = clone(inputs) || {};
  if (!pkg) return i;
  i.seal = { ...(i.seal || {}), on: !!pkg.seal?.on && Number(i.seal?.sqft) > 0 };
  if (pkg.seal?.coats) i.seal.coats = Math.max(1, Math.min(10, Math.round(Number(pkg.seal.coats)) || 1));
  i.crack = { ...(i.crack || {}), on: !!pkg.crack?.on && Number(i.crack?.lf) > 0 };
  i.stripe = { ...(i.stripe || {}), on: !!pkg.stripe?.on };
  const extra = Array.isArray(pkg.extras) ? pkg.extras.filter(e => e && Number(e.amount)) : [];
  i.extras = [...(Array.isArray(i.extras) ? i.extras : []), ...extra];
  return i;
}

// what's included, in plain words, for the customer
export function includes(pkg, est) {
  const out = [];
  if (est.crack) out.push(`Crack filling (about ${Math.round(est.crack.lf).toLocaleString('en-US')} ft)`);
  if (est.seal) out.push(`Sealcoat, ${est.seal.coats} coat${est.seal.coats > 1 ? 's' : ''} (about ${Math.round(est.seal.sqft).toLocaleString('en-US')} sq ft)`);
  if (est.stripe) out.push(`Line striping${est.stripe.stalls ? `, ${est.stripe.stalls} stalls` : ''}${est.stripe.ada.accessible ? ` incl. ${est.stripe.ada.accessible} accessible` : ''}`);
  for (const e of pkg?.extras || []) if (Number(e.amount)) out.push(e.label || 'Extra item');
  return out;
}

export function estimatePackages(inputs, settings, crew, list) {
  return (list || []).map(pkg => { const est = estimate(applyPackage(inputs, pkg), settings, crew); return { pkg, est, includes: includes(pkg, est) }; });
}
