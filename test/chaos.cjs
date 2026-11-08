// Monkey test: random taps, junk typing, map taps, reloads. Checks the app after every step.
// Usage: node test/chaos.cjs <outdir> [runs] [steps]
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || 'shots'; fs.mkdirSync(out, { recursive: true });
const RUNS = Number(process.argv[3] || 6), STEPS = Number(process.argv[4] || 250);
const root = path.join(__dirname, '..', process.env.OUT || 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
function fakeForecast() {
  const pad = n => String(n).padStart(2, '0'); const time = [], hi = [], lo = [], rain = [], wind = [], code = [];
  for (let i = 0; i < 16; i++) { const d = new Date(); d.setDate(d.getDate() + i); time.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); hi.push(40 + (i * 7) % 35); lo.push(28 + (i * 5) % 25); rain.push((i * 23) % 100); wind.push((i * 9) % 35); code.push([0, 2, 3, 61, 80, 95][i % 6]); }
  return JSON.stringify({ daily: { time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_probability_max: rain, precipitation_sum: rain.map(r => r / 100), wind_speed_10m_max: wind, weather_code: code } });
}
const JUNK = ['0', '-1', '-99999', '1e9', '999999999999', '3.14159', '', ' ', 'abc', '🚗💨', "<img src=x onerror=alert('x')>", '"; DROP TABLE x; --', '00012', '1,000', '½', 'O\'Brien & Sons', 'a'.repeat(400), '5000', '2', '45', '100', '0.5'];
const findings = [];

