import 'leaflet/dist/leaflet.css';
import './styles.css';
import { h, put, $, $$, usd, usd0, num, dateStr, localDay, toast, modal, confirmBox, field, toggle, busy, download, debounce } from './ui.js';
import { cloudStore, demoStore, SUPABASE_URL } from './store.js';
import { store as LS, storageWorks } from './safe.js';
import { DEFAULTS, merge, estimate, adaRequired, ADA_NOTES, sealcoat, tankMix, crackFill, striping } from './calc.js';
import { effectiveInputs, drawingTotals, STENCILS, measureFeature } from './geo.js';
import { createMap, featureEditor, pickStencil, geocode } from './mapview.js';
import { quoteDoc, quoteText, ics, DEFAULT_TERMS, buildPublic, renderQuote, renderInvoice } from './quote.js';
import { followUps, smsLink, mailLink, KIND_WORD, addDays as addDay } from './followups.js';
import { qbInvoices, qbPayments, qbCustomers, csv, moneyTotals, payInfo, payText, driveway as drivewayPrice } from './books.js';
import { jobDays, weekOf, addDays, offOn, cleanOff, jobsOn, problems, bookingWarnings, freeOn, weekText, myCrew } from './crewplan.js';
import { designLayout, lotFromDrawing, applyLayout, LAYOUT_DEFAULTS } from './layout.js';
import { invoiceDraft, invoiceState, STATE_WORD, daysLate, balanceOf, paidOn, billedSoFar, checkPayment, moneySummary, estSnapshot, wrapUp, learn, invoiceText, METHODS, r2 } from './money.js';
import { suggestPackages, estimatePackages } from './packages.js';
import { forecast, judgeDay, servicesOf, jobDates, sky, ICON, WORD } from './weather.js';
import { shrinkPhoto, LABELS } from './photos.js';

const RECOVERY = /type=recovery/.test(location.hash);
const S = { store: null, session: null, companies: [], company: null, role: null, crew: [], jobs: [], mv: null };
const app = () => $('#app');
const can = () => ['owner', 'admin', 'estimator'].includes(S.role);
const boss = () => ['owner', 'admin'].includes(S.role);
const settings = () => merge(DEFAULTS, S.company?.settings || {});
const STATUS = { lead: 'Lead', quoted: 'Quoted', won: 'Won', scheduled: 'Scheduled', done: 'Done', lost: 'Lost' };
const go = path => { if (location.hash !== '#' + path) location.hash = path; else route(); };

// ---------------- boot ----------------
async function boot() {
  const mode = LS.getItem('lotcalc-mode') || 'cloud';
  S.store = mode === 'demo' ? demoStore() : cloudStore();
  if (mode === 'demo') window.__lc = S; // lets the automated tests poke the demo
  S.session = await S.store.session().catch(() => null);
  S.store.onAuth(async s => { const had = !!S.session; S.session = s; if (!!s !== had) { await loadCompanies(); route(); } });
  if (S.session) await loadCompanies();
  window.addEventListener('hashchange', route);
  route();
  if (RECOVERY && S.session) setTimeout(newPasswordPrompt, 300);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
async function loadCompanies() {
  S.companies = S.session ? await S.store.myCompanies().catch(e => { toast(e.message, 'bad'); return []; }) : [];
  const last = LS.getItem('lotcalc-company');
  const pick = S.companies.find(c => c.id === last) || (S.companies.length === 1 ? S.companies[0] : null);
  if (pick) await useCompany(pick.id, false); else { S.company = null; S.role = null; }
}
async function useCompany(id, nav = true) {
  S.companies = S.companies.find(c => c.id === id) ? S.companies : await S.store.myCompanies();
  const c = S.companies.find(x => x.id === id); if (!c) return;
  S.company = c; S.role = c.role; LS.setItem('lotcalc-company', id);
  S.crewNames = []; S.follow = null;
  [S.crew, S.jobs, S.invoices, S.crewNames] = await Promise.all([S.store.listCrew(id), S.store.listJobs(id), ['owner', 'admin', 'estimator'].includes(c.role) ? S.store.listInvoices(id).catch(() => []) : [], S.store.crewNames(id).catch(() => [])]);
  if (['owner', 'admin', 'estimator'].includes(c.role)) await loadFollow().catch(() => { S.follow = null; });
  if (nav) go('/jobs');
}

// ---------------- router ----------------
async function route() {
  await flushSave(); if (S.flushCompany) { const f = S.flushCompany; S.flushCompany = null; await f(); }
  if (S.flushCosts) { const f = S.flushCosts; S.flushCosts = null; await f(); }
  if (S.mv) { S.mv.destroy(); S.mv = null; }
  const raw = location.hash.replace(/^#/, '');
  if (/^(access_token|error|type=)/.test(raw)) { history.replaceState(null, '', location.pathname + '#/jobs'); }
  const parts = (location.hash.replace(/^#\/?/, '') || 'jobs').split('/');
  document.body.classList.toggle('signed-out', !S.session);
  if (document.body.classList.contains('public')) { document.body.classList.remove('public'); document.title = 'LotBoss'; }
  if (parts[0] === 'q' && parts[1]) return renderPublicQuote(parts[1]);
  if (parts[0] === 'get-quote' && parts[1]) return renderWebForm(parts[1]);
  if (!S.session) return renderAuth();
  if (!S.company) return renderCompanies();
  const [page, id, tab] = parts;
  try {
    if (page === 'job' && id) return await renderJob(id, tab || 'map');
    lastJobRoute = null;
    if (page === 'schedule') return renderShell('schedule', await renderSchedule());
    if (page === 'money' && can()) return renderShell('jobs', await renderMoneyPage());
    if (page === 'follow' && can()) return renderShell('jobs', await renderFollowPage());
    if (page === 'tools') return renderShell('tools', renderTools());
    if (page === 'settings') return renderShell('settings', await renderSettings(id || 'company'));
    if (page === 'companies') return renderCompanies();
    return renderShell('jobs', renderJobs());
  } catch (e) {
    console.error(e);
    const gone = /not found|0 rows|deleted|JSON object requested/i.test(e.message);
    if (gone) JOB = null;
    renderShell('jobs', h('div.empty', h('h2', gone ? 'This job isn\'t here anymore' : 'Something went wrong'), h('p', gone ? 'It may have been deleted, or it belongs to a different company.' : e.message), h('button.btn.primary', { onclick: () => go('/jobs') }, 'Back to jobs')));
  }
}

// ---------------- auth ----------------
function brand(small) { return h('div.brand' + (small ? '.small' : ''), h('span.brand-mark', { 'aria-hidden': 'true' }), h('span.brand-name', 'Lot', h('b', 'Boss'))); }
function renderAuth() {
  let mode = 'in';
  const email = field('Email', { type: 'email', autocomplete: 'email', required: true });
  const pass = field('Password', { type: 'password', autocomplete: 'current-password', required: true });
  const name = field('Your name', { autocomplete: 'name' });
  const err = h('p.form-error', { role: 'alert' });
  const submit = h('button.btn.primary.wide', { type: 'submit' }, 'Sign in');
  const swap = h('button.link', { type: 'button', onclick: () => { mode = mode === 'in' ? 'up' : 'in'; paint(); } });
  const forgot = h('button.link', { type: 'button', onclick: async () => {
    if (!email.input.value) { err.textContent = 'Type your email first, then tap Forgot password.'; return; }
    try { await S.store.resetPassword(email.input.value.trim()); toast('Check your email for a reset link.'); } catch (e) { err.textContent = e.message; }
  } }, 'Forgot password?');
  const paint = () => {
    submit.textContent = mode === 'in' ? 'Sign in' : 'Create account';
    swap.textContent = mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in';
    name.hidden = mode === 'in'; forgot.hidden = mode !== 'in';
    pass.input.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
    err.textContent = '';
  };
  const form = h('form.auth-form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    const em = email.input.value.trim(), pw = pass.input.value;
    if (mode === 'up' && pw.length < 8) { err.textContent = 'Use at least 8 characters for your password.'; return; }
    busy(submit, true, mode === 'in' ? 'Signing in…' : 'Creating account…');
    try {
      if (S.store.kind === 'demo') { LS.setItem('lotcalc-mode', 'cloud'); S.store = cloudStore(); S.store.onAuth(async s => { const had = !!S.session; S.session = s; if (!!s !== had) { await loadCompanies(); route(); } }); }
      const s = mode === 'in' ? await S.store.signIn(em, pw) : await S.store.signUp(em, pw, name.input.value.trim());
      if (!s) { busy(submit, false); err.textContent = ''; toast('Account created. Check your email to confirm it, then sign in.'); mode = 'in'; paint(); return; }
      S.session = s; await loadCompanies(); route();
    } catch (ex) { busy(submit, false); err.textContent = /invalid login/i.test(ex.message) ? 'Wrong email or password.' : ex.message; }
  } }, email, pass, name, err, submit, h('div.auth-links', forgot, swap));
  paint();
  put(app(), h('main.auth',
    h('section.auth-hero',
      brand(),
      h('h1', 'Measure the lot. Price the job. Send the quote.'),
      h('p', 'Sealcoat, crack fill and striping estimates from a satellite map, with your real material, crew and wage numbers behind every price.'),
      h('div.stripe-rule', { 'aria-hidden': 'true' })),
    h('section.auth-card', h('h2', 'Sign in to your company'), form,
      h('div.divider', h('span', 'or')),
      h('button.btn.ghost.wide', { type: 'button', onclick: startDemo }, 'Try the demo, no account needed'),
      h('p.fine', 'The demo keeps everything on this device only.'))));
}
async function startDemo() {
  if (!storageWorks) toast('Your browser is blocking storage, so the demo resets when you close it.', 'warn');
  LS.setItem('lotcalc-mode', 'demo');
  S.store = demoStore(); window.__lc = S;
  await S.store.signIn('demo@lotcalc.app');
  if (!(await S.store.myCompanies()).length) await seedDemo();
  S.session = await S.store.session(); await loadCompanies();
  if (!S.company && S.companies[0]) await useCompany(S.companies[0].id, false);
  go('/jobs');
}
async function seedDemo() {
  const cid = await S.store.createCompany({ name: 'Rutherford Paving & Striping', phone: '(740) 555-0142', email: 'office@example.com', address: 'New Concord, OH', memberName: 'Darren' });
  const crew = [];
  for (const c of [{ name: 'Mike', role: 'Foreman', wage: 24, phone: '7405550101' }, { name: 'Josh', role: 'Laborer', wage: 18, phone: '7405550102' }, { name: 'Tyler', role: 'Laborer', wage: 17, phone: '7405550103' }]) crew.push(await S.store.saveCrew({ ...c, company_id: cid }));
  const L0 = 39.9409, G0 = -82.0050, fy = f => f / 364000, fx = f => f / (364000 * Math.cos(L0 * Math.PI / 180));
  const P = (x, y) => [+(G0 + fx(x)).toFixed(7), +(L0 + fy(y)).toFixed(7)];
  const drawing = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { kind: 'seal' }, geometry: { type: 'Polygon', coordinates: [[P(0, 0), P(220, 0), P(220, 140), P(0, 140), P(0, 0)]] } },
    { type: 'Feature', properties: { kind: 'row', style: 'single', stallWidth: 9, color: 'white' }, geometry: { type: 'LineString', coordinates: [P(10, 120), P(208, 120)] } },
    { type: 'Feature', properties: { kind: 'row', style: 'single', stallWidth: 9, color: 'white' }, geometry: { type: 'LineString', coordinates: [P(10, 40), P(208, 40)] } },
    { type: 'Feature', properties: { kind: 'crack' }, geometry: { type: 'LineString', coordinates: [P(30, 70), P(90, 76), P(160, 68), P(210, 80)] } },
    { type: 'Feature', properties: { kind: 'hash', color: 'white' }, geometry: { type: 'Polygon', coordinates: [[P(0, 140), P(60, 140), P(60, 150), P(0, 150), P(0, 140)]] } },
    { type: 'Feature', properties: { kind: 'line', color: 'white', label: 'Stop bar' }, geometry: { type: 'LineString', coordinates: [P(220, 5), P(220, 17)] } },
    { type: 'Feature', properties: { kind: 'stencil', stencil: 'stop' }, geometry: { type: 'Point', coordinates: P(212, 10) } },
    { type: 'Feature', properties: { kind: 'stencil', stencil: 'arrow' }, geometry: { type: 'Point', coordinates: P(110, 80) } }
  ] };
  const next = new Date(); next.setDate(next.getDate() + 3); const nextDay = localDay(next);
  await S.store.saveJob({ company_id: cid, title: 'Red Lobster, Maple Ave', address: '3575 Maple Ave, Zanesville, OH 43701', lat: L0 + fy(70), lng: G0 + fx(110), customer: { name: 'Jon Anderson', company: 'Darden property mgmt', phone: '(740) 555-0199', email: 'jon@example.com' }, status: 'quoted', drawing, inputs: { seal: { on: true, coats: 2 }, crack: { on: true }, stripe: { on: true, stopBars: 0 }, crewIds: crew.map(c => c.id) }, scheduled_date: nextDay, scheduled_days: 2, crew_ids: crew.map(c => c.id) });
  for (const j of await S.store.listJobs(cid)) { const full = await S.store.getJob(j.id); const { inputs } = effectiveInputs(full.inputs, full.drawing); full.price = estimate(inputs, {}, crew).total; await S.store.saveJob(full); }
  await S.store.saveJob({ company_id: cid, price: 5000, title: 'First Baptist Church', address: 'Main St, New Concord, OH', customer: { name: 'Pastor Dave' }, status: 'lead', inputs: { crack: { on: true, lf: 5000 }, crewIds: crew.slice(0, 2).map(c => c.id) } });
  // a booked job this week and someone off next week, so the week board has something on it
  { const ahead = d => { const x = new Date(); x.setDate(x.getDate() + d); return localDay(x); };
    const inp = { crack: { on: true, lf: 900 }, stripe: { on: true, rows: [{ stalls: 40 }] }, crewIds: [crew[0].id, crew[1].id] }; const e2 = estimate(inp, {}, crew);
    await S.store.saveJob({ company_id: cid, title: 'Kroger, Maple Ave', address: '3500 Maple Ave, Zanesville, OH', customer: { name: 'Dan (store manager)', phone: '(740) 555-0190' }, status: 'scheduled', price: e2.total, inputs: inp, crew_ids: inp.crewIds, scheduled_date: ahead(1), scheduled_days: 2, notes: 'Start after 9pm when the lot empties.' });
    await S.store.saveCrew({ ...crew[2], time_off: [{ from: ahead(8), to: ahead(10), note: 'Vacation' }] }); }
  // follow-ups: a quote they opened 5 days ago but didn't sign, and a lot sealed 3 years ago
  { const inp = { seal: { on: true, sqft: 42000, coats: 2 }, crack: { on: true, lf: 1200 }, stripe: { on: true, rows: [{ stalls: 120 }] }, crewIds: crew.map(c => c.id) }; const e3 = estimate(inp, {}, crew);
    const w = await S.store.saveJob({ company_id: cid, title: 'Walmart Supercenter, Maple Ave', address: '3575 Maple Ave, Zanesville, OH', customer: { name: 'Rick Dawson (facilities)', phone: '(740) 555-0166', email: 'rick.dawson@example.com' }, status: 'quoted', price: e3.total, inputs: inp });
    const pub = buildPublic({ company: { name: 'Rutherford Paving & Striping' }, job: w, est: e3, options: [], recommended: 0 });
    const q = await S.store.saveQuote(w.id, { public: pub }, e3.total, 30); S.store._backdateQuote?.(q.id, 5, { status: 'viewed', viewed_at: new Date(Date.now() - 3 * 864e5).toISOString() });
    const ago = d => { const x = new Date(); x.setDate(x.getDate() - d); return localDay(x); };
    await S.store.saveJob({ company_id: cid, title: 'Zanesville Family Dental', address: '1100 Brandywine Blvd, Zanesville, OH', customer: { name: 'Dr. Amy Chen', phone: '(740) 555-0122', email: 'office@example.com' }, status: 'done', price: 3850, inputs: { seal: { on: true, sqft: 9000, coats: 2 } }, scheduled_date: ago(3 * 365 - 5), scheduled_days: 1 }); }
  // two finished jobs: one paid, one still owed (late), both with a wrap-up, so the Money screens have something to show
  const ago = d => { const x = new Date(); x.setDate(x.getDate() - d); return localDay(x); };
  const ids = crew.map(c => c.id);
  for (const [title, addr, cust, inputs, daysAgo, slow, paidAll] of [
    ['Dollar General, Rt 40', '2150 E Pike, Zanesville, OH', { name: 'Karen Miller', phone: '(740) 555-0170' }, { seal: { on: true, sqft: 18000, coats: 2 }, crack: { on: true, lf: 600 }, stripe: { on: true, rows: [{ stalls: 32 }] }, crewIds: ids }, 40, 1.2, true],
    ['Muskingum Valley Bank', '120 Main St, New Concord, OH', { name: 'Steve Price', phone: '(740) 555-0181' }, { seal: { on: true, sqft: 12000, coats: 2 }, stripe: { on: true, rows: [{ stalls: 24 }] }, crewIds: ids }, 25, 1.15, false]]) {
    const est = estimate(inputs, {}, crew);
    const job = await S.store.saveJob({ company_id: cid, title, address: addr, customer: cust, status: 'done', price: est.total, inputs, crew_ids: ids, scheduled_date: ago(daysAgo + 2), scheduled_days: est.time.days });
    const d = invoiceDraft({ job, est, settings: {}, today: ago(daysAgo) });
    const inv = await S.store.createInvoice(job.id, { ...d, issued: ago(daysAgo) });
    await S.store.addPayment(inv.id, { amount: paidAll ? inv.total : r2(Math.round(inv.total * 0.4)), date: ago(daysAgo - 10), method: 'check', ref: paidAll ? '#4471' : '#1180' });
    const snap = estSnapshot(est);
    await S.store.saveCosts(job.id, cid, { snap, frozen: true, doneAt: ago(daysAgo), actuals: { crew: crew.map(c => ({ id: c.id, name: c.name, wage: c.wage, hours: Math.round(snap.personHours / crew.length * slow * 2) / 2 })), sealerGal: Math.round(snap.seal.sealerGal * 1.1), other: [{ label: 'Dump fee', amount: 45 }] } });
  }
}
async function newPasswordPrompt() {
  const p = field('New password', { type: 'password', autocomplete: 'new-password' });
  await modal('Set a new password', p, [{ label: 'Save password', kind: 'primary', value: async () => { if (p.input.value.length < 8) { toast('Use at least 8 characters.', 'warn'); return false; } try { await S.store.updatePassword(p.input.value); toast('Password updated.'); } catch (e) { toast(e.message, 'bad'); return false; } } }]);
}

// ---------------- company picker ----------------
async function renderCompanies() {
  if (S.session) S.companies = await S.store.myCompanies().catch(() => S.companies);
  const list = S.companies.map(c => h('button.company-card', { type: 'button', onclick: async () => { await useCompany(c.id); } }, h('strong', c.name), h('span.muted', roleName(c.role))));
  const create = async () => {
    const n = field('Company name', { required: true, placeholder: 'Rutherford Paving & Striping' }); n.input.maxLength = 80;
    const you = field('Your name', { value: S.session?.user?.user_metadata?.name || '' });
    const ph = field('Company phone', { type: 'tel', autocomplete: 'tel' });
    const em = field('Company email', { type: 'email' });
    const ad = field('Company address');
    const id = await modal('Set up your company', h('div.form-grid', n, you, ph, em, ad), [{ label: 'Cancel', result: null }, { label: 'Create company', kind: 'primary', value: async () => {
      if (!n.input.value.trim()) { toast('Give your company a name.', 'warn'); return false; }
      try { return await S.store.createCompany({ name: n.input.value.trim().slice(0, 80), memberName: you.input.value.trim().slice(0, 60), phone: ph.input.value.trim(), email: em.input.value.trim(), address: ad.input.value.trim() }); } catch (e) { toast(e.message, 'bad'); return false; }
    } }]);
    if (id) { S.companies = await S.store.myCompanies(); await useCompany(id); toast('Company created. Set your prices in Settings.'); }
  };
  const join = async () => {
    const code = field('Invite code', { placeholder: 'A1B2C3D4', autocomplete: 'off' });
    const you = field('Your name', { value: S.session?.user?.user_metadata?.name || '' });
    const id = await modal('Join a company', h('div', code, you, h('p.muted', 'Ask the owner for a code. They make one in Settings, under Team.')), [{ label: 'Cancel', result: null }, { label: 'Join', kind: 'primary', value: async () => { try { return await S.store.joinCompany(code.input.value, you.input.value.trim()); } catch (e) { toast(e.message, 'bad'); return false; } } }]);
    if (id) { S.companies = await S.store.myCompanies(); await useCompany(id); toast('You joined the company.'); }
  };
  put(app(), h('main.picker',
    h('header.picker-head', brand(true), h('button.link', { type: 'button', onclick: signOut }, 'Sign out')),
    h('h1', S.companies.length ? 'Pick a company' : 'Set up your company'),
    S.companies.length ? h('div.company-list', list) : h('p.lede', 'Your company holds your prices, crew, wages and jobs. Create one, or join your boss\'s with an invite code.'),
    h('div.picker-actions', h('button.btn.primary', { type: 'button', onclick: create }, 'Create a company'), h('button.btn.ghost', { type: 'button', onclick: join }, 'Join with an invite code')),
    S.store.kind === 'demo' ? h('p.fine', 'Demo mode: saved on this device only.') : null));
}
const roleName = r => ({ owner: 'Owner', admin: 'Admin', estimator: 'Estimator', crew: 'Crew' }[r] || r);
async function signOut() { await S.store.signOut(); S.session = null; S.company = null; LS.removeItem('lotcalc-company'); if (S.store.kind === 'demo') { LS.setItem('lotcalc-mode', 'cloud'); S.store = cloudStore(); } go('/jobs'); route(); }

// ---------------- shell ----------------
const NAV = [['jobs', 'Jobs', 'M4 6h16M4 12h16M4 18h10'], ['schedule', 'Schedule', 'M7 3v3M17 3v3M4 8h16M5 5h14v15H5z'], ['tools', 'Calculators', 'M6 3h12v18H6zM9 7h6M9 11h1M12 11h1M15 11h0M9 15h1M12 15h1M15 15v3'], ['settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4']];
const icon = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
function renderShell(active, content) {
  put(app(), h('div.shell',
    h('header.topbar', brand(true), h('button.company-switch', { type: 'button', onclick: () => go('/companies'), 'aria-label': 'Switch company' }, h('span', S.company.name), h('small', roleName(S.role) + (S.store.kind === 'demo' ? ' · demo' : '')))),
    h('nav.nav', { 'aria-label': 'Main' }, NAV.map(([k, label, d]) => h('a', { href: '#/' + k, class: k === active ? 'active' : '', 'aria-current': k === active ? 'page' : null }, icon(d), h('span', label)))),
    h('main.content', { id: 'main' }, content)));
}

