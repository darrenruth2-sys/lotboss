// Driveways, how-to-pay, QuickBooks export, time clock. Usage: node test/extras.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4202/';
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap|nominatim|fonts\.|supabase\.co|open-meteo/, r => r.abort());
  const page = await ctx.newPage(); page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss(); });
  return { ctx, page };
}
const demo = async page => { await page.goto(URL0); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card'); };
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')));
const setDb = (page, fn) => page.evaluate(fn);
const screenOk = async (page, label) => {
  const st = await page.evaluate(() => ({ bad: (document.body.innerText.match(/\b(null|undefined|NaN|Infinity|\[object Object\])\b/g) || []), wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  expect(!st.bad.length, `${label}: no null/undefined/NaN on screen${st.bad.length ? ' (' + st.bad.join(',') + ')' : ''}`);
  expect(!st.wide, `${label}: fits the screen`);
};
const today = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  await new Promise(r => server.listen(4202, r));
  const browser = await chromium.launch();

  console.log('\ndriveways (phone)');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.nav >> text=Calculators'); await page.waitForSelector('.dw-calc');
    expect(/\$180/.test(await page.textContent('.dw-calc .calc-out')), '60 x 12 driveway at $0.25 = $180');
    await page.click('text=+ Add a driveway');
    const rows = page.locator('.dw-row');
    await rows.nth(1).locator('input').nth(0).fill('Mrs. Jones, 12 Elm');
    await rows.nth(1).locator('input').nth(1).fill('20'); await rows.nth(1).locator('input').nth(2).fill('10'); await page.waitForTimeout(150);
    expect(/Mrs\. Jones, 12 Elm[\s\S]*\$150 \(minimum\)/.test(await page.textContent('.dw-calc .calc-out')), 'small driveway hits the $150 minimum');
    for (const v of ['-5', '1e12', '']) await rows.nth(1).locator('input').nth(1).fill(v);
    await screenOk(page, 'driveways with junk');
    await rows.nth(1).locator('input').nth(1).fill('20');
    const sms = decodeURIComponent(await page.getAttribute('.dw-calc a:has-text("Text the price")', 'href'));
    expect(/Driveway sealcoating from Rutherford Paving/.test(sms) && /Mrs\. Jones, 12 Elm: 200 sq ft = \$150/.test(sms), 'text-the-price message is right');
    await page.click('.dw-calc >> text=Make it a job'); await page.waitForSelector('.tabs'); await page.waitForTimeout(800);
    const d = await db(page); const j = d.jobs.find(x => x.title === 'Mrs. Jones, 12 Elm');
    expect(j && j.inputs.extras.length === 2 && j.inputs.extras.reduce((t, x) => t + x.amount, 0) === 330, 'job made with both driveways priced ($330)');
    { const tt = await page.textContent('.tb-total'); expect(/\$330|\$35\d/.test(tt), 'job total shows the driveways: ' + tt); }
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nhow customers pay + QuickBooks (desktop)');
  { const { ctx, page } = await newCtx(browser, { viewport: { width: 1366, height: 900 } }); await demo(page);
    await page.goto(URL0 + '#/settings/company'); await page.waitForSelector('text=How customers pay you');
    await page.fill('label:has-text("Online payment link") input', 'javascript:alert(1)'); await page.waitForTimeout(900);
    let d = await db(page); expect(!d.companies[0].settings?.payments?.link, 'javascript: payment link refused');
    await page.fill('label:has-text("Online payment link") input', 'https://buy.stripe.com/test_123');
    await page.fill('label:has-text("Venmo") input', '@Rutherford-Paving');
    await page.fill('label:has-text("Mail checks to") input', 'PO Box 1, New Concord OH'); await page.waitForTimeout(1200);
    d = await db(page); expect(d.companies[0].settings.payments.link === 'https://buy.stripe.com/test_123' && d.companies[0].settings.payments.venmo === '@Rutherford-Paving', 'payment info saved');
    // the browser won't let us copy: show the link to copy by hand, no browser popup
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } }); });
    await page.click('label.toggle:has-text("Take quote requests online")'); await page.waitForTimeout(600);
    await page.click('button:has-text("Copy website button")'); await page.waitForSelector('.copy-box');
    expect(/get-quote/.test(await page.inputValue('.copy-box')) && !page.dialogs.length, 'copy blocked: shows the code to copy, no popup');
    await page.click('.sheet-actions >> text=Done');
    // leave the map while the AI is still tracing
    await page.goto(URL0 + '#/jobs'); await page.waitForSelector('.job-card'); await page.click('.job-card >> text=Kroger'); await page.click('.tabs >> text=Map'); await page.waitForSelector('#map');
    await page.click('text=AI outline the lot'); await page.click('.tabs >> text=Details'); await page.waitForTimeout(2500);
    expect(!page.errors.length && await page.locator('.sheet >> text=AI outline').count() === 0, 'leaving the map mid-trace: no crash, no stray popup');
    await page.goto(URL0 + '#/money'); await page.waitForSelector('h1 >> text=Money');
    await page.click('.job-card >> text=Muskingum Valley Bank'); await page.waitForSelector('.money-tab');
    const t = decodeURIComponent(await page.getAttribute('.inv-card a:has-text("Text it")', 'href'));
    expect(/How to pay \$[\d,.]+:/.test(t) && /buy\.stripe\.com\/test_123/.test(t) && /Venmo: @Rutherford-Paving/.test(t), 'texted invoice says how to pay');
    await page.click('.inv-card >> text=View / print'); await page.waitForSelector('.sheet .invoice');
    const link = page.locator('.sheet .pay-ways a[href="https://buy.stripe.com/test_123"]');
    expect(await link.count() === 1 && await page.locator('.sheet .pay-ways a[href^="https://venmo.com/u/Rutherford-Paving"]').count() === 1, 'printed invoice has tappable pay links');
    await page.click('.sheet-actions >> text=Close');
    // QuickBooks
    await page.goto(URL0 + '#/money'); await page.waitForSelector('text=For your accountant');
    { const tt = await page.textContent('section:has-text("For your accountant")'); expect(/Billed \$[\d,.]+ · collected \$[\d,.]+ · still owed \$[\d,.]+/.test(tt), 'year totals shown'); }
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('section:has-text("For your accountant") >> button:has-text("Invoices")')]);
    const txt = fs.readFileSync(await dl.path(), 'utf8');
    expect(dl.suggestedFilename() === `invoices-${new Date().getFullYear()}.csv`, 'file name ' + dl.suggestedFilename());
    expect(/^"InvoiceNo","Customer","InvoiceDate"/.test(txt) && /"Sealcoating"/.test(txt) && /"\d\d\/\d\d\/\d{4}"/.test(txt), 'QuickBooks invoice CSV looks right');
    await page.selectOption('section:has-text("For your accountant") select', 'all');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('section:has-text("For your accountant") >> button:has-text("Payments")')]);
    expect(/"Check"/.test(fs.readFileSync(await dl2.path(), 'utf8')), 'payments CSV has the check payments');
    const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('section:has-text("For your accountant") >> button:has-text("Customers")')]);
    expect(/Karen Miller|Steve Price/.test(fs.readFileSync(await dl3.path(), 'utf8')), 'customers CSV has billed customers');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\ntime clock (phone)');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    // Mike is the logged-in crew member, with a job today
    await setDb(page, () => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); const mike = d.crew.find(c => c.name === 'Mike'); mike.user_id = d.user.id; const j = d.jobs.find(x => x.title.startsWith('Kroger')); const x = new Date(); j.scheduled_date = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; j.lat = 39.94; j.lng = -82.0; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation({ latitude: 39.9401, longitude: -82.0 });
    await page.reload(); await page.waitForSelector('.job-card');
    await page.click('.nav >> text=Schedule'); await page.waitForSelector('.clock');
    expect(await page.locator('.clock >> text=Clock in at Kroger, Maple Ave').count() === 1, 'shows Clock in for today\'s job');
    await page.evaluate(() => { window.__lcOffline = true; });
    await page.click('.clock-btn'); await page.waitForTimeout(600);
    expect(/No signal/.test(await page.textContent('#toast')) && await page.locator('.clock-btn').isEnabled(), 'no signal: clear message, can retry');
    await page.evaluate(() => { window.__lcOffline = false; });
    await page.click('.clock-btn'); await page.waitForSelector('.clock-on');
    expect(/on site/.test(await page.textContent('#toast')), 'clocked in on site (GPS ~36 ft away)');
    await page.reload(); await page.waitForSelector('.clock-on');
    expect(/On the clock/.test(await page.textContent('.clock')) && /Kroger/.test(await page.textContent('.clock')), 'still on the clock after reload');
    await screenOk(page, 'on the clock'); await page.screenshot({ path: `${out}/clock.png` });
    let d = await db(page); expect(d.time.length === 1 && d.time[0].in_dist_ft < 100, 'saved with distance ' + d.time[0].in_dist_ft + ' ft');
    await page.click('text=Clock out'); await page.waitForSelector('.clock >> text=Clock in at');
    d = await db(page); expect(d.time[0].out_at, 'clocked out');
    // the office: add a full 8-hour shift and use it in the wrap-up
    await setDb(page, () => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); const j = d.jobs.find(x => x.title.startsWith('Kroger')); const josh = d.crew.find(c => c.name === 'Josh'); const t = Date.now() - 9 * 3600e3; d.time.push({ id: 'x1', company_id: j.company_id, job_id: j.id, crew_id: josh.id, in_at: new Date(t).toISOString(), out_at: new Date(t + 8 * 3600e3).toISOString() }); d.time[0].out_at = new Date(new Date(d.time[0].in_at).getTime() + 7.5 * 3600e3).toISOString(); localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.goto(URL0 + '#/jobs'); await page.reload(); await page.waitForSelector('.job-card');
    await page.click('.job-card >> text=Kroger'); await page.click('.tabs >> text=Money'); await page.waitForSelector('.money-tab');
    const btn = page.locator('button:has-text("Use time clock hours")');
    expect(await btn.count() === 1 && /15\.5 hrs, 2 people/.test(await btn.textContent()), 'wrap-up offers the clock hours (15.5 hrs, 2 people): ' + (await btn.count() ? await btn.textContent() : 'no button'));
    await btn.click(); await page.waitForTimeout(900);
    const vals = await page.locator('.wrap-crew input').evaluateAll(xs => xs.map(x => x.value));
    expect(vals.includes('7.5') && vals.includes('8'), 'hours filled in: ' + vals.join(', '));
    // crew without a linked login
    await setDb(page, () => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); d.crew.forEach(c => c.user_id = null); d.members[0].role = 'crew'; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.goto(URL0 + '#/schedule'); await page.reload(); await page.waitForSelector('.page-head h1');
    expect(await page.locator('.clock').count() === 0, 'no time clock until the login is linked');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  await browser.close(); server.close();
  const failed = results.filter(r => r[0] === 'bad').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
