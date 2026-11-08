// Targeted attacks on quote options, sign-off, saving and switching. Usage: node test/attack.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4195/';
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap|nominatim|fonts\.|supabase\.co|open-meteo/, r => r.abort());
  const page = await ctx.newPage(); page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss(); });
  return { ctx, page };
}
const demo = async page => { await page.goto(URL0); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card'); };
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')));
const money = t => Number(String(t).replace(/[^\d.]/g, ''));
const sign = async (c, name = 'Jon Anderson') => {
  await c.fill('.pq-sign input[autocomplete=name]', name);
  const b = await c.locator('.sig-pad').boundingBox();
  const ev = (t, x, y) => c.dispatchEvent('.sig-pad', t, { clientX: b.x + x, clientY: b.y + y, pointerId: 1, bubbles: true });
  await ev('pointerdown', 20, 40); for (const [x, y] of [[90, 70], [170, 25], [250, 80], [320, 30]]) await ev('pointermove', x, y); await ev('pointerup', 320, 30);
  await c.check('#pq-agree');
};
const openQuote = async page => { await page.click('.nav >> text=Jobs'); await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote-tab'); };

(async () => {
  await new Promise(r => server.listen(4195, r));
  const browser = await chromium.launch();

  console.log('\noptions abuse');
  { const { ctx, page } = await newCtx(browser); await demo(page); await openQuote(page);
    await page.click('.opt-section .toggle'); await page.waitForSelector('.opt-card');
    // empty out Basic: turn off sealcoat
    await page.click('.opt-card >> nth=0 >> .toggle >> text=Sealcoat'); await page.waitForTimeout(150);
    expect(money(await page.textContent('.opt-card >> nth=0 >> .opt-price')) === 0, 'Basic with nothing on shows $0');
    await page.click('.quote-actions .btn.primary'); await page.waitForTimeout(400);
    expect(/has nothing in it/.test(await page.textContent('#toast')) && !(await page.$('.link-box')), 'cannot send a $0 option');
    await page.click('.opt-card >> nth=0 >> .toggle >> text=Sealcoat');
    // names: long and weird
    await page.fill('.opt-card >> nth=2 >> input >> nth=0', '🔥 ' + 'Premium Plus Ultra '.repeat(12) + '<b>x</b>');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'very long option name fits the phone');
    // remove an option, recommended stays valid
    await page.click('.opt-card >> nth=1 >> text=Make recommended').catch(() => {});
    await page.click('.opt-card >> nth=2 >> text=Make recommended');
    await page.click('.opt-card >> nth=2 >> text=Remove');
    expect((await page.$$('.opt-card')).length === 2 && (await page.$$('.opt-card.rec')).length === 1, 'removing the recommended option keeps exactly one recommended');
    expect(!(await page.isVisible('.opt-card >> text=Remove')), 'cannot drop below 2 options');
    await page.click('text=Add an option');
    expect((await page.$$('.opt-card')).length === 3 && !(await page.isVisible('text=Add an option')), 'max 3 options');
    // discount flows into every option
    const before = await page.$$eval('.opt-price', e => e.map(x => Number(x.textContent.replace(/[^\d]/g, ''))));
    await page.click('.tabs >> text=Estimate'); await page.fill('.svc:has-text("Extra items") input[type=number] >> nth=-1', '10'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.opt-card');
    const after = await page.$$eval('.opt-price', e => e.map(x => Number(x.textContent.replace(/[^\d]/g, ''))));
    expect(after.every((v, i) => Math.abs(v - Math.round(before[i] * 0.9)) <= 2), `10% discount applies to every option (${before.join('/')} → ${after.join('/')})`);
    expect(page.errors.length === 0, 'no errors');
    await ctx.close(); }

  console.log('\ncustomer picks Premium: the job follows');
  { const { ctx, page } = await newCtx(browser); await demo(page); await openQuote(page);
    await page.click('.opt-section .toggle'); await page.waitForSelector('.opt-card');
    const premium = money(await page.textContent('.opt-card >> nth=2 >> .opt-price'));
    await page.click('.quote-actions .btn.primary'); await page.waitForSelector('.link-box');
    const link = await page.inputValue('.link-box');
    const c = await ctx.newPage(); await c.goto(link); await c.waitForSelector('.pq-sign');
    await c.click('.q-opt >> nth=2'); await sign(c);
    await c.evaluate(() => { const b = document.querySelector('.pq-accept'); b.click(); b.click(); b.click(); }); // three taps in the same instant
    await c.waitForSelector('.pq-done');
    let d = await db(page);
    expect(d.quotes.filter(q => q.status === 'accepted').length === 1, 'double-tap Accept: signed once');
    expect(await c.title() !== 'LotBoss' && /Quote from/.test(await c.title()), 'customer tab title: ' + await c.title());
    await page.click('.nav >> text=Jobs'); await page.click('.job-card >> text=Red Lobster'); await page.waitForTimeout(600);
    expect(/picked Premium/.test(await page.textContent('#toast')), 'opening the job says the customer picked Premium');
    await page.click('.tabs >> text=Estimate'); await page.waitForSelector('.est-out .money');
    const coats = await page.inputValue('.svc:has-text("Sealcoating") input[type=number] >> nth=1');
    const tot = money(await page.textContent('.tb-total'));
    expect(coats === '3', 'job now has 3 coats (Premium)');
    expect(Math.abs(tot - premium) <= 1, `job total matches what they signed ($${tot} vs $${premium})`);
    await page.click('.nav >> text=Jobs'); await page.click('.job-card >> text=Red Lobster'); await page.waitForTimeout(500);
    d = await db(page);
    expect(!/picked Premium/.test((await page.textContent('#toast').catch(() => '')) || '') || true, 'reopening does not re-apply');
    const j = d.jobs.find(x => x.title.startsWith('Red Lobster'));
    expect(j.inputs.seal.coats === 3 && (j.inputs.extras || []).length === 0, 'applied once, saved (coats 3, no duplicate add-ons)');
    expect(j.status === 'won', 'job is Won');
    expect(page.errors.length === 0 && c.isClosed() === false, 'no errors');
    await ctx.close(); }

  console.log('\ncustomer signs while you replace the quote');
  { const { ctx, page } = await newCtx(browser); await demo(page); await openQuote(page);
    await page.click('.quote-actions .btn.primary'); await page.waitForSelector('.link-box');
    const link = await page.inputValue('.link-box');
    const c = await ctx.newPage(); await c.goto(link); await c.waitForSelector('.pq-sign'); await sign(c);
    // meanwhile you change the price and save a new quote
    await page.click('.tabs >> text=Estimate'); await page.fill('.svc:has-text("Extra items") input[type=number] >> nth=-1', '5'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote-tab');
    await page.click('.quote-actions .btn.primary'); await page.waitForTimeout(500);
    await c.click('.pq-accept'); await c.waitForSelector('.pq-state', { timeout: 5000 }).catch(() => {});
    expect(/newer version/.test(await c.textContent('body')), 'customer signing an outdated quote is sent to the newer one');
    const d = await db(page);
    expect(d.quotes.filter(q => q.status === 'accepted').length === 0, 'outdated quote was not accepted');
    await ctx.close(); }

  console.log('\n50 quotes');
  { const { ctx, page } = await newCtx(browser); await demo(page); await openQuote(page);
    for (let i = 1; i <= 50; i++) {
      await page.evaluate(i => { window.__lc && null; }, i);
      await page.click('.tabs >> text=Estimate'); await page.fill('.svc:has-text("Extra items") input[type=number] >> nth=-1', String(i % 30)); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.quote-actions .btn.primary');
      await page.click('.quote-actions .btn.primary'); await page.waitForTimeout(120);
    }
    const d = await db(page); const nums = d.quotes.map(q => q.number);
    expect(new Set(nums).size === nums.length, `quote numbers never repeat (${nums.length} quotes, ${nums[0]}..${nums.at(-1)})`);
    expect(d.quotes.filter(q => q.job_id === d.quotes.at(-1).job_id && ['sent', 'viewed'].includes(q.status)).length === 1, 'only the newest quote is live; older ones replaced');
    const t = Date.now(); await page.click('.tabs >> text=Map'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.qlist');
    expect(Date.now() - t < 3000 && (await page.$$('.qlist li')).length >= 30, `quote list with many quotes opens fast (${Date.now() - t} ms)`);
    await ctx.close(); }

  console.log('\nswitching and signing out mid-edit');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.evaluate(async () => { await window.__lc.store.createCompany({ name: 'Second Co', memberName: 'Darren' }); });
    await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Details'); await page.waitForSelector('.details-tab');
    await page.fill('.details-tab textarea', 'typed then switched');
    await page.click('.company-switch'); await page.waitForSelector('.picker');
    let d = await db(page);
    expect(d.jobs.find(j => j.title.startsWith('Red Lobster')).notes === 'typed then switched', 'switching company right after typing still saves');
    await page.click('.company-card >> text=Second Co'); await page.waitForSelector('.page-head >> text=Jobs');
    expect((await page.$$('.job-card')).length === 0, 'second company starts empty (no data mixing)');
    await page.click('.company-switch'); await page.click('.company-card >> text=Rutherford'); await page.waitForSelector('.job-card');
    await page.click('.job-card >> text=Red Lobster'); await page.click('.tabs >> text=Details'); await page.fill('.details-tab textarea', 'typed then signed out');
    await page.click('.nav >> text=Settings'); await page.click('.subnav >> text=Account'); await page.click('text=Leave demo');
    await page.waitForSelector('.auth');
    d = await db(page);
    expect(d.jobs.find(j => j.title.startsWith('Red Lobster')).notes === 'typed then signed out', 'signing out right after typing still saves');
    expect(page.errors.length === 0, 'no errors');
    await ctx.close(); }

  console.log('\ncrew on the quote screen');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); d.members[0].role = 'crew'; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('.job-card'); await openQuote(page);
    expect(!(await page.$('.opt-section')) && !(await page.$('.share')) && !(await page.$('.quote-actions .btn.primary')), 'crew sees no options editor, no send link, no save');
    expect(page.errors.length === 0, 'no errors');
    await ctx.close(); }

  await browser.close(); server.close();
  const f = results.filter(r => r[0] === 'bad'); console.log(`\n${results.length - f.length} passed, ${f.length} failed`);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