// ---------------- jobs ----------------
function renderJobs() {
  let filter = 'open', q = '';
  const listEl = h('div.job-list');
  const paint = () => {
    const open = ['lead', 'quoted', 'won', 'scheduled'];
    const rows = S.jobs.filter(j => (filter === 'all' || (filter === 'open' ? open.includes(j.status) : j.status === filter)) && (!q || `${j.title} ${j.address} ${j.customer?.name}`.toLowerCase().includes(q)));
    put(listEl, ...(rows.length ? rows.map(jobCard) : [h('div.empty', h('h2', S.jobs.length ? 'No jobs match' : 'No jobs yet'), h('p', S.jobs.length ? 'Try another filter.' : 'Start a job, find the lot on the map, and measure it.'), can() && !S.jobs.length ? h('button.btn.primary', { onclick: () => newJob() }, 'Start a job') : null)]));
  };
  const chips = h('div.chips', { role: 'tablist' }, [['open', 'Open'], ['lead', 'Leads'], ['quoted', 'Quoted'], ['won', 'Won'], ['scheduled', 'Scheduled'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => h('button.chip', { type: 'button', role: 'tab', 'aria-selected': String(k === filter), onclick: e => { filter = k; $$('.chip', chips).forEach(c => c.setAttribute('aria-selected', String(c === e.currentTarget))); paint(); } }, l)));
  const pipeline = ['quoted', 'won', 'scheduled'].map(s => { const js = S.jobs.filter(j => j.status === s); return h('div.pipe', h('span.pipe-n', usd0(js.reduce((t, j) => t + (Number(j.price) || 0), 0))), h('span.pipe-l', `${STATUS[s]} (${js.length})`)); });
  if (can() && S.follow) { const n = followNow().length; pipeline.unshift(h('a.pipe.pipe-link.fu-pipe', { href: '#/follow', class: n ? 'due' : '' }, h('span.pipe-n', String(n)), h('span.pipe-l', n === 1 ? 'Follow-up today' : 'Follow-ups today'))); }
  if (can() && S.invoices) { const m = moneySummary(S.invoices, localDay()); if (m.openCount || S.invoices.length) pipeline.push(h('a.pipe.pipe-link', { href: '#/money', class: m.overdueCount ? 'bad' : '' }, h('span.pipe-n', usd0(m.owed)), h('span.pipe-l', m.overdueCount ? `Owed · ${m.overdueCount} late` : `Owed (${m.openCount})`))); }
  paint();
  return h('div.page',
    h('div.page-head', h('h1', 'Jobs'), can() ? h('div.row-btns', h('button.btn', { type: 'button', onclick: () => jobFromMessage() }, '✨ From an email'), h('button.btn.primary', { type: 'button', onclick: () => newJob() }, 'New job')) : null),
    S.jobs.length ? h('div.pipeline', pipeline) : null,
    h('div.toolbar', h('input.search', { type: 'search', placeholder: 'Search jobs, customers, addresses', 'aria-label': 'Search jobs', oninput: debounce(e => { q = e.target.value.toLowerCase(); paint(); }, 150) }), chips),
    listEl);
}
function jobCard(j) {
  return h('a.job-card', { href: `#/job/${j.id}/map` },
    h('div.jc-main', h('strong', j.title || 'Untitled job'), h('span.muted', [j.customer?.name, j.address].filter(Boolean).join(' · ') || 'No customer yet')),
    h('div.jc-side', h('span.status.s-' + j.status, STATUS[j.status]), j.price ? h('span.jc-price', usd0(j.price)) : null, j.scheduled_date ? h('span.muted.small', dateStr(j.scheduled_date)) : null));
}
async function newJob(pre = {}) {
  const t = field('Job name', { placeholder: 'Red Lobster, Main St', required: true, value: pre.title || '' }); t.input.maxLength = 200;
  const a = field('Address', { placeholder: 'Street, city, state', autocomplete: 'street-address', value: pre.address || '' });
  const c = field('Customer name', { value: pre.customer?.name || '' });
  const extra = pre.fromEmail ? h('div.ai-prefill', h('p.muted.small', pre.demo ? 'Filled in by the demo reader. Real accounts use AI.' : 'Filled in by AI from the message. Check it before you save.'),
    h('ul', [pre.customer?.company && `Company: ${pre.customer.company}`, pre.customer?.phone && `Phone: ${pre.customer.phone}`, pre.customer?.email && `Email: ${pre.customer.email}`,
      [pre.wants?.seal && 'sealcoat', pre.wants?.crack && 'crack fill', pre.wants?.stripe && 'striping', pre.wants?.other].filter(Boolean).length ? `Wants: ${[pre.wants?.seal && 'sealcoat', pre.wants?.crack && 'crack fill', pre.wants?.stripe && 'striping', pre.wants?.other].filter(Boolean).join(', ')}` : null,
      pre.sizeHint && `Size: ${pre.sizeHint}`, pre.deadline && `When: ${pre.deadline}`, pre.isBid && 'This is a formal bid request', pre.notes && `Notes: ${pre.notes}`].filter(Boolean).map(x => h('li', x)))) : null;
  const res = await modal(pre.fromEmail ? 'New job from a message' : 'New job', h('div.form-grid', t, a, c, extra), [{ label: 'Cancel', result: null }, { label: 'Create job', kind: 'primary', value: () => ({ title: (t.input.value.trim() || a.input.value.trim() || 'New job').slice(0, 200), address: a.input.value.trim().slice(0, 200), customer: { ...(pre.customer || {}), name: c.input.value.trim().slice(0, 100) } }) }]);
  if (!res) return;
  let lat = null, lng = null;
  if (res.address) { const g = await geocode(res.address); if (g[0]) { lat = Number(g[0].lat); lng = Number(g[0].lon); } }
  const inputs = { crewIds: S.crew.filter(x => x.active !== false).slice(0, 3).map(x => x.id) };
  if (pre.wants) { if (pre.wants.seal) inputs.seal = { on: true }; if (pre.wants.crack) inputs.crack = { on: true }; if (pre.wants.stripe) inputs.stripe = { on: true }; }
  const notes = pre.fromEmail ? [pre.notes, pre.sizeHint && `Size: ${pre.sizeHint}`, pre.deadline && `Wanted: ${pre.deadline}`, pre.wants?.other && `Also asked about: ${pre.wants.other}`, pre.isBid && 'Formal bid request.'].filter(Boolean).join('\n').slice(0, 2000) : undefined;
  try {
    const job = await S.store.saveJob({ company_id: S.company.id, ...res, lat, lng, inputs, ...(notes ? { notes } : {}) });
    S.jobs.unshift(job); go(`/job/${job.id}/map`);
    if (res.address && lat == null) toast('Couldn\'t find that address. Search it on the map or use GPS.', 'warn');
  } catch (e) { toast(e.message, 'bad'); }
}
async function jobFromMessage() {
  const box = field('Paste the email, text or voicemail notes', { type: 'textarea', rows: 9, placeholder: 'Hi, we need our church lot at 1240 Military Rd sealed and restriped before Easter. Call Karen 740-555-0147…' });
  box.input.maxLength = 20000;
  const r = await modal('New job from a message', h('div', box, h('p.muted.small', 'AI pulls out the customer, phone, email, lot address, what they want and when. Nothing is saved until you check it.')), [{ label: 'Cancel', result: null }, { label: 'Read it', kind: 'primary', value: async () => {
    const text = box.input.value; if (text.trim().length < 15) { toast('Paste the whole message first.', 'warn'); return false; }
    try { return await S.store.aiReadEmail(S.company.id, text); } catch (e) { toast(e.message, 'bad'); return false; }
  } }]);
  if (!r || typeof r !== 'object') return;
  if (!r.isJobRequest && !(await confirmBox('This doesn\'t look like a job', 'It reads like spam or something other than a paving request. Make a job from it anyway?', 'Make a job', 'primary'))) return;
  newJob({ ...r, fromEmail: true });
}

// ---------------- one job ----------------
let JOB = null;
// Saving: edits are batched for 0.7 s, but anything pending is saved right away when you leave the screen,
// switch jobs, switch apps or close the page. Saves run one at a time so an older save can never land last.
let pendingJob = null, saveChain = Promise.resolve(); const stamps = {}; // latest server save time per job
const quoteCheckAt = {}; // when we last looked for a signed quote on each job
let lastJobRoute = null;  // which job the previous screen showed
const bases = {}; // the version of each job we last loaded or saved, to tell what someone else changed
const JOB_KEYS = ['title', 'address', 'customer', 'status', 'drawing', 'inputs', 'price', 'scheduled_date', 'scheduled_days', 'crew_ids', 'notes'];
const differs = (a, b, k) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null);
function saveNow() {
  const j = pendingJob; pendingJob = null;
  if (!j || !can()) return saveChain;
  const snapshot = structuredClone(j);
  saveChain = saveChain.then(async () => {
    try {
      if (stamps[snapshot.id]) snapshot.updated_at = stamps[snapshot.id]; // our own earlier save isn't a conflict
      const saved = await S.store.saveJob(snapshot);
      bases[saved.id] = structuredClone(saved);
      if (saved.updated_at) { stamps[saved.id] = saved.updated_at; j.updated_at = saved.updated_at; if (JOB && JOB.id === saved.id) JOB.updated_at = saved.updated_at; }
      const i = S.jobs.findIndex(x => x.id === saved.id); if (i >= 0) S.jobs[i] = { ...S.jobs[i], ...saved };
      LS.removeItem('lotcalc-draft-' + saved.id);
      if (!pendingJob) setSaved('Saved');
    } catch (e) {
      if (e.message === 'CONFLICT') { setSaved('Saving…'); setTimeout(() => conflict(j), 0); return; }
      if (/deleted/.test(e.message)) { LS.removeItem('lotcalc-draft-' + j.id); setSaved(''); toast('This job was deleted by someone else.', 'bad'); return; }
      pendingJob = pendingJob || j; setSaved('Not saved');
      toast('Could not save (' + e.message + '). Your changes are kept on this phone and will save when you have signal.', 'bad');
      setTimeout(() => { if (pendingJob) saveJobSoon(); }, 15000);
    }
  });
  return saveChain;
}
const saveJobSoon = debounce(saveNow, 700);
const flushSave = () => pendingJob ? saveJobSoon.flush() : saveChain;
const setSaved = t => { const el = $('#saved'); if (el) el.textContent = t; };
function touch() { if (!can()) return; setSaved('Saving…'); pendingJob = JOB; saveJobSoon(); try { LS.setItem('lotcalc-draft-' + JOB.id, JSON.stringify({ at: Date.now(), job: JOB })); } catch {} }
async function conflict(mine) {
  const fresh0 = await S.store.getJob(mine.id).catch(() => null); if (!fresh0) return;
  const base = bases[mine.id];
  const theirs = JOB_KEYS.filter(k => differs(base, fresh0, k));
  // a customer signing (or a quote being saved) only touches status + price: merge it in quietly
  if (base && theirs.every(k => k === 'status' || k === 'price')) {
    for (const k of theirs) if (!differs(base, mine, k)) { mine[k] = fresh0[k]; if (JOB && JOB.id === mine.id) JOB[k] = fresh0[k]; }
    stamps[mine.id] = fresh0.updated_at; bases[mine.id] = structuredClone(fresh0);
    if (theirs.includes('status') && fresh0.status === 'won') toast('Good news: the customer accepted the quote. Job marked Won.');
    pendingJob = JOB && JOB.id === mine.id ? JOB : mine; setTimeout(() => saveNow(), 0); return; // never wait on ourselves inside the save queue
  }
  setSaved('Not saved');
  const pick = await modal('Someone else changed this job', h('p', 'This job was changed somewhere else while you were working on it: a teammate saved it, or the customer accepted a quote. Load the latest version (recommended), or keep yours and replace theirs.'), [{ label: 'Keep mine', result: 'mine' }, { label: 'Load the latest', kind: 'primary', result: 'theirs' }]);
  const fresh = await S.store.getJob(mine.id).catch(() => null); if (!fresh) return;
  LS.removeItem('lotcalc-draft-' + mine.id);
  if (pick === 'mine') { stamps[mine.id] = fresh.updated_at; bases[mine.id] = structuredClone(fresh); mine.updated_at = fresh.updated_at; if (JOB && JOB.id === mine.id) JOB.updated_at = fresh.updated_at; pendingJob = JOB && JOB.id === mine.id ? JOB : mine; setTimeout(() => saveNow(), 0); }
  else { JOB = fresh; route(); }
}
addEventListener('pagehide', () => { flushSave(); S.flushCosts?.(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushSave(); S.flushCosts?.(); } });
addEventListener('beforeunload', e => { if (pendingJob && S.store?.kind === 'cloud') { flushSave(); e.preventDefault(); e.returnValue = ''; } });
function computeEst() {
  const { inputs, totals } = effectiveInputs(JOB.inputs, JOB.drawing);
  const st = JOB.inputs.stripe || {};
  if (Number(st.manualStalls) > 0) inputs.stripe.rows = [{ stalls: Number(st.manualStalls), style: st.manualStyle || 'single' }];
  const est = estimate(inputs, S.company.settings || {}, S.crew);
  return { est, totals, inputs };
}
async function renderJob(id, tab) {
  const arriving = lastJobRoute !== id; lastJobRoute = id;
  // coming back to a job from another screen: reload it so we never show a stale copy (a teammate or customer may have changed it)
  if (JOB && JOB.id === id && arriving && !pendingJob) { const f = await S.store.getJob(id).catch(() => null); if (f) { JOB = f; stamps[id] = f.updated_at; bases[id] = structuredClone(f); } }
  if (!JOB || JOB.id !== id) {
    JOB = await S.store.getJob(id); stamps[id] = JOB.updated_at; bases[id] = structuredClone(JOB);
    let draft = null; try { draft = JSON.parse(LS.getItem('lotcalc-draft-' + id)); } catch {}
    const same = (a, b) => ['title', 'address', 'customer', 'status', 'drawing', 'inputs', 'scheduled_date', 'scheduled_days', 'notes'].every(k => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
    if (draft?.job && draft.job.id === id && same(draft.job, JOB)) { LS.removeItem('lotcalc-draft-' + id); draft = null; } // it did save after all
    if (draft && !can()) { LS.removeItem('lotcalc-draft-' + id); draft = null; } // crew can't save job edits, so don't offer to restore them
    if (draft?.job && draft.job.id === id) { // drafts are deleted after every successful save, so one left over never saved
      const use = await modal('Unsaved changes found', h('p', `You made changes to this job on this device ${new Date(draft.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} that never saved (probably no signal). Put them back?`), [{ label: 'Throw them away', result: 'no' }, { label: 'Restore my changes', kind: 'primary', result: 'yes' }]);
      if (use === 'yes') { JOB = { ...draft.job, updated_at: JOB.updated_at }; pendingJob = JOB; saveNow(); toast('Your changes are back.'); }
      else LS.removeItem('lotcalc-draft-' + id);
    }
  }
  JOB.inputs ||= {}; JOB.drawing ||= { type: 'FeatureCollection', features: [] }; JOB.customer ||= {};
  if (can() && (arriving || Date.now() - (quoteCheckAt[JOB.id] || 0) > 20000) && ['quoted', 'won', 'scheduled'].includes(JOB.status)) {
    quoteCheckAt[JOB.id] = Date.now();
    const acc = (await S.store.listQuotes(JOB.id).catch(() => [])).find(q => q.status === 'accepted');
    if (acc && JOB.inputs.appliedQuote !== acc.id) applyAccepted(acc);
  }
  const tabs = [['map', 'Map'], ['estimate', 'Estimate'], ['quote', 'Quote'], can() ? ['money', 'Money'] : null, ['photos', 'Photos'], ['details', 'Details']].filter(Boolean);
  const body = h('div.job-body');
  const totalBar = h('div.total-bar');
  const paintTotal = () => {
    const { est } = computeEst();
    JOB.estimate = { total: est.total, subtotal: est.subtotal, days: est.time.days }; // no costs or profit: crew can read jobs
    const newPrice = est.total || null;
    if ((JOB.price == null || JOB.status === 'lead') && JOB.price !== newPrice && can()) { JOB.price = newPrice; touch(); }
    put(totalBar, 
      h('div.tb-main', h('span.tb-label', 'Job total'), h('span.tb-total', usd0(est.total))),
      can() ? h('div.tb-side', h('span', { class: est.profit >= 0 ? 'up' : 'down' }, `${est.profit >= 0 ? 'Profit' : 'Loss'} ${usd0(Math.abs(est.profit))}`), h('span.muted', `${est.marginPct}% · ${est.time.days || 0} day${est.time.days === 1 ? '' : 's'}`)) : null);
    return est;
  };
  const shell = h('div.job',
    h('div.job-head',
      h('a.back', { href: '#/jobs', 'aria-label': 'Back to jobs' }, '‹'),
      h('div.job-title', h('h1', JOB.title), h('span.muted', JOB.address || 'No address yet')),
      h('span.saved', { id: 'saved', 'aria-live': 'polite' }, '')),
    h('nav.tabs', { 'aria-label': 'Job sections' }, tabs.map(([k, l]) => h('a', { href: `#/job/${id}/${k}`, class: k === tab ? 'active' : '', 'aria-current': k === tab ? 'page' : null }, l))),
    body, totalBar);
  renderShell('jobs', shell);
  document.body.dataset.tab = tab;
  const refresh = () => { paintTotal(); };
  if (tab === 'map') renderMapTab(body, refresh);
  else if (tab === 'estimate') renderEstimateTab(body, refresh);
  else if (tab === 'quote') await renderQuoteTab(body);
  else if (tab === 'photos') await renderPhotosTab(body);
  else if (tab === 'money') await renderMoneyTab(body);
  else renderDetailsTab(body, refresh);
  paintTotal();
}

// ---------------- layout designer ----------------
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, kids = []) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); for (const k of kids) if (k) e.append(k); return e; }
function layoutPreview(pre) {
  const xs = pre.lot.map(p => p[0]), ys = pre.lot.map(p => -p[1]);
  const x0 = Math.min(...xs) - 6, y0 = Math.min(...ys) - 6, w = Math.max(...xs) - x0 + 6, hh = Math.max(...ys) - y0 + 6;
  const poly = (pts, attrs) => svgEl('polygon', { points: pts.map(p => `${p[0].toFixed(1)},${(-p[1]).toFixed(1)}`).join(' '), ...attrs });
  const r = ([x, y, rw, rd], attrs) => svgEl('rect', { x: x.toFixed(1), y: (-(y + rd)).toFixed(1), width: rw.toFixed(1), height: rd.toFixed(1), ...attrs });
  return svgEl('svg', { viewBox: `${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${hh.toFixed(1)}`, class: 'lay-svg', role: 'img', 'aria-label': 'Layout preview' }, [
    svgEl('defs', {}, [svgEl('pattern', { id: 'adahatch', width: 3, height: 3, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 3, stroke: '#4c8ff0', 'stroke-width': 1.2 })])]),
    poly(pre.lot, { fill: '#2b2f34', stroke: '#9aa3ad', 'stroke-width': 1.5 }),
    ...pre.holes.map(hl => poly(hl, { fill: '#5f8a4f', stroke: '#9aa3ad', 'stroke-width': 1 })),
    ...pre.stalls.map(s => r(s, { fill: 'none', stroke: '#ffffff', 'stroke-width': .7 })),
    ...pre.aisles.map(s => r(s, { fill: 'url(#adahatch)', stroke: '#4c8ff0', 'stroke-width': .7 })),
    ...pre.ada.map(s => r(s, { fill: s[4] === 'van' ? '#1d5fb4' : '#2f6fcc', stroke: '#fff', 'stroke-width': .7 })),
    ...pre.arrows.map(([x, y]) => svgEl('text', { x: x.toFixed(1), y: (-y + 3).toFixed(1), 'font-size': 9, fill: '#f5b800', 'text-anchor': 'middle' }, [document.createTextNode('➜')]))
  ]);
}