(async () => {
  await new Promise(r => server.listen(4190, r));
  const browser = await chromium.launch();
  let totalSteps = 0;
  for (let run = 0; run < RUNS; run++) {
    let seed = 1000 + run * 7919; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647; const pick = a => a[Math.floor(rnd() * a.length)];
    const phone = run % 2 === 0;
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1366, height: 900 }, acceptDownloads: true });
    await ctx.route(/arcgisonline|tile\.openstreetmap/, r => r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(root, 'icon-192.png')) }));
    await ctx.route(/nominatim/, r => r.fulfill({ status: 200, contentType: 'application/json', body: rnd() < 0.5 ? JSON.stringify([{ lat: '39.94', lon: '-82.0', display_name: 'Somewhere, Zanesville, OH' }]) : '[]' }));
    await ctx.route(/api\.open-meteo\.com/, r => rnd() < 0.85 ? r.fulfill({ status: 200, contentType: 'application/json', body: fakeForecast() }) : r.fulfill({ status: 500, body: 'oops' }));
    await ctx.route(/fonts\.(googleapis|gstatic)|supabase\.co/, r => r.abort());
    await ctx.addInitScript(() => { window.print = () => console.log('print'); }); // a real print dialog would freeze the robot
    const page = await ctx.newPage(); page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(10000);
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
    page.on('popup', p => p.close().catch(() => {}));
    await page.goto('http://localhost:4190/'); await page.click('text=Try the demo, no account needed'); await page.waitForSelector('.job-card');
    const log = [];
    for (let step = 0; step < STEPS; step++) {
      totalSteps++;
      let action = '';
      const watchdog = setTimeout(() => { console.log(`  ! run ${run} step ${step} stuck on: ${action}`); }, 20000);
      try {
        const r = rnd();
        if (r < 0.03) { action = 'reload'; await page.reload(); }
        else if (r < 0.05) { action = 'back'; await page.goBack().catch(() => {}); }
        else if (r < 0.12 && await page.$('#map')) {
          const b = await page.locator('#map').boundingBox();
          if (b) { const x = b.x + b.width * (0.1 + rnd() * 0.8), y = b.y + b.height * (0.15 + rnd() * 0.6); action = `map tap ${Math.round(x)},${Math.round(y)}`; phone ? await page.touchscreen.tap(x, y) : await page.mouse.click(x, y); }
        } else if (r < 0.16 && await page.$('input[type=file]')) {
          action = 'add photo'; await page.setInputFiles('input[type=file] >> nth=0', path.join(root, 'icon-192.png')).catch(() => {});
        } else if (r < 0.2 && await page.$('.sig-pad')) {
          action = 'sign'; const b = await page.locator('.sig-pad').boundingBox();
          if (b) for (const t of ['pointerdown', 'pointermove', 'pointermove', 'pointerup']) await page.dispatchEvent('.sig-pad', t, { clientX: b.x + rnd() * b.width, clientY: b.y + rnd() * b.height, pointerId: 1, bubbles: true });
        } else {
          // everything you can tap or type into that's on screen
          const els = await page.$$('button:not([disabled]), a[href^="#"], input:not([type=file]):not([readonly]), select, textarea, label.toggle');
          const vis = [];
          for (const e of els) { const ok = await e.evaluate(n => { const r = n.getBoundingClientRect(); const t = (n.textContent || '').trim(); return r.width > 0 && r.height > 0 && !/^(Sign out|Leave demo|Print|Print or save PDF)$/.test(t) && !n.closest('[inert]'); }).catch(() => false); if (ok) vis.push(e); }
          if (!vis.length) { action = 'nothing to tap'; continue; }
          const el = pick(vis);
          const tag = await el.evaluate(n => n.tagName + (n.type ? ':' + n.type : '') + ' ' + (n.textContent || n.getAttribute('aria-label') || n.name || n.placeholder || '').trim().slice(0, 40)).catch(() => '?');
          if (/^INPUT:(text|number|search|tel|email|date|password)|^TEXTAREA/.test(tag)) {
            let v = pick(JUNK); if (/date/.test(tag)) v = pick(['2026-11-20', '2026-02-30', '', '1999-01-01', '2026-12-31']);
            action = `type "${v.slice(0, 30)}" into ${tag}`; await el.fill(v, { timeout: 2000 }).catch(() => {});
          } else if (/^SELECT/.test(tag)) {
            const opts = await el.$$eval('option', o => o.map(x => x.value)); const v = pick(opts); action = `choose ${v} in ${tag}`; await el.selectOption(v, { timeout: 2000 }).catch(() => {});
          } else if (/^INPUT:checkbox/.test(tag)) { action = `check ${tag}`; await el.click({ timeout: 2000, force: true }).catch(() => {}); }
          else { action = `tap ${tag}`; await el.click({ timeout: 2000 }).catch(() => {}); }
        }
        await page.waitForTimeout(rnd() < 0.2 ? 900 : 120);
        // ---- checks after every step ----
        const st = await page.evaluate(() => {
          const txt = document.body.innerText || '';
          const bad = (txt.match(/\b(null|undefined|NaN|Infinity|\[object Object\])\b/g) || []).filter(Boolean);
          const neg = [...document.querySelectorAll('.tb-total, .money-total strong, .opt-price, .q-opt-price, .jc-price, .pipe-n')].map(e => e.textContent).filter(t => /-\$|\$-/.test(t));
          const wide = document.documentElement.scrollWidth > innerWidth + 1;
          let data = 'ok'; try { const raw = localStorage.getItem('lotcalc-demo'); if (raw) { const d = JSON.parse(raw); if (!Array.isArray(d.jobs)) data = 'jobs missing'; for (const j of d.jobs || []) if (j.price != null && !Number.isFinite(Number(j.price))) data = 'bad price on ' + j.title; } } catch (e) { data = 'corrupt: ' + e.message; }
          const stuck = !!document.querySelector('#app > p') && /Loading LotBoss/.test(txt);
          return { bad, neg, wide, data, stuck, hash: location.hash };
        });
        const problems = [];
        if (st.bad.length) problems.push('screen shows ' + [...new Set(st.bad)].join(','));
        if (st.neg.length) problems.push('negative money ' + st.neg.join(','));
        if (st.wide) problems.push('page wider than screen');
        if (st.data !== 'ok') problems.push('saved data: ' + st.data);
        if (st.stuck) problems.push('stuck on loading');
        if (errors.length) problems.push('error: ' + errors.splice(0).join(' | '));
        log.push(`${step}: ${action} [${st.hash}]`);
        if (problems.length) {
          const key = problems.join('; ').replace(/\d{3,}/g, '#').slice(0, 160);
          if (!findings.some(f => f.key === key)) {
            const shot = `${out}/chaos-${run}-${step}.png`; await page.screenshot({ path: shot }).catch(() => {});
            findings.push({ key, run, step, phone, problems, last: log.slice(-6), shot });
            console.log(`  ✗ run ${run} step ${step}: ${problems.join('; ')}\n      after: ${log.slice(-3).join(' → ')}`);
          }
        }
        // if we got signed out, get back in so the monkey keeps going
        if (await page.$('.auth') && rnd() < 0.9) { await page.click('text=Try the demo, no account needed').catch(() => {}); await page.waitForTimeout(300); }
        if (await page.$('.picker') && (await page.$$('.company-card')).length) await page.click('.company-card >> nth=0').catch(() => {});
      } catch (e) { log.push(`${step}: ${action} THREW ${e.message.split('\n')[0]}`); }
      finally { clearTimeout(watchdog); }
    }
    console.log(`run ${run} (${phone ? 'phone' : 'desktop'}): ${STEPS} steps done`);
    await ctx.close();
  }
  await browser.close(); server.close();
  fs.writeFileSync(`${out}/chaos-findings.json`, JSON.stringify(findings, null, 1));
  console.log(`\n${totalSteps} random steps, ${findings.length} distinct problems`);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
