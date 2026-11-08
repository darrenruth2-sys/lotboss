// Data layer. Two stores with the same methods:
//  - cloud: Supabase (real accounts, shared with your crew)
//  - demo:  this browser only (try it without an account; also used by the tests)
import { createClient } from '@supabase/supabase-js';
import { store as LS } from './safe.js';

export const SUPABASE_URL = 'https://wjwzpjhqtqeenydbgvcs.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_zqivN75hg94LPiI5DxkOFg_X-vJZdpK';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const nowIso = () => new Date().toISOString();
const err = e => { if (e) throw new Error(e.message || String(e)); };
const JOB_COLUMNS = ['company_id', 'title', 'customer', 'address', 'lat', 'lng', 'status', 'drawing', 'inputs', 'estimate', 'price', 'scheduled_date', 'scheduled_days', 'crew_ids', 'notes'];

export function cloudStore() {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lotcalc-auth', storage: LS } });
  return {
    kind: 'cloud',
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    onAuth(cb) { return sb.auth.onAuthStateChange((_e, s) => cb(s)); },
    async user() { const { data } = await sb.auth.getUser(); return data.user; },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); err(error); return data.session; },
    async signUp(email, password, name) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name, app: 'lotcalc' }, emailRedirectTo: location.origin + location.pathname } });
      err(error); return data.session; // null when the project requires email confirmation
    },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); err(error); },
    async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); err(error); },
    async signOut() { await sb.auth.signOut(); },
    async myCompanies() {
      const { data: s } = await sb.auth.getSession(); const uid = s.session?.user?.id; if (!uid) return [];
      const { data, error } = await sb.from('lc_members').select('role, company:lc_companies(*)').eq('user_id', uid); err(error);
      return (data || []).filter(r => r.company).map(r => ({ ...r.company, role: r.role }));
    },
    async createCompany(c) {
      const { data, error } = await sb.rpc('lc_create_company', { p_name: c.name, p_phone: c.phone || null, p_email: c.email || null, p_address: c.address || null, p_settings: c.settings || {}, p_member_name: c.memberName || null }); err(error); return data;
    },
    async joinCompany(code, memberName) { const { data, error } = await sb.rpc('lc_join_company', { p_code: code, p_member_name: memberName || null }); err(error); return data; },
    async updateCompany(id, patch) { const { error } = await sb.from('lc_companies').update(patch).eq('id', id); err(error); },
    async listMembers(cid) { const { data, error } = await sb.from('lc_members').select('*').eq('company_id', cid).order('joined_at'); err(error); return data || []; },
    async createInvite(cid, role) { const { data, error } = await sb.rpc('lc_create_invite', { p_company: cid, p_role: role }); err(error); return data; },
    async listInvites(cid) { const { data, error } = await sb.from('lc_invites').select('*').eq('company_id', cid).is('used_by', null).gt('expires_at', nowIso()).order('created_at', { ascending: false }); err(error); return data || []; },
    async removeMember(cid, uid) { const { error } = await sb.from('lc_members').delete().eq('company_id', cid).eq('user_id', uid); err(error); },
    async setMemberRole(cid, uid, role) { const { error } = await sb.from('lc_members').update({ role }).eq('company_id', cid).eq('user_id', uid); err(error); },
    async listCrew(cid) { const { data, error } = await sb.from('lc_crew').select('*').eq('company_id', cid).order('name'); if (error) return []; return data || []; },
    async saveCrew(row) {
      if (row.id) { const { id, created_at, cal_token, ...p } = row; const { error } = await sb.from('lc_crew').update(p).eq('id', id); err(error); return row; }
      const { data, error } = await sb.from('lc_crew').insert(row).select().single(); err(error); return data;
    },
    async deleteCrew(id) { const { error } = await sb.from('lc_crew').delete().eq('id', id); err(error); },
    // time clock
    async clockIn(jobId, lat, lng) { const { data, error } = await sb.rpc('lc_clock_in', { p_job: jobId, p_lat: lat ?? null, p_lng: lng ?? null }); err(error); return data; },
    async clockOut(lat, lng) { const { data, error } = await sb.rpc('lc_clock_out', { p_lat: lat ?? null, p_lng: lng ?? null }); err(error); return data; },
    async myClock(crewId) { if (!crewId) return null; const { data, error } = await sb.from('lc_time').select('*').eq('crew_id', crewId).is('out_at', null).order('in_at', { ascending: false }).limit(1); if (error) return null; return data?.[0] || null; },
    async jobTime(jobId) { const { data, error } = await sb.from('lc_time').select('*').eq('job_id', jobId).order('in_at'); if (error) return []; return data || []; },
    // website quote form (public, no login)
    async web(action, body) {
      let r; try { r = await fetch(`${SUPABASE_URL}/functions/v1/lotcalc-web`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify({ ...body, action }) }); }
      catch { throw new Error('No signal. Try again when you have service.'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || 'Something went wrong. Please try again.');
      return j;
    },
    // follow-ups
    async openQuotes(cid) { const { data, error } = await sb.from('lc_quotes').select('id, job_id, number, status, created_at, viewed_at, expires_at, share_token, total').eq('company_id', cid).in('status', ['sent', 'viewed']).limit(2000); if (error) return []; return data || []; },
    async followState(cid) { const { data, error } = await sb.from('lc_followups').select('job_id, key, state, until').eq('company_id', cid).limit(5000); if (error) return []; return data || []; },
    async setFollow(jobId, cid, key, state, until = null) { const { error } = await sb.from('lc_followups').upsert({ job_id: jobId, company_id: cid, key, state, until }); err(error); },
    // crew schedules: names only for everyone (no wages), live calendar links
    async crewNames(cid) { const { data, error } = await sb.rpc('lc_crew_names', { p_company: cid }); if (error) return []; return data || []; },
    async myCalendar(cid) { const { data, error } = await sb.rpc('lc_my_calendar', { p_company: cid }); err(error); return data || null; },
    async calendarLink(cid, crewId, reset = false) { const { data, error } = await sb.rpc('lc_calendar_link', { p_company: cid, p_crew: crewId || null, p_reset: !!reset }); err(error); return data; },
    liveCalendars: true,
    // AI (Gemini, through our own edge function so the key never reaches the phone)
    async aiPhotoCheck(job, paths) {
      const { data, error } = await sb.functions.invoke('lotcalc-ai', { body: { action: 'photo', job: job.id, paths } });
      if (error) { let msg = error.message; try { const b = await error.context.json(); msg = b.error || msg; } catch { /* not json */ } throw new Error(/Failed to send|fetch/i.test(msg) ? 'No signal. Try again when you have service.' : msg); }
      if (!data?.result) throw new Error(data?.error || 'The AI did not answer. Try again.');
      return data.result;
    },
    async aiOutline(job, v) {
      const { data, error } = await sb.functions.invoke('lotcalc-ai', { body: { action: 'outline', job: job.id, lat: v.lat, lng: v.lng, meters: v.meters } });
      if (error) { let msg = error.message; try { const b = await error.context.json(); msg = b.error || msg; } catch { /* not json */ } throw new Error(/Failed to send|fetch/i.test(msg) ? 'No signal. Try again when you have service.' : msg); }
      if (!data?.result) throw new Error(data?.error || 'The AI did not answer. Try again.');
      return data.result;
    },
    async aiReadEmail(cid, text) {
      const { data, error } = await sb.functions.invoke('lotcalc-ai', { body: { action: 'email', company: cid, text } });
      if (error) { let msg = error.message; try { const b = await error.context.json(); msg = b.error || msg; } catch { /* not json */ } throw new Error(/Failed to send|fetch/i.test(msg) ? 'No signal. Try again when you have service.' : msg); }
      if (!data?.result) throw new Error(data?.error || 'The AI did not answer. Try again.');
      return data.result;
    },
    async listJobs(cid) { const { data, error } = await sb.from('lc_jobs').select('id,company_id,title,customer,address,lat,lng,status,price,scheduled_date,scheduled_days,crew_ids,inputs,updated_at,created_at').eq('company_id', cid).order('updated_at', { ascending: false }).limit(500); err(error); return data || []; },
    async getJob(id) { const { data, error } = await sb.from('lc_jobs').select('*').eq('id', id).single(); err(error); return data; },
    async saveJob(row) {
      if (row.id) {
        const { id, created_at, updated_at, created_by, ...rest } = row;
        const p = Object.fromEntries(Object.entries(rest).filter(([k]) => JOB_COLUMNS.includes(k))); // only real columns
        let q = sb.from('lc_jobs').update(p).eq('id', id);
        if (updated_at) q = q.eq('updated_at', updated_at); // only if nobody else saved since we loaded it
        const { data, error } = await q.select().maybeSingle(); err(error);
        if (!data) { const { data: cur } = await sb.from('lc_jobs').select('id').eq('id', id).maybeSingle(); throw new Error(cur ? 'CONFLICT' : 'This job was deleted'); }
        return data;
      }
      const { data: s } = await sb.auth.getSession();
      const clean = Object.fromEntries(Object.entries(row).filter(([k]) => JOB_COLUMNS.includes(k)));
      const { data, error } = await sb.from('lc_jobs').insert({ ...clean, created_by: s.session?.user?.id }).select().single(); err(error); return data;
    },
    async deleteJob(id) { const { error } = await sb.from('lc_jobs').delete().eq('id', id); err(error); },
    async saveQuote(jobId, data, total, validDays = 30) { const { data: q, error } = await sb.rpc('lc_save_quote', { p_job: jobId, p_data: data, p_total: total, p_valid_days: validDays }); err(error); return q; },
    async publicQuote(token) { const { data, error } = await sb.rpc('lc_public_quote', { p_token: token }); err(error); return data; },
    async acceptQuote(token, option, name, signature) { const { data, error } = await sb.rpc('lc_accept_quote', { p_token: token, p_option: option, p_name: name, p_signature: signature }); err(error); return data; },
    async declineQuote(token, reason) { const { data, error } = await sb.rpc('lc_decline_quote', { p_token: token, p_reason: reason }); err(error); return data; },
    async listQuotes(jobId) { const { data, error } = await sb.from('lc_quotes').select('*').eq('job_id', jobId).order('number', { ascending: false }); if (error) return []; return data || []; },
    async listPhotos(jobId) {
      const { data, error } = await sb.from('lc_photos').select('*').eq('job_id', jobId).order('created_at'); err(error);
      if (!data?.length) return [];
      const { data: urls } = await sb.storage.from('lotcalc').createSignedUrls(data.map(p => p.path), 3600);
      const byPath = Object.fromEntries((urls || []).map(u => [u.path, u.signedUrl]));
      return data.map(p => ({ ...p, url: byPath[p.path] || null }));
    },
    async addPhoto(job, shrunk, meta) {
      const path = `${job.company_id}/${job.id}/${uuid()}.jpg`;
      const up = await sb.storage.from('lotcalc').upload(path, shrunk.blob, { contentType: 'image/jpeg', upsert: false }); err(up.error);
      const { data, error } = await sb.from('lc_photos').insert({ company_id: job.company_id, job_id: job.id, path, label: meta.label, note: meta.note || null, width: shrunk.width, height: shrunk.height, bytes: shrunk.blob.size }).select().single();
      if (error) { await sb.storage.from('lotcalc').remove([path]); err(error); }
      return data;
    },
    async updatePhoto(id, patch) { const { error } = await sb.from('lc_photos').update(patch).eq('id', id); err(error); },
    async deletePhoto(p) { const { error } = await sb.from('lc_photos').delete().eq('id', p.id); err(error); await sb.storage.from('lotcalc').remove([p.path]); },
    // invoices + payments (owners, admins, estimators only)
    async listInvoices(cid) { const { data, error } = await sb.from('lc_invoices').select('*').eq('company_id', cid).order('number', { ascending: false }).limit(2000); if (error) return []; return data || []; },
    async jobInvoices(jobId) { const { data, error } = await sb.from('lc_invoices').select('*').eq('job_id', jobId).order('number'); if (error) return []; return data || []; },
    async createInvoice(jobId, d) { const { data, error } = await sb.rpc('lc_create_invoice', { p_job: jobId, p_kind: d.kind, p_data: d.data, p_total: d.total, p_due: d.due_date || null }); err(error); return data; },
    async updateInvoice(id, patch) { const p = {}; for (const k of ['due_date', 'status', 'data']) if (k in patch) p[k] = patch[k]; const { data, error } = await sb.from('lc_invoices').update(p).eq('id', id).select().single(); err(error); return data; },
    async addPayment(id, p) { const { data, error } = await sb.rpc('lc_add_payment', { p_invoice: id, p_amount: p.amount, p_date: p.date, p_method: p.method, p_ref: p.ref || null }); err(error); return data; },
    async removePayment(id, pid) { const { data, error } = await sb.rpc('lc_remove_payment', { p_invoice: id, p_payment: pid }); err(error); return data; },
    // job wrap-up (what it really took)
    async getCosts(jobId) { const { data, error } = await sb.from('lc_job_costs').select('*').eq('job_id', jobId).maybeSingle(); if (error) return null; return data; },
    async saveCosts(jobId, cid, d) { const { data, error } = await sb.from('lc_job_costs').upsert({ job_id: jobId, company_id: cid, data: d }).select().single(); err(error); return data; },
    async listCosts(cid) { const { data, error } = await sb.from('lc_job_costs').select('*').eq('company_id', cid).limit(2000); if (error) return []; return data || []; }
  };
}