async function openLayoutDesigner(refresh, paintSum) {
  if (!can()) return;
  const lot = lotFromDrawing(JOB.drawing);
  if (!lot.lot) { await modal('Design the layout', h('div', h('p', 'First outline the lot: tap Area on the map and tap the corners of the paved lot, then Finish.'), h('p.muted', 'Outline islands or the building with Area too and set them to "Skip it". Drop a Door marker on the main entrance so ADA spaces go closest to it.')), [{ label: 'Got it', kind: 'primary', result: true }]); return; }
  const st = settings().stripe;
  const L = JOB.inputs.layout = { ...LAYOUT_DEFAULTS, stallWidth: st.stallWidth || 9, stallDepth: st.stallDepth || 18, ...(JOB.inputs.layout || {}) };
  const hadLayout = (JOB.drawing?.features || []).some(f => f.properties?.gen === 'layout');
  const handRows = (JOB.drawing?.features || []).filter(f => !f.properties?.gen && (f.properties?.kind === 'row' || (f.properties?.kind === 'stencil' && ['handicap', 'van'].includes(f.properties?.stencil))));
  let replaceHand = true;
  const out = h('div.lay-out'); let res = null;
  const run = () => {
    res = designLayout(lot.lot, lot.holes, lot.entrance, L);
    if (res.error) { put(out, h('p.warn-text', res.error)); return; }
    const s = res.stats;
    put(out, layoutPreview(res.preview),
      h('div.lay-stats', [['Spaces', s.total], ['Regular', s.regular], ['Accessible', `${s.ada}${s.van ? ` (${s.van} van)` : ''}`], ['Rows', s.rows], ['Aisles', s.aisles], ['Sq ft / space', num(s.sqftPerStall)]].map(([k, v]) => h('div', h('small', k), h('b', String(v))))),
      h('p.muted.small', `${s.total} spaces need ${s.required.accessible} accessible (${s.required.van} van) under the 2010 ADA Standards. ${s.ada >= s.required.accessible ? 'This layout meets it.' : ''} ${s.wheelStops ? `${s.wheelStops} wheel stops. ` : ''}${s.arrows ? `${s.arrows} arrows.` : ''}`),
      res.warnings.length ? h('ul.lay-warn', res.warnings.map(w => h('li', w))) : null,
      lotNote);
  };
  const lotNote = lot.lotCount > 1 ? h('p.muted.small', `You have ${lot.lotCount} areas drawn; this uses the biggest one.`) : null;
  const numF = (label, key, suffix, help) => field(label, { type: 'number', value: L[key], suffix, help, oninput: e => { if (e.target.value !== '') { L[key] = Number(e.target.value); run(); } } });
  const opts = h('div.grid2',
    numF('Stall width', 'stallWidth', 'ft'), numF('Stall depth', 'stallDepth', 'ft'),
    numF('Drive aisle', 'aisleWidth', 'ft', '24 ft is standard two-way.'), numF('Off the curb', 'setback', 'ft'),
    field('Rows run', { type: 'select', options: [{ value: '', label: 'Best fit' }, { value: 'turn', label: 'Turned 90°' }], value: L.turn ? 'turn' : '', onchange: e => { L.turn = e.target.value === 'turn'; run(); } }),
    field('Stall lines', { type: 'select', options: [{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double (hairpin)' }], value: L.style, onchange: e => { L.style = e.target.value; run(); } }),
    field('Wheel stops', { type: 'select', options: [{ value: 'none', label: 'None' }, { value: 'ada', label: 'ADA spaces only' }, { value: 'all', label: 'Every space' }], value: L.wheelStops, onchange: e => { L.wheelStops = e.target.value; run(); } }),
    toggle('Arrows in the aisles', L.arrows, v => { L.arrows = v; run(); }));
  run();
  const btns = [{ label: 'Cancel', result: null }];
  if (hadLayout) btns.push({ label: 'Remove layout', kind: 'danger', result: 'remove' });
  btns.push({ label: hadLayout ? 'Replace the layout' : 'Put it on the map', kind: 'primary', value: () => { if (!res || res.error) { toast(res?.error || 'Nothing to put on the map.', 'warn'); return false; } return 'apply'; } });
  const ans = await modal('Design the layout', h('div.lay', lot.entrance ? null : h('p.note', 'Tip: put a Door marker on the main entrance first so ADA spaces go right by it.'), out, handRows.length ? toggle(`Replace the ${handRows.length} stall row${handRows.length === 1 ? '' : 's'} and ADA stencils you drew`, true, v => { replaceHand = v; }) : null, h('details.lay-opts', { open: true }, h('summary', 'Options'), opts), h('details', h('summary', 'ADA rules used'), h('ul', ADA_NOTES.map(x => h('li', x))))), btns);
  if (!ans) return; // nothing changed
  const I = JOB.inputs; I.stripe ||= {};
  if (ans === 'remove') { JOB.drawing = applyLayout(JOB.drawing, []); I.stripe.wheelStops = undefined; I.stripe.newLayout = false; toast('Layout removed.'); }
  else {
    const base = replaceHand && handRows.length ? { ...JOB.drawing, features: JOB.drawing.features.filter(f => !handRows.includes(f)) } : JOB.drawing;
    JOB.drawing = applyLayout(base, res.features);
    I.stripe.on = true; I.stripe.newLayout = true; I.stripe.wheelStops = res.stats.wheelStops || undefined;
    const typed = Array.isArray(I.stripe.rows) && I.stripe.rows.length; if (typed) I.stripe.rows = [];
    toast(`${res.stats.total} spaces, ${res.stats.ada} accessible, on the map and in the estimate.${typed ? ' Stall rows now come from the layout.' : ''}`);
  }
  if (S.mv) { S.mv.drawing = JOB.drawing; S.mv.fit(); }
  paintSum(); refresh(); touch();
}

// ---------------- AI outline from satellite ----------------
async function aiOutlineLot(btn, refresh, paintSum) {
  if (!can() || !S.mv) return;
  const v = S.mv.view();
  if (v.meters > 900) { toast('Zoom in closer so the lot fills most of the screen, then try again.', 'warn'); return; }
  if (v.meters < 40) { toast('Zoom out a little so the whole lot is on screen.', 'warn'); return; }
  busy(btn, true, 'Tracing the lot…');
  const mv = S.mv, job = JOB;
  let r;
  try { r = await S.store.aiOutline(JOB, { lat: v.lat, lng: v.lng, meters: Math.max(60, v.meters) }); }
  catch (e) { toast(e.message, 'bad'); return; }
  finally { busy(btn, false); }
  if (S.mv !== mv || JOB !== job) return; // they left the map (or deleted the job) while it was thinking
  if (!r.found || !r.lots.length) { toast(r.notes || 'No parking lot found in the middle of the map. Center the lot and try again.', 'warn'); return; }
  const feats = [...r.lots.map(l => ({ type: 'Feature', properties: { kind: 'seal', gen: 'ai-outline', label: l.label || 'AI outline' }, geometry: { type: 'Polygon', coordinates: [l.ring] } })),
    ...r.skip.map(s => ({ type: 'Feature', properties: { kind: 'seal', exclude: true, gen: 'ai-outline', label: s.kind }, geometry: { type: 'Polygon', coordinates: [s.ring] } }))];
  const sq = feats.reduce((t, f) => t + (f.properties.exclude ? -1 : 1) * (Number(measureFeature(f).sqft) || 0), 0);
  document.querySelector('#map')?.scrollIntoView({ block: 'start' });
  S.mv.preview(feats);
  const had = (JOB.drawing?.features || []).filter(f => f.properties?.kind === 'seal' && !f.properties?.exclude).length;
  const ans = await modal('AI outline', h('div',
    h('p', `Found ${r.lots.length === 1 ? 'the lot' : r.lots.length + ' paved areas'}: about ${num(Math.max(0, Math.round(sq)))} sq ft${r.skip.length ? `, skipping ${r.skip.length} building${r.skip.length === 1 ? '' : 's'}/island${r.skip.length === 1 ? '' : 's'}` : ''}.`),
    r.stalls ? h('p', `It counted about ${num(r.stalls)} parking spaces.`) : null,
    r.surface && r.surface !== 'asphalt' ? h('p.warn-text', `It looks like ${r.surface}, not asphalt. Double-check before you quote sealcoat.`) : null,
    h('p.muted.small', `${r.demo ? 'Sample outline (demo). ' : `AI confidence ${Math.round((r.confidence || 0) * 100)}%. `}Yellow = what it traced, red = skipped. Check the edges before you quote.`),
    had ? h('p.note', `You already have ${had} area${had === 1 ? '' : 's'} drawn. Keeping adds this one too; delete whichever you don't want.`) : null),
    [{ label: 'Drop it', result: null }, { label: 'Keep it', kind: 'primary', result: 'keep' }]);
  S.mv?.preview(null);
  if (ans !== 'keep' || S.mv !== mv || JOB !== job) return;
  JOB.drawing = { type: 'FeatureCollection', features: [...(JOB.drawing?.features || []).filter(f => f.properties?.gen !== 'ai-outline'), ...feats] };
  JOB.inputs.seal = { ...(JOB.inputs.seal || {}), on: true };
  if (r.stalls) JOB.inputs.ai = { ...(JOB.inputs.ai || {}), stalls: r.stalls };
  if (S.mv) S.mv.drawing = JOB.drawing;
  paintSum(); refresh(); touch();
  toast(`Outline added: about ${num(Math.max(0, Math.round(sq)))} sq ft.${r.stalls ? ` AI counted ~${num(r.stalls)} spaces.` : ''}`);
}

function renderMapTab(body, refresh) {
  const mapEl = h('div.map', { id: 'map', role: 'application', 'aria-label': 'Satellite map. Tap to draw.' });
  const results = h('div.addr-results');
  const search = h('form.map-search', { onsubmit: async e => {
    e.preventDefault(); const q = e.target.q.value.trim(); if (!q) return;
    put(results, h('p.muted', 'Searching…'));
    const r = await geocode(q);
    put(results, ...(r.length ? r.map(x => h('button', { type: 'button', onclick: () => { S.mv.setView(+x.lat, +x.lon); put(results, ); if (can()) { JOB.lat = +x.lat; JOB.lng = +x.lon; if (!JOB.address) JOB.address = x.display_name.split(', ').slice(0, 4).join(', '); touch(); } } }, x.display_name)) : [h('p.muted', 'No match. Try the street and city.')]));
  } }, h('input', { name: 'q', type: 'search', placeholder: 'Find the lot: business name or address', 'aria-label': 'Find the lot', value: '' }), h('button.btn', { type: 'submit' }, 'Find'));
  const editor = h('div.fe-wrap');
  const sumEl = h('div.map-sum');
  const paintSum = () => {
    const t = drawingTotals(JOB.drawing);
    put(sumEl, 
      chip('Sealcoat', t.sealSqft ? `${num(t.sealSqft)} sq ft` : '—'), chip('Cracks', t.crackLf ? `${num(t.crackLf)} ft` : '—'),
      chip('Stalls', t.stalls ? String(t.stalls) : '—'), chip('Lines', t.lines.length ? `${num(t.lines.reduce((s, l) => s + l.lf, 0))} ft` : '—'),
      chip('Stencils', Object.values(t.stencils).reduce((s, v) => s + v, 0) || '—'));
  };
  const chip = (l, v) => h('span.sum-chip', h('small', l), h('b', String(v)));
  const toolBtn = (kind, label, extra) => h('button.tool', { type: 'button', disabled: !can(), onclick: async () => { if (kind === 'stencil') { const s = await pickStencil(); if (s && S.mv) S.mv.start('stencil', { stencil: s }); return; } S.mv?.start(kind, extra); } }, h('span.tool-swatch.k-' + kind), label);
  const tools = h('div.tools', { role: 'toolbar', 'aria-label': 'Drawing tools' },
    toolBtn('seal', 'Area'), toolBtn('crack', 'Crack'), toolBtn('row', 'Stall row', { style: 'single', color: 'white' }), toolBtn('line', 'Line', { color: 'white' }), toolBtn('hash', 'Hash', { color: 'white' }), toolBtn('stencil', 'Stencil'), toolBtn('entrance', 'Door'), toolBtn('measure', 'Measure'));
  const designBtn = can() ? h('button.btn.primary.design-btn', { type: 'button', onclick: () => openLayoutDesigner(refresh, paintSum) }, 'Design the layout') : null;
  const outlineBtn = can() ? h('button.btn.design-btn.ai-btn', { type: 'button', onclick: () => aiOutlineLot(outlineBtn, refresh, paintSum) }, '✨ AI outline the lot') : null;
  const mapActions = h('div.map-actions',
    h('button.btn.ghost.small', { type: 'button', onclick: async () => { try { const p = await S.mv.locate(); if (can() && !JOB.lat) { JOB.lat = p.lat; JOB.lng = p.lng; touch(); } } catch (e) { toast(e.message, 'warn'); } } }, 'My location'),
    h('button.btn.ghost.small', { type: 'button', onclick: () => S.mv.fit() }, 'Fit drawing'),
    h('button.btn.ghost.small', { type: 'button', onclick: e => { const on = S.mv.toggleBase(); e.currentTarget.textContent = on ? 'Street map' : 'Satellite'; } }, 'Street map'));
  body.append(h('div.map-tab', h('div.map-wrap', search, results, mapEl, tools), h('aside.map-side', sumEl, outlineBtn, designBtn, editor, mapActions, h('p.muted.small', 'Tip: zoom in close before tapping corners. Satellite measurements are usually within a few percent; check critical numbers with a wheel.'))));
  S.mv = createMap(mapEl, JOB, { readOnly: !can(), settings: S.company.settings, onChange: fc => { JOB.drawing = fc; paintSum(); refresh(); touch(); put(editor, featureEditor(S.mv.selected, S.mv) || ''); } });
  S.mv.onSelect = f => put(editor, featureEditor(f, S.mv) || '');
  paintSum();
  if (!JOB.lat && JOB.address) geocode(JOB.address).then(r => { if (r[0] && S.mv) { S.mv.setView(+r[0].lat, +r[0].lon); JOB.lat = +r[0].lat; JOB.lng = +r[0].lon; touch(); } });
}

function renderEstimateTab(body, refresh) {
  const I = JOB.inputs; I.seal ||= {}; I.crack ||= {}; I.stripe ||= {}; I.crewIds ||= [];
  const out = h('div.est-out');
  const ro = !can();
  const upd = () => { paintOut(); refresh(); touch(); };
  const numField = (label, obj, key, opts = {}) => field(label, { type: 'number', value: obj[key] ?? '', placeholder: opts.placeholder, suffix: opts.suffix, help: opts.help, oninput: e => { obj[key] = e.target.value === '' ? undefined : Number(e.target.value); upd(); } });
  const { totals, inputs } = computeEst();
  const svc = (title, obj, defOn, inner) => {
    const box = h('div.svc-body', { hidden: !(obj.on ?? defOn) }, inner);
    return h('section.svc', toggle(title, obj.on ?? defOn, v => { obj.on = v; box.hidden = !v; upd(); }), box);
  };
  const st = settings();
  const seal = svc('Sealcoating', I.seal, inputs.seal.on, h('div.grid2',
    numField('Square feet', I.seal, 'sqft', { placeholder: totals.sealSqft ? `${num(totals.sealSqft)} from map` : 'Measure on the map or type it', suffix: 'sq ft' }),
    numField('Coats', I.seal, 'coats', { placeholder: String(st.sealcoat.coats) })));
  const crack = svc('Crack filling', I.crack, inputs.crack.on, h('div.grid3',
    numField('Linear feet', I.crack, 'lf', { placeholder: totals.crackLf ? `${num(totals.crackLf)} from map` : 'Measure or type it', suffix: 'ft' }),
    numField('Crack width', I.crack, 'widthIn', { placeholder: String(st.crack.widthIn), suffix: 'in' }),
    numField('Crack depth', I.crack, 'depthIn', { placeholder: String(st.crack.depthIn), suffix: 'in' })));
  const S2 = I.stripe; S2.stencils ||= {};
  const stencilGrid = h('div.grid4', STENCILS.map(k => field(st.stripe.stencils[k].label, { type: 'number', value: S2.stencils[k] ?? '', placeholder: totals.stencils[k] ? `${totals.stencils[k]} on map` : '0', inputmode: 'numeric', oninput: e => { S2.stencils[k] = e.target.value === '' ? undefined : Number(e.target.value); upd(); } })));
  const adaBox = h('div.ada-box');
  const paintAda = () => {
    const { est } = computeEst(); const r = est.stripe?.ada; const total = est.stripe?.totalStalls || 0; const req = adaRequired(total);
    put(adaBox, h('p', h('strong', `${total} stalls need ${req.accessible} accessible space${req.accessible === 1 ? '' : 's'}, ${req.van} van accessible.`), r && S2.adaAuto !== false ? ' Added to the estimate with stencils, aisles and signs.' : ''),
      h('details', h('summary', 'ADA rules used'), h('ul', ADA_NOTES.map(n => h('li', n)))));
  };
  const manual = h('div.grid2',
    numField('Stalls (if not drawn)', S2, 'manualStalls', { placeholder: totals.stalls ? `${totals.stalls} from map` : '0', help: 'Leave blank to use the stall rows you drew.' }),
    field('Stall lines', { type: 'select', options: [{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double (hairpin)' }], value: S2.manualStyle || 'single', onchange: e => { S2.manualStyle = e.target.value; upd(); } }));
  const adaManual = h('div.grid3', { hidden: S2.adaAuto !== false }, numField('Accessible spaces', S2, 'adaSpaces'), numField('Van spaces', S2, 'vanSpaces'), numField('Signs to install', S2, 'signs', { placeholder: 'auto' }));
  const stripe = svc('Line striping', S2, inputs.stripe.on, h('div',
    manual,
    h('div.grid3',
      numField('Stop bars', S2, 'stopBars', { placeholder: '0' }),
      numField('Stop bar length', S2, 'stopBarLen', { placeholder: '12', suffix: 'ft' }),
      numField('Curb paint', S2, 'curbLf', { placeholder: '0', suffix: 'ft' })),
    toggle('Fresh layout (no old lines to follow)', S2.newLayout, v => { S2.newLayout = v; upd(); }, 'Adds chalk-line layout time per stall.'),
    h('h3.sub', 'Stencils'), stencilGrid,
    h('h3.sub', 'Accessible parking'),
    toggle('Figure ADA spaces for me', S2.adaAuto !== false, v => { S2.adaAuto = v; adaManual.hidden = v; upd(); paintAda(); }, 'Uses the 2010 ADA table and adds stencils, blue aisles and signs.'),
    adaBox,
    adaManual,
    numField('Wheel stops', S2, 'wheelStops', { placeholder: '0' })));
  // crew
  const crewBox = h('section.svc', h('h2.svc-title', 'Crew on this job'),
    S.crew.length ? h('div.crew-pick', S.crew.filter(c => c.active !== false).map(c => toggle(`${c.name}${c.role ? ' · ' + c.role : ''}`, I.crewIds.includes(c.id), v => { I.crewIds = v ? [...new Set([...I.crewIds, c.id])] : I.crewIds.filter(x => x !== c.id); JOB.crew_ids = I.crewIds; upd(); }, can() ? `${usd(c.wage)}/hr` : null)))
      : h('div.grid2', numField('Crew size', I, 'crewSize', { placeholder: '2' }), numField('Average wage', I, 'avgWage', { placeholder: '20', suffix: '$/hr', help: boss() ? 'Add your crew in Settings to use real wages.' : '' })));
  // extras
  I.extras ||= [];
  const extrasList = h('div.extras');
  const paintExtras = () => put(extrasList, ...I.extras.map((x, i) => h('div.extra-row',
    field('Item', { value: x.label || '', placeholder: 'Oil spot primer, mobilization…', oninput: e => { x.label = e.target.value; upd(); } }),
    field('Amount', { type: 'number', value: x.amount ?? '', suffix: '$', oninput: e => { x.amount = Number(e.target.value) || 0; upd(); } }),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Remove item', onclick: () => { I.extras.splice(i, 1); paintExtras(); upd(); } }, '✕'))));
  paintExtras();
  const extras = h('section.svc', h('h2.svc-title', 'Extra items and discount'), extrasList,
    h('button.btn.ghost.small', { type: 'button', onclick: () => { I.extras.push({ label: '', amount: 0 }); paintExtras(); } }, 'Add an item'),
    h('div.grid2', numField('Discount', I, 'discountPct', { placeholder: '0', suffix: '%' })));

  function paintOut() {
    const { est } = computeEst();
    const rows = [];
    rows.push(h('div.money',
      h('div.money-total', h('span', 'Customer price'), h('strong', usd(est.total))),
      est.minimumApplied ? h('p.note', `Raised to your ${usd0(est.minimum)} minimum.`) : est.subtotal > 0 ? h('p.note', `${usd0(est.overMinimumBy)} over your ${usd0(est.minimum)} minimum.`) : null,
      h('ul.lines', est.lines.map(l => h('li', h('span', l.label), h('span', usd(l.amount)))))));
    if (can()) rows.push(h('div.costs',
      h('h3', 'Your numbers'),
      h('dl.kv',
        kv('Materials', usd(est.cost.materials)), kv(`Labor (${est.crew.size} ${est.crew.size === 1 ? 'person' : 'people'} @ ${usd(est.crew.avgWage)}/hr + burden)`, usd(est.cost.labor)),
        kv('Equipment + fuel', usd(est.cost.equipment)), kv('Overhead', usd(est.cost.overhead)), kv('Break-even', usd(est.breakEven), 'strong'),
        kv(est.profit >= 0 ? 'Profit' : 'Loss', `${usd(est.profit)} (${est.marginPct}%)`, est.profit >= 0 ? 'up' : 'down'),
        kv('Price for 30% margin', usd(est.suggestedFor30))),
      h('h3', 'Time on the job'),
      h('dl.kv', kv('Work hours (all crew)', num(est.time.personHours, 1)), kv('On site', `${num(est.time.onSiteHours, 1)} hrs · ${est.time.days} day${est.time.days === 1 ? '' : 's'}`), kv('Travel + setup', `${num(est.time.mobilizationHours, 1)} hrs`), est.crew.names.length ? kv('Crew', est.crew.names.join(', ')) : null)));
    if (est.materials.length) rows.push(h('div.mats', h('h3', 'Materials to load'), h('table.mat-table', h('tbody', est.materials.map(m => h('tr', h('td', m.item), h('td.num', `${num(m.qty, 2)} ${m.unit}`), can() ? h('td.num.muted', usd0(m.cost)) : null))))));
    if (est.seal) { const t = est.seal.tank; rows.push(h('div.mats', h('h3', `Tank mix (${num(t.tankGal)} gal tank)`), h('p.muted', `${num(est.seal.tankLoads, 2)} tank loads for this job · each tank covers about ${num(t.sqftPerTank)} sq ft per coat`), h('dl.kv', kv('Concentrate', `${num(t.concentrateGal, 1)} gal`), kv('Water', `${num(t.waterGal, 1)} gal`), kv('Sand', `${num(t.sandLb)} lb (${num(t.sandBags, 1)} bags)`), kv('Additive', `${num(t.additiveGal, 1)} gal`)))); }
    if (est.crack) rows.push(h('div.mats', h('h3', 'Crack filler'), h('p.muted', `${num(est.crack.lbPerLf, 3)} lb per ft · about ${num(est.crack.lfPerBox)} ft per ${st.crack.boxLb} lb box`)));
    if (est.stripe) rows.push(h('div.mats', h('h3', 'Paint'), h('p.muted', `${num(est.stripe.lf.total)} ft of line at ${num(est.stripe.lfPerGal)} ft per gallon (${st.stripe.lineWidthIn} in wide, ${st.stripe.mils} mils)`), h('dl.kv', est.stripe.paint.map(p => kv(`${p.color[0].toUpperCase() + p.color.slice(1)}`, `${num(p.lf)} ft · ${num(p.gal, 2)} gal`)))));
    if (est.warnings.length) rows.unshift(h('div.warnings', est.warnings.map(w => h('p', w))));
    put(out, ...rows);
    paintAda();
  }
  const form = h('div.est-form', { inert: ro ? '' : null }, seal, crack, stripe, crewBox, extras);
  body.append(h('div.est-tab', form, h('aside.est-side', out)));
  paintOut();
}
const kv = (k, v, cls) => [h('dt', k), h('dd', { class: cls || '' }, v)];
const sameQuote = (q, est) => q && Number(q.total) === Number(est.total) && JSON.stringify(q.data?.est?.lines) === JSON.stringify(est.lines);

async function renderQuoteTab(body) {
  const { est, inputs } = computeEst();
  const quotes = can() ? await S.store.listQuotes(JOB.id) : [];
  const P = (JOB.inputs.packages ||= { on: false, list: null, recommended: 1 });
  if (!Array.isArray(P.list) || !P.list.length) P.list = suggestPackages(inputs, S.company.settings);
  const cust = JOB.customer || {};
  const paper = h('div.paper'); const optBox = h('div.opt-editor');
  const optionsNow = () => P.on && P.list.length > 1 ? estimatePackages(inputs, S.company.settings, S.crew, P.list) : null;
  const pubNow = () => buildPublic({ company: S.company, job: JOB, est, options: optionsNow(), recommended: P.recommended });
  const paintPaper = () => put(paper, renderQuote(pubNow(), S.company, { date: Date.now() }));
  const linkOf = q => q?.share_token ? `${location.origin}${location.pathname}#/q/${q.share_token}` : '';
  const latest = quotes.find(q => q.status !== 'replaced') || quotes[0];
  const textNow = q => quoteText({ company: S.company, job: JOB, est, number: q?.number, link: linkOf(q), options: optionsNow() });

  // option editor
  const paintOptions = () => {
    const priced = estimatePackages(inputs, S.company.settings, S.crew, P.list);
    put(optBox, ...priced.map(({ pkg, est: e }, i) => {
      const chg = () => { touch(); paintOptions(); paintPaper(); };
      return h('div.opt-card', { class: i === P.recommended ? 'rec' : '' },
        h('div.opt-top', field('Option name', { value: pkg.name, oninput: e2 => { pkg.name = e2.target.value; touch(); paintPaper(); } }), h('strong.opt-price', usd0(e.total))),
        h('div.opt-svcs',
          inputs.seal?.sqft > 0 ? toggle('Sealcoat', pkg.seal?.on, v => { pkg.seal = { ...(pkg.seal || {}), on: v }; chg(); }) : null,
          inputs.seal?.sqft > 0 && pkg.seal?.on ? field('Coats', { type: 'number', value: pkg.seal?.coats ?? 2, inputmode: 'numeric', class: 'coats', onchange: e2 => { pkg.seal.coats = Math.max(1, Math.min(4, Number(e2.target.value) || 1)); chg(); } }) : null,
          inputs.crack?.lf > 0 ? toggle('Crack fill', pkg.crack?.on, v => { pkg.crack = { on: v }; chg(); }) : null,
          inputs.stripe?.on ? toggle('Striping', pkg.stripe?.on, v => { pkg.stripe = { on: v }; chg(); }) : null),
        field('What the customer reads', { value: pkg.note || '', placeholder: 'Our most popular option', oninput: e2 => { pkg.note = e2.target.value; touch(); paintPaper(); } }),
        h('div.row-btns',
          h('button.btn.small' + (i === P.recommended ? '.primary' : '.ghost'), { type: 'button', onclick: () => { P.recommended = i; chg(); } }, i === P.recommended ? 'Recommended' : 'Make recommended'),
          P.list.length > 2 ? h('button.btn.small.ghost.danger', { type: 'button', onclick: () => { P.list.splice(i, 1); if (P.recommended >= P.list.length) P.recommended = P.list.length - 1; chg(); } }, 'Remove') : null));
    }), h('div.row-btns',
      P.list.length < 3 ? h('button.btn.small', { type: 'button', onclick: () => { P.list.push({ ...JSON.parse(JSON.stringify(P.list.at(-1))), name: 'Option ' + (P.list.length + 1) }); touch(); paintOptions(); paintPaper(); } }, 'Add an option') : null,
      h('button.btn.small.ghost', { type: 'button', onclick: () => { P.list = suggestPackages(inputs, S.company.settings); P.recommended = Math.min(1, P.list.length - 1); touch(); paintOptions(); paintPaper(); } }, 'Start over with suggestions')));
  };
  const optSection = can() ? h('section.svc.opt-section',
    toggle('Give the customer options (Good / Better / Best)', P.on, v => { P.on = v; optBox.hidden = !v; touch(); paintPaper(); }, 'Customers who get choices say yes more often. They pick one when they sign.'),
    optBox) : null;
  optBox.hidden = !P.on;

  const save = can() ? h('button.btn.primary', { type: 'button', disabled: !est.total, onclick: async e => {
    const pub = pubNow();
    const empty = (pub.options || []).find(o => !(o.total > 0));
    if (empty) { toast(`"${empty.name}" has nothing in it. Turn on at least one service or remove that option.`, 'bad'); return; }
    if (latest && ['sent', 'viewed'].includes(latest.status || 'sent') && JSON.stringify(latest.data?.public) === JSON.stringify(pub)) { toast(`Nothing changed since quote No. ${latest.number}. Send that link.`, 'warn'); return; }
    if (latest?.status === 'accepted' && !(await confirmBox('This job already has a signed quote', `Quote No. ${latest.number} was accepted. Make a new quote anyway? The signed one stays on file.`, 'Make a new quote', 'primary'))) return;
    busy(e.currentTarget, true, 'Saving…');
    try {
      await flushSave();
      const q = await S.store.saveQuote(JOB.id, { public: pub, packages: pub.options ? JSON.parse(JSON.stringify(P.list)) : null, est, job: { title: JOB.title, address: JOB.address, customer: JOB.customer } }, pub.options ? pub.options[pub.recommended].total : est.total, Number(settings().quoteValidDays) || 30);
      const fresh = await S.store.getJob(JOB.id); stamps[JOB.id] = fresh.updated_at; JOB.updated_at = fresh.updated_at; bases[JOB.id] = structuredClone(fresh);
      JOB.status = fresh.status; JOB.price = fresh.price; toast(`Quote No. ${q.number} saved. Send the customer the link.`); route();
    } catch (ex) { busy(e.currentTarget, false); toast(ex.message, 'bad'); }
  } }, quotes.length ? 'Save as new quote' : 'Save quote') : null;

  const share = latest && latest.share_token && can() ? h('section.svc.share',
    h('h2.svc-title', `Send quote No. ${latest.number}`),
    h('p.muted', 'The customer opens this link, picks an option if you gave them some, signs with a finger and taps Accept. You see it here right away.'),
    h('div.link-row', h('input.link-box', { value: linkOf(latest), readonly: true, 'aria-label': 'Customer link', onfocus: e => e.target.select() }),
      h('button.btn', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(linkOf(latest)); toast('Link copied.'); } catch { $('.link-box')?.select(); toast('Press and hold the link to copy it.', 'warn'); } } }, 'Copy link')),
    h('div.row-btns',
      h('a.btn.primary', { href: `sms:${(cust.phone || '').replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(textNow(latest))}` }, 'Text it to the customer'),
      h('a.btn', { href: `mailto:${encodeURIComponent(cust.email || '')}?subject=${encodeURIComponent(`Your quote from ${S.company.name}: ${JOB.title}`)}&body=${encodeURIComponent(textNow(latest))}` }, 'Email it'),
      h('a.btn.ghost', { href: linkOf(latest), target: '_blank', rel: 'noopener' }, 'See what they see'))) : null;

  const STATUSQ = { sent: 'Sent', viewed: 'Opened', accepted: 'Accepted', declined: 'Declined', replaced: 'Replaced' };
  const past = quotes.length ? h('section.past', h('h3', 'Saved quotes'), h('ul.qlist', quotes.map(q => h('li',
    h('div.q-row', h('button.link', { type: 'button', onclick: () => showOldQuote(q) }, `No. ${q.number}`), h('span.muted', `${dateStr(q.created_at)} · ${usd(q.total)}`), h('span.qs.qs-' + (q.status || 'sent'), STATUSQ[q.status || 'sent'])),
    q.status === 'accepted' ? h('div.accepted', h('p', h('strong', `Signed by ${q.accepted_name}`), ` on ${new Date(q.accepted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}${q.data?.public?.options && q.accepted_option != null ? ` · picked ${q.data.public.options[q.accepted_option]?.name} (${usd(q.data.public.options[q.accepted_option]?.total)})` : ''}`), q.signature ? h('img.sig-img', { src: q.signature, alt: `Signature of ${q.accepted_name}` }) : null) : null,
    q.status === 'declined' ? h('p.muted', `Declined ${dateStr(q.declined_at)}${q.decline_reason ? ': "' + q.decline_reason + '"' : ''}`) : null)))) : null;

  body.append(h('div.quote-tab',
    h('div.quote-actions', save, h('button.btn', { type: 'button', onclick: () => window.print() }, 'Print or save PDF'),
      h('button.btn.ghost', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(textNow(latest)); toast('Copied.'); } catch { toast('Copy is blocked here.', 'warn'); } } }, 'Copy text')),
    !est.total ? h('p.note', 'Measure something on the map or fill in the estimate to build a quote.') : null,
    share, optSection, paper, past));
  if (P.on) paintOptions(); else optSection?.querySelector('input[type=checkbox]')?.addEventListener('change', () => paintOptions(), { once: true });
  paintPaper();
}
function showOldQuote(q) {
  const d = q.data?.public ? renderQuote(q.data.public, S.company, { number: q.number, date: q.created_at, expires: q.expires_at }) : quoteDoc({ company: S.company, job: { ...JOB, ...(q.data.job || {}) }, est: q.data.est, number: q.number, date: q.created_at });
  modal(`Quote No. ${q.number}`, h('div.paper', d), [{ label: 'Close', result: true }, { label: 'Print', kind: 'primary', value: () => { const w = $('.print-slot') || h('div.print-slot'); put(w, d.cloneNode(true)); document.body.append(w); document.body.classList.add('print-old'); window.print(); document.body.classList.remove('print-old'); w.remove(); } }]);
}

// When the customer signs a particular option, make the job match it (coats, services, add-ons) so materials, hours and schedule are right.
function applyAccepted(q) {
  const I = JOB.inputs; const i = q.accepted_option; const pkg = Array.isArray(q.data?.packages) && i != null ? q.data.packages[i] : null;
  if (pkg) {
    I.seal = { ...(I.seal || {}), on: !!pkg.seal?.on }; if (pkg.seal?.coats) I.seal.coats = pkg.seal.coats;
    I.crack = { ...(I.crack || {}), on: !!pkg.crack?.on }; I.stripe = { ...(I.stripe || {}), on: !!pkg.stripe?.on };
    const add = (pkg.extras || []).filter(e => Number(e.amount)); if (add.length) I.extras = [...(I.extras || []), ...add];
    I.packages = { ...(I.packages || {}), on: false };
    toast(`The customer picked ${pkg.name || 'an option'}. The job now matches it.`);
  }
  I.appliedQuote = q.id; touch();
}

// ---------------- what the customer sees (no account needed) ----------------
function signaturePad() {
  const cv = h('canvas.sig-pad', { width: 900, height: 280, 'aria-label': 'Sign here with your finger or mouse', role: 'img' });
  const g = cv.getContext('2d'); let drawing = false, last = null, ink = 0;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
  cv.addEventListener('pointerdown', e => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
  cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(p.x, p.y); g.stroke(); ink += Math.hypot(p.x - last.x, p.y - last.y); last = p; e.preventDefault(); });
  const up = () => { drawing = false; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  return { el: cv, clear() { g.clearRect(0, 0, cv.width, cv.height); ink = 0; }, get signed() { return ink > 60; }, png() { return cv.toDataURL('image/png'); } };
}
// ---------------- website quote form (public, no login) ----------------
async function renderWebForm(cid) {
  document.body.classList.add('public'); document.title = 'Get a quote';
  put(app(), h('main.pq.wf', h('p.muted', 'Loading…')));
  let info; try { info = await S.store.web('info', { company: cid }); } catch (e) { info = { error: e.message }; }
  if (info.error) return put(app(), h('main.pq.wf', h('div.pq-state', h('h1', 'Quote form unavailable'), h('p', info.error))));
  document.title = `Get a quote from ${info.name}`;
  const started = Date.now();
  const st = { ring: null, seal: !!info.services.seal, crack: !!info.services.crack, stripe: false, crackLevel: 'some', stalls: '' };
  const priceBox = h('div.wf-price', { 'aria-live': 'polite' }, h('p.muted', 'Outline your lot to see a price.'));
  const mapEl = h('div.wf-map', { id: 'map' });
  const fakeJob = { id: 'web', drawing: { type: 'FeatureCollection', features: [] }, lat: null, lng: null, inputs: {} };
  let mv = null, priceTimer = null, lastReq = 0;
  const ringOf = fc => { const f = (fc?.features || []).find(x => x.properties?.kind === 'seal' && x.geometry?.type === 'Polygon'); return f ? f.geometry.coordinates[0] : null; };
  const reprice = () => {
    clearTimeout(priceTimer);
    priceTimer = setTimeout(async () => {
      if (!st.ring) { put(priceBox, h('p.muted', 'Outline your lot to see a price.')); return; }
      if (!st.seal && !st.crack && !st.stripe) { put(priceBox, h('p.muted', 'Pick at least one service.')); return; }
      const my = ++lastReq; put(priceBox, h('p.muted', 'Working out your price…'));
      try {
        const r = await S.store.web('price', { company: cid, ring: st.ring, seal: st.seal, crack: st.crack, stripe: st.stripe, crackLevel: st.crackLevel, stalls: st.stalls });
        if (my !== lastReq) return;
        put(priceBox, h('p.wf-range', `$${r.low.toLocaleString('en-US')} – $${r.high.toLocaleString('en-US')}`), h('p.muted.small', `For about ${r.sqft.toLocaleString('en-US')} sq ft${st.stripe ? `, ${r.stalls} parking spaces${r.guessedStalls ? ' (our guess)' : ''}` : ''}. This is an estimate; we'll confirm the exact price after a quick look at your lot.`));
      } catch (e) { if (my === lastReq) put(priceBox, h('p.warn-text', e.message)); }
    }, 350);
  };
  const find = field('Address of the lot', { placeholder: '123 Main St, Zanesville, OH', autocomplete: 'street-address' });
  const findBtn = h('button.btn', { type: 'button', onclick: async () => {
    const q = find.input.value.trim(); if (q.length < 4) { toast('Type the address first.', 'warn'); return; }
    busy(findBtn, true, 'Finding…'); const g = await geocode(q); busy(findBtn, false);
    if (!g[0]) { toast('Couldn\'t find that address. Try adding the city and state, or move the map yourself.', 'warn'); return; }
    mv?.setView(Number(g[0].lat), Number(g[0].lon), 19); addr.input.value ||= q;
  } }, 'Find it');
  const drawBtn = h('button.btn.primary', { type: 'button', onclick: () => { if (!mv) return; mv.drawing = { type: 'FeatureCollection', features: [] }; st.ring = null; reprice(); mv.start('seal'); mapEl.scrollIntoView({ block: 'center' }); } }, 'Outline my lot');
  const svc = (key, label) => info.services[key] ? toggle(label, st[key], v => { st[key] = v; paintExtra(); reprice(); }) : null;
  const extra = h('div.wf-extra');
  const paintExtra = () => put(extra,
    st.crack ? field('How many cracks?', { type: 'select', value: st.crackLevel, options: [{ value: 'light', label: 'A few' }, { value: 'some', label: 'Some' }, { value: 'lots', label: 'A lot' }], onchange: e => { st.crackLevel = e.target.value; reprice(); } }) : null,
    st.stripe ? field('How many parking spaces? (optional)', { type: 'number', value: st.stalls, min: 1, placeholder: 'We can guess', oninput: e => { st.stalls = e.target.value; reprice(); } }) : null);
  paintExtra();
  const name = field('Your name', { autocomplete: 'name' }), biz = field('Business or church (optional)', { autocomplete: 'organization' }), phone = field('Phone', { type: 'tel', autocomplete: 'tel' }), email = field('Email', { type: 'email', autocomplete: 'email' });
  const addr = field('Lot address', { autocomplete: 'street-address' }), note = field('Anything we should know? (optional)', { type: 'textarea', rows: 2, placeholder: 'Gate codes, best days, problem spots…' });
  [name, biz, phone, email, addr].forEach(f => f.input.maxLength = 120); note.input.maxLength = 1000;
  const hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'wf-hp' });
  const sendBtn = h('button.btn.primary.wf-send', { type: 'button', onclick: async () => {
    if (!st.ring) { toast('Outline your lot on the map first.', 'warn'); mapEl.scrollIntoView({ block: 'center' }); return; }
    busy(sendBtn, true, 'Sending…');
    try {
      const r = await S.store.web('submit', { company: cid, ring: st.ring, seal: st.seal, crack: st.crack, stripe: st.stripe, crackLevel: st.crackLevel, stalls: st.stalls, name: name.input.value, business: biz.input.value, phone: phone.input.value, email: email.input.value, address: addr.input.value || find.input.value, note: note.input.value, hp: hp.value, ms: Date.now() - started });
      mv?.destroy(); mv = null;
      put(app(), h('main.pq.wf', h('div.pq-state', h('h1', 'Thanks! We got your request.'), h('p', `${info.name} will reach out soon${r.low ? ` about your estimate of $${r.low.toLocaleString('en-US')} – $${r.high.toLocaleString('en-US')}` : ''}.`), r.ref && r.ref !== 'thanks' ? h('p.muted', `Reference: ${r.ref}`) : null, info.phone ? h('p', 'Need us sooner? Call ', h('a', { href: 'tel:' + info.phone.replace(/[^\d+]/g, '') }, info.phone)) : null)));
    } catch (e) { toast(e.message, 'bad'); busy(sendBtn, false); }
  } }, 'Send my request');
  put(app(), h('main.pq.wf',
    h('header.wf-head', info.logo ? h('img.q-logo', { src: info.logo, alt: '' }) : null, h('div', h('h1', info.name), h('p.muted', 'Get a price for your parking lot in about a minute.'))),
    info.message ? h('p.wf-msg', info.message) : null,
    h('section.svc', h('h2.svc-title', '1. Find your lot'), h('div.wf-find', find, findBtn)),
    h('section.svc', h('h2.svc-title', '2. Outline it'), h('p.muted', 'Tap Outline my lot, then tap each corner of the paved area on the map. Tap Finish when you\'re done.'), h('div.wf-mapwrap', mapEl), h('div.row-btns', drawBtn)),
    h('section.svc', h('h2.svc-title', '3. What do you need?'), h('div.wf-svcs', svc('seal', 'Sealcoating'), svc('crack', 'Crack filling'), svc('stripe', 'Line striping')), extra, priceBox),
    h('section.svc', h('h2.svc-title', '4. Your info'), h('div.grid2', name, biz, phone, email, addr), note, h('label.wf-hp-wrap', { 'aria-hidden': 'true' }, 'Leave this empty', hp), sendBtn,
      h('p.muted.small', `We only use this to send you a quote. ${info.phone ? 'Questions? Call ' + info.phone + '.' : ''}`))));
  mv = createMap(mapEl, fakeJob, { onChange: fc => { st.ring = ringOf(fc); reprice(); }, settings: {} });
  mv.setView(39.95, -82.0, 16);
}

async function renderPublicQuote(token) {
  document.body.classList.add('public'); document.title = 'Your quote';
  put(app(), h('main.pq', h('p.muted', 'Loading your quote…')));
  let d; try { d = await S.store.publicQuote(token); } catch (e) { d = { error: e.message }; }
  const box = h('main.pq');
  const c = d?.company || {}; if (c.name) document.title = `Quote from ${c.name}`;
  const contact = c.phone ? h('p.pq-help', 'Questions? Call ', h('a', { href: 'tel:' + String(c.phone).replace(/[^\d+]/g, '') }, c.phone), c.email ? [' or email ', h('a', { href: 'mailto:' + c.email }, c.email)] : null, '.') : null;
  const done = (title, text) => put(app(), h('main.pq', h('div.pq-state', h('h1', title), h('p', text), contact)));
  if (!d || d.error) return done('This link isn\'t working', 'The quote may have been removed, or the link was cut off when it was copied. Ask the company to send it again.');
  if (d.status === 'replaced') return put(app(), h('main.pq', h('div.pq-state', h('h1', 'There\'s a newer version of this quote'), h('p', `${c.name || 'The company'} updated this quote.`), d.latest_token ? h('a.btn.primary', { href: '#/q/' + d.latest_token }, 'Open the latest quote') : null, contact)));
  const q = d.quote || {}; const opts = Array.isArray(q.options) ? q.options : [];
  let selected = opts.length ? (Number.isInteger(q.recommended) ? q.recommended : 0) : null;
  const docBox = h('div.paper');
  const paintDoc = () => put(docBox, renderQuote(q, c, { number: d.number, date: d.created_at, expires: d.expires_at }, d.status === 'accepted' || d.status === 'declined' || d.expired ? null : { selected, onSelect: i => { selected = i; paintDoc(); paintTotal(); } }));
  const totalEl = h('p.pq-total');
  const paintTotal = () => { totalEl.textContent = opts.length ? `${opts[selected].name}: ${usd(opts[selected].total)}` : `Total: ${usd(q.total ?? d.total)}`; };
  let action;
  if (d.status === 'accepted') {
    action = h('section.pq-done', h('h2', '✓ Accepted'), h('p', `Signed by ${d.accepted_name} on ${new Date(d.accepted_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${opts.length && d.accepted_option != null ? `, ${opts[d.accepted_option]?.name} (${usd(opts[d.accepted_option]?.total)})` : ''}.`), h('p', `${c.name || 'The company'} will be in touch to schedule the work.`), contact);
  } else if (d.status === 'declined') {
    action = h('section.pq-done', h('h2', 'You declined this quote'), h('p', 'If you change your mind, contact the company for an updated quote.'), contact);
  } else if (d.expired) {
    action = h('section.pq-done', h('h2', 'This quote has expired'), h('p', 'Prices can change. Ask for an updated quote.'), contact);
  } else {
    const pad = signaturePad();
    const name = field('Your full name', { autocomplete: 'name', value: q.customer?.name || '' }); name.input.maxLength = 100;
    const err = h('p.form-error', { role: 'alert' });
    const agree = h('input', { type: 'checkbox', id: 'pq-agree', onchange: () => { err.textContent = ''; } });
    pad.el.addEventListener('pointerup', () => { if (pad.signed) err.textContent = ''; });
    const accept = h('button.btn.primary.wide.pq-accept', { type: 'button', onclick: async () => {
      err.textContent = '';
      if (name.input.value.trim().length < 2) { err.textContent = 'Type your full name.'; name.input.focus(); return; }
      if (!pad.signed) { err.textContent = 'Sign in the box with your finger or mouse.'; return; }
      if (!agree.checked) { err.textContent = 'Check the box to agree to the terms.'; return; }
      busy(accept, true, 'Sending…');
      try { await S.store.acceptQuote(token, selected, name.input.value.trim(), pad.png()); renderPublicQuote(token); window.scrollTo(0, 0); }
      catch (e) { busy(accept, false); if (/replaced|already accepted|declined|expired/i.test(e.message)) { toast(e.message, 'warn'); renderPublicQuote(token); return; } err.textContent = e.message; }
    } }, 'Accept this quote');
    const decline = h('button.link', { type: 'button', onclick: async () => {
      const why = field('Anything we should know? (optional)', { type: 'textarea', rows: 3, placeholder: 'Price, timing, went with someone else…' });
      const ok = await modal('Decline this quote?', why, [{ label: 'Go back', result: null }, { label: 'Decline quote', kind: 'danger', result: 'yes' }]);
      if (ok !== 'yes') return;
      try { await S.store.declineQuote(token, why.input.value); renderPublicQuote(token); } catch (e) { toast(e.message, 'bad'); }
    } }, 'Decline this quote');
    action = h('section.pq-sign', h('h2', 'Accept and sign'), totalEl, name,
      h('div.sig-wrap', h('span.field-label', 'Sign here'), pad.el, h('button.link', { type: 'button', onclick: () => pad.clear() }, 'Clear signature')),
      h('label.pq-agree', { for: 'pq-agree' }, agree, h('span', `I accept this quote and the terms above, and authorize ${c.name || 'the company'} to do the work.`)),
      err, accept, h('div.pq-decline', decline), contact);
  }
  paintDoc(); if (opts.length || d.status !== 'accepted') paintTotal();
  const finished = d.status === 'accepted' || d.status === 'declined' || d.expired;
  put(box, finished ? action : null, docBox, finished ? null : action); // the answer goes on top once there is one
  put(app(), box);
}

// ---------------- AI photo check ----------------
const COND = { good: ['Good', 's-done'], fair: ['Fair', 's-won'], poor: ['Poor', 's-quoted'], failed: ['Failed', 's-lost'] };
function aiResultCard(r, onUse) {
  if (!r) return null;
  const c = r.cracks || {}; const mid = Math.round(((Number(c.lfLow) || 0) + (Number(c.lfHigh) || 0)) / 2);
  const I = JOB.inputs; const haveLf = Number(I.crack?.lf) || 0;
  const facts = [
    ['Cracks', `${c.severity || 'unknown'}${c.types?.length ? ' · ' + c.types.join(', ') : ''}${c.widestInches ? ` · up to ${c.widestInches}" wide` : ''}`],
    ['Crack footage seen', c.lfHigh ? `${num(c.lfLow)}–${num(c.lfHigh)} ft in ${r.photos || 'these'} photo${r.photos === 1 ? '' : 's'}` : 'none'],
    c.alligatorSqft ? ['Alligator cracking', `about ${num(c.alligatorSqft)} sq ft`] : null,
    ['Potholes', String(r.potholes ?? 0)], ['Oil spots', String(r.oilSpots ?? 0)],
    ['Sealer', r.sealerCondition || 'unknown'], ['Striping', r.stripingCondition || 'unknown']
  ].filter(Boolean);
  const btns = [];
  if (mid > 0) btns.push(h('button.btn.small.primary', { type: 'button', onclick: () => onUse('crack', mid) }, haveLf ? `Use ${num(mid)} ft of crack fill (you have ${num(haveLf)})` : `Add ${num(mid)} ft of crack fill`));
  if (r.oilSpots > 0 && !(I.extras || []).some(x => /oil spot/i.test(x.label))) btns.push(h('button.btn.small', { type: 'button', onclick: () => onUse('oil', r.oilSpots) }, `Add oil spot primer (${r.oilSpots})`));
  if (['faded', 'gone'].includes(r.stripingCondition) && !I.stripe?.on) btns.push(h('button.btn.small', { type: 'button', onclick: () => onUse('stripe') }, 'Turn on restriping'));
  if (['worn', 'gone', 'never sealed'].includes(r.sealerCondition) && !I.seal?.on) btns.push(h('button.btn.small', { type: 'button', onclick: () => onUse('seal') }, 'Turn on sealcoat'));
  const [cw, cc] = COND[r.condition] || ['Unknown', ''];
  return h('section.ai-card',
    h('div.ai-head', h('h3', 'AI photo check'), h('span.status.' + cc, cw), r.demo ? h('span.muted.small', 'Sample answer (demo)') : null),
    r.isParkingLot === false ? h('p.warn-text', 'These don\'t look like photos of a parking lot. Take pictures of the pavement and try again.') : null,
    r.summary ? h('p.ai-sum', r.summary) : null,
    h('dl.ai-facts', facts.map(([k, v]) => h('div', h('dt', k), h('dd', v)))),
    r.recommend?.length ? h('div', h('h4', 'Quote this'), h('ul', r.recommend.map(x => h('li', x)))) : null,
    r.notForSealcoat?.length ? h('div.ai-warn', h('h4', 'Sealing won\'t fix'), h('ul', r.notForSealcoat.map(x => h('li', x)))) : null,
    btns.length ? h('div.row-btns', btns) : null,
    h('p.muted.small', `Footage is only what shows in the photos; the whole lot likely has more. Measure cracks on the map for exact numbers. ${r.confidence != null ? `AI confidence ${Math.round(r.confidence * 100)}%. ` : ''}${r.at ? 'Checked ' + dateStr(r.at) + '.' : ''}`));
}
async function runAiPhotoCheck(photos, onDone, btn) {
  const usable = photos.filter(p => p.path || p.url);
  if (!usable.length) { toast('Add some photos of the lot first.', 'warn'); return; }
  const order = ['cracks', 'before', 'damage', 'other'];
  const pre = [...usable].sort((a, b) => (order.indexOf(a.label) + 9) % 9 - (order.indexOf(b.label) + 9) % 9).slice(0, 4).map(p => p.id);
  const chosen = new Set(pre);
  const grid = h('div.ai-pick', usable.slice(0, 40).map(p => { const cb = h('input', { type: 'checkbox', checked: chosen.has(p.id), 'aria-label': `${LABELS[p.label] || 'Photo'} ${p.note || ''}`, onchange: e => { if (e.target.checked) { if (chosen.size >= 4) { e.target.checked = false; toast('Up to 4 photos at a time.', 'warn'); return; } chosen.add(p.id); } else chosen.delete(p.id); } }); return h('label.ai-thumb', cb, p.url ? h('img', { src: p.url, alt: '' }) : h('span', '?')); }));
  const go = await modal('AI photo check', h('div', h('p', 'Pick up to 4 photos that show the pavement: cracks, wear, oil spots, lines. The AI looks at them and fills in what it sees.'), grid), [{ label: 'Cancel', result: null }, { label: 'Check them', kind: 'primary', value: () => chosen.size ? 'go' : (toast('Pick at least one photo.', 'warn'), false) }]);
  if (go !== 'go') return;
  const pick = usable.filter(p => chosen.has(p.id));
  busy(btn, true, 'Looking at the photos…');
  try {
    const r = await S.store.aiPhotoCheck(JOB, pick.map(p => p.path || p.id));
    JOB.inputs.ai = { ...(JOB.inputs.ai || {}), photo: r }; touch();
    onDone(r);
  } catch (e) { toast(e.message, 'bad'); }
  finally { busy(btn, false); }
}
function useAi(kind, n) {
  const I = JOB.inputs;
  if (kind === 'crack') { I.crack = { ...(I.crack || {}), on: true, lf: n }; toast(`Crack fill set to ${num(n)} ft. Check it on the Estimate tab.`); }
  if (kind === 'oil') { I.extras ||= []; I.extras.push({ label: `Oil spot primer (${n} spot${n === 1 ? '' : 's'})`, amount: n * 15 }); toast(`Added oil spot primer at $15 a spot. Change the price on the Estimate tab.`); }
  if (kind === 'stripe') { I.stripe = { ...(I.stripe || {}), on: true }; toast('Restriping turned on.'); }
  if (kind === 'seal') { I.seal = { ...(I.seal || {}), on: true }; toast('Sealcoat turned on.'); }
  touch();
}

async function renderPhotosTab(body) {
  let label = ['done'].includes(JOB.status) ? 'after' : 'before';
  const me = S.session?.user?.id;
  const status = h('p.photo-status', { 'aria-live': 'polite' });
  const grid = h('div.photo-groups');
  let photos = [];
  const load = async () => { try { photos = await S.store.listPhotos(JOB.id); } catch (e) { status.textContent = 'Could not load photos: ' + e.message; photos = []; } paint(); };
  const paint = () => {
    put(grid, ...(photos.length ? Object.keys(LABELS).filter(k => photos.some(p => p.label === k)).map(k => h('section.photo-group', h('h3', `${LABELS[k]} (${photos.filter(p => p.label === k).length})`),
      h('div.photo-grid', photos.filter(p => p.label === k).map(p => h('button.photo-thumb', { type: 'button', onclick: () => openPhoto(p), 'aria-label': `${LABELS[p.label]} photo${p.note ? ': ' + p.note : ''}` },
        p.url ? h('img', { src: p.url, alt: '', loading: 'lazy' }) : h('span.muted', 'Missing'), p.note ? h('span.photo-note', p.note) : null)))))
      : [h('div.empty', h('h2', 'No photos yet'), h('p', 'Take before pictures when you measure: cracks, oil spots, faded lines. After pictures make the best ads.'))]));
  };
  const upload = async files => {
    files = [...files].filter(f => f && (f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name)));
    if (!files.length) return;
    let done = 0, failed = 0;
    for (const f of files) {
      status.textContent = `Adding photo ${done + failed + 1} of ${files.length}…`;
      try { const shrunk = await shrinkPhoto(f); await S.store.addPhoto(JOB, shrunk, { label }); done++; }
      catch (e) { failed++; toast(`${f.name || 'Photo'}: ${e.message}`, 'bad'); }
    }
    status.textContent = failed ? `Added ${done}, ${failed} didn't upload.` : `Added ${done} photo${done === 1 ? '' : 's'}.`;
    await load();
  };
  const openPhoto = async p => {
    const canEdit = can() || p.created_by === me;
    const lab = field('Label', { type: 'select', options: Object.entries(LABELS).map(([value, l]) => ({ value, label: l })), value: p.label });
    const note = field('Note', { type: 'textarea', rows: 2, value: p.note || '', placeholder: 'Big alligator cracking by the dumpster' });
    const res = await modal(LABELS[p.label] + ' photo', h('div.photo-view', p.url ? h('img', { src: p.url, alt: p.note || 'Job photo' }) : null, canEdit ? h('div.grid2', lab, note) : (p.note ? h('p', p.note) : null), h('p.muted.small', `Added ${dateStr(p.created_at)}`)),
      canEdit ? [{ label: 'Delete', kind: 'danger ghost', value: async () => (await confirmBox('Delete this photo?', 'It will be gone for everyone on your team.')) ? 'delete' : false }, { label: 'Close', result: null }, { label: 'Save', kind: 'primary', result: 'save' }] : [{ label: 'Close', result: null }]);
    try {
      if (res === 'delete') { await S.store.deletePhoto(p); toast('Photo deleted.'); await load(); }
      else if (res === 'save') { await S.store.updatePhoto(p.id, { label: lab.input.value, note: note.input.value.trim() || null }); toast('Saved.'); await load(); }
    } catch (e) { toast(e.message, 'bad'); }
  };
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'New photos are' }, Object.entries(LABELS).map(([k, l]) => h('button.seg-btn', { type: 'button', role: 'radio', 'aria-checked': String(k === label), onclick: e => { label = k; $$('.seg-btn', seg).forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); } }, l.split(' ')[0])));
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: e => { upload(e.target.files); e.target.value = ''; } });
  const lib = h('input', { type: 'file', accept: 'image/*', multiple: true, onchange: e => { upload(e.target.files); e.target.value = ''; } });
  const aiSlot = h('div.ai-slot');
  const aiBtn = h('button.btn.ai-btn', { type: 'button', onclick: () => runAiPhotoCheck(photos, () => paintAi(), aiBtn) }, '✨ AI check the photos');
  const paintAi = () => put(aiSlot, aiResultCard(JOB.inputs.ai?.photo, (k, n) => { useAi(k, n); paintAi(); }));
  const aiBox = can() ? h('section.svc', h('h2.svc-title', 'AI photo check'), h('p.muted', 'Let AI look at your photos and tell you the condition, how many cracks it sees, oil spots, potholes and what to quote.'), aiBtn, aiSlot) : null;
  body.append(h('div.photos-tab',
    h('section.svc', h('h2.svc-title', 'Add photos'), h('div.seg-row', h('span.muted', 'New photos are:'), seg),
      h('div.row-btns', h('label.btn.primary.file-btn', cam, 'Take a photo'), h('label.btn.file-btn', lib, 'Choose photos')), status,
      h('p.muted.small', S.store.kind === 'demo' ? 'Demo photos stay in this browser only, as small copies.' : 'Photos are shrunk to about 250 KB each and only your company can see them.')),
    aiBox, grid));
  status.textContent = 'Loading photos…'; await load(); status.textContent = ''; paintAi();
}

