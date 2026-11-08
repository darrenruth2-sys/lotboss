// Weather go/no-go for sealcoat, crack fill and striping. Forecast from Open-Meteo (free, no key).
import { store as LS } from './safe.js';

export const WEATHER_DEFAULTS = {
  sealMinF: 50,       // sealer: 50°F and rising, per most manufacturers
  sealNightMinF: 40,  // a cold night after sealing slows the cure
  stripeMinF: 50,     // water-based traffic paint
  crackMinF: 40,      // hot-pour on dry pavement
  rainNoGoPct: 50,    // chance of rain that calls the day off
  rainRiskPct: 30,    // chance of rain worth a warning
  windNoGoMph: 25     // spray rigs and paint overspray
};

const num = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

// day: { date, hi, lo, rainPct, rainIn, windMph }  next: the following day (for "no rain 24 h after sealing")
export function judgeDay(services, day, next, rules = {}) {
  const R = { ...WEATHER_DEFAULTS, ...Object.fromEntries(Object.entries(rules || {}).filter(([, v]) => Number.isFinite(Number(v)))) };
  const reasons = []; let level = 'go';
  const worse = l => { const rank = { go: 0, risky: 1, no: 2 }; if (rank[l] > rank[level]) level = l; };
  if (!day) return { level: 'unknown', reasons: ['No forecast that far out'] };
  const S = new Set(services && services.length ? services : ['seal', 'crack', 'stripe']);
  const hi = num(day.hi, null), lo = num(day.lo, null), rain = num(day.rainPct, 0), wind = num(day.windMph, 0);
  const minNeeded = Math.max(S.has('seal') ? R.sealMinF : -99, S.has('stripe') ? R.stripeMinF : -99, S.has('crack') ? R.crackMinF : -99);
  if (hi != null && hi < minNeeded) { worse('no'); reasons.push(`High of ${Math.round(hi)}°F, needs ${minNeeded}°F`); }
  else if (hi != null && hi < minNeeded + 5) { worse('risky'); reasons.push(`Only ${Math.round(hi)}°F, barely warm enough`); }
  if (rain >= R.rainNoGoPct) { worse('no'); reasons.push(`${Math.round(rain)}% chance of rain`); }
  else if (rain >= R.rainRiskPct) { worse('risky'); reasons.push(`${Math.round(rain)}% chance of rain`); }
  if (S.has('seal')) {
    if (lo != null && lo < R.sealNightMinF) { worse('risky'); reasons.push(`Drops to ${Math.round(lo)}°F tonight, slow cure`); }
    const nr = num(next?.rainPct, 0);
    if (next && nr >= R.rainNoGoPct) { worse('risky'); reasons.push(`${Math.round(nr)}% rain the next day, sealer needs 24 h dry`); }
  }
  if ((S.has('seal') || S.has('stripe')) && wind >= R.windNoGoMph) { worse('risky'); reasons.push(`Wind up to ${Math.round(wind)} mph, overspray`); }
  if (!reasons.length) reasons.push(`${hi != null ? Math.round(hi) + '°F, ' : ''}${Math.round(rain)}% rain`);
  return { level, reasons };
}

export function servicesOf(inputs = {}) {
  const s = [];
  if (inputs.seal?.on) s.push('seal');
  if (inputs.crack?.on) s.push('crack');
  if (inputs.stripe?.on) s.push('stripe');
  return s;
}

// days the job covers: start date + number of days (whole days, at least 1)
export function jobDates(start, days) {
  if (!start) return [];
  const out = []; const n = Math.max(1, Math.ceil(num(days, 1)));
  const d = new Date(start + 'T12:00:00');
  for (let i = 0; i < n; i++) { const x = new Date(d); x.setDate(d.getDate() + i); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`); }
  return out;
}

export function parseOpenMeteo(j) {
  const d = j?.daily; if (!d || !Array.isArray(d.time)) return [];
  return d.time.map((date, i) => ({ date, hi: d.temperature_2m_max?.[i], lo: d.temperature_2m_min?.[i], rainPct: d.precipitation_probability_max?.[i] ?? 0, rainIn: d.precipitation_sum?.[i] ?? 0, windMph: d.wind_speed_10m_max?.[i] ?? 0, code: d.weather_code?.[i] }));
}

const mem = new Map();
export async function forecast(lat, lng, fetchImpl = fetch) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  const key = `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
  const hit = mem.get(key) || (() => { try { return JSON.parse(LS.getItem('lotcalc-wx-' + key)); } catch { return null; } })();
  if (hit && Date.now() - hit.at < 45 * 60e3) return hit.days;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${key.split(',')[0]}&longitude=${key.split(',')[1]}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=16`;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const days = parseOpenMeteo(await r.json());
    const rec = { at: Date.now(), days }; mem.set(key, rec); try { LS.setItem('lotcalc-wx-' + key, JSON.stringify(rec)); } catch {}
    return days;
  } catch { return hit ? hit.days : null; }
}

export const ICON = { go: '✓', risky: '!', no: '✕', unknown: '?' };
export const WORD = { go: 'Good to go', risky: 'Risky', no: 'No-go', unknown: 'No forecast yet' };
// WMO weather codes, short words
export function sky(code) {
  const c = Number(code);
  if ([0, 1].includes(c)) return 'Sunny'; if (c === 2) return 'Partly cloudy'; if (c === 3) return 'Cloudy'; if ([45, 48].includes(c)) return 'Fog';
  if (c >= 51 && c <= 57) return 'Drizzle'; if (c >= 61 && c <= 67) return 'Rain'; if (c >= 71 && c <= 77) return 'Snow'; if (c >= 80 && c <= 82) return 'Showers'; if (c >= 85 && c <= 86) return 'Snow showers'; if (c >= 95) return 'Storms';
  return '';
}
