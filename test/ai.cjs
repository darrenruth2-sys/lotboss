// AI photo check (demo answer): walk through it and try to break it. Usage: node test/ai.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4199/';
const img = path.join(root, 'icon-192.png');
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap|nominatim|fonts\.|supabase\.co|open-meteo/, r => r.abort());
  const page = await ctx.newPage(); page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss(); });
  return { ctx, page };
}
const demo = async page => { await page.goto(URL0); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card'); };
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')));
const rl = d => d.jobs.find(j => j.title.startsWith('Red Lobster'));
const screenOk = async (page, label) => {
  const st = await page.evaluate(() => ({ bad: (document.body.innerText.match(/\b(null|undefined|NaN|Infinity|\[object Object\])\b/g) || []), wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  expect(!st.bad.length, `${label}: no null/undefined/NaN on screen${st.bad.length ? ' (' + st.bad.join(',') + ')' : ''}`);
  expect(!st.wide, `${label}: fits the screen`);
};
const toPhotos = async page => { await page.click('.chip >> text=All'); await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Photos'); await page.waitForSelector('.photos-tab'); await page.waitForTimeout(300); };

(async () => {
  await new Promise(r => server.listen(4199, r));
  const browser = await chromium.launch();

  console.log('\nAI photo check (phone)');
  { const { ctx, page } = await newCtx(browser); await demo(page); await toPhotos(page);
    await page.click('text=AI check the photos'); await page.waitForTimeout(300);
    expect(await page.locator('#toast >> text=Add some photos').count() === 1 && await page.locator('.sheet').count() === 0, 'no photos: asks you to add some first');
    await page.setInputFiles('.photos-tab input[type=file] >> nth=1', [img, img, img, img, img, img]); await page.waitForSelector('.photo-thumb >> nth=5', { timeout: 15000 });
    await page.click('text=AI check the photos'); await page.waitForSelector('.ai-pick');
    expect(await page.locator('.ai-thumb input:checked').count() === 4, 'picks 4 photos to start');
    await page.click('.ai-thumb >> nth=5'); await page.waitForTimeout(150);
    expect(await page.locator('.ai-thumb input:checked').count() === 4 && await page.locator('#toast >> text=Up to 4').count() === 1, 'can\'t pick a 5th');
    for (let i = 0; i < 4; i++) await page.click('.ai-thumb >> nth=' + i);
    await page.click('.sheet-actions >> text=Check them'); await page.waitForTimeout(200);
    expect(await page.locator('.sheet').count() === 1, 'none picked: stays open and asks for one');
    await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(300);
    expect(await page.locator('.ai-card').count() === 0, 'Cancel: nothing checked');
    // no signal
    await page.evaluate(() => { window.__lcOffline = true; });
    await page.click('text=AI check the photos'); await page.click('.sheet-actions >> text=Check them'); await page.waitForTimeout(400);
    expect(await page.locator('#toast >> text=No signal').count() === 1 && await page.locator('.ai-card').count() === 0, 'no signal: clear message, no half answer');
    expect(await page.locator('.ai-btn').isEnabled(), 'button works again after an error');
    await page.evaluate(() => { window.__lcOffline = false; });
    // real (demo) run
    await page.click('text=AI check the photos'); await page.click('.sheet-actions >> text=Check them');
    expect(/Looking at the photos/.test(await page.textContent('.ai-btn')), 'button shows it\'s working');
    await page.waitForSelector('.ai-card', { timeout: 5000 });
    expect(/Fair/.test(await page.textContent('.ai-card .ai-head')), 'shows the condition');
    expect(/140–220 ft/.test(await page.textContent('.ai-card')), 'shows the crack footage range');
    expect(await page.locator('.ai-warn li').count() === 1, 'shows what sealing won\'t fix');
    await screenOk(page, 'AI result'); await page.screenshot({ path: `${out}/ai-result.png`, fullPage: true });
    // use the numbers
    await page.click('.ai-card button:has-text("crack fill")'); await page.waitForTimeout(900);
    let d = await db(page); expect(rl(d).inputs.crack.lf === 180 && rl(d).inputs.crack.on, 'crack fill set to the middle of the range (180 ft)');
    expect(/you have 180/.test(await page.textContent('.ai-card')), 'button now says what you already have');
    await page.click('.ai-card button:has-text("Oil spot primer")'); await page.waitForTimeout(900);
    d = await db(page); expect(rl(d).inputs.extras.some(x => /Oil spot primer \(3 spots\)/.test(x.label) && x.amount === 45), 'oil spot primer added (3 x $15)');
    expect(await page.locator('.ai-card button:has-text("Oil spot primer")').count() === 0, 'can\'t add the primer twice');
    // answer is saved with the job
    await page.reload(); await page.waitForSelector('.tabs'); await page.click('.tabs >> text=Photos'); await page.waitForSelector('.ai-card');
    expect(/Fair/.test(await page.textContent('.ai-card')), 'answer is still there after reload');
    await page.click('.tabs >> text=Estimate'); await page.waitForTimeout(300);
    expect(/Oil spot primer/.test(await page.textContent('body')), 'primer shows on the estimate');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nAI outline from satellite (demo outline)');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.chip >> text=All'); await page.click('.job-card >> text=Red Lobster'); await page.waitForSelector('#map'); await page.waitForTimeout(400);
    const aiCount = async () => (rl(await db(page)).drawing.features || []).filter(f => f.properties.gen === 'ai-outline').length;
    await page.click('text=AI outline the lot'); await page.waitForSelector('.sheet >> text=AI outline');
    expect(/about [\d,]+ sq ft/.test(await page.textContent('.sheet')) && /96 parking spaces/.test(await page.textContent('.sheet')), 'shows square feet and the space count');
    expect(await page.locator('.leaflet-overlay-pane path[stroke="#f5b800"]').count() >= 1, 'yellow preview is drawn on the map');
    expect(await page.locator('.sheet .note >> text=already have').count() === 1, 'warns you already have areas drawn');
    await page.screenshot({ path: `${out}/ai-outline.png` });
    await page.click('.sheet-actions >> text=Drop it'); await page.waitForTimeout(900);
    expect(await aiCount() === 0 && await page.locator('.leaflet-overlay-pane path[stroke="#f5b800"][stroke-dasharray="8 6"]').count() === 0, 'Drop it: nothing added, preview gone');
    const before = await page.textContent('.sum-chip:has(small:text-is("Sealcoat")) b');
    await page.click('text=AI outline the lot'); await page.click('.sheet-actions >> text=Keep it'); await page.waitForTimeout(1200);
    expect(await aiCount() === 2, 'Keep it: lot + island added');
    expect(rl(await db(page)).drawing.features.some(f => f.properties.gen === 'ai-outline' && f.properties.exclude), 'island is marked Skip');
    expect(await page.textContent('.sum-chip:has(small:text-is("Sealcoat")) b') !== before, 'sealcoat area went up');
    await page.click('text=AI outline the lot'); await page.click('.sheet-actions >> text=Keep it'); await page.waitForTimeout(1200);
    expect(await aiCount() === 2, 'running it again replaces the old AI outline, no doubles');
    // way zoomed out
    await page.evaluate(() => window.__lc.mv.map.setZoom(13, { animate: false })); await page.waitForTimeout(400);
    await page.click('text=AI outline the lot'); await page.waitForTimeout(300);
    expect(await page.locator('#toast >> text=Zoom in closer').count() === 1 && await page.locator('.sheet').count() === 0, 'zoomed way out: asks you to zoom in');
    await page.evaluate(() => window.__lc.mv.map.setZoom(19, { animate: false })); await page.waitForTimeout(400);
    await page.evaluate(() => { window.__lcOffline = true; });
    await page.click('text=AI outline the lot'); await page.waitForTimeout(500);
    expect(await page.locator('#toast >> text=No signal').count() === 1 && await page.locator('.sheet').count() === 0, 'no signal: clear message');
    expect(await page.locator('text=AI outline the lot').isEnabled(), 'button works again');
    await page.evaluate(() => { window.__lcOffline = false; });
    await screenOk(page, 'after outline');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\ncrew don\'t get AI');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); d.members[0].role = 'crew'; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('.job-card'); await toPhotos(page);
    expect(await page.locator('text=AI check the photos').count() === 0, 'no AI button for crew');
    await page.goto(URL0 + '#/jobs'); await page.waitForSelector('.job-card');
    expect(await page.locator('text=From an email').count() === 0, 'no From an email for crew');
    await page.click('.job-card >> nth=0'); await page.waitForSelector('#map');
    expect(await page.locator('text=AI outline the lot').count() === 0, 'no AI outline for crew');
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nnew job from an email (demo reader)');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    const n0 = (await db(page)).jobs.length;
    await page.click('text=From an email'); await page.waitForSelector('.sheet textarea');
    await page.click('.sheet-actions >> text=Read it'); await page.waitForTimeout(200);
    expect(await page.locator('.sheet textarea').count() === 1, 'empty paste: stays open and asks for the message');
    await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(300);
    expect((await db(page)).jobs.length === n0 && await page.locator('.sheet').count() === 0, 'Cancel: nothing made');
    // spam
    await page.click('text=From an email'); await page.fill('.sheet textarea', 'Congratulations!!! You won a FREE cruise. Click here to claim. Reply STOP to unsubscribe.');
    await page.click('.sheet-actions >> text=Read it'); await page.waitForSelector('text=doesn\'t look like a job');
    await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(300);
    expect((await db(page)).jobs.length === n0, 'spam: warns, and Cancel makes nothing');
    // a real request
    await page.click('text=From an email');
    await page.fill('.sheet textarea', 'From: Karen Walsh <kwalsh@firstumc.org>\nWe need our lot at 1240 Military Rd, Zanesville OH crack filled, sealed and restriped, about 85 spaces, before Easter Sunday. Call 740-555-0147. <img src=x onerror=alert(1)>');
    await page.click('.sheet-actions >> text=Read it'); await page.waitForSelector('.ai-prefill');
    expect(await page.inputValue('.sheet input >> nth=1') === '1240 Military Rd, Zanesville OH', 'address filled in');
    expect(await page.inputValue('.sheet input >> nth=2') === 'Karen Walsh', 'customer name filled in');
    const pre = await page.textContent('.ai-prefill');
    expect(/740-555-0147/.test(pre) && /kwalsh@firstumc\.org/.test(pre) && /sealcoat, crack fill, striping/.test(pre) && /85 spaces/.test(pre) && /before Easter Sunday/.test(pre), 'phone, email, services, size and deadline shown to check');
    await screenOk(page, 'job from email'); await page.screenshot({ path: `${out}/email-job.png` });
    await page.fill('.sheet input >> nth=0', 'First United Methodist');
    await page.click('.sheet-actions >> text=Create job'); await page.waitForSelector('.tabs', { timeout: 10000 }); await page.waitForTimeout(900);
    const d = await db(page); const j = d.jobs.find(x => x.title === 'First United Methodist');
    expect(!!j, 'job created with your edited name');
    expect(j && j.customer.phone === '740-555-0147' && j.customer.email === 'kwalsh@firstumc.org', 'phone and email saved on the job');
    expect(j && j.inputs.seal?.on && j.inputs.crack?.on && j.inputs.stripe?.on, 'sealcoat, crack fill and striping turned on');
    expect(j && /85 spaces/.test(j.notes) && /Easter/.test(j.notes), 'size and deadline saved in the notes');
    expect(!page.dialogs.length, 'hostile text in the email didn\'t run');
    // no signal
    await page.goto(URL0 + '#/jobs'); await page.waitForSelector('.job-card');
    await page.evaluate(() => { window.__lcOffline = true; });
    await page.click('text=From an email'); await page.fill('.sheet textarea', 'Need striping at 455 Underwood St please, thanks Tom'); await page.click('.sheet-actions >> text=Read it'); await page.waitForTimeout(400);
    expect(await page.locator('#toast >> text=No signal').count() === 1 && await page.locator('.sheet textarea').count() === 1, 'no signal: message kept so you can try again');
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  await browser.close(); server.close();
  const failed = results.filter(r => r[0] === 'bad').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