function renderDetailsTab(body, refresh) {
  const c = JOB.customer;
  const f = (label, obj, key, opts = {}) => { const w = field(label, { ...opts, value: obj[key] ?? '', oninput: e => { obj[key] = e.target.value.slice(0, 200); touch(); } }); w.input.maxLength = 200; return w; };
  const { est } = computeEst();
  const crewNames = S.crew.filter(x => (JOB.crew_ids || JOB.inputs.crewIds || []).includes(x.id));
  const booking = can() ? bookingBox() : h('p.muted', crewNames.map(x => x.name).join(', ') || 'No crew picked yet.');
  const sched = h('section.svc', h('h2.svc-title', 'Schedule'),
    h('div.grid3',
      field('Start date', { type: 'date', value: JOB.scheduled_date || '', onchange: e => { JOB.scheduled_date = e.target.value || null; if (JOB.scheduled_date && ['lead', 'quoted', 'won'].includes(JOB.status)) JOB.status = 'scheduled'; statusSel.input.value = JOB.status; touch(); booking.repaint?.(); } }),
      field('Days', { type: 'number', value: JOB.scheduled_days ?? est.time.days ?? '', placeholder: String(est.time.days || 1), oninput: e => { JOB.scheduled_days = e.target.value === '' ? null : Math.max(0, Math.min(60, Number(e.target.value) || 0)); touch(); booking.repaint?.(); } }),
      field('Status', { type: 'select', options: Object.entries(STATUS).map(([value, label]) => ({ value, label })), value: JOB.status, onchange: e => { JOB.status = e.target.value; touch(); } })),
    h('h3.sub', 'Who\'s working it'), booking,
    h('div.row-btns',
      h('button.btn', { type: 'button', disabled: !JOB.scheduled_date, onclick: () => download(`${slug(JOB.title)}.ics`, ics([JOB], S.company.name), 'text/calendar') }, 'Add to calendar'),
      crewTextLink(JOB, crewNames)));
  const statusSel = sched.querySelector('select') ? { input: sched.querySelector('select') } : { input: {} };
  const wx = h('div.wx-box', h('p.muted', 'Checking the forecast…'));
  sched.append(h('h3.sub', 'Weather for this job'), wx);
  const pickDay = date => { const el = sched.querySelector('input[type=date]'); el.value = date; el.dispatchEvent(new Event('change')); paintWeather(wx, JOB, pickDay, true); };
  paintWeather(wx, JOB, pickDay);
  body.append(h('div.details-tab', { inert: can() ? null : '' },
    h('section.svc', h('h2.svc-title', 'Job'), h('div.grid2', f('Job name', JOB, 'title'), f('Site address', JOB, 'address'))),
    h('section.svc', h('h2.svc-title', 'Customer'), h('div.grid2', f('Name', c, 'name', { autocomplete: 'name' }), f('Company', c, 'company'), f('Phone', c, 'phone', { type: 'tel' }), f('Email', c, 'email', { type: 'email' }))),
    sched,
    h('section.svc', h('h2.svc-title', 'Notes'), field('Notes for your crew and office', { type: 'textarea', rows: 4, value: JOB.notes || '', oninput: e => { JOB.notes = e.target.value; touch(); } })),
    can() ? h('button.btn.danger.ghost', { type: 'button', onclick: async () => { if (await confirmBox('Delete this job?', 'The job, its drawing and its saved quotes will be deleted. This can\'t be undone.')) { pendingJob = null; await saveChain; await S.store.deleteJob(JOB.id); S.jobs = S.jobs.filter(j => j.id !== JOB.id); JOB = null; toast('Job deleted.'); go('/jobs'); } } }, 'Delete job') : null));
}
const slug = s => String(s || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job';
function crewTextLink(job, crew, small) {
  const phones = crew.map(c => (c.phone || '').replace(/[^\d+]/g, '')).filter(Boolean);
  const msg = `Job: ${job.title}\n${job.address || ''}\nStart: ${dateStr(job.scheduled_date) || 'TBD'}${job.scheduled_days ? ` (${job.scheduled_days} day${job.scheduled_days == 1 ? '' : 's'})` : ''}\n${job.notes ? 'Notes: ' + job.notes : ''}`.trim();
  return h('a.btn' + (small ? '.small' : ''), { href: `sms:${phones.join(',')}?&body=${encodeURIComponent(msg)}`, 'aria-disabled': String(!phones.length || !job.scheduled_date), class: !phones.length || !job.scheduled_date ? 'disabled' : '' }, phones.length ? `Text the crew (${phones.length})` : 'Text the crew (add phone numbers)');
}

// ---------------- money: invoices, payments, wrap-up ----------------
const STATE_CLASS = { open: 's-quoted', partial: 's-won', overdue: 's-lost', paid: 's-done', void: 's-void' };
const statePill = (inv, today) => { const s = invoiceState(inv, today); return h('span.status.' + STATE_CLASS[s], s === 'overdue' ? `${daysLate(inv, today)} day${daysLate(inv, today) === 1 ? '' : 's'} late` : STATE_WORD[s]); };
function printDoc(node) { const w = $('.print-slot') || h('div.print-slot'); put(w, node); document.body.append(w); document.body.classList.add('print-old'); window.print(); document.body.classList.remove('print-old'); w.remove(); }
const invoiceKindWord = k => ({ deposit: 'Deposit', balance: 'Final bill', full: 'Invoice' }[k] || 'Invoice');

async function renderMoneyTab(body) {
  if (!can()) { put(body, h('div.empty', h('h2', 'Office only'), h('p', 'Invoices and job costs are only for owners, admins and estimators.'))); return; }
  const job = JOB; const today = localDay();
  const [invoices, costRow] = await Promise.all([S.store.jobInvoices(job.id), S.store.getCosts(job.id)]);
  if (JOB !== job) return; // left the job while loading
  S.invoices = [...(S.invoices || []).filter(i => i.job_id !== job.id), ...invoices];
  const { est } = computeEst();
  const live = invoices.filter(i => i.status !== 'void');
  const billed = billedSoFar(invoices);
  const paid = r2(live.reduce((t, i) => t + paidOn(i), 0)), owed = r2(live.reduce((t, i) => t + balanceOf(i), 0));
  const left = r2(est.total - billed.total);
  const st = settings();
  const startInvoice = async kind => {
    const pctF = kind === 'deposit' ? field('Deposit', { type: 'number', value: st.depositPct, suffix: '%' }) : null;
    const dueF = field('Due date', { type: 'date', value: '' });
    const noteF = field('Note on the invoice (optional)', { type: 'textarea', rows: 2, placeholder: 'Thanks for choosing us!' });
    const prev = h('div.paper.small-paper');
    let draft = null;
    const redo = () => {
      draft = invoiceDraft({ kind, job, est, settings: st, invoices, depositPct: pctF ? Number(pctF.input.value) : undefined, today });
      if (draft.error) { put(prev, h('p.warn-text', draft.error)); return; }
      if (!dueF.input.dataset.touched) dueF.input.value = draft.due_date;
      draft.due_date = dueF.input.value || null; draft.data.note = noteF.input.value.trim().slice(0, 1000);
      put(prev, renderInvoice({ ...draft, number: null }, S.company, today));
    };
    pctF?.input.addEventListener('input', redo); noteF.input.addEventListener('input', redo);
    dueF.input.addEventListener('change', () => { dueF.input.dataset.touched = '1'; redo(); });
    redo();
    if (draft.error) { toast(draft.error, 'warn'); return; }
    const made = await modal(kind === 'deposit' ? 'Ask for a deposit' : billed.count ? 'Bill the rest' : 'Bill the job', h('div.form-grid', pctF, dueF, noteF, h('p.muted.small', 'Preview'), prev), [{ label: 'Cancel', result: null }, { label: 'Create invoice', kind: 'primary', value: async () => {
      redo(); if (draft.error) { toast(draft.error, 'warn'); return false; }
      if (draft.due_date && draft.due_date < today) { toast('The due date is in the past.', 'warn'); return false; }
      try { return await S.store.createInvoice(job.id, draft); } catch (e) { toast(e.message, 'bad'); return false; }
    } }]);
    if (made) { toast(`Invoice ${made.number} created.`); if (['lead', 'quoted'].includes(JOB.status)) { JOB.status = 'won'; touch(); } refreshMoney(); }
  };
  const invCard = inv => {
    const s = invoiceState(inv, today); const bal = balanceOf(inv);
    const text = [invoiceText(inv, S.company, today), s !== 'paid' && s !== 'void' ? payText(S.company.settings, balanceOf(inv)) : ''].filter(Boolean).join('\n\n');
    const cust = job.customer || {};
    return h('div.inv-card', { class: 'inv-' + s },
      h('div.inv-top', h('div', h('strong', `${invoiceKindWord(inv.kind)} No. ${inv.number}`), h('span.muted.small', `Sent ${dateStr(inv.issued || inv.created_at)}${inv.due_date ? ' · due ' + dateStr(inv.due_date) : ''}`)), statePill(inv, today)),
      h('dl.inv-nums', h('div', h('dt', 'Total'), h('dd', usd(inv.total))), h('div', h('dt', 'Paid'), h('dd', usd(paidOn(inv)))), h('div', h('dt', 'Owed'), h('dd', { class: s === 'overdue' ? 'down' : '' }, usd(bal)))),
      (inv.payments || []).length ? h('ul.pay-list', inv.payments.map(p => h('li', h('span', `${dateStr(p.date)} · ${METHODS[p.method] || 'Payment'}${p.ref ? ' ' + p.ref : ''}`), h('span', usd(p.amount)), h('button.icon-btn.small', { type: 'button', 'aria-label': `Remove ${usd(p.amount)} payment`, onclick: async () => { if (await confirmBox('Remove this payment?', `${usd(p.amount)} on ${dateStr(p.date)} will be taken off this invoice.`, 'Remove')) { try { await S.store.removePayment(inv.id, p.id); refreshMoney(); } catch (e) { toast(e.message, 'bad'); } } } }, '✕')))) : null,
      h('div.row-btns',
        s !== 'void' && bal > 0 ? h('button.btn.primary.small', { type: 'button', onclick: () => recordPayment(inv) }, 'Record payment') : null,
        h('button.btn.small', { type: 'button', onclick: () => { const d = renderInvoice(inv, S.company, today); modal(`Invoice No. ${inv.number}`, h('div.paper', d), [{ label: 'Close', result: true }, { label: 'Print or save PDF', kind: 'primary', value: () => { printDoc(d.cloneNode(true)); return false; } }]); } }, 'View / print'),
        s !== 'void' ? h('a.btn.small', { href: `sms:${(cust.phone || '').replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(text)}` }, 'Text it') : null,
        s !== 'void' ? h('a.btn.small', { href: `mailto:${encodeURIComponent(cust.email || '')}?subject=${encodeURIComponent(`Invoice ${inv.number} from ${S.company.name}`)}&body=${encodeURIComponent(text)}` }, 'Email it') : null,
        s !== 'void' && !(inv.payments || []).length ? h('button.btn.small.ghost.danger', { type: 'button', onclick: async () => { if (await confirmBox(`Void invoice ${inv.number}?`, 'It stays on record marked VOID and stops counting as owed. You can make a new one.', 'Void it')) { try { await S.store.updateInvoice(inv.id, { status: 'void' }); refreshMoney(); } catch (e) { toast(e.message, 'bad'); } } } }, 'Void') : null));
  };
  const recordPayment = async inv => {
    const bal = balanceOf(inv);
    const a = field('Amount', { type: 'number', value: bal.toFixed(2), suffix: '$' }), d = field('Date paid', { type: 'date', value: today }), m = field('Paid by', { type: 'select', options: Object.entries(METHODS).map(([value, label]) => ({ value, label })), value: 'check' }), r = field('Check # or note (optional)', { placeholder: '#1042' });
    const res = await modal(`Payment on invoice ${inv.number}`, h('div.form-grid', h('p.muted', `Owed: ${usd(bal)}`), a, d, m, r), [{ label: 'Cancel', result: null }, { label: 'Save payment', kind: 'primary', value: async () => {
      const p = { amount: Number(a.input.value), date: d.input.value, method: m.input.value, ref: r.input.value.trim().slice(0, 80) };
      const bad = a.input.value.trim() === '' ? 'Enter the amount paid.' : checkPayment(inv, p, today); if (bad) { toast(bad, 'warn'); return false; }
      try { return await S.store.addPayment(inv.id, p); } catch (e) { toast(e.message, 'bad'); return false; }
    } }]);
    if (res) { toast(balanceOf(res) <= 0 ? `Invoice ${inv.number} is paid in full.` : `Payment saved. ${usd(balanceOf(res))} still owed.`); refreshMoney(); }
  };
  const refreshMoney = async () => { await S.flushCosts?.(); if (JOB === job && location.hash.endsWith('/money')) renderMoneyTab(body); };

  // ----- wrap-up -----
  const saved = costRow?.data || {};
  const A = structuredClone(saved.actuals || {}); A.crew = Array.isArray(A.crew) ? A.crew : []; A.other = Array.isArray(A.other) ? A.other : [];
  const frozen = !!saved.frozen && saved.snap;
  const snap = frozen ? saved.snap : estSnapshot(est);
  const crewIds = job.crew_ids?.length ? job.crew_ids : job.inputs.crewIds || [];
  if (!A.crew.length) A.crew = S.crew.filter(c => crewIds.includes(c.id)).map(c => ({ id: c.id, name: c.name, wage: Number(c.wage) || 0, hours: '' }));
  const out = h('div.wrap-out');
  let dirty = false;
  const pushCosts = debounce(async () => { if (!dirty) return; dirty = false; try { await S.store.saveCosts(job.id, job.company_id, { actuals: A, snap, frozen: !!frozen }); setSaved('Saved'); } catch (e) { dirty = true; setSaved('Not saved'); toast('Could not save the wrap-up (' + e.message + ').', 'bad'); } }, 700);
  S.flushCosts = () => pushCosts.flush();
  const changed = () => { dirty = true; setSaved('Saving…'); pushCosts(); paintWrap(); };
  const paintWrap = () => {
    const r = wrapUp(snap, A, st, billed.count && left <= 0.005 ? billed.subtotal : undefined);
    put(out,
      h('p.wrap-head', { class: r.complete ? (r.profit >= snap.profit - 1 ? 'up' : 'down') : 'muted' }, r.headline),
      r.complete ? h('table.cmp', h('thead', h('tr', h('th', ''), h('th.num', 'Estimate'), h('th.num', 'Actual'))),
        h('tbody', r.rows.map(row => h('tr', { class: row.strong ? 'strong' : '' }, h('td', row.label), h('td.num', row.money ? usd0(row.est) : `${num(row.est, 1)} ${row.unit}`), h('td.num', { class: row.key === 'profit' ? (row.actual >= row.est ? 'up' : 'down') : '' }, row.money ? usd0(row.actual) : `${num(row.actual, 1)} ${row.unit}`)))),
        r.qty.length ? h('tbody.qty', r.qty.map(q => h('tr', h('td', q.label), h('td.num', `${num(q.est, 1)} ${q.unit}`), h('td.num', `${num(q.actual, 1)} ${q.unit}`)))) : null) : null,
      r.notes.length ? h('ul.wrap-notes', r.notes.map(t => h('li', t))) : null);
  };
  const hoursRow = (c, i) => h('div.wrap-crew',
    h('span.wrap-name', c.name || 'Crew member', h('small.muted', ` ${usd(c.wage)}/hr`)),
    field('Hours', { type: 'number', value: c.hours ?? '', min: 0, placeholder: num(snap.personHours / Math.max(1, A.crew.length), 1), oninput: e => { c.hours = e.target.value === '' ? '' : Math.max(0, Math.min(400, Number(e.target.value) || 0)); changed(); } }),
    h('button.icon-btn.small', { type: 'button', 'aria-label': `Take ${c.name || 'this person'} off this job`, onclick: () => { A.crew.splice(i, 1); changed(); paintCrew(); } }, '✕'));
  const crewBox = h('div.wrap-crews');
  const paintCrew = () => {
    const others = S.crew.filter(c => !A.crew.some(x => x.id === c.id));
    put(crewBox, A.crew.length ? A.crew.map(hoursRow) : h('p.muted', S.crew.length ? 'Add who worked this job.' : 'Add your crew and their wages in Settings first.'),
      others.length ? h('select.add-crew', { 'aria-label': 'Add someone who worked', onchange: e => { const c = S.crew.find(x => x.id === e.target.value); if (c) { A.crew.push({ id: c.id, name: c.name, wage: Number(c.wage) || 0, hours: '' }); changed(); paintCrew(); } } }, h('option', { value: '' }, '+ Add someone who worked'), others.map(c => h('option', { value: c.id }, c.name))) : null);
  };
  paintCrew();
  const mat = (label, key, have, est0, unit) => have ? field(label, { type: 'number', value: A[key] ?? '', min: 0, placeholder: `${num(est0, 1)} (estimate)`, suffix: unit, oninput: e => { A[key] = e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0); changed(); } }) : null;
  const otherBox = h('div.wrap-other');
  const paintOther = () => put(otherBox, A.other.map((o, i) => h('div.extra-row',
    field('What', { value: o.label || '', placeholder: 'Dump fee, rental, tow…', oninput: e => { o.label = e.target.value.slice(0, 80); changed(); } }),
    field('Cost', { type: 'number', value: o.amount ?? '', suffix: '$', oninput: e => { o.amount = Math.max(0, Number(e.target.value) || 0); changed(); } }),
    h('button.icon-btn.small', { type: 'button', 'aria-label': 'Remove cost', onclick: () => { A.other.splice(i, 1); changed(); paintOther(); } }, '✕'))),
    h('button.btn.small.ghost', { type: 'button', onclick: () => { if (A.other.length >= 30) return; A.other.push({ label: '', amount: '' }); paintOther(); } }, '+ Add a cost'));
  paintOther();
  paintWrap();

  const times = (await S.store.jobTime(job.id).catch(() => [])).filter(t => t.out_at);
  const clockHours = {}; for (const t of times) clockHours[t.crew_id] = (clockHours[t.crew_id] || 0) + (new Date(t.out_at) - new Date(t.in_at)) / 3600e3;
  const clockTotal = Object.values(clockHours).reduce((a, b) => a + b, 0);
  const useClock = clockTotal > 0 ? h('button.btn.small', { type: 'button', onclick: () => {
    for (const [id, hrs] of Object.entries(clockHours)) { let c = A.crew.find(x => x.id === id); const who = S.crew.find(x => x.id === id); if (!c) { c = { id, name: who?.name || 'Crew', wage: Number(who?.wage) || 0, hours: '' }; A.crew.push(c); } c.hours = Math.round(hrs * 4) / 4; }
    changed(); paintCrew(); toast('Hours filled in from the time clock.');
  } }, `Use time clock hours (${num(Math.round(clockTotal * 4) / 4, 2)} hrs, ${Object.keys(clockHours).length} ${Object.keys(clockHours).length === 1 ? 'person' : 'people'})`) : null;
  put(body, h('div.money-tab',
    h('section.svc', h('h2.svc-title', 'Getting paid'),
      h('dl.inv-nums.big', h('div', h('dt', 'Job price'), h('dd', usd(est.total))), h('div', h('dt', 'Billed'), h('dd', usd(billed.total))), h('div', h('dt', 'Paid'), h('dd.up', usd(paid))), h('div', h('dt', 'Owed'), h('dd', { class: owed > 0 ? 'down' : '' }, usd(owed)))),
      h('div.row-btns',
        left > 0.005 && est.total > 0 ? h('button.btn.primary', { type: 'button', onclick: () => startInvoice('full') }, billed.count ? `Bill the rest (${usd(left)})` : 'Bill the job') : null,
        !billed.count && est.total > 0 ? h('button.btn', { type: 'button', onclick: () => startInvoice('deposit') }, `Ask for a deposit (${st.depositPct}%)`) : null),
      est.total <= 0 ? h('p.muted', 'This job has no price yet. Measure it or add items on the Estimate tab first.') : null,
      Math.abs(est.total - (job.price || est.total)) > 1 && ['won', 'scheduled', 'done'].includes(job.status) ? h('p.note', `Heads up: the estimate (${usd(est.total)}) no longer matches the price the customer agreed to (${usd(job.price)}). Invoices use the estimate.`) : null,
      invoices.length ? h('div.inv-list', [...invoices].reverse().map(invCard)) : null),
    h('section.svc', h('h2.svc-title', 'Job wrap-up'),
      h('p.muted', frozen ? `Job finished ${dateStr(saved.doneAt)}. Compared against the estimate as it was then.` : 'After the job, put in what it really took. You\'ll see the real profit, and LotBoss learns your crew\'s real speed for future quotes. Leave a material blank if you used what was estimated.'),
      h('h3.sub', 'Hours worked (including drive and setup)'), useClock, crewBox,
      field('Truck and equipment hours', { type: 'number', value: A.truckHours ?? '', min: 0, placeholder: 'same as the longest shift', suffix: 'hrs', oninput: e => { A.truckHours = e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0); changed(); } }),
      snap.seal || snap.crack || snap.stripe ? h('h3.sub', 'Materials used') : null,
      h('div.grid2', mat('Sealer (concentrate)', 'sealerGal', snap.seal, snap.seal?.sealerGal, 'gal'), mat('Sand', 'sandBags', snap.seal, snap.seal?.sandBags, 'bags'), mat('Crack filler', 'crackBoxes', snap.crack, snap.crack?.boxes, 'boxes'), mat('Paint', 'paintGal', snap.stripe, snap.stripe?.paintGal, 'gal')),
      h('h3.sub', 'Other costs'), otherBox,
      h('h3.sub', 'How it did'), out,
      job.status !== 'done' ? h('button.btn.primary', { type: 'button', onclick: async () => {
        if (!A.crew.some(c => Number(c.hours) > 0) && !(await confirmBox('No hours yet', 'Mark it done anyway? You can still add hours later.', 'Mark done', 'primary'))) return;
        JOB.status = 'done'; touch();
        dirty = true; await pushCosts.flush(); // make sure the wrap-up is saved with the snapshot
        try { await S.store.saveCosts(job.id, job.company_id, { actuals: A, snap, frozen: true, doneAt: today }); } catch (e) { toast(e.message, 'bad'); }
        toast(owed > 0 ? `Job marked done. ${usd(owed)} is still owed.` : billed.count ? 'Job marked done.' : 'Job marked done. Bill it when you\'re ready.'); refreshMoney();
      } }, 'Mark the job done') : null)));
}

