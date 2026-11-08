// Tries to break the app. Usage: node test/abuse.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });

// fake 16-day forecast: today good, +1 rain, +2 cold, +3 good, +4 windy, rest good
function fakeForecast() {
  const pad = n => String(n).padStart(2, '0'); const time = [], hi = [], lo = [], rain = [], wind = [], code = [];
  for (let i = 0; i < 16; i++) { const d = new Date(); d.setDate(d.getDate() + i); time.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    hi.push(i === 2 ? 44 : 66); lo.push(i === 2 ? 30 : 47); rain.push(i === 1 ? 80 : 10); wind.push(i === 4 ? 31 : 8); code.push(i === 1 ? 63 : 1); }
  return JSON.stringify({ daily: { time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_probability_max: rain, precipitation_sum: rain.map(r => r > 50 ? 0.4 : 0), wind_speed_10m_max: wind, weather_code: code } });
}
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4180/';

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap/, r => r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(root, 'icon-192.png')) }));
  await ctx.route(/nominatim/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route(/fonts\.(googleapis|gstatic)|supabase\.co/, r => r.abort());
    await ctx.route(/api\.open-meteo\.com/, r => r.fulfill({ status: 200, contentType: 'application/json', body: fakeForecast() }));
  const page = await ctx.newPage();
  page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss(); });
  return { ctx, page };
}
const demo = async page => { await page.goto(URL0); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card'); };
const wide = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')));

(async () => {
  await new Promise(r => server.listen(4180, r));
  const browser = await chromium.launch();

  console.log('\nhostile text');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    const evil = `<img src=x onerror="alert('xss')"><script>alert(1)</script>${'Q'.repeat(300)}`;
    await page.click('.page-head >> text=New job');
    await page.fill('.sheet input >> nth=0', evil); await page.fill('.sheet input >> nth=1', '"; DROP TABLE jobs; --'); await page.fill('.sheet input >> nth=2', '🚗💨 Jöhn O\'Brien & Sons <b>bold</b>');
    await page.click('text=Create job'); await page.waitForSelector('.leaflet-container');
    expect(page.dialogs.length === 0, 'no script ran from a job name (XSS blocked)');
    expect(!(await wide(page)), '300-character job name does not stretch the page');
    await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote');
    expect((await page.textContent('.quote')).includes("Jöhn O'Brien & Sons <b>bold</b>"), 'quote shows special characters literally');
    expect(page.dialogs.length === 0 && page.errors.length === 0, 'no errors or scripts on quote');
    await page.screenshot({ path: `${out}/abuse-evil-quote.png` });
    await ctx.close(); }

  console.log('\nfast typing then leaving the page');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.job-card >> text=First Baptist'); await page.click('.tabs >> text=Estimate'); await page.waitForSelector('.est-form');
    const crack = page.locator('.svc:has-text("Crack filling") input[type=number]').first();
    await crack.fill('7777');
    await page.click('.nav >> text=Jobs'); // leave immediately
    await page.click('.job-card >> text=Red Lobster'); // open a different job right away
    await page.waitForTimeout(1500);
    let db = await state(page);
    const fb = db.jobs.find(j => j.title === 'First Baptist Church');
    expect(fb.inputs.crack.lf === 7777, `edit survives leaving within a second (saved lf=${fb.inputs.crack.lf})`);
    // same job, reload right after typing
    await page.click('.tabs >> text=Details'); await page.fill('.details-tab textarea', 'gate code 4411');
    await page.reload(); await page.waitForSelector('.details-tab, .job-card, .auth');
    db = await state(page);
    expect(db.jobs.find(j => j.title.startsWith('Red Lobster')).notes === 'gate code 4411', 'note survives an instant reload');
    await ctx.close(); }

  console.log('\nbad links and deleted jobs');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    for (const h of ['#/job/not-a-real-id/map', '#/job/', '#/garbage/stuff', '#/settings/nope', '#/job/x/y/z/w']) {
      await page.goto(URL0 + h); await page.waitForTimeout(400);
      const txt = await page.textContent('body');
      expect(page.errors.length === 0 && !/Loading LotBoss/.test(txt) && txt.length > 50, `bad link ${h} shows a usable screen`);
    }
    await page.goto(URL0 + '#/jobs'); await page.click('.job-card >> text=First Baptist'); await page.click('.tabs >> text=Details');
    await page.click('text=Delete job'); await page.click('.sheet-actions >> text=Delete'); await page.waitForSelector('.page-head >> text=Jobs');
    await page.goBack(); await page.waitForTimeout(500);
    expect(page.errors.length === 0 && /Something went wrong|not found|Jobs|isn't here/i.test(await page.textContent('body')), 'back button to a deleted job does not crash');
    await page.screenshot({ path: `${out}/abuse-deleted-job.png` });
    await ctx.close(); }

  console.log('\ndouble taps');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote');
    const btn = page.locator('.quote-actions .btn.primary');
    for (let i = 0; i < 3; i++) { await btn.click(); await page.waitForTimeout(250); }
    await page.waitForTimeout(500);
    const db = await state(page);
    const mine = db.quotes.filter(q => db.jobs.find(j => j.id === q.job_id)?.title.startsWith('Red Lobster'));
    expect(mine.length === 1, `repeated Save quote with no changes makes 1 quote (made ${mine.length})`);
    await page.click('.nav >> text=Jobs'); const nb = page.locator('.page-head >> text=New job');
    await nb.click(); await page.click('.sheet >> text=Cancel');
    expect((await page.$$('.scrim')).length === 0, 'sheet closes cleanly');
    await ctx.close(); }

  console.log('\nstorage blocked / corrupted');
  { const { ctx, page } = await newCtx(browser);
    await page.addInitScript(() => { localStorage.setItem('lotcalc-demo', '{not json!!'); });
    await page.goto(URL0); await page.waitForTimeout(500);
    expect(page.errors.length === 0 && await page.isVisible('.auth'), 'corrupted saved data still opens the app');
    await ctx.close(); }
  { const { ctx, page } = await newCtx(browser);
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError: storage blocked'); } }); });
    await page.goto(URL0); await page.waitForTimeout(800);
    expect(await page.isVisible('.auth'), 'private browsing / blocked storage still shows sign-in (errors: ' + page.errors.slice(0, 1).join() + ')');
    if (await page.isVisible('.auth')) { await page.click('text=Try the demo, no account needed'); await page.waitForTimeout(800); expect(await page.isVisible('.job-card'), 'demo works with storage blocked'); }
    await ctx.close(); }

  console.log('\nbig data: 500 jobs, 1000 shapes');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('lotcalc-demo')); const cid = db.companies[0].id; const base = db.jobs[0];
      for (let i = 0; i < 500; i++) db.jobs.push({ ...structuredClone(base), id: 'bulk-' + i, title: `Bulk lot ${i}`, address: `${i} Main St`, status: ['lead', 'quoted', 'won', 'scheduled', 'done'][i % 5], price: 1000 + i, updated_at: new Date(Date.now() - i * 1e6).toISOString(), company_id: cid });
      const big = db.jobs.find(j => j.id === 'bulk-0'); const f0 = big.drawing.features.find(f => f.properties.kind === 'crack');
      for (let i = 0; i < 1000; i++) big.drawing.features.push({ type: 'Feature', properties: { kind: 'crack' }, geometry: { type: 'LineString', coordinates: f0.geometry.coordinates.map(([x, y]) => [x + (i % 40) * 0.00003, y + Math.floor(i / 40) * 0.00002]) } });
      localStorage.setItem('lotcalc-demo', JSON.stringify(db));
    });
    let t = Date.now(); await page.reload(); await page.waitForSelector('.job-card'); const load = Date.now() - t;
    expect(load < 3000, `500 jobs: list opens in ${load} ms`);
    t = Date.now(); await page.fill('.search', 'Bulk lot 49'); await page.waitForTimeout(300); const n = (await page.$$('.job-card')).length;
    expect(n >= 1 && n <= 11, `search narrows 502 jobs to ${n}`);
    await page.click('.chip >> text=All'); t = Date.now(); await page.fill('.search', ''); await page.waitForTimeout(250);
    expect((await page.$$('.job-card')).length > 400, 'All filter shows hundreds of jobs');
    await page.fill('.search', 'Bulk lot 0'); await page.waitForTimeout(250);
    t = Date.now(); await page.click('.job-card >> text="Bulk lot 0"'); await page.waitForSelector('.leaflet-container'); await page.waitForTimeout(300); const mapMs = Date.now() - t;
    expect(mapMs < 4000, `job with 1000+ shapes opens map in ${mapMs} ms`);
    t = Date.now(); await page.click('.tabs >> text=Estimate'); await page.waitForSelector('.est-out .money'); const estMs = Date.now() - t;
    expect(estMs < 3000, `estimate with 1000+ shapes in ${estMs} ms`);
    const crack = page.locator('.svc:has-text("Crack filling") input[type=number]').nth(1);
    t = Date.now(); for (const ch of '0.75') await crack.press(ch === '.' ? 'Period' : ch); const typeMs = Date.now() - t;
    expect(typeMs < 2500, `typing stays snappy with 1000 shapes (${typeMs} ms for 4 keys)`);
    expect(page.errors.length === 0, 'no errors with big data');
    await ctx.close(); }

  console.log('\ncrew member view');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('lotcalc-demo')); db.members[0].role = 'crew'; localStorage.setItem('lotcalc-demo', JSON.stringify(db)); });
    await page.reload(); await page.waitForSelector('.job-card');
    expect(!(await page.isVisible('.page-head >> text=New job')), 'crew cannot start jobs');
    await page.click('.job-card >> text=Red Lobster'); await page.waitForSelector('.leaflet-container');
    const tb = await page.textContent('.total-bar');
    expect(!/Profit|Loss/.test(tb), 'crew does not see profit in the total bar');
    expect(await page.isDisabled('.tool >> text=Crack'), 'crew cannot draw');
    await page.click('.tabs >> text=Estimate'); await page.waitForSelector('.est-out');
    const est = await page.textContent('.est-out');
    expect(!/Break-even|Profit|Labor|\$\/hr|wage/i.test(est), 'crew does not see wages, labor or profit on estimate');
    await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote');
    expect(!(await page.isVisible('text=Save quote')), 'crew cannot save quotes');
    await page.click('.nav >> text=Settings'); await page.waitForSelector('.subnav');
    expect(!(await page.isVisible('.subnav >> text=Crew and wages')), 'crew has no wage settings');
    expect(!(await page.isVisible('.subnav >> text=Prices and rates')), 'crew has no price settings');
    await page.click('.nav >> text=Calculators'); await page.waitForSelector('.calc');
    expect(!/Price at your rate|Material cost|Paint cost/.test(await page.textContent('.calc-grid')), 'crew calculators hide your prices and costs');
    await page.screenshot({ path: `${out}/abuse-crew.png` });
    await ctx.close(); }

  console.log('\nkeyboard only (desktop)');
  { const { ctx, page } = await newCtx(browser, { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
    await page.goto(URL0); await page.waitForSelector('.auth');
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement.textContent || document.activeElement.tagName);
    expect(/Skip/.test(first), 'first Tab lands on "Skip to content"');
    await page.focus('input[type=email]'); await page.keyboard.type('x@y.z'); await page.keyboard.press('Tab'); await page.keyboard.type('short'); await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    expect(ring !== 'none', 'keyboard focus is visible');
    await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card');
    await page.click('.page-head >> text=New job'); await page.keyboard.press('Escape');
    expect((await page.$$('.scrim')).length === 0, 'Escape closes a sheet');
    const focusable = await page.evaluate(() => [...document.querySelectorAll('a,button,input,select,textarea')].filter(e => e.offsetParent && !e.labels?.length && !e.getAttribute('aria-label') && !(e.textContent || '').trim() && e.type !== 'hidden').map(e => e.outerHTML.slice(0, 80)));
    expect(focusable.length === 0, 'every control has a label: ' + focusable.slice(0, 3).join(' | '));
    await ctx.close(); }

  console.log('\nprinting the quote');
  { const { ctx, page } = await newCtx(browser, { viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 }); await demo(page);
    await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote');
    await page.emulateMedia({ media: 'print' });
    const visible = await page.evaluate(() => ['.topbar', '.nav', '.tabs', '.total-bar', '.quote-actions'].filter(s => { const e = document.querySelector(s); return e && getComputedStyle(e).display !== 'none'; }));
    expect(visible.length === 0, 'print hides app chrome: ' + visible.join(','));
    await page.pdf({ path: `${out}/abuse-quote.pdf`, format: 'Letter', printBackground: true });
    const pdfSize = fs.statSync(`${out}/abuse-quote.pdf`).size;
    expect(pdfSize > 5000, `quote prints to PDF (${Math.round(pdfSize / 1024)} KB)`);
    await page.screenshot({ path: `${out}/abuse-print.png`, fullPage: true });
    await ctx.close(); }

  console.log('\ntiny phone + dark mode + big text');
  { const { ctx, page } = await newCtx(browser, { viewport: { width: 320, height: 640 }, colorScheme: 'dark' }); await demo(page);
    for (const [label, go] of [['jobs', null], ['job map', '.job-card >> text=Red Lobster'], ['estimate', '.tabs >> text=Estimate'], ['quote', '.tabs >> text=Quote'], ['details', '.tabs >> text=Details'], ['schedule', '.nav >> text=Schedule'], ['calculators', '.nav >> text=Calculators'], ['settings', '.nav >> text=Settings']]) {
      if (go) { await page.click(go); await page.waitForTimeout(350); }
      expect(!(await wide(page)), `320px phone, dark: ${label} fits`);
      await page.screenshot({ path: `${out}/abuse-320-dark-${label.replace(' ', '-')}.png` });
    }
    await page.evaluate(() => document.documentElement.style.fontSize = '150%');
    await page.click('.nav >> text=Jobs'); await page.waitForTimeout(300);
    expect(!(await wide(page)), 'large text setting (150%) still fits');
    await ctx.close(); }

  console.log('\nestimate edge cases in the UI');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.job-card >> text=First Baptist'); await page.click('.tabs >> text=Estimate'); await page.waitForSelector('.est-form');
    const disc = page.locator('.svc:has-text("Extra items") input[type=number]').last();
    await disc.fill('150'); await page.waitForTimeout(150);
    const tot = await page.textContent('.tb-total');
    expect(!/-/.test(tot), `150% discount does not go negative (${tot})`);
    await disc.fill('');
    await page.click('.svc .toggle >> text=Crack filling'); await page.waitForTimeout(150);
    expect((await page.textContent('.tb-total')).trim() === '$0', 'all services off = $0');
    await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote');
    expect(await page.isDisabled('text=Save quote'), 'cannot save a $0 quote');
    await ctx.close(); }

  console.log('\nback button through tabs');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.job-card >> text=Red Lobster'); for (const t of ['Estimate', 'Quote', 'Details']) await page.click(`.tabs >> text=${t}`);
    await page.goBack(); await page.waitForTimeout(300); const a = await page.textContent('.tabs a.active');
    expect(a === 'Quote', `back goes to the previous tab (${a})`);
    expect(page.errors.length === 0, 'no errors going back');
    await ctx.close(); }


  console.log('\nsettings typed fast');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.nav >> text=Settings'); await page.waitForSelector('.svc-title >> text=Company details');
    const inputs = page.locator('.svc:has-text("Company details") input');
    await inputs.nth(0).fill('Fast Typer Paving'); await inputs.nth(1).fill('740-555-9999'); await inputs.nth(2).fill('fast@example.com');
    await page.click('.nav >> text=Jobs'); await page.waitForTimeout(900);
    const c = (await state(page)).companies[0];
    expect(c.name === 'Fast Typer Paving' && c.phone === '740-555-9999' && c.email === 'fast@example.com', `3 quick settings edits all saved (${c.name} / ${c.phone} / ${c.email})`);
    await ctx.close(); }

  console.log('\ntwo people editing the same job');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Details'); await page.waitForSelector('.details-tab');
    const id = await page.evaluate(() => location.hash.split('/')[2]);
    await page.evaluate(id => window.__lc.store._otherUserEdits(id, { notes: 'office changed this' }), id);
    await page.fill('.details-tab textarea', 'my field note');
    await page.waitForSelector('text=Someone else changed this job', { timeout: 4000 }).catch(() => {});
    expect(await page.isVisible('text=Someone else changed this job'), 'warns when someone else saved the job first');
    await page.click('.sheet-actions >> text=Keep mine'); await page.waitForTimeout(800);
    let j = (await state(page)).jobs.find(x => x.id === id);
    expect(j.notes === 'my field note', 'Keep mine saves your version');
    await page.fill('.details-tab textarea', 'second edit'); await page.waitForTimeout(1000);
    await page.fill('.details-tab textarea', 'third edit'); await page.waitForTimeout(1000);
    j = (await state(page)).jobs.find(x => x.id === id);
    expect(j.notes === 'third edit' && !(await page.isVisible('text=Someone else changed this job')), 'your own back-to-back saves never conflict');
    await ctx.close(); }

  console.log('\nno signal on the job site');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Details');
    await page.evaluate(() => { window.__lcOffline = true; });
    await page.fill('.details-tab textarea', 'measured with no bars');
    await page.waitForTimeout(1200);
    expect((await page.textContent('#saved')) === 'Not saved', 'shows Not saved when there is no signal');
    expect(/kept on this phone/.test(await page.textContent('#toast')), 'tells you the changes are kept on the phone');
    await page.reload(); await page.waitForTimeout(800);
    expect(await page.isVisible('text=Unsaved changes found'), 'after closing the app, offers to restore unsaved changes');
    await page.click('.sheet-actions >> text=Restore my changes'); await page.waitForTimeout(900);
    expect((await page.inputValue('.details-tab textarea')) === 'measured with no bars', 'restored text is back on screen');
    const j = (await state(page)).jobs.find(x => x.title.startsWith('Red Lobster'));
    expect(j.notes === 'measured with no bars', 'and it saved once signal came back');
    await ctx.close(); }


  console.log('\nphotos: huge, many, fake, crew');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.job-card >> text=First Baptist'); await page.click('.tabs >> text=Photos'); await page.waitForSelector('.photos-tab');
    const big = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 4032; c.height = 3024; const g = c.getContext('2d'); for (let i = 0; i < 300; i++) { g.fillStyle = `hsl(${i},60%,${30 + i % 40}%)`; g.fillRect(Math.random() * 4032, Math.random() * 3024, 400, 300); } const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95)); return Array.from(new Uint8Array(await b.arrayBuffer())); });
    const t0 = Date.now();
    await page.setInputFiles('.photos-tab input[multiple]', [{ name: 'IMG_4032.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(big) }]);
    await page.waitForSelector('.photo-thumb', { timeout: 15000 });
    expect(true, `12-megapixel photo (${Math.round(big.length / 1024)} KB) added in ${Date.now() - t0} ms`);
    const db1 = await state(page); const ph = db1.photos[0];
    expect(Math.max(ph.width, ph.height) <= 640 && ph.data.length < 200000, `demo keeps a small copy (${ph.width}x${ph.height}, ${Math.round(ph.data.length / 1024)} KB)`);
    await page.setInputFiles('.photos-tab input[multiple]', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
    await page.waitForTimeout(400);
    expect((await page.$$('.photo-thumb')).length === 1 && page.errors.length === 0, 'a text file is ignored, no crash');
    await page.setInputFiles('.photos-tab input[multiple]', [{ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a jpeg') }]);
    await page.waitForTimeout(800);
    expect(/didn't upload/.test(await page.textContent('.photo-status')) && page.errors.length === 0, 'a broken picture shows a clear message: ' + await page.textContent('.photo-status'));
    const icon = fs.readFileSync(path.join(root, 'icon-192.png'));
    await page.setInputFiles('.photos-tab input[multiple]', Array.from({ length: 8 }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: icon })));
    await page.waitForFunction(() => document.querySelectorAll('.photo-thumb').length === 9, null, { timeout: 15000 }).catch(() => {});
    expect((await page.$$('.photo-thumb')).length === 9, '8 photos at once all added');
    expect(!(await wide(page)), 'photo grid fits the phone');
    await page.screenshot({ path: `${out}/abuse-photos.png` });
    // crew: can add, can't delete someone else's
    await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('lotcalc-demo')); db.members[0].role = 'crew'; db.photos.forEach(p => p.created_by = 'someone-else'); localStorage.setItem('lotcalc-demo', JSON.stringify(db)); });
    await page.reload(); await page.waitForSelector('.photo-thumb');
    await page.click('.photo-thumb >> nth=0');
    expect(!(await page.isVisible('.sheet-actions >> text=Delete')), "crew can't delete someone else's photo");
    await page.click('.sheet-actions >> text=Close');
    expect(await page.isVisible('text=Take a photo'), 'crew can still take photos');
    await page.click('.nav >> text=Jobs'); await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Details'); await page.waitForSelector('.wx-day');
    expect(await page.isDisabled('.wx-day >> nth=0'), "crew can't reschedule by tapping the forecast");
    await ctx.close(); }

  console.log('\nweather edge cases');
  { const { ctx, page } = await newCtx(browser);
    await ctx.unroute(/api\.open-meteo\.com/); await ctx.route(/api\.open-meteo\.com/, r => r.abort());
    await demo(page); await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Details');
    await page.waitForTimeout(800);
    expect(/Forecast unavailable/.test(await page.textContent('.wx-box')) && page.errors.length === 0, 'no signal: says the forecast is unavailable');
    await page.click('.nav >> text=Jobs'); await page.click('.page-head >> text=New job'); await page.fill('.sheet input >> nth=0', 'No address yet'); await page.click('text=Create job');
    await page.waitForSelector('.leaflet-container'); await page.click('.tabs >> text=Details'); await page.waitForTimeout(500);
    expect(/Find the lot on the map/.test(await page.textContent('.wx-box')), 'job with no location explains how to get weather');
    await ctx.close(); }


  console.log('\ncustomer links: old, fake, expired, declined');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote');
    await page.click('.quote-actions .btn.primary'); await page.waitForSelector('.link-box');
    const oldLink = await page.inputValue('.link-box');
    await page.click('.opt-section .toggle'); await page.waitForSelector('.opt-card');
    await page.click('.quote-actions .btn.primary'); await page.waitForTimeout(600);
    const newLink = await page.inputValue('.link-box');
    expect(oldLink !== newLink, 'new quote gets a new link');
    const c = await ctx.newPage(); c.on('pageerror', e => page.errors.push(e.message));
    await c.goto(oldLink); await c.waitForSelector('.pq-state');
    expect(/newer version/.test(await c.textContent('.pq-state')), 'old link says there is a newer quote');
    await c.click('text=Open the latest quote'); await c.waitForSelector('.pq-sign');
    expect((await c.$$('.q-opt')).length === 3, 'and opens the newest one');
    await c.goto(URL0 + '#/q/0123456789abcdef0123456789abcdef0123'); await c.waitForSelector('.pq-state');
    expect(/isn't working/.test(await c.textContent('.pq-state')), 'made-up link: clear message');
    await c.goto(URL0 + '#/q/<img src=x onerror=alert(1)>'); await c.waitForTimeout(500);
    expect(page.dialogs.length === 0 && c.url().length > 0, 'junk link: no script runs');
    // decline
    await c.goto(newLink); await c.waitForSelector('.pq-sign');
    await c.click('text=Decline this quote'); await c.fill('.sheet textarea', '<b>too</b> pricey'); await c.click('.sheet-actions >> text=Decline quote');
    await c.waitForSelector('.pq-done');
    expect(/declined/.test(await c.textContent('.pq-done')), 'customer can decline');
    await page.click('.tabs >> text=Map'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.qlist');
    expect(/Declined/.test(await page.textContent('.qlist')) && /"<b>too<\/b> pricey"/.test(await page.textContent('.qlist')), 'you see the decline and the reason (as plain text)');
    // expired
    await page.click('.quote-actions .btn.primary'); await page.waitForTimeout(600);
    const exp = await page.inputValue('.link-box');
        await c.evaluate(() => { const db = JSON.parse(localStorage.getItem('lotcalc-demo')); db.quotes.at(-1).expires_at = '2020-01-01T00:00:00.000Z'; localStorage.setItem('lotcalc-demo', JSON.stringify(db)); });
    await c.goto(URL0 + '#/jobs'); await c.goto(exp); await c.reload(); await c.waitForSelector('.pq-done');
    expect(/expired/.test(await c.textContent('.pq-done')), 'expired quote cannot be signed');
    // hostile signer name
    await c.evaluate(() => { const db = JSON.parse(localStorage.getItem('lotcalc-demo')); db.quotes.at(-1).expires_at = '2099-01-01T00:00:00.000Z'; localStorage.setItem('lotcalc-demo', JSON.stringify(db)); });
    await c.reload(); await c.waitForSelector('.pq-sign');
    await c.fill('.pq-sign input[autocomplete=name]', '<script>alert("x")</script> Bobby');
    const pad = await c.locator('.sig-pad').boundingBox();
    const ev = (type, x, y) => c.dispatchEvent('.sig-pad', type, { clientX: pad.x + x, clientY: pad.y + y, pointerId: 1, bubbles: true });
    await ev('pointerdown', 20, 40); for (const [x, y] of [[80, 70], [160, 30], [240, 80], [300, 40]]) await ev('pointermove', x, y); await ev('pointerup', 300, 40);
    await c.check('#pq-agree'); await c.click('.pq-accept'); await c.waitForSelector('.pq-done');
    await page.click('.tabs >> text=Map'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.qlist');
    expect(page.dialogs.length === 0 && /Signed by <script>/.test(await page.textContent('.qlist')), 'hostile signer name shows as text, no script');
    expect(!(await wide(c)) && c.isClosed() === false, 'customer page fits the phone');
    await c.screenshot({ path: `${out}/abuse-customer-done.png` });
    await ctx.close(); }

  await browser.close(); server.close();
  const fails = results.filter(r => r[0] === 'bad');
  console.log(`\n${results.length - fails.length} passed, ${fails.length} failed`);
  fs.writeFileSync(`${out}/abuse-results.json`, JSON.stringify(results, null, 1));
})().catch(e => { console.error(e); server.close(); process.exit(1); });
