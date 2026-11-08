// Clicks through the app in a real browser (demo mode), phone + desktop. Usage: node test/e2e.cjs <outdir>
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
const fails = []; const ok = m => console.log('  ✓ ' + m); const bad = m => { fails.push(m); console.log('  ✗ ' + m); };
const expect = (cond, m) => cond ? ok(m) : bad(m);

(async () => {
  await new Promise(r => server.listen(4173, r));
  const browser = await chromium.launch();
  for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 900 }]]) {
    console.log(`\n${name}`);
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: name === 'phone', isMobile: name === 'phone' });
    // no internet in the test box: answer map tiles with a gray image and address search with a fixed result
    await ctx.route(/arcgisonline|openstreetmap\.org\/\d|tile\.openstreetmap/, r => r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(root, 'icon-192.png')) }));
    await ctx.route(/nominatim/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ lat: '39.9409', lon: '-82.0050', display_name: '3575 Maple Ave, Zanesville, Muskingum County, Ohio, 43701, United States' }]) }));
    await ctx.route(/fonts\.(googleapis|gstatic)|supabase\.co/, r => r.abort());
    await ctx.route(/api\.open-meteo\.com/, r => r.fulfill({ status: 200, contentType: 'application/json', body: fakeForecast() }));
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const shot = async n => { await page.screenshot({ path: `${out}/${name}-${n}.png`, fullPage: false }); const junk = await page.evaluate(() => /\b(null|undefined|NaN)\b/.test(document.body.innerText.replace(/Rutherford|nullable/g, ''))); if (junk) bad(`${n}: the words null/undefined/NaN show on screen`); const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); if (w[0] > w[1] + 1) bad(`${n}: page is ${w[0]}px wide on a ${w[1]}px screen`); };
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('.auth');
    await shot('01-signin');
    expect(await page.isVisible('text=Measure the lot. Price the job. Send the quote.'), 'sign-in screen shows');

    await page.click('text=Try the demo, no account needed');
    await page.waitForSelector('.job-card');
    await shot('02-jobs');
    { const t = await page.$$eval('.job-card', xs => xs.map(x => x.textContent).join('|')); expect(['Red Lobster', 'First Baptist', 'Kroger'].every(n => t.includes(n)), 'demo has its open jobs (Red Lobster, First Baptist, Kroger)'); }

    await page.click('.job-card >> text=Red Lobster, Maple Ave');
    await page.waitForSelector('.leaflet-container');
    await page.waitForTimeout(600);
    await shot('03-map');
    const sum = await page.textContent('.map-sum');
    expect(/Sealcoat\s*[\d,]+ sq ft/.test(sum), 'map sums sealcoat area: ' + sum.replace(/\s+/g, ' '));
    expect(/Stalls\s*44/.test(sum), 'map counts 44 stalls (2 rows of 198 ft at 9 ft)');
    const total1 = await page.textContent('.tb-total');
    expect(/\$[\d,]+/.test(total1) && total1 !== '$0', 'total bar shows ' + total1);

    // draw a new crack with 3 taps
    await page.click('.tool >> text=Crack');
    const box = await page.locator('#map').boundingBox();
    const isPhone = name === 'phone';
    const tap = async (fx, fy) => { const b = await page.locator('#map').boundingBox(); return isPhone ? page.touchscreen.tap(b.x + b.width * fx, b.y + b.height * fy) : page.mouse.click(b.x + b.width * fx, b.y + b.height * fy); };
    const press = sel => isPhone ? page.tap(sel) : page.click(sel);
    await tap(0.3, 0.45); await tap(0.5, 0.47); await tap(0.7, 0.43);
    await page.waitForTimeout(150);
    await shot('04-drawing');
    await press('.draw-bar .finish');
    await press('.draw-bar >> text=Cancel');
    const sum2 = await page.textContent('.map-sum');
    expect(sum2 !== sum, 'drawing a crack changes the totals');
    expect(await page.isVisible('.feature-editor'), 'new shape is selected for editing');
    await shot('05-shape-edit');

    // stencil
    await page.click('.tool >> text=Stencil');
    await page.selectOption('.sheet select', 'handicap');
    await page.click('text=Start placing');
    await tap(0.4, 0.3); await press('.draw-bar >> text=Cancel');
    expect(/Stencils\s*3/.test(await page.textContent('.map-sum')), 'stencil placed (3 total)');

    // estimate
    await page.click('.tabs >> text=Estimate');
    await page.waitForSelector('.est-out .money');
    await shot('06-estimate');
    await page.evaluate(() => window.scrollTo(0, 99999)); await shot('07-estimate-bottom');
    const est = await page.textContent('.est-out');
    expect(/Sealcoat:/.test(est) && /Crack fill:/.test(est), 'estimate has sealcoat + crack lines');
    expect(/Handicap symbol × 2/.test(est), 'ADA auto: 44 stalls -> 2 handicap stencils (map stencil counted)');
    expect(/ADA sign \+ post × 2/.test(est), 'ADA signs added');
    expect(/Break-even/.test(est) && /Profit|Loss/.test(est), 'shows break-even + profit');
    expect(/Tank mix/.test(est) && /Crack filler/.test(est) && /Paint/.test(est), 'shows tank mix, filler and paint');
    // turn off sealcoat → total drops
    const before = await page.textContent('.tb-total');
    await page.click('.svc .toggle >> text=Sealcoating');
    await page.waitForTimeout(100);
    const after = await page.textContent('.tb-total');
    expect(before !== after, `turning off sealcoat changes total (${before} -> ${after})`);
    await page.click('.svc .toggle >> text=Sealcoating');

    // quote
    await page.click('.tabs >> text=Quote');
    await page.waitForSelector('.quote');
    await shot('08-quote');
    const q = await page.textContent('.quote');
    expect(/Jon Anderson/.test(q) && /Scope of work/.test(q) && /Total/.test(q), 'quote has customer, scope, total');
    expect(!/Profit|Break-even|wage/i.test(q), 'quote hides costs and profit from the customer');
    // Good / Better / Best
    await page.click('.opt-section .toggle');
    await page.waitForSelector('.opt-card');
    const prices = await page.$$eval('.opt-price', els => els.map(e => Number(e.textContent.replace(/[^\d]/g, ''))));
    expect(prices.length === 3 && prices[0] < prices[1] && prices[1] < prices[2], 'Basic < Standard < Premium: ' + prices.join(' < '));
    expect((await page.$$('.paper .q-opt')).length === 3 && /Recommended/.test(await page.textContent('.paper')), 'quote shows 3 options with Standard recommended');
    await shot('08b-options');
    await page.click('.quote-actions >> text=Save quote');
    await page.waitForSelector('text=Saved quotes');
    expect(await page.locator('text=/No\\. 10\\d\\d/').count() >= 1, 'quote saved with a number');
    const link = await page.inputValue('.link-box');
    expect(/#\/q\/[0-9a-f]{36}$/.test(link), 'customer link made');
    // the customer opens it on their phone
    const cust = await ctx.newPage(); cust.on('pageerror', e => errors.push('customer page: ' + e.message));
    await cust.goto(link); await cust.waitForSelector('.pq-sign');
    expect(!/Profit|Break-even|wage|Labor/i.test(await cust.textContent('body')), 'customer page shows no costs or profit');
    expect(!(await cust.isVisible('.nav')), 'customer page has no app menus');
    await cust.click('.q-opt >> nth=2');
    expect(/Premium/.test(await cust.textContent('.pq-total')), 'customer picks Premium');
    await cust.click('.pq-accept');
    expect(/Sign in the box/.test(await cust.textContent('.form-error')), 'cannot accept without signing');
    const pad = await cust.locator('.sig-pad').boundingBox();
    const stroke = async pts => { if (isPhone) { await cust.dispatchEvent('.sig-pad', 'pointerdown', { clientX: pad.x + pad.width * pts[0][0], clientY: pad.y + pad.height * pts[0][1], pointerId: 1, bubbles: true }); for (const [x, y] of pts.slice(1)) await cust.dispatchEvent('.sig-pad', 'pointermove', { clientX: pad.x + pad.width * x, clientY: pad.y + pad.height * y, pointerId: 1, bubbles: true }); await cust.dispatchEvent('.sig-pad', 'pointerup', { pointerId: 1, bubbles: true }); } else { await cust.mouse.move(pad.x + pad.width * pts[0][0], pad.y + pad.height * pts[0][1]); await cust.mouse.down(); for (const [x, y] of pts.slice(1)) await cust.mouse.move(pad.x + pad.width * x, pad.y + pad.height * y, { steps: 4 }); await cust.mouse.up(); } };
    await stroke([[0.1, 0.6], [0.2, 0.3], [0.3, 0.7], [0.45, 0.35], [0.6, 0.65], [0.8, 0.4]]);
    await cust.click('.pq-accept');
    expect(/agree to the terms/.test(await cust.textContent('.form-error')), 'must check the terms box');
    await cust.check('#pq-agree');
    await cust.screenshot({ path: `${out}/${name}-08c-customer-sign.png`, fullPage: true });
    await cust.click('.pq-accept');
    await cust.waitForSelector('.pq-done');
    expect(/Accepted/.test(await cust.textContent('.pq-done')) && /Jon Anderson/.test(await cust.textContent('.pq-done')), 'customer sees Accepted with their name');
    await cust.screenshot({ path: `${out}/${name}-08d-customer-done.png` });
    await cust.reload(); await cust.waitForSelector('.pq-done');
    expect(!(await cust.isVisible('.pq-sign')), 'reopening the link shows it is already accepted (no second signature)');
    await cust.close();
    // back in the app
    await page.click('.tabs >> text=Map'); await page.click('.tabs >> text=Quote'); await page.waitForSelector('.qlist');
    const q1001 = await page.textContent('.qlist');
    expect(/Accepted/.test(q1001) && /Signed by Jon Anderson/.test(q1001) && /picked Premium/.test(q1001), 'your app shows signed, by whom, which option');
    expect(await page.isVisible('.sig-img'), 'signature image on file');
    await shot('08e-signed');

    // details + schedule
    await page.click('.tabs >> text=Details');
    await page.waitForSelector('.details-tab');
    await shot('09-details');
    await page.waitForSelector('.wx-day');
    expect((await page.$$('.wx-day')).length === 14, 'shows a 14-day forecast');
    const verdicts = await page.$$eval('.wx-day .wx-verdict', els => els.map(e => e.textContent));
    expect(/Risky/.test(verdicts[0]) && /No-go/.test(verdicts[1]) && /No-go/.test(verdicts[2]) && /Good/.test(verdicts[3]) && /Risky/.test(verdicts[4]), 'rain-tomorrow risky / rain no-go / cold no-go / good / windy risky: ' + verdicts.slice(0, 5).join(', '));
    await page.click('.wx-day >> nth=1'); await page.waitForTimeout(400);
    expect(await page.isVisible('.wx-box .warnings'), 'picking a rainy day warns right away');
    await shot('09b-weather');
    await page.click('.wx-day >> nth=3'); await page.waitForTimeout(500);
    expect(/Wind/.test(await page.textContent('.wx-box .warnings')), '2-day job starting day 3 warns about day 4 wind');
    await page.click('.wx-day >> nth=5'); await page.waitForTimeout(900);
    expect(!(await page.isVisible('.wx-box .warnings')), 'picking 2 good days clears the warning');
    expect(await page.textContent('#saved') !== 'Not saved', 'details autosave');
    // photos
    await page.click('.tabs >> text=Photos'); await page.waitForSelector('.photos-tab');
    expect(await page.isVisible('text=No photos yet'), 'empty photo screen explains what to do');
    await page.click('.seg-btn >> text=Damage');
    await page.setInputFiles('.photos-tab input[multiple]', [path.join(root, 'icon-512.png'), path.join(root, 'icon-192.png')]);
    await page.waitForSelector('.photo-thumb'); await page.waitForTimeout(300);
    expect((await page.$$('.photo-thumb')).length === 2 && await page.isVisible('text=Damage / problem areas (2)'), 'two photos added under Damage');
    await page.click('.photo-thumb >> nth=0'); await page.fill('.sheet textarea', 'alligator cracks by dumpster'); await page.selectOption('.sheet select', 'before'); await page.click('.sheet-actions >> text=Save');
    await page.waitForSelector('text=Before (1)');
    expect(await page.isVisible('.photo-note >> text=alligator cracks by dumpster'), 'photo note + relabel saved');
    await shot('09c-photos');
    await page.click('.tabs >> text=Details'); await page.waitForSelector('.details-tab');
    await page.click('.nav >> text=Schedule');
    await page.waitForSelector('.page-head >> text=Schedule');
    await shot('10-schedule');
    await page.click('.seg >> text=List'); await page.waitForSelector('.sched-card');
    expect(await page.isVisible('.sched-card >> text=Red Lobster, Maple Ave'), 'job on schedule');
    const won = (await page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')).jobs.find(j => j.title.startsWith('Red Lobster'))));
    expect(['won', 'scheduled'].includes(won.status), 'signed job turned Won (now ' + won.status + ')');
    await page.waitForSelector('.sched-card:has-text("Red Lobster") .wx-pill', { timeout: 5000 }).catch(() => {});
    expect(/Good to go/.test(await page.textContent('.sched-card:has-text("Red Lobster")')), 'schedule shows the weather for the job day');
    expect(await page.isVisible('text=Text the crew (3)'), 'text crew with 3 phone numbers');

    // calculators
    await page.click('.nav >> text=Calculators');
    await page.waitForSelector('.calc');
    await shot('11-calculators');
    const calcs = await page.textContent('.calc-grid');
    expect(/Boxes\s*5 × 30 lb/.test(calcs), '1000 ft crack = 5 boxes');
    expect(/Accessible spaces\s*2/.test(calcs), '45 stalls = 2 ADA');

    // settings
    await page.click('.nav >> text=Settings');
    await page.waitForSelector('.subnav');
    await page.click('.subnav >> text=Prices and rates'); await page.waitForSelector('text=Minimum job price'); await shot('12-rates');
    await page.click('.subnav >> text=Crew and wages'); await page.waitForSelector('.crew-row'); await shot('13-crew');
    expect((await page.$$('.crew-row')).length === 3, '3 crew with wages');
    await page.click('.subnav >> text=Team'); await page.click('text=Invite estimator'); await page.waitForSelector('.big-code');
    expect(/^[0-9A-F]{12}$/.test((await page.textContent('.big-code')).trim()), 'invite code made');
    await shot('14-invite'); await page.click('.sheet >> text=Done');

    // new job, typed numbers only: 5000 ft cracks, way past minimum
    await page.click('.nav >> text=Jobs'); await page.click('.page-head >> text=New job');
    await page.fill('.sheet input >> nth=0', 'Kroger Zanesville'); await page.fill('.sheet input >> nth=1', '3575 Maple Ave, Zanesville, OH');
    await page.click('text=Create job'); await page.waitForSelector('.leaflet-container');
    await page.click('.tabs >> text=Estimate'); await page.waitForSelector('.est-form');
    await page.click('.svc .toggle >> text=Crack filling');
    const crackInput = page.locator('.svc:has-text("Crack filling") input[type=number]').first();
    await crackInput.fill('5000');
    await page.waitForTimeout(200);
    const est2 = await page.textContent('.est-out');
    expect(/\$5,000\.00/.test(est2), '5000 ft crack job = $5,000');
    expect(/over your \$500 minimum/.test(est2), 'shows how far past the $500 minimum');
    expect(/Crack filler\s*22 boxes/.test(est2), '22 boxes of crack filler');
    await shot('15-crack-job');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scrolling');
    expect(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