// ---------------- follow-ups ----------------
const quoteUrlFor = t => `${location.origin}${location.pathname}#/q/${t}`;
async function loadFollow() {
  if (!can()) { S.follow = null; return []; }
  const cid = S.company.id;
  const [quotes, state, costs] = await Promise.all([S.store.openQuotes(cid).catch(() => []), S.store.followState(cid).catch(() => []), S.store.listCosts(cid).catch(() => [])]);
  S.follow = { quotes, state, costs };
  return followNow();
}
function followNow() {
  if (!S.follow) return [];
  const st = settings();
  const state = Object.fromEntries((S.follow.state || []).map(f => [f.job_id + '|' + f.key, f]));
  const me = (S.session?.user?.user_metadata?.name || S.myName || '').split(' ')[0];
  return followUps({ jobs: S.jobs, quotes: S.follow.quotes, invoices: S.invoices || [], costs: S.follow.costs, state, settings: { reviewLink: st.reviewLink, resealYears: Number(st.resealYears) || 3, quoteNudgeDays: Number(st.quoteNudgeDays) || 3 }, company: S.company, me, today: localDay(), quoteUrl: quoteUrlFor });
}
async function renderFollowPage() {
  const list = await loadFollow();
  const page = h('div.page');
  const setState = async (it, state, until = null) => {
    try { await S.store.setFollow(it.jobId, S.company.id, state === 'never' ? '*' : it.key, state, until); S.follow.state = [...S.follow.state.filter(f => !(f.job_id === it.jobId && f.key === (state === 'never' ? '*' : it.key))), { job_id: it.jobId, key: state === 'never' ? '*' : it.key, state, until }]; return true; }
    catch (e) { toast(e.message, 'bad'); return false; }
  };
  const undo = async it => { try { await S.store.setFollow(it.jobId, S.company.id, it.key, 'snoozed', localDay()); S.follow.state = S.follow.state.filter(f => !(f.job_id === it.jobId && f.key === it.key)); S.follow.state.push({ job_id: it.jobId, key: it.key, state: 'snoozed', until: localDay() }); paint(); } catch (e) { toast(e.message, 'bad'); } };
  const card = it => {
    const sms = smsLink(it.customer.phone, it.message), mail = mailLink(it.customer.email, it.subject, it.message);
    const sent = async () => { if (await setState(it, 'done')) { paint(); toast('Marked done.', 'ok', { label: 'Undo', run: () => undo(it) }); } };
    const msgBox = h('details.fu-msg', h('summary', 'See the message'), h('p', it.message));
    return h('article.fu-card', { class: 'fu-' + it.kind + (it.hot ? ' hot' : '') },
      h('div.fu-top', h('span.fu-kind', KIND_WORD[it.kind]), it.hot ? h('span.fu-hot', it.kind === 'quote' ? 'They opened it' : it.kind === 'lead' ? 'Call them today' : '30+ days late') : null),
      h('a.fu-title', { href: `#/job/${it.jobId}/${it.kind === 'payment' ? 'money' : it.kind === 'quote' ? 'quote' : it.kind === 'lead' ? 'map' : 'details'}` }, it.title),
      h('p.muted', `${it.customer.name || 'No customer name'} · ${it.why}`),
      it.needsLink ? h('p.note', 'Add your Google review link in Settings > Company first, so the message has it.') : null,
      msgBox,
      h('div.row-btns',
        sms ? h('a.btn.primary.small', { href: sms, onclick: () => setTimeout(sent, 300) }, 'Text') : null,
        mail ? h('a.btn.small', { href: mail, onclick: () => setTimeout(sent, 300) }, 'Email') : null,
        !sms && !mail ? h('span.muted.small', 'No phone or email on this job.') : null,
        h('button.btn.small.ghost', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(it.message); toast('Message copied.'); } catch { msgBox.open = true; } } }, 'Copy'),
        h('button.btn.small.ghost', { type: 'button', onclick: sent }, 'Done'),
        h('button.btn.small.ghost', { type: 'button', onclick: async () => { if (await setState(it, 'snoozed', addDays(localDay(), 7))) { paint(); toast('Snoozed for a week.'); } } }, 'Next week'),
        h('button.btn.small.ghost.danger', { type: 'button', onclick: async () => { if (await confirmBox('Stop following up?', `No more reminders of any kind for ${it.title}.`, 'Stop')) { if (await setState(it, 'never')) paint(); } } }, 'Stop')));
  };
  const paint = () => {
    const items = followNow();
    const groups = ['lead', 'payment', 'quote', 'review', 'reseal'].map(k => [k, items.filter(i => i.kind === k)]).filter(([, v]) => v.length);
    put(page,
      h('div.page-head', h('a.back.inline', { href: '#/jobs', 'aria-label': 'Back to jobs' }, '‹'), h('h1', 'Follow up')),
      h('p.muted', 'People to reach out to today. Tap Text or Email: it opens your own phone with the message written, ready to send.'),
      items.length ? groups.map(([k, v]) => h('section.svc', h('h2.svc-title', `${{ lead: 'New website requests', payment: 'Late payments', quote: 'Quotes waiting on an answer', review: 'Ask for a review', reseal: 'Time to reseal' }[k]} (${v.length})`), h('div.fu-list', v.map(card))))
        : h('div.empty', h('h2', 'All caught up'), h('p', 'Nobody to follow up with today. Unsigned quotes, late invoices, review requests and reseal reminders show up here on their own.')));
  };
  paint();
  return page;
}

