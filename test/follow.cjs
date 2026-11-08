// Follow-ups: walk through it and try to break it. Usage: node test/follow.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4200/';
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap|nominatim|fonts\.|supabase\.co|open-meteo/, r => r.abort());
  const page = await ctx.newPage(); page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss(); });
  return { ctx, page };
}
const demo = async page => { await page.goto(URL0); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card'); };
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')));
const screenOk = async (page, label) => {
  const st = await page.evaluate(() => ({ bad: (document.body.innerText.match(/\b(null|undefined|NaN|Infinity|\[object Object\])\b/g) || []), wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  expect(!st.bad.length, `${label}: no null/undefined/NaN on screen${st.bad.length ? ' (' + st.bad.join(',') + ')' : ''}`);
  expect(!st.wide, `${label}: fits the screen`);
};
const card = (page, title) => page.locator(`.fu-card:has(.fu-title:text-is("${title}"))`);
const count = async page => Number(await page.textContent('.fu-pipe .pipe-n'));

(async () => {
  await new Promise(r => server.listen(4200, r));
  const browser = await chromium.launch();

  console.log('\nfollow-up list (phone)');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    const n = await count(page);
    expect(n >= 4, `Jobs page shows ${n} follow-ups today`);
    await page.click('.fu-pipe'); await page.waitForSelector('h1 >> text=Follow up');
    expect(await page.locator('.fu-card').count() === n, 'page lists the same number');
    const w = card(page, 'Walmart Supercenter, Maple Ave');
    expect(await w.count() === 1 && /They opened it/.test(await w.textContent()), 'opened-but-unsigned quote is flagged');
    expect(await page.locator('.fu-card.fu-quote').first().locator('.fu-title').textContent() === 'Walmart Supercenter, Maple Ave', 'hot quote is at the top of its group');
    const sms = decodeURIComponent(await w.locator('a:has-text("Text")').getAttribute('href'));
    expect(/^sms:7405550166/.test(sms) && /Hi Rick/.test(sms) && /#\/q\/[0-9a-f]+/.test(sms), 'text goes to Rick with the quote link');
    expect(/^mailto:rick\.dawson%40example\.com/.test(await w.locator('a:has-text("Email")').getAttribute('href')), 'email link too');
    expect(await card(page, 'Muskingum Valley Bank').filter({ hasText: 'Payment reminder' }).count() === 1, 'late invoice shows as a payment reminder');
    expect(await card(page, 'Zanesville Family Dental').filter({ hasText: 'Reseal reminder' }).count() === 1, '3-year-old sealcoat job gets a reseal reminder');
    expect(await page.locator('.fu-card .note >> text=review link').count() >= 1, 'review requests say the review link is missing');
    await screenOk(page, 'follow-up list'); await page.screenshot({ path: `${out}/follow.png`, fullPage: true });
    // done + undo
    await w.locator('button:has-text("Done")').click(); await page.waitForTimeout(300);
    expect(await card(page, 'Walmart Supercenter, Maple Ave').count() === 0, 'Done removes it');
    await page.click('.toast-act'); await page.waitForTimeout(300);
    expect(await card(page, 'Walmart Supercenter, Maple Ave').count() === 1, 'Undo brings it back');
    // snooze survives a reload
    await card(page, 'Zanesville Family Dental').locator('button:has-text("Next week")').click(); await page.waitForTimeout(300);
    await page.reload(); await page.waitForSelector('h1 >> text=Follow up');
    expect(await card(page, 'Zanesville Family Dental').count() === 0, 'snoozed one stays hidden after reload');
    // stop: confirm Cancel keeps it, Stop removes every reminder for that job
    const mv = card(page, 'Muskingum Valley Bank'); const before = await mv.count();
    await mv.first().locator('button:has-text("Stop")').click(); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(200);
    expect(await card(page, 'Muskingum Valley Bank').count() === before, 'Stop → Cancel keeps it');
    await card(page, 'Muskingum Valley Bank').first().locator('button:has-text("Stop")').click(); await page.click('.sheet-actions >> text=Stop'); await page.waitForTimeout(300);
    expect(await card(page, 'Muskingum Valley Bank').count() === 0, 'Stop removes every reminder for that job (payment and review)');
    // no signal
    await page.evaluate(() => { window.__lcOffline = true; });
    await card(page, 'Walmart Supercenter, Maple Ave').locator('button:has-text("Done")').click(); await page.waitForTimeout(300);
    expect(await card(page, 'Walmart Supercenter, Maple Ave').count() === 1 && await page.locator('.toast.bad').count() === 1, 'no signal: stays on the list with an error');
    await page.evaluate(() => { window.__lcOffline = false; });
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nreview link + settings');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.goto(URL0 + '#/settings/company'); await page.waitForSelector('label:has-text("Review link") input');
    await page.fill('label:has-text("Review link") input', 'javascript:alert(1)'); await page.waitForTimeout(900);
    let d = await db(page); expect(!d.companies[0].settings?.reviewLink, 'a javascript: link is refused');
    expect(await page.locator('.field.bad').count() === 1, 'and the box turns red');
    await page.fill('label:has-text("Review link") input', 'https://g.page/r/RutherfordPaving/review'); await page.waitForTimeout(1200);
    d = await db(page); expect(d.companies[0].settings?.reviewLink === 'https://g.page/r/RutherfordPaving/review', 'good link saved');
    await page.goto(URL0 + '#/follow'); await page.waitForSelector('h1 >> text=Follow up');
    const rv = page.locator('.fu-card.fu-review').first();
    expect(/g\.page\/r\/RutherfordPaving\/review/.test(decodeURIComponent(await rv.locator('a:has-text("Text")').getAttribute('href') || '')), 'review request text has your link');
    expect(await page.locator('.fu-card .note >> text=review link').count() === 0, 'missing-link note gone');
    // reseal after 5 years instead of 3: the dental job drops off
    await page.goto(URL0 + '#/settings/rates'); await page.waitForSelector('text=Remind to reseal after');
    await page.locator('label:has-text("Remind to reseal after") input, .field:has-text("Remind to reseal after") input').first().fill('5'); await page.waitForTimeout(1200);
    await page.goto(URL0 + '#/follow'); await page.waitForSelector('h1 >> text=Follow up');
    expect(await page.locator('.fu-card.fu-reseal').count() === 0, 'reseal after 5 years: not due yet');
    await screenOk(page, 'after settings');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\ncrew');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); d.members[0].role = 'crew'; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('.job-card');
    expect(await page.locator('.fu-pipe').count() === 0, 'no follow-up tile for crew');
    await page.goto(URL0 + '#/follow'); await page.waitForTimeout(500);
    expect(await page.locator('h1 >> text=Follow up').count() === 0, 'follow-up page blocked for crew');
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  await browser.close(); server.close();
  const failed = results.filter(r => r[0] === 'bad').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
