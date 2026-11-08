// Invoices, payments, wrap-up: walk through it and try to break it. Usage: node test/money.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4196/';
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap|nominatim|fonts\.|supabase\.co|open-meteo/, r => r.abort());
  const page = await ctx.newPage(); page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss(); });
  return { ctx, page };
}
const demo = async page => { await page.goto(URL0); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card'); };
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')));
const money = t => Number(String(t).replace(/[^\d.-]/g, ''));
const screenOk = async (page, label) => {
  const st = await page.evaluate(() => ({ bad: (document.body.innerText.match(/\b(null|undefined|NaN|Infinity|\[object Object\])\b/g) || []), wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  expect(!st.bad.length, `${label}: no null/undefined/NaN on screen${st.bad.length ? ' (' + st.bad.join(',') + ')' : ''}`);
  expect(!st.wide, `${label}: fits the screen`);
};
const openJob = async (page, name, tab = 'Money') => { await page.goto(URL0 + '#/jobs'); await page.waitForSelector('.job-card'); await page.click(`.chip >> text=All`); await page.click(`.job-card >> text=${name}`); await page.click(`.tabs >> text=${tab}`); await page.waitForTimeout(300); };
const sheetBtn = (page, t) => page.click(`.sheet-actions >> text=${t}`);

(async () => {
  await new Promise(r => server.listen(4196, r));
  const browser = await chromium.launch();

  console.log('\nmoney screens with demo data');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    const tile = page.locator('.pipe-link:not(.fu-pipe)');
    expect(await tile.count() === 1, 'jobs page shows what you are owed');
    expect(/late/.test(await tile.textContent()), 'owed tile calls out the late invoice');
    await tile.click(); await page.waitForSelector('h1 >> text=Money');
    expect(await page.locator('text=Muskingum Valley Bank').count() >= 1, 'money page lists the bank job as waiting on payment');
    expect(await page.locator('.status.s-lost').count() >= 1, 'late invoice is marked late');
    expect(await page.locator('text=Dollar General').count() >= 1, 'paid job shows under Paid');
    await screenOk(page, 'money page'); await page.screenshot({ path: `${out}/money-page.png` });
    await page.click('.job-card >> text=Muskingum Valley Bank'); await page.waitForSelector('.money-tab');
    expect(/Made|Lost/.test(await page.textContent('.wrap-head')), 'finished job shows how it really did');
    expect(await page.locator('.cmp').count() === 1, 'estimate vs actual table shows');
    await screenOk(page, 'finished job money tab'); await page.screenshot({ path: `${out}/money-tab-done.png`, fullPage: true });
    // record the rest of the payment
    const owedBefore = money(await page.locator('.inv-card .inv-nums div:nth-child(3) dd').textContent());
    await page.click('text=Record payment'); await page.waitForSelector('.sheet');
    expect(money(await page.inputValue('.sheet input[type=number]')) === owedBefore, 'payment amount starts at what is owed');
    await sheetBtn(page, 'Save payment'); await page.waitForTimeout(400);
    expect(await page.locator('.inv-card .status.s-done').count() === 1, 'paying the rest marks it Paid');
    await page.goto(URL0 + '#/jobs'); await page.waitForSelector('.job-card');
    expect(!/late/.test(await page.locator('.pipe-link:not(.fu-pipe)').textContent()), 'nothing late anymore on the jobs page');
    // settings learns from the two finished jobs (both ran slow)
    await page.goto(URL0 + '#/settings/rates'); await page.waitForSelector('.learn');
    expect(await page.locator('.learn-row').count() >= 1, 'settings suggests better numbers from finished jobs');
    await page.click('.learn-row >> nth=0 >> button'); await page.waitForTimeout(900);
    const d = await db(page); const c = d.companies[0].settings;
    expect(c && c.sealcoat && c.sealcoat.sqftPerPersonHourPerCoat < 1200, 'applying a suggestion saves it to your rates');
    await screenOk(page, 'learn box');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\ndeposit, balance, payments on a new job');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await openJob(page, 'Red Lobster');
    const price = money(await page.locator('.inv-nums.big div:nth-child(1) dd').textContent());
    expect(price > 500, 'job price shows on the Money tab');
    await page.click('text=Ask for a deposit'); await page.waitForSelector('.sheet .invoice');
    await page.fill('.sheet input[type=number]', '50'); await page.waitForTimeout(150);
    const prevTotal = money(await page.locator('.sheet .q-total td.num').textContent());
    expect(Math.abs(prevTotal - price / 2) < 0.02, 'deposit preview is 50% of the job');
    await page.fill('.sheet input[type=number]', '-20'); await page.waitForTimeout(100);
    expect(money(await page.locator('.sheet .q-total td.num').textContent()) > 0, 'negative deposit % can\'t make a negative invoice');
    await page.fill('.sheet input[type=number]', '50');
    await page.fill('.sheet input[type=date]', '2001-01-01'); await page.dispatchEvent('.sheet input[type=date]', 'change');
    await sheetBtn(page, 'Create invoice'); await page.waitForTimeout(300);
    expect(await page.locator('.sheet').count() === 1, 'due date in the past is refused');
    await page.fill('.sheet input[type=date]', ''); await page.dispatchEvent('.sheet input[type=date]', 'change');
    await sheetBtn(page, 'Create invoice'); await page.waitForSelector('.inv-card');
    await page.waitForTimeout(900);
    let d = await db(page); const rl = () => d.jobs.find(j => j.title.startsWith('Red Lobster')).id; const mine = () => d.invoices.filter(i => i.job_id === rl());
    expect(mine().filter(i => i.kind === 'deposit').length === 1, 'deposit invoice saved');
    expect(d.jobs.find(j => j.title.startsWith('Red Lobster')).status === 'won', 'billing a quoted job marks it Won');
    expect(await page.locator('text=Ask for a deposit').count() === 0, 'can\'t ask for a second deposit');
    // payments: try to break it
    const pay = async (amt, date) => { await page.click('.inv-card >> text=Record payment'); await page.waitForSelector('.sheet'); await page.fill('.sheet input[type=number]', String(amt)); if (date !== undefined) await page.fill('.sheet input[type=date]', date); await sheetBtn(page, 'Save payment'); await page.waitForTimeout(300); const open = await page.locator('.sheet').count(); if (open) await page.click('.sheet-actions >> text=Cancel'); return !open; };
    const dep = mine()[0];
    expect(!(await pay(dep.total + 5)), 'overpaying is refused');
    expect(!(await pay(0)), '$0 payment refused');
    expect(!(await pay(-50)), 'negative payment refused');
    expect(!(await pay('')), 'blank payment refused');
    expect(!(await pay(10.555)), 'fraction-of-a-cent payment refused');
    expect(!(await pay(10, '2099-01-01')), 'payment dated in the future refused');
    expect(await pay(100), '$100 part payment saved');
    expect(await page.locator('.inv-card .status.s-won').count() === 1, 'shows Part paid');
    expect(await page.locator('text=Void').count() === 0, 'can\'t void an invoice with a payment on it');
    // remove the payment, then void, then re-bill
    await page.click('.pay-list .icon-btn'); await sheetBtn(page, 'Remove'); await page.waitForTimeout(300);
    d = await db(page); expect(mine()[0].payments.length === 0, 'payment removed');
    await page.click('.inv-card >> text=Void'); await sheetBtn(page, 'Void it'); await page.waitForTimeout(300);
    d = await db(page); expect(mine()[0].status === 'void', 'unpaid deposit voided');
    expect(await page.locator('text=Ask for a deposit').count() === 1, 'voided deposit doesn\'t count, can bill again');
    // deposit → pay → bill the rest → pay → fully paid, and totals add to the job price
    await page.click('text=Ask for a deposit'); await sheetBtn(page, 'Create invoice'); await page.waitForTimeout(300);
    d = await db(page);
    await page.click('.inv-card.inv-open >> text=Record payment'); await sheetBtn(page, 'Save payment'); await page.waitForTimeout(300);
    await page.click('text=Bill the rest'); await page.waitForSelector('.sheet .invoice');
    expect(await page.locator('.sheet .q-lines td >> text=/already billed/').count() === 1, 'final bill subtracts the deposit');
    await sheetBtn(page, 'Create invoice'); await page.waitForTimeout(300);
    d = await db(page); const live = mine().filter(i => i.status !== 'void');
    expect(Math.abs(live.reduce((t, i) => t + i.total, 0) - price) < 0.02, `deposit + final bill = the job price exactly (${live.map(i => i.total).join(' + ')} vs ${price})`);
    expect(await page.locator('text=Bill the rest').count() === 0 && await page.locator('text=Bill the job').count() === 0, 'nothing left to bill');
    await page.click('.inv-card.inv-open >> text=Record payment'); await sheetBtn(page, 'Save payment'); await page.waitForTimeout(300);
    expect(money(await page.locator('.inv-nums.big div:nth-child(4) dd').textContent()) === 0, 'owed goes to $0 when everything is paid');
    // printing view
    await page.click('.inv-card >> nth=0 >> text=View / print'); await page.waitForSelector('.sheet .invoice');
    expect(/Paid in full/.test(await page.textContent('.sheet .invoice')), 'printed invoice says Paid in full');
    await page.click('.sheet-actions >> text=Close');
    const sms = await page.getAttribute('.inv-card >> nth=0 >> a:has-text("Text it")', 'href');
    expect(/^sms:/.test(sms) && /Invoice%20No/.test(sms), 'text-it link carries the invoice');
    await screenOk(page, 'money tab after billing'); await page.screenshot({ path: `${out}/money-tab-billed.png`, fullPage: true });
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nwrap-up abuse');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await openJob(page, 'Red Lobster');
    const hours = page.locator('.wrap-crew input');
    expect(await hours.count() === 3, 'crew on the job are listed for hours');
    await hours.nth(0).evaluate(e => { e.type = 'text'; e.value = 'abc'; e.dispatchEvent(new Event('input')); e.type = 'number'; }); await hours.nth(1).fill('-40'); await hours.nth(2).fill('99999999');
    await page.waitForTimeout(200); await screenOk(page, 'junk hours');
    await hours.nth(0).fill('10'); await hours.nth(1).fill('10'); await hours.nth(2).fill('10');
    await page.fill('input[placeholder*="(estimate)"] >> nth=0', '-5');
    await page.click('text=+ Add a cost'); await page.fill('.wrap-other input >> nth=0', '<img src=x onerror=alert(1)>'); await page.fill('.wrap-other input[type=number]', '1e9');
    await page.waitForTimeout(200);
    expect(/Made|Lost/.test(await page.textContent('.wrap-head')), 'headline shows with hours in');
    await screenOk(page, 'wrap-up with junk');
    // leave right away: must still save
    await page.click('.tabs >> text=Map'); await page.waitForTimeout(400);
    let d = await db(page); const rlId = d.jobs.find(j => j.title.startsWith('Red Lobster')).id; const c = (d.costs || []).find(x => x.job_id === rlId);
    expect(c && c.data.actuals.crew.every(x => x.hours === 10), 'hours saved even when you leave right away' + (c ? ' ' + JSON.stringify(c.data.actuals.crew.map(x => x.hours)) : ' (no costs row)'));
    expect(c && c.data.actuals.crew.length === 3, 'crew list saved');
    await page.click('.tabs >> text=Money'); await page.waitForSelector('.wrap-crew');
    expect(await page.inputValue('.wrap-crew input >> nth=0') === '10', 'hours are still there when you come back');
    await page.selectOption('.add-crew', { index: 0 }).catch(() => {});
    await page.click('.wrap-crew >> nth=2 >> .icon-btn'); await page.waitForTimeout(200);
    expect(await page.locator('.wrap-crew').count() === 2, 'take someone off the job');
    await page.selectOption('.add-crew', { label: 'Tyler' }); await page.waitForTimeout(200);
    expect(await page.locator('.wrap-crew').count() === 3, 'add someone back');
    await page.click('text=Mark the job done'); await page.waitForTimeout(1200);
    d = await db(page);
    expect(d.jobs.find(j => j.title.startsWith('Red Lobster')).status === 'done', 'job marked done');
    expect(d.costs.find(x => x.job_id === rlId).data.frozen === true, 'wrap-up locked to the estimate as it was');
    expect(!page.dialogs.length, 'hostile cost label did not run');
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\ncrew can\'t see money');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); d.members[0].role = 'crew'; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('.job-card');
    expect(await page.locator('.pipe-link:not(.fu-pipe)').count() === 0, 'no owed tile for crew');
    await page.click('.job-card >> nth=0'); await page.waitForSelector('.tabs');
    expect(await page.locator('.tabs >> text=Money').count() === 0, 'no Money tab for crew');
    const id = (await page.evaluate(() => location.hash)).split('/')[2];
    await page.goto(URL0 + `#/job/${id}/money`); await page.waitForTimeout(400);
    expect(!(await page.locator('.inv-card, .wrap-crew').count()), 'typing the Money address shows nothing');
    await page.goto(URL0 + '#/money'); await page.waitForTimeout(400);
    expect(await page.locator('h1 >> text=Money').count() === 0, 'money page blocked for crew');
    const leaked = await page.evaluate(async () => { const s = window.__lc.store; return [(await s.listInvoices(window.__lc.company.id)).length, (await s.listCosts(window.__lc.company.id)).length]; });
    expect(leaked[0] === 0 && leaked[1] === 0, 'crew can\'t pull invoices or costs from the data layer either');
    let blocked = false; try { await page.evaluate(async () => { const s = window.__lc.store; await s.createInvoice(window.__lc.jobs[0].id, { kind: 'full', total: 5, data: {} }); }); } catch { blocked = true; }
    expect(blocked, 'crew can\'t create an invoice');
    await ctx.close(); }

  console.log('\nno signal, many invoices, desktop');
  { const { ctx, page } = await newCtx(browser, { viewport: { width: 1366, height: 900 } }); await demo(page);
    await openJob(page, 'Red Lobster');
    await page.evaluate(() => { window.__lcOffline = true; });
    await page.click('text=Bill the job'); await sheetBtn(page, 'Create invoice'); await page.waitForTimeout(300);
    expect(await page.locator('.sheet').count() === 1, 'no signal: invoice not created, window stays open to retry');
    await page.evaluate(() => { window.__lcOffline = false; });
    await sheetBtn(page, 'Create invoice'); await page.waitForTimeout(300);
    expect(await page.locator('.inv-card').count() === 1, 'retry with signal works');
    // 300 invoices across the company: money page still quick
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); const j = d.jobs[0]; for (let i = 0; i < 300; i++) d.invoices.push({ id: 'x' + i, company_id: j.company_id, job_id: j.id, number: 5000 + i, kind: 'full', status: i % 7 ? 'open' : 'void', issued: '2026-01-01', due_date: i % 3 ? '2026-01-15' : '2099-01-01', total: 100 + i, data: { title: 'Bulk ' + i }, payments: i % 2 ? [{ id: 'p' + i, amount: 50, date: '2026-01-10', method: 'cash' }] : [] }); localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    const t0 = Date.now(); await page.goto(URL0 + '#/money'); await page.reload(); await page.waitForSelector('h1 >> text=Money'); const ms = Date.now() - t0;
    expect(ms < 4000, `money page with 300+ invoices loads in ${ms} ms`);
    await screenOk(page, 'money page, 300 invoices');
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  await browser.close(); server.close();
  const failed = results.filter(r => r[0] === 'bad').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