async function renderMoneyPage() {
  const today = localDay();
  const [invs] = await Promise.all([S.store.listInvoices(S.company.id)]);
  S.invoices = invs;
  const m = moneySummary(invs, today);
  const byJob = Object.fromEntries(S.jobs.map(j => [j.id, j]));
  const open = invs.filter(i => balanceOf(i) > 0).sort((a, b) => (invoiceState(b, today) === 'overdue') - (invoiceState(a, today) === 'overdue') || String(a.due_date || '').localeCompare(String(b.due_date || '')));
  const recent = invs.filter(i => i.status !== 'void' && balanceOf(i) <= 0).slice(0, 15);
  const row = i => { const j = byJob[i.job_id]; return h('a.job-card', { href: `#/job/${i.job_id}/money` }, h('div.jc-main', h('strong', `${j?.title || i.data?.title || 'Job'}`), h('span.muted', `${invoiceKindWord(i.kind)} No. ${i.number}${i.due_date ? ' · due ' + dateStr(i.due_date) : ''}${i.data?.customer?.name ? ' · ' + i.data.customer.name : ''}`)), h('div.jc-side', statePill(i, today), h('span.jc-price', usd0(balanceOf(i) || i.total)))); };
  const yr = Number(today.slice(0, 4));
  const rangeSel = field('Export', { type: 'select', value: 'this', options: [{ value: 'this', label: `This year (${yr})` }, { value: 'last', label: `Last year (${yr - 1})` }, { value: 'all', label: 'Everything' }] });
  const rng = () => rangeSel.input.value === 'this' ? { from: `${yr}-01-01`, to: `${yr}-12-31` } : rangeSel.input.value === 'last' ? { from: `${yr - 1}-01-01`, to: `${yr - 1}-12-31` } : {};
  const tag = () => rangeSel.input.value === 'all' ? 'all' : String(rangeSel.input.value === 'this' ? yr : yr - 1);
  const totBox = h('p.muted');
  const paintTot = () => { const t = moneyTotals(invs, rng()); totBox.textContent = `Billed ${usd(t.billed)} · collected ${usd(t.collected)} · still owed ${usd(t.open)}`; };
  rangeSel.input.addEventListener('change', paintTot); paintTot();
  const exportBox = h('section.svc', h('h2.svc-title', 'For your accountant / QuickBooks'), h('p.muted', 'Spreadsheet files QuickBooks Online can import (Settings > Import data), or just send them to your accountant.'), rangeSel, totBox,
    h('div.row-btns',
      h('button.btn', { type: 'button', onclick: () => download(`invoices-${tag()}.csv`, csv(qbInvoices(invs, S.jobs, rng())), 'text/csv') }, 'Invoices'),
      h('button.btn', { type: 'button', onclick: () => download(`payments-${tag()}.csv`, csv(qbPayments(invs, S.jobs, rng())), 'text/csv') }, 'Payments'),
      h('button.btn', { type: 'button', onclick: () => download('customers.csv', csv(qbCustomers(S.jobs, invs)), 'text/csv') }, 'Customers')));
  return h('div.page',
    h('div.page-head', h('a.back.inline', { href: '#/jobs', 'aria-label': 'Back to jobs' }, '‹'), h('h1', 'Money')),
    h('div.pipeline', h('div.pipe', h('span.pipe-n', usd0(m.owed)), h('span.pipe-l', `Owed (${m.openCount})`)), h('div.pipe', { class: m.overdueCount ? 'bad' : '' }, h('span.pipe-n', usd0(m.overdue)), h('span.pipe-l', `Late (${m.overdueCount})`)), h('div.pipe', h('span.pipe-n', usd0(m.collectedMonth)), h('span.pipe-l', 'Collected this month'))),
    h('section.svc', h('h2.svc-title', 'Waiting on payment'), open.length ? h('div.job-list', open.map(row)) : h('p.muted', invs.length ? 'Nobody owes you anything right now.' : 'No invoices yet. Open a job, go to the Money tab and bill it.')),
    recent.length ? h('section.svc', h('h2.svc-title', 'Paid'), h('div.job-list', recent.map(row))) : null,
    invs.length ? exportBox : null);
}

// suggestions from finished jobs, shown on the Prices and rates page
async function learnBox(custom, saveCompany) {
  const rows = await S.store.listCosts(S.company.id).catch(() => []);
  const jobs = rows.map(r => r.data).filter(d => d?.frozen && d.snap && d.actuals);
  const sug = learn(jobs, settings());
  if (!jobs.length) return h('section.svc.learn', h('h2.svc-title', 'Learn from your jobs'), h('p.muted', 'When you finish jobs and fill in the wrap-up on the Money tab, LotBoss compares what you estimated with what really happened and suggests better numbers here.'));
  return h('section.svc.learn', h('h2.svc-title', 'Learn from your jobs'),
    sug.length ? h('div', h('p.muted', `Based on ${jobs.length} finished job${jobs.length === 1 ? '' : 's'}:`), sug.map(s => { const btn = h('button.btn.small.primary', { type: 'button', onclick: () => { setPath(custom, s.path, s.to); saveCompany({ settings: custom }); btn.disabled = true; btn.textContent = 'Updated'; } }, `Use ${num(s.to)}`); return h('div.learn-row', h('div', h('strong', `${s.label}: ${num(s.from)} → ${num(s.to)}`), h('span.muted.small', s.why)), btn); }))
      : h('p.muted', `${jobs.length} finished job${jobs.length === 1 ? '' : 's'} so far. ${jobs.length < 2 ? 'After 2 or more, LotBoss can suggest changes.' : 'Your numbers match what your crew really does. Nothing to change.'}`));
}

// ---------------- schedule ----------------
// ---------------- schedule: week board, my jobs, live calendars ----------------
const dayShort = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
const people = () => can() ? S.crew.filter(c => c.active !== false) : (S.crewNames || []);
const calUrl = t => `${SUPABASE_URL}/functions/v1/lotcalc-cal?t=${t}`;

