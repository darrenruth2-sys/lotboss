// Layout designer: walk through it and try to break it. Usage: node test/layout.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4197/';
const tile = fs.readFileSync(path.join(root, 'icon-192.png'));
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap/, r => r.fulfill({ status: 200, contentType: 'image/png', body: tile }));
  await ctx.route(/nominatim|fonts\.|supabase\.co|open-meteo/, r => r.abort());
  const page = await ctx.newPage(); page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' <- '))); page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss(); });
  return { ctx, page };
}
const demo = async page => { await page.goto(URL0); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card'); };
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')));
const job = (d, name) => d.jobs.find(j => j.title.startsWith(name));
const gen = j => (j.drawing?.features || []).filter(f => f.properties?.gen === 'layout');
const openJob = async (page, name) => { await page.goto(URL0 + '#/jobs'); await page.waitForSelector('.job-card'); await page.click('.chip >> text=All'); await page.click(`.job-card >> text=${name}`); await page.waitForSelector('#map'); await page.waitForTimeout(300); };
const stat = async (page, label) => Number((await page.locator(`.lay-stats div:has(small:text-is("${label}")) b`).textContent()).replace(/[^\d]/g, ''));
const screenOk = async (page, label) => {
  const st = await page.evaluate(() => ({ bad: (document.body.innerText.match(/\b(null|undefined|NaN|Infinity|\[object Object\])\b/g) || []), wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  expect(!st.bad.length, `${label}: no null/undefined/NaN on screen${st.bad.length ? ' (' + st.bad.join(',') + ')' : ''}`);
  expect(!st.wide, `${label}: fits the screen`);
};
const setOpt = async (page, label, v) => { const i = page.locator(`.lay-opts label:has-text("${label}") input, .lay-opts .field:has(label:text-is("${label}")) input`).first(); await i.fill(String(v)); await page.waitForTimeout(150); };

(async () => {
  await new Promise(r => server.listen(4197, r));
  const browser = await chromium.launch();

  console.log('\ndesign a layout on the demo lot (phone)');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await openJob(page, 'Red Lobster');
    await page.click('text=Design the layout'); await page.waitForSelector('.lay-svg');
    const total = await stat(page, 'Spaces');
    expect(total > 10, `designer fits ${total} spaces on the lot`);
    expect(await page.locator('.lay-svg rect').count() >= total, 'preview draws every space');
    expect(await page.locator('.lay .note').count() === 1, 'tells you to mark the door first');
    await page.screenshot({ path: `${out}/layout-modal.png` });
    await screenOk(page, 'designer');
    // options change the count
    await setOpt(page, 'Stall width', 11); const wide = await stat(page, 'Spaces');
    expect(wide < total, `11 ft stalls fit fewer (${wide} < ${total})`);
    for (const junk of ['0', '-5', '1e9', '']) { await setOpt(page, 'Stall width', junk); }
    await screenOk(page, 'junk stall widths');
    await setOpt(page, 'Stall width', 9); await setOpt(page, 'Drive aisle', 3); await screenOk(page, '3 ft aisle');
    expect(await page.locator('.lay-warn li').count() >= 1, 'warns that a tight aisle is too narrow');
    await setOpt(page, 'Drive aisle', 24);
    expect(await stat(page, 'Spaces') === total, 'back to the same count');
    await page.selectOption('.lay-opts select >> nth=2', 'all');
    await page.click('.sheet-actions >> text=Put it on the map'); await page.waitForTimeout(1200);
    let d = await db(page); let j = job(d, 'Red Lobster');
    expect(gen(j).length > 0, 'layout saved on the job');
    expect(j.inputs.stripe.wheelStops === total, `wheel stops on every space (${j.inputs.stripe.wheelStops})`);
    expect(j.inputs.stripe.newLayout === true, 'priced as a new layout');
    const chip = await page.locator('.sum-chip:has(small:text-is("Stalls")) b').textContent();
    expect(Number(chip) === total, `map shows ${chip} stalls`);
    expect(!(j.drawing.features.some(f => !f.properties.gen && f.properties.kind === 'row')), 'hand-drawn rows replaced, no double count');
    await page.screenshot({ path: `${out}/layout-map.png` });
    await page.click('.tabs >> text=Estimate'); await page.waitForTimeout(300);
    expect(new RegExp(`${total} stalls need`).test(await page.textContent('.ada-box')), 'estimate counts the designed stalls and their ADA');
    // put a door in the far corner and redo: ADA moves
    await page.click('.tabs >> text=Map'); await page.waitForSelector('#map');
    const before = gen(j).filter(f => f.properties.ada && f.properties.kind === 'row').map(f => f.geometry.coordinates[0]);
    await page.click('.tool:has-text("Door")'); const b = await page.locator('#map').boundingBox();
    await page.touchscreen.tap(b.x + b.width * 0.9, b.y + b.height * 0.2); await page.waitForTimeout(300);
    await page.click('.tool:has-text("Door")'); await page.touchscreen.tap(b.x + b.width * 0.85, b.y + b.height * 0.25); await page.waitForTimeout(300);
    d = await db(page); j = job(d, 'Red Lobster');
    await page.waitForTimeout(900); d = await db(page); j = job(d, 'Red Lobster');
    expect(j.drawing.features.filter(f => f.properties.kind === 'entrance').length === 1, 'only one door marker kept');
    await page.click('text=Design the layout'); await page.waitForSelector('.lay-svg');
    expect(await page.locator('.lay .note').count() === 0, 'no door tip once a door is marked');
    await page.click('.sheet-actions >> text=Replace the layout'); await page.waitForTimeout(1200);
    d = await db(page); j = job(d, 'Red Lobster');
    const after = gen(j).filter(f => f.properties.ada && f.properties.kind === 'row').map(f => f.geometry.coordinates[0]);
    expect(JSON.stringify(after) !== JSON.stringify(before), 'ADA spaces moved toward the door');
    expect(gen(j).filter(f => f.properties.kind === 'row').reduce((t, f) => t + f.properties.stalls, 0) === total, 'replacing keeps one layout, no duplicates');
    // tap a generated row and edit it like any other row
    await page.click('text=Design the layout'); await page.click('.sheet-actions >> text=Remove layout'); await page.waitForTimeout(1200);
    d = await db(page); j = job(d, 'Red Lobster');
    expect(gen(j).length === 0 && !j.inputs.stripe.wheelStops, 'layout removed, wheel stops cleared');
    expect(j.drawing.features.some(f => f.properties.kind === 'seal'), 'your lot outline is still there');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nno lot drawn, tiny lot, crew');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await openJob(page, 'First Baptist');
    await page.click('text=Design the layout'); await page.waitForTimeout(300);
    expect(await page.locator('.sheet >> text=First outline the lot').count() === 1, 'no outline: explains how to draw one');
    await page.click('.sheet-actions >> text=Got it');
    // a 30 x 30 ft "lot"
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); const j = d.jobs.find(x => x.title.startsWith('First Baptist')); const a = 39.94, o = -82.01, dy = 30 / 364813, dx = 30 / (364813 * Math.cos(a * Math.PI / 180)); j.drawing = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'seal' }, geometry: { type: 'Polygon', coordinates: [[[o, a], [o + dx, a], [o + dx, a + dy], [o, a + dy], [o, a]]] } }] }; j.updated_at = new Date().toISOString(); localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('#map');
    await page.click('text=Design the layout'); await page.waitForSelector('.sheet');
    expect(await page.locator('.lay-out .warn-text >> text=too small').count() === 1, 'tiny lot: says it is too small');
    await page.click('.sheet-actions >> text=Put it on the map'); await page.waitForTimeout(300);
    expect(await page.locator('.sheet').count() === 1, 'can\'t put an empty layout on the map');
    await page.click('.sheet-actions >> text=Cancel');
    await screenOk(page, 'tiny lot');
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); d.members[0].role = 'crew'; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForTimeout(1500); await page.waitForSelector('.tabs');
    expect(await page.locator('text=Design the layout').count() === 0, 'crew don\'t get the designer');
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nbig lot with islands (desktop)');
  { const { ctx, page } = await newCtx(browser, { viewport: { width: 1366, height: 900 }, hasTouch: false, isMobile: false }); await demo(page);
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lotcalc-demo')); const j = d.jobs.find(x => x.title.startsWith('First Baptist'));
      const a = 39.94, o = -82.01, F = 364813, K = Math.cos(a * Math.PI / 180); const P = ([x, y]) => [o + x / (F * K), a + y / F];
      const box = (x, y, w, hh) => [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh], [x, y]].map(P);
      j.drawing = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'seal' }, geometry: { type: 'Polygon', coordinates: [box(0, 0, 700, 450)] } },
        { type: 'Feature', properties: { kind: 'seal', exclude: true }, geometry: { type: 'Polygon', coordinates: [box(200, 150, 60, 60)] } },
        { type: 'Feature', properties: { kind: 'seal', exclude: true }, geometry: { type: 'Polygon', coordinates: [box(500, 300, 120, 80)] } },
        { type: 'Feature', properties: { kind: 'entrance' }, geometry: { type: 'Point', coordinates: P([350, 450]) } }] };
      j.lat = a; j.lng = o; j.updated_at = new Date().toISOString(); localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await openJob(page, 'First Baptist');
    const t0 = Date.now(); await page.click('text=Design the layout'); await page.waitForSelector('.lay-svg'); const ms = Date.now() - t0;
    const total = await stat(page, 'Spaces');
    expect(total > 600, `7-acre lot with 2 islands: ${total} spaces`);
    expect(ms < 2500, `designed in ${ms} ms`);
    expect((await page.locator('.lay-stats div:has(small:text-is("Accessible")) b').textContent()).includes('van'), 'van spaces included');
    await page.screenshot({ path: `${out}/layout-big.png` });
    // spam the options
    for (let i = 0; i < 15; i++) { await setOpt(page, 'Stall width', 8 + (i % 5)); await page.selectOption('.lay-opts select >> nth=0', i % 2 ? 'turn' : ''); }
    await screenOk(page, 'option spam');
    await page.click('.sheet-actions >> text=Put it on the map'); await page.waitForTimeout(1500);
    const d = await db(page); const j = job(d, 'First Baptist');
    expect(gen(j).length > 20, 'big layout saved');
    await page.click('.tabs >> text=Estimate'); await page.waitForTimeout(400);
    const tot = await page.textContent('.tb-total'); expect(/\$[\d,]+/.test(tot), 'estimate has a price: ' + tot.trim());
    await screenOk(page, 'estimate with big layout');
    await page.reload(); await page.waitForSelector('.tabs');
    await page.click('.tabs >> text=Map'); await page.waitForSelector('#map'); await page.waitForTimeout(500);
    expect(await page.locator('.leaflet-overlay-pane path').count() > 20, 'layout draws on the map after reload');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nevery Cancel button really cancels');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    const count = async () => (await db(page)).jobs.length;
    const n0 = await count();
    await page.click('text=New job'); await page.fill('.sheet input >> nth=0', 'Should not exist'); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(500);
    expect(await page.locator('.sheet').count() === 0 && await count() === n0, 'New job → Cancel: window closes, no job made');
    await page.click('text=New job'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    expect(await page.locator('.sheet').count() === 0 && await count() === n0, 'New job → Escape: nothing made');
    await openJob(page, 'Red Lobster');
    await page.click('.tabs >> text=Details'); await page.click('button:has-text("Delete job")'); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(300);
    expect(await page.locator('.sheet').count() === 0 && await count() === n0, 'Delete job → Cancel: window closes, job kept');
    await page.click('.tabs >> text=Money'); await page.waitForSelector('.money-tab');
    await page.click('text=Bill the job'); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(400);
    let d = await db(page); const rl = d.jobs.find(j => j.title.startsWith('Red Lobster'));
    expect(await page.locator('.sheet').count() === 0 && !(d.invoices || []).some(i => i.job_id === rl.id), 'Bill the job → Cancel: no invoice');
    expect(!/undefined/.test(await page.locator('#toast').textContent().catch(() => '')), 'no "Invoice undefined created" message');
    await page.click('text=Bill the job'); await page.click('.sheet-actions >> text=Create invoice'); await page.waitForSelector('.inv-card');
    await page.click('text=Record payment'); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(400);
    d = await db(page); expect(d.invoices.find(i => i.job_id === rl.id).payments.length === 0, 'Record payment → Cancel: nothing recorded');
    await page.click('.inv-card >> text=Void'); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(400);
    d = await db(page); expect(await page.locator('.sheet').count() === 0 && d.invoices.find(i => i.job_id === rl.id).status === 'open', 'Void → Cancel: window closes, invoice kept');
    await page.click('.tabs >> text=Map'); await page.waitForSelector('#map');
    const before = JSON.stringify((await db(page)).jobs.find(j => j.id === rl.id).drawing);
    await page.click('text=Design the layout'); await page.waitForSelector('.lay-svg'); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(1000);
    expect(JSON.stringify((await db(page)).jobs.find(j => j.id === rl.id).drawing) === before, 'Design layout → Cancel: map unchanged');
    await page.click('text=Design the layout'); await page.waitForSelector('.lay-svg'); await page.click('.sheet-head .icon-btn'); await page.waitForTimeout(600);
    expect(JSON.stringify((await db(page)).jobs.find(j => j.id === rl.id).drawing) === before, 'Design layout → ✕: map unchanged');
    await page.goto(URL0 + '#/settings/crew'); await page.waitForTimeout(400);
    const crew0 = (await db(page)).crew.length;
    await page.click('text=Add crew member'); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(300);
    expect((await db(page)).crew.length === crew0, 'Add crew → Cancel: nobody added');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  await browser.close(); server.close();
  const failed = results.filter(r => r[0] === 'bad').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
