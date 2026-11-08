// Website quote form (demo store): walk through it as a customer and try to break it. Usage: node test/webform.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4201/';
const tile = fs.readFileSync(path.join(root, 'icon-192.png'));
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap/, r => r.fulfill({ status: 200, contentType: 'image/png', body: tile }));
  await ctx.route(/nominatim/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ lat: '39.9409', lon: '-82.0050', display_name: 'Maple Ave, Zanesville' }]) }));
  await ctx.route(/fonts\.|supabase\.co|open-meteo/, r => r.abort());
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
const outline = async page => {
  await page.click('button:has-text("Outline my lot")'); await page.waitForTimeout(300);
  const b = await page.locator('#map').boundingBox();
  for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.75, 0.7], [0.25, 0.7]]) { await page.touchscreen.tap(b.x + b.width * fx, b.y + b.height * fy); await page.waitForTimeout(150); }
  await page.tap('.draw-bar .finish'); await page.waitForTimeout(800);
};

(async () => {
  await new Promise(r => server.listen(4201, r));
  const browser = await chromium.launch();

  console.log('\nturning it on');
  const { ctx, page } = await newCtx(browser); await demo(page);
  const cid = (await db(page)).companies[0].id;
  await page.goto(URL0 + '#/get-quote/' + cid); await page.waitForSelector('main.wf');
  expect(await page.locator('text=Quote form unavailable').count() === 1, 'form is off until you turn it on');
  await page.goto(URL0 + '#/get-quote/not-a-real-company'); await page.waitForSelector('main.wf');
  expect(await page.locator('text=Quote form unavailable').count() === 1, 'made-up company link: unavailable');
  await page.goto(URL0 + '#/settings/company'); await page.waitForSelector('text=Website quote form');
  await page.click('label.toggle:has-text("Take quote requests online")'); await page.waitForTimeout(1000);
  expect((await db(page)).companies[0].settings.webForm.on === true, 'switch saves');
  expect((await page.textContent('.wf-link code')).includes('#/get-quote/' + cid), 'shows the link to share');
  await page.fill('label:has-text("Message at the top") textarea', 'Booking spring now!'); await page.waitForTimeout(1000);
  await screenOk(page, 'settings');

  console.log('\na customer gets a price (phone)');
  await page.goto(URL0 + '#/get-quote/' + cid); await page.waitForSelector('.wf-head');
  expect(/Rutherford Paving/.test(await page.textContent('.wf-head')) && /Booking spring now!/.test(await page.textContent('.wf-msg')), 'shows your company name and message');
  expect(!/\$0\.18|pricePerSqft|0\.18/.test(await page.content()), 'your rates aren\'t on the page');
  await page.fill('.wf-find input', '3575 Maple Ave Zanesville'); await page.click('text=Find it'); await page.waitForTimeout(600);
  await outline(page);
  await page.waitForSelector('.wf-range', { timeout: 5000 });
  const range = await page.textContent('.wf-range');
  expect(/^\$[\d,]+ – \$[\d,]+$/.test(range), 'price range shows: ' + range);
  const [lo, hi] = range.replace(/[$,]/g, '').split(' – ').map(Number);
  expect(lo > 0 && hi > lo, 'low < high');
  await page.click('label.toggle:has-text("Line striping")'); await page.waitForTimeout(800);
  const withStripe = await page.textContent('.wf-range');
  expect(withStripe !== range && /parking spaces \(our guess\)/.test(await page.textContent('.wf-price')), 'adding striping changes the price and guesses spaces');
  await page.fill('.wf-extra input[type=number]', '40'); await page.waitForTimeout(800);
  expect(/40 parking spaces/.test(await page.textContent('.wf-price')), 'typed space count is used');
  for (const l of ['label.toggle:has-text("Sealcoating")', 'label.toggle:has-text("Crack filling")', 'label.toggle:has-text("Line striping")']) await page.click(l);
  await page.waitForTimeout(600);
  expect(/at least one service/.test(await page.textContent('.wf-price')), 'nothing picked: asks for a service');
  await page.click('label.toggle:has-text("Sealcoating")'); await page.waitForTimeout(600);
  await screenOk(page, 'form with price'); await page.screenshot({ path: `${out}/webform.png`, fullPage: true });

  console.log('\nbreaking the send');
  const n0 = (await db(page)).jobs.length;
  await page.click('text=Send my request'); await page.waitForTimeout(300);
  expect(/name|second/.test(await page.textContent('#toast')), 'empty form: tells you what\'s missing');
  await page.fill('label:has-text("Your name") input', 'Karen <img src=x onerror=alert(1)>');
  await page.fill('label:has-text("Phone") input', '123'); await page.click('text=Send my request'); await page.waitForTimeout(300);
  expect(/phone/i.test(await page.textContent('#toast')), 'bad phone number caught');
  await page.fill('label:has-text("Phone") input', '(740) 555-0147');
  await page.fill('label:has-text("Lot address") input', '1240 Military Rd, Zanesville');
  await page.fill('label:has-text("Anything we should know") textarea', 'Gate code 2210');
  await page.evaluate(() => { window.__lcOffline = true; }); await page.click('text=Send my request'); await page.waitForTimeout(300);
  expect(/No signal/.test(await page.textContent('#toast')) && await page.locator('text=Send my request').isEnabled(), 'no signal: message, and you can try again');
  await page.evaluate(() => { window.__lcOffline = false; });
  await page.waitForTimeout(3500); // real people take a few seconds
  await page.click('text=Send my request'); await page.waitForSelector('text=Thanks! We got your request.');
  expect(/Reference: [0-9A-F]{8}/.test(await page.textContent('main')), 'thank-you page with a reference number');
  let d = await db(page); const lead = d.jobs.find(j => j.inputs?.source === 'web');
  expect(d.jobs.length === n0 + 1 && lead && lead.status === 'lead', 'one new lead saved');
  expect(lead && lead.customer.phone === '(740) 555-0147' && /Gate code 2210/.test(lead.notes) && lead.drawing.features.length === 1, 'lead has phone, note and the lot outline');
  expect(!page.dialogs.length, 'hostile name didn\'t run');
  await screenOk(page, 'thank you');

  console.log('\nbots and the owner side');
  await page.goto(URL0 + '#/get-quote/' + cid); await page.reload(); await page.waitForSelector('.wf-head'); await outline(page);
  await page.fill('label:has-text("Your name") input', 'Bot'); await page.fill('label:has-text("Phone") input', '7405550100'); await page.fill('label:has-text("Lot address") input', '1 Main');
  await page.evaluate(() => { const i = document.querySelector('.wf-hp'); i.value = 'http://spam.example'; });
  await page.waitForTimeout(4200); await page.click('text=Send my request'); await page.waitForSelector('text=Thanks! We got your request.');
  d = await db(page); expect(d.jobs.length === n0 + 1, 'bot that fills the hidden box: shown thanks, nothing saved');
  await page.goto(URL0 + '#/jobs'); await page.waitForSelector('.job-card');
  expect(await page.locator('.job-card >> text=(web)').count() === 1, 'lead shows on the Jobs list');
  await page.goto(URL0 + '#/follow'); await page.waitForSelector('h1 >> text=Follow up');
  expect(await page.locator('.fu-card.fu-lead').count() === 1 && await page.locator('.fu-card').first().evaluate(n => n.classList.contains('fu-lead')), 'new website request is first on Follow-ups');
  expect(/Call them today/.test(await page.textContent('.fu-card.fu-lead')), 'marked call them today');
  await page.click('.fu-card.fu-lead .fu-title'); await page.waitForSelector('#map'); await page.waitForTimeout(500);
  expect(/sq ft/.test(await page.textContent('.sum-chip:has(small:text-is("Sealcoat"))')), 'opening it shows their outline measured');
  expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
  await ctx.close();

  await browser.close(); server.close();
  const failed = results.filter(r => r[0] === 'bad').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