async function calendarModal(title, getToken, phone, who) {
  let token;
  try { token = await getToken(false); } catch (e) { await modal(title, h('div', h('p', e.message), h('p.muted', 'You can still download the schedule and open it in your calendar app with the Download button.')), [{ label: 'OK', kind: 'primary', result: true }]); return; }
  if (!token) { toast('No calendar link yet.', 'warn'); return; }
  const box = h('div.cal-box');
  const paint = () => {
    const url = calUrl(token), web = url.replace(/^https:/, 'webcal:');
    put(box,
      h('p', `${who ? who + '\'s' : 'This'} calendar fills itself in and updates on its own when jobs change (phones check about every hour). No prices or wages are in it.`),
      h('div.row-btns.stack', h('a.btn.primary', { href: web }, 'Add to iPhone / Apple Calendar'), h('a.btn', { href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(web)}`, target: '_blank', rel: 'noopener' }, 'Add to Google Calendar'),
        h('button.btn', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { copyBox('Copy this link', url); } } }, 'Copy link'),
        phone ? h('a.btn', { href: `sms:${String(phone).replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(`Here's your job calendar from ${S.company.name}. Tap to add it to your phone: ${web}`)}` }, `Text it to ${who || 'them'}`) : null),
      h('p.muted.small', 'Anyone with this link can see these jobs. If it gets shared by mistake, make a new one; the old link stops working.'),
      getToken.reset ? h('button.btn.ghost.small', { type: 'button', onclick: async () => { if (!(await confirmBox('Make a new link?', 'The old link stops working. Anyone using it will need the new one.', 'New link'))) return; try { token = await getToken(true); paint(); toast('New link made.'); } catch (e) { toast(e.message, 'bad'); } } }, 'Make a new link') : null);
  };
  paint();
  await modal(title, box, [{ label: 'Done', kind: 'primary', result: true }]);
}

function weekBoard(days, rows, jobs, today, { me } = {}) {
  const probs = problems(jobs, rows, days);
  const unassigned = days.map(d => jobs.filter(j => !(j.crew_ids || []).length && jobDays(j).includes(d)));
  const chip = (j, d) => { const span = jobDays(j); const i = span.indexOf(d); return h('a.wk-job.s-' + j.status, { href: `#/job/${j.id}/details`, title: `${j.title}${j.address ? ', ' + j.address : ''}` }, h('span', j.title), span.length > 1 ? h('small', `${i + 1}/${span.length}`) : null); };
  return h('div.wk-wrap', h('table.wk', { 'aria-label': 'Week schedule' },
    h('thead', h('tr', h('th.wk-name', ''), days.map(d => h('th', { class: d === today ? 'today' : '' }, dayShort(d))))),
    h('tbody',
      rows.map(c => h('tr', { class: me && c.id === me.id ? 'me' : '' },
        h('th.wk-name', h('span', c.name), can() && c.phone ? h('a.wk-text', { href: `sms:${c.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(weekText(c, jobs, days, S.company.name, dayShort))}`, 'aria-label': `Text ${c.name} their week`, title: `Text ${c.name} their week` }, '✉') : null),
        days.map(d => {
          const js = jobsOn(jobs, c.id, d); const off = offOn(c, d);
          const dbl = probs.some(p => p.type === 'double' && p.crewId === c.id && p.day === d); const offBad = off && js.length;
          return h('td', { class: [d === today ? 'today' : '', off ? 'off' : '', dbl || offBad ? 'clash' : ''].filter(Boolean).join(' ') },
            off ? h('span.wk-off', 'Off' + (off.note ? ' · ' + off.note : '')) : null, js.map(j => chip(j, d)));
        }))),
      !me && unassigned.some(x => x.length) ? h('tr.unassigned', h('th.wk-name', h('span', 'No crew yet')), days.map((d, i) => h('td', { class: d === today ? 'today' : '' }, unassigned[i].map(j => chip(j, d))))) : null)),
    probs.length ? h('div.warnings.wk-probs', probs.map(p => h('p', p.type === 'double' ? `${p.name} is on ${p.jobs.length} jobs ${dayShort(p.day)}: ${p.jobs.map(j => j.title).join(' and ')}.` : `${p.name} is off ${dayShort(p.day)}${p.off.note ? ' (' + p.off.note + ')' : ''} but is on ${p.jobs.map(j => j.title).join(', ')}.`))) : null);
}

// ---------------- time clock ----------------
// when the phone won't let us copy for them: show it selected so they can long-press > Copy
function copyBox(title, text) {
  const ta = h('textarea.copy-box', { readonly: true, rows: Math.min(6, Math.ceil(text.length / 40)) }); ta.value = text;
  modal(title, h('div', h('p.muted.small', 'Press and hold, then Copy.'), ta), [{ label: 'Done', kind: 'primary', result: true }]);
  setTimeout(() => { ta.focus(); ta.select(); }, 50);
}
const gps = () => new Promise(res => { if (!navigator.geolocation) return res(null); let done = false; const t = setTimeout(() => { done = true; res(null); }, 8000); navigator.geolocation.getCurrentPosition(p => { if (!done) { clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude }); } }, () => { if (!done) { clearTimeout(t); res(null); } }, { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }); });
const hm = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const clockTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
async function clockCard(me, jobs, today) {
  if (!me) return null;
  const box = h('section.svc.clock');
  const paint = async () => {
    const open = await S.store.myClock(me.id).catch(() => null);
    if (open) {
      const job = S.jobs.find(j => j.id === open.job_id);
      const timer = h('strong.clock-run', hm(Date.now() - new Date(open.in_at)));
      const iv = setInterval(() => { if (!timer.isConnected) return clearInterval(iv); timer.textContent = hm(Date.now() - new Date(open.in_at)); }, 30000);
      const out = h('button.btn.primary.clock-btn', { type: 'button', onclick: async () => { busy(out, true, 'Clocking out…'); const p = await gps(); try { const t = await S.store.clockOut(p?.lat, p?.lng); toast(`Clocked out. ${hm(new Date(t.out_at) - new Date(t.in_at))} on ${job?.title || 'the job'}.`); paint(); } catch (e) { toast(/fetch/i.test(e.message) ? 'No signal. Try again in a minute.' : e.message, 'bad'); busy(out, false); } } }, 'Clock out');
      put(box, h('p.clock-on', '● On the clock'), h('p', h('strong', job?.title || 'Job'), ` since ${clockTime(open.in_at)} · `, timer), open.in_dist_ft != null && open.in_dist_ft > 1000 ? h('p.warn-text.small', `You clocked in ${num(Math.round(open.in_dist_ft / 5280 * 10) / 10)} miles from the job.`) : null, out);
    } else {
      const mineToday = jobs.filter(j => (j.crew_ids || []).includes(me.id) && jobDays(j).includes(today));
      put(box, h('h2.svc-title', 'Time clock'),
        mineToday.length ? mineToday.map(j => { const b = h('button.btn.primary.clock-btn', { type: 'button', onclick: async () => { busy(b, true, 'Clocking in…'); const p = await gps(); try { const t = await S.store.clockIn(j.id, p?.lat, p?.lng); toast(`Clocked in at ${clockTime(t.in_at)}${t.in_dist_ft != null ? (t.in_dist_ft < 1000 ? ', on site' : `, ${num(Math.round(t.in_dist_ft / 5280 * 10) / 10)} mi from the job`) : ''}.`); paint(); } catch (e) { toast(/fetch/i.test(e.message) ? 'No signal. Try again in a minute.' : e.message, 'bad'); busy(b, false); } } }, `Clock in at ${j.title}`); return b; })
          : h('p.muted', 'No job on your schedule today.'));
    }
  };
  await paint();
  return box;
}

let schedView = (() => { try { return localStorage.getItem('lotcalc-sched-view') || 'week'; } catch { return 'week'; } })();
let schedWeek = null;
async function renderSchedule() {
  const today = localDay();
  S.crewNames = await S.store.crewNames(S.company.id).catch(() => S.crewNames || []);
  const me = myCrew(S.crewNames);
  const crewOnly = !can();
  const all = S.jobs.filter(j => j.scheduled_date && j.status !== 'lost');
  const jobs = crewOnly && me ? all.filter(j => (j.crew_ids || []).includes(me.id)) : all;
  const sched = [...jobs].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  const days = weekOf(schedWeek || today);
  const page = h('div.page');
  const setView = v => { schedView = v; try { localStorage.setItem('lotcalc-sched-view', v); } catch { /* private mode */ } route(); };
  const nav = h('div.wk-nav',
    h('button.icon-btn', { type: 'button', 'aria-label': 'Last week', onclick: () => { schedWeek = addDays(days[0], -7); route(); } }, '‹'),
    h('strong', `${new Date(days[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(days[6] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Next week', onclick: () => { schedWeek = addDays(days[0], 7); route(); } }, '›'),
    days.includes(today) ? null : h('button.btn.small.ghost', { type: 'button', onclick: () => { schedWeek = null; route(); } }, 'This week'));
  const head = h('div.page-head', h('h1', crewOnly ? 'My jobs' : 'Schedule'),
    h('div.seg', { role: 'tablist' }, [['week', 'Week'], ['list', 'List']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(schedView === k), class: schedView === k ? 'on' : '', onclick: () => setView(k) }, l))));
  const calBtns = h('div.row-btns',
    crewOnly ? (me ? h('button.btn', { type: 'button', onclick: () => calendarModal('My job calendar', () => S.store.myCalendar(S.company.id), null, null) }, 'Put my jobs on my phone calendar') : null)
      : boss() ? h('button.btn', { type: 'button', onclick: () => { const g = reset => S.store.calendarLink(S.company.id, null, reset); g.reset = true; calendarModal('Company calendar', g, null, null); } }, 'Live company calendar') : null,
    sched.length ? h('button.btn.ghost', { type: 'button', onclick: () => download('lotcalc-schedule.ics', ics(sched, S.company.name), 'text/calendar') }, 'Download all') : null);
  const clock = await clockCard(me, S.jobs, today);
  const linkNote = crewOnly && !me ? h('p.note', 'Ask your boss to link your login to your name (Settings > Crew > Edit > Login). Then you\'ll see just your jobs here and can put them on your phone\'s calendar.') : null;
  if (schedView === 'week') {
    const rows = crewOnly ? (me ? [me] : people()) : people();
    put(page, head, linkNote, clock, nav,
      rows.length || jobs.some(j => days.some(d => jobDays(j).includes(d))) ? weekBoard(days, rows, crewOnly && me ? jobs : all, today, { me: crewOnly ? me : null }) : h('div.empty', h('h2', 'No crew yet'), h('p', can() ? 'Add your crew in Settings > Crew and wages, then pick who works each job on its Details tab.' : 'Nothing here yet.')),
      !crewOnly && rows.length ? h('p.muted.small', `Tap ✉ to text someone their week. Who's free ${dayShort(today)}: ${freeOn(all, rows, today).map(c => c.name).join(', ') || 'nobody'}.`) : null,
      calBtns);
    return page;
  }
  const upcoming = sched.filter(j => jobDays(j).at(-1) >= today || j.status !== 'done');
  const toBook = crewOnly ? [] : S.jobs.filter(j => j.status === 'won' && !j.scheduled_date);
  const groups = {}; for (const j of upcoming) (groups[j.scheduled_date] ||= []).push(j);
  const names = ids => people().filter(c => (ids || []).includes(c.id));
  put(page, head, linkNote, clock,
    toBook.length ? h('section.svc', h('h2.svc-title', 'Won, needs a date'), h('div.job-list', toBook.map(j => h('a.job-card', { href: `#/job/${j.id}/details` }, h('div.jc-main', h('strong', j.title), h('span.muted', j.address || '')), h('div.jc-side', h('span.status.s-won', 'Won')))))) : null,
    Object.keys(groups).length ? Object.entries(groups).map(([d, js]) => h('section.day', h('h2.day-h', { class: d === today ? 'today' : '' }, d === today ? 'Today' : dateStr(d)),
      js.map(j => { const crew = names(j.crew_ids); const badge = h('div.wx-slot'); schedWeather(badge, j); return h('div.sched-card',
        h('a.jc-main', { href: `#/job/${j.id}/details` }, h('strong', j.title), h('span.muted', [j.address, j.scheduled_days ? `${j.scheduled_days} day${j.scheduled_days == 1 ? '' : 's'}` : null, crew.map(c => c.name).join(', ')].filter(Boolean).join(' · ')), badge),
        h('div.row-btns', h('button.btn.small', { type: 'button', onclick: () => download(`${slug(j.title)}.ics`, ics([j], S.company.name), 'text/calendar') }, 'Calendar'), can() ? crewTextLink(j, crew, true) : null)); })))
      : h('div.empty', h('h2', 'Nothing scheduled'), h('p', crewOnly ? 'No jobs on your schedule yet.' : 'Open a job, go to Details, and pick a start date. It shows up here and can go straight to your phone\'s calendar.')),
    calBtns);
  return page;
}

// on the Details tab: pick the crew for the dates, with who's busy or off
function bookingBox() {
  const box = h('div.booking');
  const paint = () => {
    const I = JOB.inputs; const ids = JOB.crew_ids?.length ? JOB.crew_ids : I.crewIds || [];
    const draft = { ...JOB, crew_ids: ids };
    const days = jobDays(draft); const others = S.jobs.filter(j => j.id !== JOB.id);
    const crew = S.crew.filter(c => c.active !== false);
    const note = c => { if (!days.length) return null; const off = days.find(d => offOn(c, d)); if (off) return `off ${dayShort(off)}`; const busy = days.flatMap(d => jobsOn(others.filter(j => j.status !== 'done'), c.id, d)); return busy.length ? `busy: ${busy[0].title}` : 'free'; };
    const warn = bookingWarnings(draft, others, crew, dayShort);
    put(box,
      crew.length ? h('div.crew-pick', crew.map(c => { const nt = note(c); return toggle(c.name, ids.includes(c.id), v => { const next = v ? [...new Set([...ids, c.id])] : ids.filter(x => x !== c.id); I.crewIds = next; JOB.crew_ids = next; touch(); paint(); }, nt ? h('span', { class: 'avail ' + (nt === 'free' ? 'free' : 'busy') }, nt) : null); })) : h('p.muted', 'Add your crew in Settings > Crew and wages to book people on jobs.'),
      warn.length ? h('div.warnings', warn.map(w => h('p', w))) : null);
  };
  paint();
  box.repaint = paint;
  return box;
}

// ---------------- weather ----------------
const deg = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '—' : Math.round(Number(v)) + '°';
const joinReasons = rs => rs.map((r, i) => i ? r.charAt(0).toLowerCase() + r.slice(1) : r).join('; ');
const wxPill = (r, small) => h('span.wx-pill.wx-' + r.level, { title: r.reasons.join('; ') }, h('b', { 'aria-hidden': 'true' }, ICON[r.level]), small ? WORD[r.level] : ` ${WORD[r.level]}`);
async function paintWeather(box, job, onPick, keepScroll) {
  const days = await forecast(job.lat, job.lng);
  if (!job.lat) { put(box, h('p.muted', 'Find the lot on the map to see the forecast.')); return; }
  if (!days) { put(box, h('p.muted', 'Forecast unavailable right now. Check your signal.')); return; }
  const svc = servicesOf(job.inputs); const rules = settings().weather;
  const booked = new Set(jobDates(job.scheduled_date, job.scheduled_days));
  const verdicts = days.map((d, i) => ({ d, r: judgeDay(svc, d, days[i + 1], rules) }));
  const bookedBad = verdicts.filter(v => booked.has(v.d.date) && v.r.level !== 'go');
  const strip = h('div.wx-strip', { role: 'list' }, verdicts.slice(0, 14).map(({ d, r }) => h('button.wx-day.wx-' + r.level, { type: 'button', role: 'listitem', class: booked.has(d.date) ? 'booked' : '', disabled: !onPick || !can(), 'aria-label': `${dateStr(d.date)}: ${WORD[r.level]}. ${r.reasons.join('. ')}`, onclick: () => onPick && onPick(d.date) },
    h('span.wx-date', dateStr(d.date).replace(',', '')), h('span.wx-temp', `${deg(d.hi)} / ${deg(d.lo)}`), h('span.wx-sky', sky(d.code) || ' '), h('span.wx-rain', Number.isFinite(Number(d.rainPct)) && d.rainPct !== null ? `${Math.round(d.rainPct)}% rain` : 'rain ?'), h('span.wx-verdict', ICON[r.level] + ' ' + WORD[r.level]))));
  put(box, 
    bookedBad.length ? h('div.warnings', bookedBad.map(v => h('p', `${dateStr(v.d.date)}: ${WORD[v.r.level].toLowerCase()}. ${joinReasons(v.r.reasons)}.`))) : null,
    h('p.muted.small', `Judged for ${svc.length ? svc.map(s => ({ seal: 'sealcoat', crack: 'crack fill', stripe: 'striping' }[s])).join(', ') : 'all work'} using your weather rules.${onPick && can() ? ' Tap a day to schedule it.' : ''}`),
    strip);
  if (!keepScroll) strip.querySelector('.booked')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}
async function schedWeather(slot, j) {
  const dates = jobDates(j.scheduled_date, j.scheduled_days);
  const days = await forecast(j.lat, j.lng); if (!days || !dates.length) return;
  const full = j.inputs ? j : await S.store.getJob(j.id).catch(() => j);
  const results = dates.map(dt => { const i = days.findIndex(d => d.date === dt); return i < 0 ? null : judgeDay(servicesOf(full.inputs), days[i], days[i + 1], settings().weather); }).filter(Boolean);
  if (!results.length) return;
  const rank = { go: 0, risky: 1, no: 2 }; const worst = results.reduce((a, b) => rank[b.level] > rank[a.level] ? b : a);
  put(slot, wxPill(worst), worst.level !== 'go' ? h('span.wx-why', joinReasons(worst.reasons)) : null);
}

// ---------------- calculators ----------------
function renderTools() {
  const st = settings();
  const calc = (title, fields, run) => { const out = h('div.calc-out'); const go2 = () => put(out, ...run()); const box = h('section.svc.calc', h('h2.svc-title', title), h('div.grid3', fields), out); fields.forEach(f => f.input.addEventListener('input', go2)); go2(); return box; };
  const v = f => Number(f.input.value) || 0;
  const sq = field('Square feet', { type: 'number', value: 10000 }), co = field('Coats', { type: 'number', value: st.sealcoat.coats }), tk = field('Tank size', { type: 'number', value: st.sealcoat.tankGal, suffix: 'gal' });
  const lf = field('Crack length', { type: 'number', value: 1000, suffix: 'ft' }), cw = field('Width', { type: 'number', value: st.crack.widthIn, suffix: 'in' }), cd = field('Depth', { type: 'number', value: st.crack.depthIn, suffix: 'in' });
  const pl = field('Line length', { type: 'number', value: 2000, suffix: 'ft' }), pw = field('Line width', { type: 'number', value: st.stripe.lineWidthIn, suffix: 'in' }), pm = field('Thickness', { type: 'number', value: st.stripe.mils, suffix: 'mils' });
  const at = field('Total stalls', { type: 'number', value: 45 });
  const rl = field('Row length', { type: 'number', value: 90, suffix: 'ft' }), sw = field('Stall width', { type: 'number', value: st.stripe.stallWidth, suffix: 'ft' }), sd = field('Stall depth', { type: 'number', value: st.stripe.stallDepth, suffix: 'ft' });
  // driveways: several at once (a street of homeowners), priced at your homeowner rates
  const D = [{ length: 60, width: 12, cracks: '', who: '' }];
  const dBox = h('div.dw'), dOut = h('div.calc-out');
  const paintD = () => {
    const r = drivewayPrice(D, st);
    put(dBox, D.map((d, i) => h('div.dw-row',
      field('Homeowner / address', { value: d.who, placeholder: 'optional', oninput: e => { d.who = e.target.value.slice(0, 100); } }),
      field('Length', { type: 'number', value: d.length ?? '', suffix: 'ft', oninput: e => { d.length = e.target.value; d.sqft = ''; paintOut(); } }),
      field('Width', { type: 'number', value: d.width ?? '', suffix: 'ft', oninput: e => { d.width = e.target.value; d.sqft = ''; paintOut(); } }),
      field('Cracks', { type: 'number', value: d.cracks ?? '', suffix: 'ft', oninput: e => { d.cracks = e.target.value; paintOut(); } }),
      h('button.icon-btn.small', { type: 'button', 'aria-label': 'Remove driveway', onclick: () => { D.splice(i, 1); if (!D.length) D.push({ length: '', width: '' }); paintD(); } }, '✕'))),
      D.length < 50 ? h('button.btn.small.ghost', { type: 'button', onclick: () => { D.push({ length: '', width: '', cracks: '', who: '' }); paintD(); } }, '+ Add a driveway') : null);
    paintOut(r);
  };
  const paintOut = (r = drivewayPrice(D, st)) => {
    const text = `Driveway sealcoating from ${S.company.name}:\n${r.items.map((x, i) => x.price ? `${D[i].who ? D[i].who + ': ' : ''}${num(x.sqft)} sq ft${x.cracks ? ` + ${num(x.cracks)} ft of cracks` : ''} = $${num(x.price)}` : null).filter(Boolean).join('\n')}${S.company.phone ? `\nQuestions or to book: ${S.company.phone}` : ''}`;
    put(dOut, h('dl.kv', ...r.items.map((x, i) => x.price ? kv(D[i].who || `Driveway ${i + 1}`, `$${num(x.price)}${x.minimumApplied ? ' (minimum)' : ''} · ${num(x.sqft)} sq ft`) : null).filter(Boolean), kv('Total', `$${num(r.total)}`), kv('Crew time', `about ${r.hours} hrs`)),
      r.total > 0 ? h('div.row-btns', h('a.btn.small', { href: `sms:?&body=${encodeURIComponent(text)}` }, 'Text the price'), can() ? h('button.btn.small.primary', { type: 'button', onclick: async () => {
        const items = r.items.map((x, i) => x.price ? { label: `Driveway sealcoat${D[i].who ? ' - ' + D[i].who : ''}: ${num(x.sqft)} sq ft${x.cracks ? ` + ${num(x.cracks)} ft crack fill` : ''}`, amount: x.price } : null).filter(Boolean);
        try { const job = await S.store.saveJob({ company_id: S.company.id, title: (D.find(d => d.who)?.who || 'Driveway job').slice(0, 120), status: 'lead', customer: { name: D.length === 1 ? D[0].who || '' : '' }, inputs: { kind: 'driveway', extras: items, crewIds: [] }, price: r.total }); S.jobs.unshift(job); go(`/job/${job.id}/estimate`); toast('Driveway job made. The prices are on the Estimate tab.'); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Make it a job') : null) : null,
      h('p.muted.small', `Your driveway rates: $${st.driveway.pricePerSqft}/sq ft, $${st.driveway.crackPerLf}/ft of cracks, $${st.driveway.minimum} minimum. Change them in Settings > Prices and rates.`));
  };
  paintD();
  const dwCalc = h('section.svc.calc.dw-calc', h('h2.svc-title', 'Driveways (homeowners)'), h('p.muted', 'Price one driveway or a whole street at your homeowner rates.'), dBox, dOut);
  return h('div.page', h('div.page-head', h('h1', 'Calculators')), h('p.lede', 'Quick numbers without starting a job. These use your company\'s rates.'),
    dwCalc,
    h('div.calc-grid',
      calc('Sealcoat and tank mix', [sq, co, tk], () => { const s = { ...st.sealcoat, tankGal: v(tk) || st.sealcoat.tankGal }; const r = sealcoat(v(sq), v(co) || 1, s); const t = tankMix(s); return [h('dl.kv', kv('Mixed material', `${num(r.mixedGal)} gal`), kv('Concentrate', `${num(r.concentrateGal)} gal`), kv('Sand', `${r.materials[1].qty} bags`), kv('Tank loads', num(r.tankLoads, 2)), kv('Per full tank', `${num(t.concentrateGal, 1)} gal sealer + ${num(t.waterGal, 1)} gal water + ${num(t.sandLb)} lb sand + ${num(t.additiveGal, 1)} gal additive`), can() ? kv('Price at your rate', usd(r.price)) : null)]; }),
      calc('Crack filler', [lf, cw, cd], () => { const r = crackFill(v(lf), st.crack, { widthIn: v(cw), depthIn: v(cd) }); return [h('dl.kv', kv('Filler needed', `${num(r.lbs)} lb`), kv('Boxes', `${r.boxes} × ${st.crack.boxLb} lb`), kv('Per box', `about ${num(r.lfPerBox)} ft`), can() ? kv('Material cost', usd(r.materialCost)) : null, can() ? kv('Price at your rate', usd(r.price)) : null)]; }),
      calc('Paint', [pl, pw, pm], () => { const s = { ...st.stripe, lineWidthIn: v(pw) || 4, mils: v(pm) || 15 }; const r = striping({ lines: [{ lf: v(pl), color: 'white' }], adaAuto: false }, s); return [h('dl.kv', kv('Coverage', `${num(r.lfPerGal)} ft per gallon`), kv('Paint needed', `${num(r.paintGal, 2)} gal`), kv('5-gal buckets', String(Math.ceil(r.paintGal / 5))), can() ? kv('Paint cost', usd(r.materialCost)) : null)]; }),
      calc('Stalls in a row', [rl, sw, sd], () => { const n2 = Math.floor((v(rl) + 0.5) / (v(sw) || 9)); return [h('dl.kv', kv('Stalls', String(n2)), kv('Single lines', `${n2 + 1} lines · ${num((n2 + 1) * (v(sd) || 18))} ft`), kv('Double lines', `${2 * (n2 + 1)} lines · ${num(2 * (n2 + 1) * (v(sd) || 18))} ft`))]; }),
      calc('ADA spaces required', [at], () => { const r = adaRequired(v(at)); return [h('dl.kv', kv('Accessible spaces', String(r.accessible)), kv('Van accessible (of those)', String(r.van)), kv('Signs', String(r.accessible))), h('details', h('summary', 'Rules'), h('ul', ADA_NOTES.map(n => h('li', n))))]; })));
}

// ---------------- settings ----------------
const RATE_FORM = [
  ['Weather rules', [['weather.sealMinF', 'Sealcoat needs at least', '°F'], ['weather.sealNightMinF', 'Night after sealing at least', '°F'], ['weather.stripeMinF', 'Striping needs at least', '°F'], ['weather.crackMinF', 'Crack fill needs at least', '°F'], ['weather.rainNoGoPct', 'Call it off at rain chance', '%'], ['weather.rainRiskPct', 'Warn at rain chance', '%'], ['weather.windNoGoMph', 'Warn at wind', 'mph']]],
  ['Driveways (homeowners)', [['driveway.pricePerSqft', 'Driveway price', '$/sq ft'], ['driveway.minimum', 'Minimum per driveway', '$'], ['driveway.crackPerLf', 'Driveway crack fill', '$/ft'], ['driveway.sqftPerHour', 'Crew seals', 'sq ft/hr']]],
  ['Job pricing', [['minimumJob', 'Minimum job price', '$'], ['quoteValidDays', 'Quotes are good for', 'days'], ['invoiceDueDays', 'Invoices due in', 'days'], ['depositPct', 'Usual deposit', '%'], ['quoteNudgeDays', 'Check in on quotes after', 'days'], ['resealYears', 'Remind to reseal after', 'years'], ['taxPct', 'Sales tax', '%'], ['overheadPct', 'Overhead', '%'], ['laborBurdenPct', 'Labor burden (taxes, comp)', '%'], ['equipmentPerHour', 'Equipment + fuel', '$/hr'], ['mobilizationHours', 'Travel + setup per day', 'hrs'], ['hoursPerDay', 'Work day', 'hrs']]],
  ['Sealcoat', [['sealcoat.pricePerSqft', 'Your price', '$/sq ft'], ['sealcoat.coats', 'Default coats', ''], ['sealcoat.sqftPerGalPerCoat', 'Coverage (mixed)', 'sq ft/gal/coat'], ['sealcoat.waterPct', 'Water', '% of sealer'], ['sealcoat.sandLbPerGal', 'Sand', 'lb/gal sealer'], ['sealcoat.additivePct', 'Additive', '% of sealer'], ['sealcoat.concentrateCost', 'Sealer cost', '$/gal'], ['sealcoat.sandBagCost', 'Sand cost', '$/bag'], ['sealcoat.sandBagLb', 'Sand bag size', 'lb'], ['sealcoat.additiveCost', 'Additive cost', '$/gal'], ['sealcoat.tankGal', 'Tank size', 'gal'], ['sealcoat.sqftPerPersonHourPerCoat', 'Production per person', 'sq ft/hr/coat']]],
  ['Crack fill', [['crack.pricePerLf', 'Your price', '$/ft'], ['crack.widthIn', 'Typical width', 'in'], ['crack.depthIn', 'Typical depth', 'in'], ['crack.boxLb', 'Box size', 'lb'], ['crack.boxCost', 'Box cost', '$'], ['crack.wastePct', 'Waste', '%'], ['crack.lfPerPersonHour', 'Production per person', 'ft/hr'], ['crack.meltHours', 'Kettle warm-up', 'hrs/day']]],
  ['Striping', [['stripe.pricePerLf', 'Your price per foot', '$/ft'], ['stripe.pricePerStall', 'Or price per stall (0 = per foot)', '$'], ['stripe.lineWidthIn', 'Line width', 'in'], ['stripe.mils', 'Paint thickness', 'mils'], ['stripe.paintCostPerGal', 'Paint cost', '$/gal'], ['stripe.stallWidth', 'Stall width', 'ft'], ['stripe.stallDepth', 'Stall depth', 'ft'], ['stripe.lfPerPersonHour', 'Production per person', 'ft/hr'], ['stripe.hashSpacingIn', 'Hash line spacing', 'in'], ['stripe.signPrice', 'ADA sign installed', '$'], ['stripe.wheelStopPrice', 'Wheel stop installed', '$']]]
];
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { a[k] = a[k] && typeof a[k] === 'object' ? a[k] : {}; a = a[k]; }); a[ks.at(-1)] = v; };
async function renderSettings(section) {
  const secs = [['company', 'Company'], ['rates', 'Prices and rates'], ['crew', 'Crew and wages'], ['team', 'Team'], ['account', 'Account']].filter(([k]) => boss() || ['account', 'company'].includes(k));
  const nav = h('nav.subnav', secs.map(([k, l]) => h('a', { href: '#/settings/' + k, class: k === section ? 'active' : '' }, l)));
  const c = S.company; const ro = !boss();
  let pendingPatch = {};
  const pushCompany = debounce(async () => { const patch = pendingPatch; pendingPatch = {}; if (!Object.keys(patch).length) return; try { await S.store.updateCompany(c.id, patch); Object.assign(c, patch); toast('Saved.'); } catch (e) { Object.assign(pendingPatch, patch, pendingPatch); toast(e.message, 'bad'); } }, 600);
  const saveCompany = patch => { Object.assign(pendingPatch, patch); pushCompany(); };
  saveCompany.flush = patch => { Object.assign(pendingPatch, patch || {}); return pushCompany.flush(); };
  S.flushCompany = () => pushCompany.flush();
  let body;
  if (section === 'company') {
    const f = (label, key, opts = {}) => { const w = field(label, { ...opts, value: c[key] || '', oninput: e => saveCompany({ [key]: e.target.value.slice(0, key === 'address' ? 200 : 100) }) }); w.input.maxLength = key === 'address' ? 200 : 100; return w; };
    const logo = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Company logo', onchange: async e => { const file = e.target.files[0]; if (!file) return; const url = await shrink(file); saveCompany.flush({ logo: url }); preview.src = url; preview.hidden = false; } });
    const preview = h('img.logo-preview', { src: c.logo || '', alt: 'Logo', hidden: !c.logo });
    body = h('div', { inert: ro ? '' : null }, h('section.svc', h('h2.svc-title', 'Company details'), h('p.muted', 'These show at the top of every quote.'), h('div.grid2', f('Company name', 'name'), f('Phone', 'phone', { type: 'tel' }), f('Email', 'email', { type: 'email' }), f('Website', 'website'), f('Address', 'address', { class: 'span2' }))),
      (() => { // website quote form
        const W = { on: false, rangePct: 15, services: { seal: true, crack: true, stripe: true }, message: '', ...(c.settings?.webForm || {}) }; W.services = { seal: true, crack: true, stripe: true, ...(W.services || {}) };
        const link = `${location.origin}${location.pathname}#/get-quote/${c.id}`;
        const saveW = () => saveCompany({ settings: { ...(c.settings || {}), webForm: { ...W } } });
        const linkBox = h('div.wf-link', h('code', link), h('div.row-btns',
          h('button.btn.small', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied. Put it on your website, Facebook page or Google profile.'); } catch { copyBox('Copy this link', link); } } }, 'Copy link'),
          h('a.btn.small', { href: link, target: '_blank', rel: 'noopener' }, 'See it'),
          h('button.btn.small.ghost', { type: 'button', onclick: async () => { const code = `<a href="${link}" style="display:inline-block;padding:14px 22px;background:#F5B800;color:#23272B;font:700 18px sans-serif;border-radius:10px;text-decoration:none">Get an instant parking lot quote</a>`; try { await navigator.clipboard.writeText(code); toast('Button code copied. Paste it into your website builder.'); } catch { copyBox('Copy this code', code); } } }, 'Copy website button')));
        const body2 = h('div', { hidden: !W.on }, linkBox,
          field('Price range shown', { type: 'number', value: W.rangePct, suffix: '±%', help: 'Customers see your estimate minus/plus this much.', oninput: e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 50) { W.rangePct = v; saveW(); } } }),
          h('div.wf-svcs', toggle('Offer sealcoating', W.services.seal, v => { W.services.seal = v; saveW(); }), toggle('Offer crack filling', W.services.crack, v => { W.services.crack = v; saveW(); }), toggle('Offer line striping', W.services.stripe, v => { W.services.stripe = v; saveW(); })),
          field('Message at the top (optional)', { type: 'textarea', rows: 2, value: W.message, placeholder: 'Booking spring 2027 now. Free on-site look before every job.', oninput: e => { W.message = e.target.value.slice(0, 500); saveW(); } }));
        return h('section.svc', h('h2.svc-title', 'Website quote form'), h('p.muted', 'A page where customers outline their own lot and get a price range on the spot. Each request lands here as a new lead. Your rates stay private: they only ever see the range.'),
          toggle('Take quote requests online', W.on, v => { W.on = v; body2.hidden = !v; saveW(); }), body2);
      })(),
      (() => { // how customers pay you
        const P = { ...(c.settings?.payments || {}) };
        const savP = () => saveCompany({ settings: { ...(c.settings || {}), payments: { ...P } } });
        const pf = (label, key, opts = {}) => { const w = field(label, { ...opts, value: P[key] || '', oninput: e => { const v = e.target.value.slice(0, 160); if (key === 'link' && v && !/^https:\/\/\S+$/.test(v.trim())) { w.classList.add('bad'); return; } w.classList.remove('bad'); P[key] = v; savP(); } }); w.input.maxLength = 160; return w; };
        return h('section.svc', h('h2.svc-title', 'How customers pay you'), h('p.muted', 'Shows on every invoice (printed, texted and emailed). Fill in the ones you use.'),
          h('div.grid2', pf('Online payment link', 'link', { type: 'url', placeholder: 'https://buy.stripe.com/… or Square/PayPal link', help: 'From Stripe, Square or PayPal. Must start with https://' }), pf('Venmo', 'venmo', { placeholder: '@Rutherford-Paving' }), pf('Zelle', 'zelle', { placeholder: 'Phone or email' }), pf('Cash App', 'cashapp', { placeholder: '$rutherfordpaving' }), pf('Mail checks to', 'checksTo', { placeholder: 'Rutherford Paving, PO Box…', class: 'span2' })),
          pf('Note on invoices (optional)', 'note', { placeholder: 'Thank you! 3% fee on card payments.' }));
      })(),
      h('section.svc', h('h2.svc-title', 'Google reviews'), h('p.muted', 'Paste the link customers use to review you on Google. Follow-ups send it after each job. (Google Business Profile > Ask for reviews > copy link.)'),
        (() => { const w = field('Review link', { type: 'url', value: c.settings?.reviewLink || '', placeholder: 'https://g.page/r/…/review', oninput: e => { const v = e.target.value.trim().slice(0, 300); if (v && !/^https:\/\/\S+$/.test(v)) { w.classList.add('bad'); return; } w.classList.remove('bad'); saveCompany({ settings: { ...(c.settings || {}), reviewLink: v } }); } }); return w; })()),
      h('section.svc', h('h2.svc-title', 'Logo'), preview, h('label.btn.ghost.file-btn', logo, 'Upload logo')),
      h('section.svc', h('h2.svc-title', 'Quote terms'), field('One term per line', { type: 'textarea', rows: 7, value: c.settings?.terms || DEFAULT_TERMS, oninput: e => saveCompany({ settings: { ...(c.settings || {}), terms: e.target.value } }) })));
  } else if (section === 'rates') {
    const cur = settings(); const custom = structuredClone(c.settings || {});
    body = h('div', await learnBox(custom, saveCompany), RATE_FORM.map(([title, rows]) => h('section.svc', h('h2.svc-title', title), h('div.grid3', rows.map(([path, label, unit]) => field(label, { type: 'number', value: getPath(cur, path), suffix: unit, oninput: e => { if (e.target.value === '') return; setPath(custom, path, Number(e.target.value)); saveCompany({ settings: custom }); } }))))),
      h('section.svc', h('h2.svc-title', 'Stencil prices'), h('div.grid4', STENCILS.map(k => field(cur.stripe.stencils[k].label, { type: 'number', value: cur.stripe.stencils[k].price, suffix: '$', oninput: e => { setPath(custom, `stripe.stencils.${k}.price`, Number(e.target.value) || 0); saveCompany({ settings: custom }); } })))),
      h('button.btn.ghost', { type: 'button', onclick: async () => { if (await confirmBox('Reset prices and rates?', 'Every rate goes back to the LotBoss default. Your quote terms stay.', 'Reset')) { const keep = { terms: c.settings?.terms }; await S.store.updateCompany(c.id, { settings: keep }); c.settings = keep; route(); } } }, 'Reset to defaults'));
  } else if (section === 'crew') {
    S.crew = await S.store.listCrew(c.id);
    const list = h('div.crew-list', S.crew.length ? S.crew.map(m => h('div.crew-row', h('div', h('strong', m.name), h('span.muted', [m.role, m.phone, m.user_id ? 'has login' : null, (() => { const o = cleanOff(m.time_off).find(x => x.to >= localDay()); return o ? `off ${dateStr(o.from)}${o.to !== o.from ? ' to ' + dateStr(o.to) : ''}` : null; })()].filter(Boolean).join(' · '))), h('span', `${usd(m.wage)}/hr`), h('button.btn.small.ghost', { type: 'button', onclick: () => editCrew(m) }, 'Edit'))) : h('p.muted', 'No crew yet. Add everyone who works jobs, with their hourly wage, so job costs are real.'));
    body = h('div', h('section.svc', h('h2.svc-title', 'Crew and wages'), h('p.muted', 'Only owners, admins and estimators can see wages.'), list, h('button.btn.primary', { type: 'button', onclick: () => editCrew({}) }, 'Add crew member')));
  } else if (section === 'team') {
    const [members, invites] = await Promise.all([S.store.listMembers(c.id), S.store.listInvites(c.id).catch(() => [])]);
    const me = S.session.user.id;
    body = h('div', h('section.svc', h('h2.svc-title', 'People who can sign in'), h('div.crew-list', members.map(m => h('div.crew-row', h('div', h('strong', m.name || (m.user_id === me ? 'You' : 'Team member')), h('span.muted', roleName(m.role))),
      m.role !== 'owner' && m.user_id !== me ? h('select', { 'aria-label': 'Role', onchange: async e => { try { await S.store.setMemberRole(c.id, m.user_id, e.target.value); toast('Role changed.'); } catch (ex) { toast(ex.message, 'bad'); } } }, ['admin', 'estimator', 'crew'].map(r => h('option', { value: r, selected: r === m.role }, roleName(r)))) : h('span'),
      m.role !== 'owner' && m.user_id !== me ? h('button.btn.small.ghost.danger', { type: 'button', onclick: async () => { if (await confirmBox('Remove from company?', 'They lose access right away.', 'Remove')) { await S.store.removeMember(c.id, m.user_id); route(); } } }, 'Remove') : h('span'))))),
      h('section.svc', h('h2.svc-title', 'Invite someone'), h('p.muted', 'Estimators can measure, price and quote. Crew can see jobs and the schedule, but not wages or profit. Admins can do everything but delete the company.'),
        h('div.row-btns', ['estimator', 'crew', 'admin'].map(r => h('button.btn', { type: 'button', onclick: async () => { try { const code = await S.store.createInvite(c.id, r); await modal('Invite code', h('div', h('p.big-code', code), h('p', `Send this to your ${roleName(r).toLowerCase()}. They create an account, tap "Join with an invite code" and type it. Works once, for 14 days.`)), [{ label: 'Done', kind: 'primary', result: true }]); route(); } catch (e) { toast(e.message, 'bad'); } } }, `Invite ${roleName(r).toLowerCase()}`))),
        invites.length ? h('ul.codes', invites.map(i => h('li', h('code', i.code), ` ${roleName(i.role)} · expires ${dateStr(i.expires_at)}`))) : null));
  } else {
    body = h('div', h('section.svc', h('h2.svc-title', 'Your account'), h('p', S.session.user.email), S.store.kind === 'demo' ? h('p.note', 'You\'re in demo mode. Nothing leaves this device.') : null,
      h('div.row-btns', S.store.kind === 'cloud' ? h('button.btn', { type: 'button', onclick: newPasswordPrompt }, 'Change password') : null, h('button.btn', { type: 'button', onclick: () => go('/companies') }, 'Switch company'), h('button.btn.danger.ghost', { type: 'button', onclick: signOut }, S.store.kind === 'demo' ? 'Leave demo' : 'Sign out'))));
  }
  return h('div.page', h('div.page-head', h('h1', 'Settings')), nav, body);
}
async function editCrew(m) {
  const n = field('Name', { value: m.name || '' }), r = field('Role', { value: m.role || '', placeholder: 'Foreman, laborer…' }), w = field('Hourly wage', { type: 'number', value: m.wage ?? '', suffix: '$/hr' }), p = field('Cell phone', { type: 'tel', value: m.phone || '', help: 'Used for texting schedules.' });
  const act = toggle('Works jobs right now', m.active !== false, () => {});
  // link a login so they see "My jobs"; days off so nobody books them by accident
  const members = await S.store.listMembers(S.company.id).catch(() => []);
  const taken = new Set(S.crew.filter(x => x.id !== m.id && x.user_id).map(x => x.user_id));
  const login = field('Login', { type: 'select', value: m.user_id || '', help: 'Link their LotBoss login so they see just their own jobs.', options: [{ value: '', label: 'Not linked' }, ...members.filter(x => !taken.has(x.user_id)).map(x => ({ value: x.user_id, label: `${x.name || 'Unnamed'} (${x.role})${x.user_id === S.session?.user?.id ? ' · you' : ''}` }))] });
  const off = cleanOff(m.time_off);
  const offBox = h('div.off-list');
  const paintOff = () => put(offBox, off.map((o, i) => h('div.off-row',
    field('From', { type: 'date', value: o.from, onchange: e => { o.from = e.target.value; if (!o.to || o.to < o.from) { o.to = o.from; paintOff(); } } }),
    field('To', { type: 'date', value: o.to, onchange: e => { o.to = e.target.value; } }),
    field('Why (optional)', { value: o.note, placeholder: 'Vacation', oninput: e => { o.note = e.target.value.slice(0, 80); } }),
    h('button.icon-btn.small', { type: 'button', 'aria-label': 'Remove days off', onclick: () => { off.splice(i, 1); paintOff(); } }, '✕'))),
    off.length < 50 ? h('button.btn.small.ghost', { type: 'button', onclick: () => { const d = localDay(); off.push({ from: d, to: d, note: '' }); paintOff(); } }, '+ Add days off') : null);
  paintOff();
  const calBtn = m.id && boss() ? h('button.btn.small', { type: 'button', onclick: () => { const g = reset => S.store.calendarLink(S.company.id, m.id, reset); g.reset = true; calendarModal(`${m.name}'s calendar`, g, p.input.value || m.phone, m.name); } }, 'Calendar link') : null;
  const res = await modal(m.id ? 'Edit crew member' : 'Add crew member', h('div.form-grid', n, r, w, p, act, login, h('h3.sub', 'Days off'), offBox, calBtn), [
    ...(m.id ? [{ label: 'Delete', kind: 'danger ghost', value: async () => { if (await confirmBox('Delete crew member?', `${m.name} will be removed.`)) { await S.store.deleteCrew(m.id); return 'deleted'; } return false; } }] : []),
    { label: 'Cancel', result: null }, { label: 'Save', kind: 'primary', value: async () => { if (!n.input.value.trim()) { toast('Add a name.', 'warn'); return false; } try { await S.store.saveCrew({ ...(m.id ? { id: m.id } : {}), company_id: S.company.id, name: n.input.value.trim(), role: r.input.value.trim() || null, wage: Number(w.input.value) || 0, phone: p.input.value.trim() || null, active: act.input.checked, user_id: login.input.value || null, time_off: cleanOff(off) }); return 'saved'; } catch (e) { toast(e.message, 'bad'); return false; } } }]);
  if (res) { S.crew = await S.store.listCrew(S.company.id); route(); }
}
function shrink(file, max = 360) {
  return new Promise(res => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = h('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) }); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); res(cv.toDataURL('image/png')); URL.revokeObjectURL(img.src); }; img.src = URL.createObjectURL(file); });
}

boot();
