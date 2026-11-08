// Crew schedules: week board, booking warnings, days off, crew view. Usage: node test/schedule.cjs <outdir>
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = m => { results.push(['ok', m]); console.log('  ✓ ' + m); }; const bad = m => { results.push(['bad', m]); console.log('  ✗ ' + m); };
const expect = (c, m) => c ? ok(m) : bad(m);
const URL0 = 'http://localhost:4198/';
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  await ctx.route(/arcgisonline|tile\.openstreetmap|nominatim|fonts\.|supabase\.co|open-meteo/, r => r.abort());
  const page = await ctx.newPage(); page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss(); });
  return { ctx, page };
}
const demo = async page => { await page.goto(URL0); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card'); };
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('lotcalc-demo')));
const day = k => { const x = new Date(); x.setDate(x.getDate() + k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const screenOk = async (page, label) => {
  const st = await page.evaluate(() => ({ bad: (document.body.innerText.match(/\b(null|undefined|NaN|Infinity|\[object Object\])\b/g) || []), wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  expect(!st.bad.length, `${label}: no null/undefined/NaN on screen${st.bad.length ? ' (' + st.bad.join(',') + ')' : ''}`);
  expect(!st.wide, `${label}: page fits the screen (board scrolls inside its box)`);
};
// go to the week that holds `d`
const toWeek = async (page, d) => { for (let i = 0; i < 6; i++) { const has = await page.evaluate(dd => [...document.querySelectorAll('.wk thead th')].some(th => th.dataset.day === dd) || window.__weekHas?.(dd), d); if (has) return; const first = await page.evaluate(() => window.__lc && null); break; } };
const openSchedule = async page => { await page.goto(URL0 + '#/schedule'); await page.waitForSelector('.page-head h1'); await page.waitForTimeout(300); };
const nextWeek = page => page.click('[aria-label="Next week"]');
const cellText = async (page, name) => page.locator(`.wk tr:has(th.wk-name span:text-is("${name}")) td`).allTextContents();

(async () => {
  await new Promise(r => server.listen(4198, r));
  const browser = await chromium.launch();
  const tomorrow = day(1), dow = (new Date().getDay() + 6) % 7; // 0 = Monday
  const tomorrowNextWeek = dow === 6; // today is Sunday → tomorrow is in next week

  console.log('\nweek board (phone)');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await openSchedule(page);
    expect(await page.locator('.wk').count() === 1, 'week board is the default view');
    expect((await page.locator('.wk tbody tr').count()) >= 3, 'a row for each crew member');
    if (tomorrowNextWeek) await nextWeek(page);
    await page.waitForTimeout(200);
    const mike = (await cellText(page, 'Mike')).join(' | '), tyler = (await cellText(page, 'Tyler')).join(' | ');
    expect(/Kroger/.test(mike), 'Kroger shows on Mike\'s row');
    expect(!/Kroger/.test(tyler), 'and not on Tyler\'s (he isn\'t on it)');
    expect(/1\/2/.test(mike) && /2\/2/.test(mike) || tomorrowNextWeek || dow === 5, '2-day job shows day 1/2 and 2/2');
    await screenOk(page, 'week board'); await page.screenshot({ path: `${out}/week-phone.png`, fullPage: true });
    // text Mike his week
    const sms = decodeURIComponent(await page.getAttribute('.wk tr:has(th.wk-name span:text-is("Mike")) .wk-text', 'href'));
    expect(/^sms:7405550101/.test(sms) && /Mike schedule from Rutherford Paving/.test(sms) && /Kroger/.test(sms), 'text-Mike-his-week link has his jobs');
    // next week: Tyler is off
    if (!tomorrowNextWeek) await nextWeek(page); await page.waitForTimeout(200);
    for (let i = 0; i < 2 && !(await cellText(page, 'Tyler')).join(' ').includes('Off'); i++) { await nextWeek(page); await page.waitForTimeout(150); }
    expect((await cellText(page, 'Tyler')).join(' ').includes('Off · Vacation'), 'Tyler\'s vacation shows as Off');
    // spin through weeks fast
    for (let i = 0; i < 30; i++) await page.click(i % 3 ? '[aria-label="Next week"]' : '[aria-label="Last week"]');
    await page.click('text=This week').catch(() => {});
    await screenOk(page, 'after flipping 30 weeks');
    // list view is remembered
    await page.click('.seg >> text=List'); await page.reload(); await page.waitForSelector('.page-head h1'); await page.waitForTimeout(300);
    expect(await page.locator('.wk').count() === 0 && await page.locator('.seg button.on >> text=List').count() === 1, 'List view remembered after reload');
    expect(await page.locator('text=Kroger').count() >= 1, 'list shows Kroger');
    await page.click('.seg >> text=Week');
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nbooking warnings on the Details tab');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.click('.chip >> text=All'); await page.click('.job-card >> text=First Baptist'); await page.click('.tabs >> text=Details'); await page.waitForSelector('.booking');
    await page.fill('input[type=date] >> nth=0', tomorrow); await page.dispatchEvent('input[type=date] >> nth=0', 'change'); await page.waitForTimeout(150);
    expect(/busy: Kroger/.test(await page.locator('.booking .toggle:has-text("Mike")').textContent()), 'Mike shows as busy on Kroger that day');
    expect(/free/.test(await page.locator('.booking .toggle:has-text("Tyler")').textContent()), 'Tyler shows as free');
    expect(await page.locator('.booking .toggle:has-text("Mike") input:checked').count() === 1, 'Mike is already on this job');
    expect(await page.locator('.booking .warnings >> text=Mike is already on Kroger').count() === 1, 'picking that date warns Mike is already on Kroger');
    await page.click('.booking .toggle:has-text("Mike")'); await page.waitForTimeout(150);
    expect(await page.locator('.booking .warnings >> text=Mike is already').count() === 0, 'taking Mike off clears his warning');
    await page.click('.booking .toggle:has-text("Mike")'); await page.waitForTimeout(150);
    // book Tyler on his vacation
    await page.fill('input[type=date] >> nth=0', day(8)); await page.dispatchEvent('input[type=date] >> nth=0', 'change'); await page.waitForTimeout(150);
    await page.click('.booking .toggle:has-text("Tyler")'); await page.waitForTimeout(200);
    expect(await page.locator('.booking .warnings >> text=/Tyler is off .*Vacation/').count() === 1, 'booking Tyler on his vacation warns');
    expect(await page.locator('.booking .warnings >> text=Mike is already').count() === 0, 'Mike warning gone on the new date');
    // junk day counts
    for (const v of ['1e9', '-5', 'abc', '0']) { await page.fill('.details-tab input[type=number] >> nth=0', v).catch(() => {}); await page.waitForTimeout(80); }
    await screenOk(page, 'junk day counts');
    await page.fill('.details-tab input[type=number] >> nth=0', '1e9'); await page.waitForTimeout(900);
    const d = await db(page); const fb = d.jobs.find(j => j.title.startsWith('First Baptist'));
    expect(fb.scheduled_days <= 60, `huge day count capped (${fb.scheduled_days})`);
    // back to tomorrow with Mike → the board shows the clash
    await page.fill('.details-tab input[type=number] >> nth=0', '1');
    await page.fill('input[type=date] >> nth=0', tomorrow); await page.dispatchEvent('input[type=date] >> nth=0', 'change'); await page.waitForTimeout(900);
    await openSchedule(page); if (tomorrowNextWeek) await nextWeek(page); await page.waitForTimeout(200);
    expect(await page.locator('.wk tr:has(th.wk-name span:text-is("Mike")) td.clash').count() >= 1, 'board outlines Mike\'s double-booked day');
    expect(await page.locator('.wk-probs >> text=/Mike is on 2 jobs/').count() >= 1, 'board lists the double-booking');
    await page.screenshot({ path: `${out}/week-clash.png`, fullPage: true });
    expect(!page.errors.length && !page.dialogs.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\ncrew editor: days off, login, calendar link, Cancel');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    await page.goto(URL0 + '#/settings/crew'); await page.waitForSelector('.crew-row');
    await page.click('.crew-row:has-text("Josh") >> text=Edit'); await page.waitForSelector('.sheet');
    await page.click('text=+ Add days off'); await page.click('.sheet-actions >> text=Cancel'); await page.waitForTimeout(300);
    let d = await db(page); expect(!(d.crew.find(c => c.name === 'Josh').time_off || []).length, 'Cancel: days off not saved');
    await page.click('.crew-row:has-text("Josh") >> text=Edit'); await page.waitForSelector('.sheet');
    await page.click('text=+ Add days off');
    await page.fill('.off-row input[type=date] >> nth=0', day(3)); await page.dispatchEvent('.off-row input[type=date] >> nth=0', 'change');
    await page.fill('.off-row input[type=date] >> nth=1', day(1)); // "to" before "from": should fall back to a single day
    await page.fill('.off-row input:not([type=date])', 'Doctor <img src=x onerror=alert(1)>');
    await page.selectOption('.sheet select', { index: 1 });
    await page.click('.sheet-actions >> text=Save'); await page.waitForTimeout(500);
    d = await db(page); const josh = d.crew.find(c => c.name === 'Josh');
    expect(josh.time_off.length === 1 && josh.time_off[0].from === day(3) && josh.time_off[0].to === day(3), 'backwards dates saved as one day off');
    expect(josh.user_id === d.user.id, 'login linked');
    expect(/has login/.test(await page.textContent('.crew-row:has-text("Josh")')) && /off /.test(await page.textContent('.crew-row:has-text("Josh")')), 'crew list shows login and upcoming days off');
    // can't link the same login to a second person
    await page.click('.crew-row:has-text("Mike") >> text=Edit'); await page.waitForSelector('.sheet');
    expect(await page.locator('.sheet select option').count() === 1, 'a login already linked to Josh isn\'t offered for Mike');
    await page.click('text=Calendar link'); await page.waitForTimeout(300);
    expect(await page.locator('.sheet >> text=need a real account').count() === 1, 'demo: calendar link explains it needs a real account');
    await page.click('.sheet-actions >> text=OK'); await page.click('.sheet-actions >> text=Cancel');
    expect(!page.dialogs.length, 'hostile note didn\'t run');
    await screenOk(page, 'crew settings');
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\ncrew login: My jobs');
  { const { ctx, page } = await newCtx(browser); await demo(page);
    // not linked yet
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); d.members[0].role = 'crew'; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('.job-card'); await openSchedule(page);
    expect(await page.locator('h1 >> text=My jobs').count() === 1, 'crew see "My jobs"');
    expect(await page.locator('.note >> text=Ask your boss to link your login').count() === 1, 'not linked: told to ask the boss');
    expect(await page.locator('.wk-text').count() === 0, 'no phone numbers / text buttons for crew');
    // linked to Mike
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); d.crew.find(c => c.name === 'Mike').user_id = d.user.id; localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('.page-head h1'); await page.waitForTimeout(300);
    expect(await page.locator('.wk tbody tr').count() === 1 && await page.locator('.wk tr.me >> text=Mike').count() === 1, 'linked: only my own row');
    await page.click('.seg >> text=List'); await page.waitForTimeout(200);
    const txt = await page.textContent('.page');
    expect(/Kroger/.test(txt) && !/Muskingum|Dollar General/.test(txt), 'list shows only my jobs');
    expect(!/\$\d/.test(txt), 'no prices on my schedule');
    await page.click('text=Put my jobs on my phone calendar'); await page.waitForTimeout(300);
    expect(await page.locator('#toast >> text=No calendar link').count() === 1 || await page.locator('.sheet').count() === 1, 'demo calendar button handled');
    await page.click('.seg >> text=Week');
    await screenOk(page, 'crew view');
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  console.log('\nlots of crew + jobs (desktop)');
  { const { ctx, page } = await newCtx(browser, { viewport: { width: 1366, height: 900 } }); await demo(page);
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lotcalc-demo')); const cid = d.companies[0].id; const t = new Date(); const ds = k => { const x = new Date(t); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10); };
      for (let i = 0; i < 25; i++) d.crew.push({ id: 'cx' + i, company_id: cid, name: 'Worker ' + i + (i === 3 ? ' with a really really long name that goes on' : ''), wage: 15, active: true, time_off: i % 4 ? [] : [{ from: ds(i % 7), to: ds(i % 7 + 1), note: 'x' }] });
      for (let i = 0; i < 120; i++) d.jobs.push({ id: 'jx' + i, company_id: cid, title: 'Lot ' + i, status: 'scheduled', scheduled_date: ds(i % 14 - 3), scheduled_days: 1 + i % 3, crew_ids: ['cx' + (i % 25), 'cx' + ((i * 7) % 25)], inputs: {}, drawing: null, customer: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      localStorage.setItem('lotcalc-demo', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('.job-card');
    const t0 = Date.now(); await openSchedule(page); await page.waitForSelector('.wk'); const ms = Date.now() - t0;
    expect(ms < 3000, `28 crew x 120 jobs board in ${ms} ms`);
    expect(await page.locator('.wk td.clash').count() > 0, 'clashes flagged in a busy week');
    await screenOk(page, 'busy board'); await page.screenshot({ path: `${out}/week-busy.png` });
    expect(!page.errors.length, 'no errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
    await ctx.close(); }

  await browser.close(); server.close();
  const failed = results.filter(r => r[0] === 'bad').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