// ---------- demo store: everything in this browser ----------
export function demoStore(key = 'lotcalc-demo') {
  const load = () => { try { const v = JSON.parse(LS.getItem(key)); return v && Array.isArray(v.jobs) ? v : null; } catch { return null; } };
  let db = load() || { user: null, companies: [], members: [], crew: [], jobs: [], quotes: [], invites: [] };
  const save = () => { LS.setItem(key, JSON.stringify(db)); };
  const listeners = new Set();
  const fresh = () => { const v = load(); if (v) db = v; }; // pick up changes made in another tab (like a customer signing)
  const sess = () => db.user ? { user: db.user } : null;
  const mine = cid => db.members.find(m => m.company_id === cid && m.user_id === db.user?.id);
  const can = cid => ['owner', 'admin', 'estimator'].includes(mine(cid)?.role);
  const boss = cid => ['owner', 'admin'].includes(mine(cid)?.role);
  const need = ok => { if (!ok) throw new Error('Not allowed'); };
  const api = {
    kind: 'demo',
    async session() { return sess(); },
    onAuth(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    async user() { return db.user; },
    async signIn(email) { db.user = { id: 'demo-user', email: email || 'demo@lotcalc.app', user_metadata: { name: 'Demo' } }; save(); listeners.forEach(f => f(sess())); return sess(); },
    async signUp(email, _pw, name) { db.user = { id: 'demo-user', email, user_metadata: { name } }; save(); listeners.forEach(f => f(sess())); return sess(); },
    async resetPassword() {}, async updatePassword() {},
    async signOut() { db.user = null; save(); listeners.forEach(f => f(null)); },
    async myCompanies() { return db.members.filter(m => m.user_id === db.user?.id).map(m => ({ ...db.companies.find(c => c.id === m.company_id), role: m.role })).filter(c => c.id); },
    async createCompany(c) {
      const id = uuid(); db.companies.push({ id, name: c.name, phone: c.phone || null, email: c.email || null, address: c.address || null, website: null, logo: null, settings: c.settings || {}, created_at: nowIso() });
      db.members.push({ company_id: id, user_id: db.user.id, role: 'owner', name: c.memberName || null, joined_at: nowIso() }); save(); return id;
    },
    async joinCompany(code) { const inv = db.invites.find(i => i.code === String(code).trim().toUpperCase() && !i.used_by); if (!inv) throw new Error('That invite code is not valid or has expired'); inv.used_by = db.user.id; save(); return inv.company_id; },
    async updateCompany(id, patch) { need(boss(id)); Object.assign(db.companies.find(c => c.id === id), patch); save(); },
    async listMembers(cid) { return db.members.filter(m => m.company_id === cid); },
    async createInvite(cid, role) { need(boss(cid)); const code = uuid().replace(/-/g, '').slice(0, 12).toUpperCase(); db.invites.push({ code, company_id: cid, role, created_at: nowIso(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), used_by: null }); save(); return code; },
    async listInvites(cid) { return db.invites.filter(i => i.company_id === cid && !i.used_by); },
    async removeMember(cid, uid) { need(boss(cid)); db.members = db.members.filter(m => !(m.company_id === cid && m.user_id === uid && m.role !== 'owner')); save(); },
    async setMemberRole(cid, uid, role) { need(boss(cid)); const m = db.members.find(x => x.company_id === cid && x.user_id === uid); if (m && m.role !== 'owner') m.role = role; save(); },
    async listCrew(cid) { return can(cid) ? db.crew.filter(c => c.company_id === cid).sort((a, b) => a.name.localeCompare(b.name)) : []; },
    async saveCrew(row) { need(boss(row.company_id)); if (row.id) { Object.assign(db.crew.find(c => c.id === row.id), row); save(); return row; } const r = { active: true, ...row, id: uuid(), created_at: nowIso() }; db.crew.push(r); save(); return r; },
    async deleteCrew(id) { db.crew = db.crew.filter(c => c.id !== id); save(); },
    // time clock, same rules as lc_clock_in / lc_clock_out
    async clockIn(jobId, lat, lng) {
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('Failed to fetch');
      const j = db.jobs.find(x => x.id === jobId); need(j && mine(j.company_id));
      const me = db.crew.find(c => c.company_id === j.company_id && c.user_id === db.user.id);
      if (!me) throw new Error("Your login isn't linked to a crew name yet. Ask your boss (Settings > Crew > Edit > Login).");
      const list = (db.time ||= []); if (list.some(t => t.crew_id === me.id && !t.out_at)) throw new Error("You're already clocked in. Clock out first.");
      const dist = (a, b, c, d) => (a == null || c == null) ? null : Math.round(20902231 * 2 * Math.asin(Math.sqrt(Math.sin((c - a) * Math.PI / 360) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin((d - b) * Math.PI / 360) ** 2)));
      const t = { id: uuid(), company_id: j.company_id, job_id: j.id, crew_id: me.id, user_id: db.user.id, in_at: nowIso(), out_at: null, in_dist_ft: dist(lat, lng, j.lat, j.lng) };
      list.push(t); save(); return structuredClone(t);
    },
    async clockOut() {
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('Failed to fetch');
      const mineIds = db.crew.filter(c => c.user_id === db.user?.id).map(c => c.id);
      const t = (db.time || []).filter(x => mineIds.includes(x.crew_id) && !x.out_at).sort((a, b) => b.in_at.localeCompare(a.in_at))[0];
      if (!t) throw new Error("You're not clocked in.");
      t.out_at = new Date(Math.min(Date.now(), new Date(t.in_at).getTime() + 20 * 3600e3)).toISOString(); save(); return structuredClone(t);
    },
    async myClock(crewId) { return structuredClone((db.time || []).find(t => t.crew_id === crewId && !t.out_at) || null); },
    async jobTime(jobId) { const j = db.jobs.find(x => x.id === jobId); if (!j || !can(j.company_id)) return []; return (db.time || []).filter(t => t.job_id === jobId).map(t => ({ ...t })); },
    _addTime(t) { (db.time ||= []).push({ id: uuid(), ...t }); save(); }, // test helper
    // website quote form, same rules as the lotcalc-web edge function (demo only: priced in the browser)
    async web(action, body) {
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('No signal. Try again when you have service.');
      const { webPrice, cleanLead, cleanRing, webSettings } = await import('./webquote.js');
      const co = db.companies.find(c => c.id === body.company); const W = webSettings(co?.settings || {});
      if (!co || !W.on) throw new Error("This company isn't taking online quote requests right now. Please call them.");
      if (action === 'info') return { name: co.name, phone: co.phone || '', logo: co.logo || null, services: W.services, message: W.message || '', rangePct: W.rangePct };
      const ring = cleanRing(body.ring); if (!ring) throw new Error('Outline your lot on the map first (tap each corner).');
      const { default: area } = await import('@turf/area'); const { polygon } = await import('@turf/helpers');
      const price = webPrice({ ...body, sqft: area(polygon([ring])) * 10.763910416709722 }, co.settings || {}); if (price.error) throw new Error(price.error);
      if (action === 'price') return { low: price.low, high: price.high, sqft: price.sqft, stalls: price.stalls, guessedStalls: price.guessedStalls, crackLf: price.crackLf };
      if (body.hp) return { ok: true, ref: 'thanks' };
      if (!(Number(body.ms) >= 4000)) throw new Error('Please take a second to check your info, then send again.');
      const c = cleanLead(body); if (c.error) throw new Error(c.error);
      const L = c.lead; const id = uuid();
      const lat = ring.slice(0, -1).reduce((t, p) => t + p[1], 0) / (ring.length - 1), lng = ring.slice(0, -1).reduce((t, p) => t + p[0], 0) / (ring.length - 1);
      db.jobs.unshift({ id, company_id: co.id, title: (L.business || L.address.split(',')[0] || 'Website request').slice(0, 120) + ' (web)', address: L.address, lat, lng, status: 'lead', customer: { name: L.name, phone: L.phone, email: L.email, company: L.business },
        drawing: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'seal', label: 'Customer outline', gen: 'web' }, geometry: { type: 'Polygon', coordinates: [ring] } }] },
        inputs: { seal: { on: !!price.services.seal }, crack: { on: !!price.services.crack, lf: price.crackLf || undefined }, stripe: { on: !!price.services.stripe, rows: price.stalls ? [{ stalls: price.stalls }] : [] }, source: 'web', web: { low: price.low, high: price.high, sqft: Math.round(price.sqft), crackLevel: price.crackLevel, at: nowIso() } },
        notes: `Website quote request. They saw $${price.low.toLocaleString('en-US')} to $${price.high.toLocaleString('en-US')} for about ${Math.round(price.sqft).toLocaleString('en-US')} sq ft.${L.note ? '\nThey wrote: ' + L.note : ''}`, price: null, created_at: nowIso(), updated_at: nowIso() });
      save(); return { ok: true, ref: id.slice(0, 8).toUpperCase(), low: price.low, high: price.high };
    },
    async openQuotes(cid) { if (!can(cid)) return []; return db.quotes.filter(q => q.company_id === cid && ['sent', 'viewed'].includes(q.status)).map(q => ({ id: q.id, job_id: q.job_id, number: q.number, status: q.status, created_at: q.created_at, viewed_at: q.viewed_at, expires_at: q.expires_at, share_token: q.share_token, total: q.total })); },
    async followState(cid) { if (!can(cid)) return []; return (db.follow || []).filter(f => f.company_id === cid).map(f => ({ ...f })); },
    async setFollow(jobId, cid, key, state, until = null) {
      const j = db.jobs.find(x => x.id === jobId); need(j && j.company_id === cid && can(cid));
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('Failed to fetch');
      if (!['done', 'snoozed', 'never'].includes(state)) throw new Error('Bad state');
      const list = (db.follow ||= []); const f = list.find(x => x.job_id === jobId && x.key === key);
      if (f) Object.assign(f, { state, until }); else list.push({ job_id: jobId, company_id: cid, key, state, until });
      save();
    },
    async crewNames(cid) { if (!mine(cid)) return []; return db.crew.filter(c => c.company_id === cid && c.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ id: c.id, name: c.name, time_off: structuredClone(c.time_off || []), is_me: !!db.user && c.user_id === db.user.id })); },
    async myCalendar() { return null; },
    async calendarLink() { throw new Error('Live calendar links need a real account. In the demo, use Download instead.'); },
    liveCalendars: false,
    // demo: a made-up outline around the middle of the map so you can see how it works
    async aiOutline(job, v) {
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('No signal. Try again when you have service.');
      if (!Number.isFinite(v?.lat) || !Number.isFinite(v?.lng)) throw new Error('Find the lot on the map first.');
      await new Promise(r => setTimeout(r, 700));
      const k = 1 / (364000 * Math.cos(v.lat * Math.PI / 180)), q = 1 / 364000; // feet to degrees
      const P = (x, y) => [Math.round((v.lng + x * k) * 1e7) / 1e7, Math.round((v.lat + y * q) * 1e7) / 1e7];
      const ring = pts => [...pts.map(([x, y]) => P(x, y)), P(...pts[0])];
      return { demo: true, found: true, lots: [{ label: 'Main lot', ring: ring([[-160, -90], [150, -95], [165, 60], [40, 85], [-155, 80]]) }], skip: [{ kind: 'island', ring: ring([[-20, -15], [25, -15], [25, 10], [-20, 10]]) }], stalls: 96, surface: 'asphalt', notes: 'Sample outline (demo). Real accounts trace the satellite picture.', confidence: 0.8, meters: v.meters, center: [v.lng, v.lat], model: 'demo sample', at: new Date().toISOString() };
    },
    // demo: a simple pattern reader so you can try it (real accounts use the AI)
    async aiReadEmail(cid, text) {
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('No signal. Try again when you have service.');
      const t = String(text || ''); if (t.trim().length < 15) throw new Error("Paste the whole message (it's too short).");
      await new Promise(r => setTimeout(r, 500));
      const low = t.toLowerCase();
      const isJob = /seal|crack|strip|paint|line|parking|lot|asphalt|blacktop|pave/.test(low) && !/congratulations|unsubscribe|click here/.test(low);
      const email = (t.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0];
      const phone = (t.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [''])[0];
      const addr = (t.match(/\d{2,6}\s+[A-Za-z0-9 .]+?(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Dr|Drive|Pike|Hwy|Ln|Lane|Way|Ct)\b\.?(?:,\s*(?:[A-Z][a-z]+\s?)+(?:,?\s*[A-Z]{2}\b)?(?:\s+\d{5})?)?/) || [''])[0].trim();
      const from = (t.match(/From:\s*([^<\n]+)/i) || [])[1]?.trim() || '';
      return { demo: true, isJobRequest: isJob, title: (addr ? addr.split(',')[0] : 'New lot').slice(0, 120), customer: { name: from, company: '', phone, email }, address: addr, wants: { seal: /seal/.test(low), crack: /crack/.test(low), stripe: /strip|line|paint/.test(low), other: '' }, sizeHint: (t.match(/\d+\s*(?:spaces|stalls|spots|acres?)/i) || [''])[0], deadline: (t.match(/(?:before|by)\s+[^.\n]{3,30}/i) || [''])[0], isBid: /\bbid\b|rfp/.test(low), notes: '', model: 'demo reader' };
    },
    // demo: a canned answer so you can see how it works (real accounts ask the AI)
    async aiPhotoCheck(job, paths) {
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('No signal. Try again when you have service.');
      if (!paths?.length) throw new Error('Pick at least one photo of this job.');
      await new Promise(r => setTimeout(r, 900));
      return { demo: true, isParkingLot: true, condition: 'fair', summary: 'The lot is oxidized and gray with scattered longitudinal and transverse cracks. No potholes, but a few oil stains near the stalls.', cracks: { severity: 'moderate', types: ['longitudinal', 'transverse', 'block'], widestInches: 0.5, lfLow: 140, lfHigh: 220, alligatorSqft: 60 }, potholes: 0, oilSpots: 3, sealerCondition: 'worn', stripingCondition: 'faded', recommend: ['Hot-pour crack fill all cracks wider than 1/4 in', 'Prime the 3 oil spots before sealing', 'Two coats of sealer with sand', 'Restripe: the lines are faded'], notForSealcoat: ['About 60 sq ft of alligator cracking by the dumpster should be cut out and patched'], confidence: 0.7, photos: paths.length, model: 'demo sample', at: new Date().toISOString() };
    },
    async listJobs(cid) { return db.jobs.filter(j => j.company_id === cid).sort((a, b) => b.updated_at.localeCompare(a.updated_at)); },
    async getJob(id) { const j = db.jobs.find(x => x.id === id); if (!j) throw new Error('Job not found'); return structuredClone(j); },
    async saveJob(row) {
      need(can(row.company_id));
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('Failed to fetch');
      if (row.id) {
        const j = db.jobs.find(x => x.id === row.id); if (!j) throw new Error('This job was deleted');
        if (row.updated_at && j.updated_at !== row.updated_at) throw new Error('CONFLICT'); // same rule as the cloud
        let t = nowIso(); if (t <= j.updated_at) t = new Date(Date.parse(j.updated_at) + 1).toISOString();
        Object.assign(j, structuredClone(row), { updated_at: t }); save(); return structuredClone(j);
      }
      const j = { status: 'lead', customer: {}, drawing: { type: 'FeatureCollection', features: [] }, inputs: {}, estimate: {}, crew_ids: [], ...structuredClone(row), id: uuid(), created_at: nowIso(), updated_at: nowIso() };
      db.jobs.push(j); save(); return structuredClone(j);
    },
    async deleteJob(id) { db.jobs = db.jobs.filter(j => j.id !== id); db.quotes = db.quotes.filter(q => q.job_id !== id); db.photos = (db.photos || []).filter(p => p.job_id !== id); db.invoices = (db.invoices || []).filter(x => x.job_id !== id); db.costs = (db.costs || []).filter(x => x.job_id !== id); db.follow = (db.follow || []).filter(x => x.job_id !== id); save(); },
    // same rules as the cloud functions (lc_save_quote / lc_public_quote / lc_accept_quote / lc_decline_quote)
    async saveQuote(jobId, data, total, validDays = 30) {
      const j = db.jobs.find(x => x.id === jobId); need(j && can(j.company_id));
      const number = Math.max(1000, ...db.quotes.filter(q => q.company_id === j.company_id).map(q => q.number)) + 1;
      db.quotes.filter(q => q.job_id === jobId && ['sent', 'viewed'].includes(q.status || 'sent')).forEach(q => q.status = 'replaced');
      const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('');
      const q = { id: uuid(), company_id: j.company_id, job_id: jobId, number, data, total, created_at: nowIso(), share_token: token, status: 'sent', expires_at: new Date(Date.now() + validDays * 864e5).toISOString() }; db.quotes.push(q);
      if (j.status === 'lead') j.status = 'quoted'; j.price = total; j.updated_at = nowIso(); save(); return q;
    },
    async publicQuote(token) {
      const q = db.quotes.find(x => x.share_token === token && /^[0-9a-f]{36}$/.test(token || ''));
      if (!q) return { error: 'not_found' };
      const c = db.companies.find(x => x.id === q.company_id) || {};
      if (q.status === 'sent' && !(typeof window !== 'undefined' && window.__lcOwnerPreview)) { q.status = 'viewed'; q.viewed_at = nowIso(); save(); }
      const latest = q.status === 'replaced' ? db.quotes.filter(x => x.job_id === q.job_id && ['sent', 'viewed', 'accepted'].includes(x.status)).sort((a, b) => b.number - a.number)[0]?.share_token : null;
      return { number: q.number, status: q.status, created_at: q.created_at, expires_at: q.expires_at, expired: q.expires_at < nowIso() && ['sent', 'viewed'].includes(q.status), accepted_at: q.accepted_at || null, accepted_name: q.accepted_name || null, accepted_option: q.accepted_option ?? null, declined_at: q.declined_at || null, latest_token: latest || null, total: q.total, quote: q.data?.public || {}, company: { name: c.name, phone: c.phone, email: c.email, address: c.address, website: c.website, logo: c.logo } };
    },
    async acceptQuote(token, option, name, signature) {
      const q = db.quotes.find(x => x.share_token === token); if (!q) throw new Error('This link is not valid');
      if (q.status === 'accepted') throw new Error('This quote was already accepted');
      if (q.status === 'replaced') throw new Error('This quote was replaced by a newer one');
      if (q.status === 'declined') throw new Error('This quote was declined');
      if (q.expires_at < nowIso()) throw new Error('This quote has expired. Ask for an updated one.');
      if (String(name || '').trim().length < 2) throw new Error('Type your full name');
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature || '') || signature.length > 300000) throw new Error('Please sign in the box');
      const opts = q.data?.public?.options || []; let price = q.total;
      if (opts.length) { if (!(option >= 0 && option < opts.length)) throw new Error('Pick one of the options'); price = opts[option].total; } else option = null;
      Object.assign(q, { status: 'accepted', accepted_at: nowIso(), accepted_name: String(name).trim(), accepted_option: option, signature });
      const j = db.jobs.find(x => x.id === q.job_id); if (j) { if (['lead', 'quoted'].includes(j.status)) j.status = 'won'; j.price = price; j.updated_at = nowIso(); }
      save(); return { ok: true, status: 'accepted' };
    },
    async declineQuote(token, reason) {
      const q = db.quotes.find(x => x.share_token === token); if (!q) throw new Error('This link is not valid');
      if (!['sent', 'viewed'].includes(q.status)) throw new Error("This quote can't be declined now");
      Object.assign(q, { status: 'declined', declined_at: nowIso(), decline_reason: String(reason || '').trim().slice(0, 500) || null }); save(); return { ok: true, status: 'declined' };
    },
    async listQuotes(jobId) { return db.quotes.filter(q => q.job_id === jobId).sort((a, b) => b.number - a.number); },
    async listPhotos(jobId) { return (db.photos || []).filter(p => p.job_id === jobId).map(p => ({ ...p, url: p.data })); },
    async addPhoto(job, shrunk, meta) {
      // demo keeps small copies inside this browser only
      const k = Math.min(1, 640 / Math.max(shrunk.width, shrunk.height)); const cv = document.createElement('canvas'); cv.width = Math.round(shrunk.width * k); cv.height = Math.round(shrunk.height * k);
      cv.getContext('2d').drawImage(shrunk.canvas, 0, 0, cv.width, cv.height);
      const p = { id: uuid(), company_id: job.company_id, job_id: job.id, path: `${job.company_id}/${job.id}/${uuid()}.jpg`, label: meta.label, note: meta.note || null, width: cv.width, height: cv.height, created_by: db.user.id, created_at: nowIso(), data: cv.toDataURL('image/jpeg', 0.6) };
      (db.photos ||= []).push(p); try { save(); } catch {} return p;
    },
    async updatePhoto(id, patch) { Object.assign((db.photos || []).find(p => p.id === id) || {}, patch); save(); },
    async deletePhoto(p) { db.photos = (db.photos || []).filter(x => x.id !== p.id); save(); },
    // same rules as lc_create_invoice / lc_add_payment / lc_remove_payment / the invoice guard
    async listInvoices(cid) { if (!can(cid)) return []; return (db.invoices || []).filter(i => i.company_id === cid).sort((a, b) => b.number - a.number).map(x => structuredClone(x)); },
    async jobInvoices(jobId) { const j = db.jobs.find(x => x.id === jobId); if (!j || !can(j.company_id)) return []; return (db.invoices || []).filter(i => i.job_id === jobId).sort((a, b) => a.number - b.number).map(x => structuredClone(x)); },
    async createInvoice(jobId, d) {
      const j = db.jobs.find(x => x.id === jobId); need(j && can(j.company_id));
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('Failed to fetch');
      if (!['full', 'deposit', 'balance'].includes(d.kind)) throw new Error('Bad invoice type');
      if (!(Number(d.total) > 0 && Number(d.total) < 1e8)) throw new Error('Invoice total must be more than $0');
      const list = (db.invoices ||= []);
      const number = Math.max(2000, ...list.filter(i => i.company_id === j.company_id).map(i => i.number)) + 1;
      const inv = { id: uuid(), company_id: j.company_id, job_id: jobId, number, kind: d.kind, status: 'open', issued: d.issued || nowIso().slice(0, 10), due_date: d.due_date || null, total: Math.round(Number(d.total) * 100) / 100, data: structuredClone(d.data || {}), payments: [], created_at: nowIso(), updated_at: nowIso() };
      list.push(inv); save(); return structuredClone(inv);
    },
    async updateInvoice(id, patch) {
      const inv = (db.invoices || []).find(i => i.id === id); need(inv && can(inv.company_id));
      if (patch.status === 'void' && inv.status !== 'void' && inv.payments.length) throw new Error('Remove the payments before voiding this invoice');
      if (inv.status === 'void' && patch.status && patch.status !== 'void') throw new Error("A voided invoice can't be reopened. Make a new one.");
      for (const k of ['due_date', 'status', 'data']) if (k in patch) inv[k] = structuredClone(patch[k]);
      inv.updated_at = nowIso(); save(); return structuredClone(inv);
    },
    async addPayment(id, p) {
      const inv = (db.invoices || []).find(i => i.id === id); need(inv && can(inv.company_id));
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('Failed to fetch');
      if (inv.status === 'void') throw new Error('This invoice was voided');
      const amt = Number(p.amount); if (!(amt > 0) || Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-6) throw new Error('Enter the amount paid in dollars and cents');
      if (!['check', 'cash', 'card', 'ach', 'other'].includes(p.method)) throw new Error('Pick how they paid');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw new Error('Pick the date it was paid');
      const paid = inv.payments.reduce((t, x) => t + Number(x.amount), 0);
      if (amt > inv.total - paid + 0.005) throw new Error(`That's more than what's owed ($${(inv.total - paid).toFixed(2)})`);
      inv.payments.push({ id: uuid(), amount: amt, date: p.date, method: p.method, ref: String(p.ref || '').slice(0, 80), at: nowIso() }); inv.updated_at = nowIso(); save(); return structuredClone(inv);
    },
    async removePayment(id, pid) { const inv = (db.invoices || []).find(i => i.id === id); need(inv && can(inv.company_id)); inv.payments = inv.payments.filter(x => x.id !== pid); inv.updated_at = nowIso(); save(); return structuredClone(inv); },
    async getCosts(jobId) { const j = db.jobs.find(x => x.id === jobId); if (!j || !can(j.company_id)) return null; const c = (db.costs || []).find(x => x.job_id === jobId); return c ? structuredClone(c) : null; },
    async saveCosts(jobId, cid, d) {
      const j = db.jobs.find(x => x.id === jobId); need(j && j.company_id === cid && can(cid));
      if (typeof window !== 'undefined' && window.__lcOffline) throw new Error('Failed to fetch');
      const list = (db.costs ||= []); let c = list.find(x => x.job_id === jobId);
      if (!c) { c = { job_id: jobId, company_id: cid }; list.push(c); }
      c.data = structuredClone(d); c.updated_at = nowIso(); save(); return structuredClone(c);
    },
    async listCosts(cid) { if (!can(cid)) return []; return (db.costs || []).filter(c => c.company_id === cid).map(x => structuredClone(x)); },
    _backdateQuote(id, days, patch = {}) { const q = db.quotes.find(x => x.id === id); if (!q) return; const t = new Date(Date.now() - days * 864e5).toISOString(); Object.assign(q, { created_at: t, expires_at: new Date(Date.now() + (30 - days) * 864e5).toISOString() }, patch); save(); }, // demo seeding only
    _otherUserEdits(id, patch) { const j = db.jobs.find(x => x.id === id); Object.assign(j, patch, { updated_at: new Date(Date.now() + 5).toISOString() }); save(); }, // test helper
    _reset() { db = { user: null, companies: [], members: [], crew: [], jobs: [], quotes: [], invites: [] }; save(); }
  };
  for (const [k, f] of Object.entries(api)) if (typeof f === 'function' && !k.startsWith('_') && k !== 'onAuth') api[k] = function (...a) { fresh(); return f.apply(this, a); };
  return api;
}
