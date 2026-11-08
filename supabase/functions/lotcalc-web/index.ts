// LotBoss website quote form. Public (no login). Customers price their own lot and send it in as a lead.
// Your rates never leave the server: the form only ever gets back a price range.
// POST { action: 'info', company }                       -> company name, phone, logo, which services, message
// POST { action: 'price', company, ring, seal, crack, stripe, crackLevel, stalls } -> { low, high, sqft }
// POST { action: 'submit', ...price fields, name, phone, email, address, business, note, hp, ms } -> { ok, ref }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { webPrice, cleanLead, cleanRing, webSettings, ringSqft } from './lib.js';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SALT = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'x').slice(-16);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const LIMITS: Record<string, [number, number]> = { info: [300, 20000], price: [200, 10000], submit: [5, 100] }; // per visitor, per company, per day

async function who(req: Request, cid: string) {
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim();
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + cid + '|' + SALT));
  return Array.from(new Uint8Array(d)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const action = String(b?.action || ''); const cid = String(b?.company || '');
  if (!LIMITS[action]) return json({ error: 'Unknown action' }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cid)) return json({ error: 'This quote form link is broken.' }, 404);
  const { data: co } = await admin.from('lc_companies').select('id, name, phone, email, website, logo, settings').eq('id', cid).maybeSingle();
  const W = webSettings(co?.settings || {});
  if (!co || !W.on) return json({ error: 'This company isn\'t taking online quote requests right now. Please call them.' }, 404);
  const [perWho, perCo] = LIMITS[action];
  const { data: ok } = await admin.rpc('lc_web_take', { p_company: cid, p_who: await who(req, cid), p_kind: action, p_per_who: perWho, p_per_company: perCo });
  if (!ok) return json({ error: action === 'submit' ? 'We already got your requests today. We\'ll be in touch!' : 'Too many tries. Please try again tomorrow or give us a call.' }, 429);

  if (action === 'info') {
    const logo = typeof co.logo === 'string' && co.logo.length < 300000 ? co.logo : null;
    return json({ name: co.name, phone: co.phone || '', logo, services: W.services, message: String(W.message || '').slice(0, 500), rangePct: W.rangePct });
  }
  const ring = cleanRing(b.ring);
  if (!ring) return json({ error: 'Outline your lot on the map first (tap each corner).' }, 400);
  const sqft = ringSqft(ring); // measured here, so nobody can send a fake size
  const price = webPrice({ sqft, seal: b.seal, crack: b.crack, stripe: b.stripe, crackLevel: b.crackLevel, stalls: b.stalls }, co.settings || {});
  if (price.error) return json({ error: price.error }, 400);
  if (action === 'price') return json({ low: price.low, high: price.high, sqft: price.sqft, stalls: price.stalls, guessedStalls: price.guessedStalls, crackLf: price.crackLf });

  // submit
  if (b.hp) return json({ ok: true, ref: 'thanks' }); // honeypot field filled in: a bot. Pretend it worked.
  if (!(Number(b.ms) >= 4000)) return json({ error: 'Please take a second to check your info, then send again.' }, 400);
  const c = cleanLead(b); if (c.error) return json({ error: c.error }, 400);
  const L = c.lead;
  const lat = ring.slice(0, -1).reduce((t, p) => t + p[1], 0) / (ring.length - 1), lng = ring.slice(0, -1).reduce((t, p) => t + p[0], 0) / (ring.length - 1);
  const usd = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
  const wants = [price.services.seal && 'sealcoat', price.services.crack && `crack fill (${price.crackLevel} cracks)`, price.services.stripe && `striping (${price.stalls} spaces${price.guessedStalls ? ', our guess' : ''})`].filter(Boolean).join(', ');
  const notes = [`Website quote request. They saw ${usd(price.low)} to ${usd(price.high)} for about ${Math.round(price.sqft).toLocaleString('en-US')} sq ft.`, `Wants: ${wants}.`, L.note ? `They wrote: ${L.note}` : ''].filter(Boolean).join('\n');
  const job = {
    company_id: cid, title: (L.business || L.address.split(',')[0] || 'Website request').slice(0, 120) + ' (web)', address: L.address, lat, lng, status: 'lead',
    customer: { name: L.name, phone: L.phone, email: L.email, company: L.business },
    drawing: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'seal', label: 'Customer outline', gen: 'web' }, geometry: { type: 'Polygon', coordinates: [ring] } }] },
    inputs: { seal: { on: !!price.services.seal }, crack: { on: !!price.services.crack, lf: price.crackLf || undefined }, stripe: { on: !!price.services.stripe, rows: price.stalls ? [{ stalls: price.stalls }] : [] }, source: 'web', web: { low: price.low, high: price.high, sqft: Math.round(price.sqft), crackLevel: price.crackLevel, at: new Date().toISOString() } },
    notes
  };
  const { data: made, error } = await admin.from('lc_jobs').insert(job).select('id').single();
  if (error || !made) return json({ error: 'Something went wrong sending your request. Please call us.' }, 500);
  return json({ ok: true, ref: made.id.slice(0, 8).toUpperCase(), low: price.low, high: price.high });
});
