// LotBoss: the math. Pure functions, no UI. Every rate is a company setting with a sensible default.
// Units: feet, square feet, linear feet (lf), gallons, pounds, dollars, hours.

import { WEATHER_DEFAULTS } from './weather.js';

export const DEFAULTS = {
  weather: { ...WEATHER_DEFAULTS },
  minimumJob: 500,
  quoteValidDays: 30,
  invoiceDueDays: 15,       // invoices are due this many days after you send them
  depositPct: 30,           // default deposit to schedule a job
  reviewLink: '',           // your Google review link, used in review requests
  resealYears: 3,           // remind customers to reseal after this many years
  quoteNudgeDays: 3,        // check in on an unsigned quote after this many days
  driveway: { pricePerSqft: 0.25, minimum: 150, crackPerLf: 1.5, sqftPerHour: 1500 }, // homeowner driveways
  laborBurdenPct: 18,       // payroll taxes + workers comp on top of wages
  overheadPct: 10,          // insurance, office, phones, etc. on top of job cost
  equipmentPerHour: 25,     // truck, fuel, machines per crew-hour on site
  mobilizationHours: 1,     // load up + drive, per crew-day
  hoursPerDay: 8,
  taxPct: 0,                // sales tax on the customer's total (0 = none)
  sealcoat: {
    pricePerSqft: 0.18, coats: 2,
    sqftPerGalPerCoat: 80,  // mixed material coverage per coat
    waterPct: 25,           // water as % of concentrate
    sandLbPerGal: 3,        // sand per gallon of concentrate
    additivePct: 2,         // additive as % of concentrate
    concentrateCost: 1.6,   // $/gal
    sandBagLb: 50, sandBagCost: 8,
    additiveCost: 22,       // $/gal
    tankGal: 550,
    sqftPerPersonHourPerCoat: 1200,
    prepSqftPerPersonHour: 4000, // blowing off / edging
    oilSpotPrimeEach: 0
  },
  crack: {
    pricePerLf: 1.0, widthIn: 0.5, depthIn: 0.5,
    boxLb: 30, boxCost: 32, wastePct: 10,
    lbPerCubicIn: 0.0397,   // hot-pour rubberized filler density
    lfPerPersonHour: 150,
    meltHours: 1            // kettle warm-up per day
  },
  stripe: {
    pricePerLf: 0.32, pricePerStall: 0, // use one or the other (stall price wins if > 0)
    lineWidthIn: 4, mils: 15,
    paintCostPerGal: 26,
    stallWidth: 9, stallDepth: 18,
    lfPerPersonHour: 700,
    minutesPerStencil: 8,
    layoutMinutesPerStall: 1.5, // snapping/chalking new layouts (0 for restripe over old lines)
    hashSpacingIn: 24,
    stencils: {             // price each, paint gallons each
      handicap: { label: 'Handicap symbol', price: 25, gal: 0.25, color: 'white' },
      van: { label: 'VAN accessible', price: 15, gal: 0.1, color: 'white' },
      arrow: { label: 'Arrow', price: 15, gal: 0.15, color: 'white' },
      stop: { label: 'STOP letters', price: 30, gal: 0.35, color: 'white' },
      noParking: { label: 'NO PARKING', price: 35, gal: 0.4, color: 'white' },
      fireLane: { label: 'FIRE LANE', price: 35, gal: 0.4, color: 'red' },
      number: { label: 'Stall number', price: 6, gal: 0.03, color: 'white' },
      custom: { label: 'Custom stencil', price: 40, gal: 0.3, color: 'white' }
    },
    signPrice: 125,         // ADA sign + post installed
    wheelStopPrice: 55      // installed
  }
};

const n = (v, d = 0) => { const x = typeof v === 'boolean' || Array.isArray(v) ? NaN : Number(v); return Number.isFinite(x) ? x : d; };
const nn = (v, d = 0) => Math.max(0, n(v, d));                       // quantities, prices, percents: never negative
const pos = (v, d) => { const x = n(v, NaN); return x > 0 ? x : d; }; // rates we divide by: must be > 0, else the default
const cap = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = v => Math.round(v * 100) / 100;
const up = (v, step = 1) => Math.ceil(v / step - 1e-9) * step;
export function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return structuredClone(base);
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    if (b && typeof b === 'object') out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(b, v) : structuredClone(b); // never replace a group with junk
    else if (v !== null && v !== undefined && v !== '' && typeof v !== 'object') out[k] = v;
  }
  return out;
}

// ---------- ADA (2010 ADA Standards, 208.2 + 208.2.4) ----------
export function adaRequired(total) {
  total = Math.max(0, Math.floor(n(total)));
  if (total === 0) return { accessible: 0, van: 0 };
  let a;
  if (total <= 25) a = 1; else if (total <= 50) a = 2; else if (total <= 75) a = 3; else if (total <= 100) a = 4;
  else if (total <= 150) a = 5; else if (total <= 200) a = 6; else if (total <= 300) a = 7; else if (total <= 400) a = 8;
  else if (total <= 500) a = 9; else if (total <= 1000) a = Math.ceil(total * 0.02);
  else a = 20 + Math.ceil((total - 1000) / 100);
  return { accessible: a, van: Math.max(1, Math.ceil(a / 6)) };
}
export const ADA_NOTES = [
  'Count is per parking facility (2010 ADA Standards 208.2). At least 1 of every 6 accessible spaces must be van accessible.',
  'Car space: 8 ft wide + 5 ft access aisle. Van space: 11 ft wide + 5 ft aisle, or 8 ft wide + 8 ft aisle.',
  'Access aisles must be marked (hash) so people don\'t park in them, and must connect to an accessible route.',
  'Every accessible space needs a sign with the International Symbol of Accessibility; van spaces add "Van Accessible". Bottom of sign at least 60 in above the ground.',
  'Spaces must be on the shortest accessible route to the entrance, and level (max 1:48 slope).',
  'States and cities can add rules (sign wording, fines, blue paint). Check local code before the job.'
];

// ---------- Sealcoat + tank mix ----------
export function tankMix(s) {
  const tank = pos(s.tankGal, 550), w = nn(s.waterPct) / 100, a = nn(s.additivePct) / 100, sandLb = nn(s.sandLbPerGal);
  const sandGalPerLb = 0.045; // sand takes up about this much room per pound
  const conc = tank / (1 + w + a + sandLb * sandGalPerLb);
  return {
    tankGal: tank,
    concentrateGal: r2(conc), waterGal: r2(conc * w), additiveGal: r2(conc * a),
    sandLb: Math.round(conc * sandLb), sandBags: r2(conc * sandLb / pos(s.sandBagLb, 50)),
    sqftPerTank: Math.round(tank * pos(s.sqftPerGalPerCoat, 80))
  };
}
export function sealcoat(sqft, coats, s) {
  sqft = nn(sqft); coats = cap(Math.round(n(coats, pos(s.coats, 2))), 1, 10);
  const baseCoats = cap(Math.round(pos(s.coats, 2)), 1, 10);
  const mixedGal = sqft * coats / pos(s.sqftPerGalPerCoat, 80);
  const w = nn(s.waterPct) / 100, a = nn(s.additivePct) / 100, sandLb = nn(s.sandLbPerGal);
  const conc = mixedGal / (1 + w + a + sandLb * 0.045);
  const sandBags = up(conc * sandLb / pos(s.sandBagLb, 50));
  const additiveGal = up(conc * a, 0.5);
  const tank = tankMix(s);
  const materials = [
    { item: 'Sealer concentrate', qty: Math.ceil(conc), unit: 'gal', cost: r2(Math.ceil(conc) * nn(s.concentrateCost)) },
    { item: 'Sand', qty: sandBags, unit: `bags (${pos(s.sandBagLb, 50)} lb)`, cost: r2(sandBags * nn(s.sandBagCost)) },
    { item: 'Additive', qty: additiveGal, unit: 'gal', cost: r2(additiveGal * nn(s.additiveCost)) },
    { item: 'Water', qty: Math.ceil(conc * w), unit: 'gal', cost: 0 }
  ];
  const personHours = sqft * coats / pos(s.sqftPerPersonHourPerCoat, 1200) + sqft / pos(s.prepSqftPerPersonHour, 4000);
  const price = sqft * nn(s.pricePerSqft) * coats / baseCoats; // your price is for your usual coats; more coats cost more
  return {
    sqft: Math.round(sqft), coats, mixedGal: Math.ceil(mixedGal), concentrateGal: Math.ceil(conc),
    tankLoads: r2(mixedGal / tank.tankGal), tank, materials,
    materialCost: r2(materials.reduce((t, m) => t + m.cost, 0)),
    personHours: r2(personHours),
    price: r2(price),
    priceLine: `${Math.round(sqft).toLocaleString('en-US')} sq ft × $${(nn(s.pricePerSqft) * coats / baseCoats).toFixed(3).replace(/0$/, '')} (${coats} coat${coats > 1 ? 's' : ''})`
  };
}

// ---------- Crack fill ----------
export function crackFill(lf, c, over = {}) {
  lf = nn(lf); over = over || {};
  const width = pos(over.widthIn, pos(c.widthIn, 0.5)), depth = pos(over.depthIn, pos(c.depthIn, 0.5));
  const lbPerLf = cap(width, 0.05, 6) * cap(depth, 0.05, 12) * 12 * pos(c.lbPerCubicIn, 0.0397);
  const boxLb = pos(c.boxLb, 30), waste = 1 + nn(c.wastePct) / 100, rate = pos(c.lfPerPersonHour, 150);
  const lbs = lf * lbPerLf * waste;
  const boxes = up(lbs / boxLb);
  const days = Math.max(1, Math.ceil(lf / (rate * 2 * 8)));
  return {
    lf: Math.round(lf), widthIn: width, depthIn: depth,
    lbPerLf: r2(lbPerLf), lbs: Math.round(lbs), boxes,
    lfPerBox: Math.round(boxLb / (lbPerLf * waste)),
    materials: [{ item: 'Crack filler', qty: boxes, unit: `boxes (${boxLb} lb)`, cost: r2(boxes * nn(c.boxCost)) }],
    materialCost: r2(boxes * nn(c.boxCost)),
    personHours: r2(lf / rate + (lf > 0 ? days * nn(c.meltHours, 1) : 0)),
    price: r2(lf * nn(c.pricePerLf)),
    priceLine: `${Math.round(lf).toLocaleString('en-US')} lf × $${nn(c.pricePerLf).toFixed(2)}`
  };
}

// ---------- Striping ----------
// rows: [{ stalls, style: 'single'|'double', depth, color }]
export function stallLines(row, s) {
  const stalls = Math.max(0, Math.round(n(row?.stalls)));
  if (!stalls) return 0;
  const depth = cap(pos(row.depth, pos(s.stallDepth, 18)), 8, 40);
  const lines = row.style === 'double' ? 2 * (stalls + 1) : stalls + 1;
  return lines * depth;
}
export function hashLf(sqft, perimeter, spacingIn) {
  sqft = nn(sqft); if (!sqft) return 0;
  return Math.round(sqft / (cap(pos(spacingIn, 24), 6, 120) / 12) + nn(perimeter));
}
export function striping(inp, s, adaSettings = {}) {
  inp = inp || {};
  const lfPerGal = (231 / (cap(pos(s.mils, 15), 5, 60) / 1000)) / 144 / (cap(pos(s.lineWidthIn, 4), 2, 24) / 12);
  const byColor = {}; const add = (color, lf) => { lf = nn(lf); const c = typeof color === 'string' && color ? color : 'white'; if (lf > 0) byColor[c] = (byColor[c] || 0) + lf; };
  const rows = Array.isArray(inp.rows) ? inp.rows : [];
  let stalls = 0; let stallLf = 0;
  for (const row of rows) { const lf = stallLines(row, s); stallLf += lf; stalls += Math.max(0, Math.round(n(row?.stalls))); add(row?.color, lf); }
  const extra = Array.isArray(inp.lines) ? inp.lines : [];   // drawn/typed lines: { lf, color, label }
  let extraLf = 0; for (const l of extra) { extraLf += nn(l?.lf); add(l?.color, nn(l?.lf)); }
  const stopBarLf = Math.round(nn(inp.stopBars)) * cap(pos(inp.stopBarLen, 12), 1, 100); add('white', stopBarLf);
  const hashes = Array.isArray(inp.hash) ? inp.hash : [];     // { sqft, perimeter, color }
  let hashTotal = 0; for (const h of hashes) { const lf = hashLf(h?.sqft, h?.perimeter, s.hashSpacingIn); hashTotal += lf; add(h?.color, lf); }
  const curbLf = nn(inp.curbLf); add(inp.curbColor || 'red', curbLf);

  // ADA
  const totalStalls = Math.round(nn(inp.totalStalls, stalls));
  const req = adaRequired(totalStalls);
  const adaCount = inp.adaAuto === false ? Math.round(nn(inp.adaSpaces)) : req.accessible;
  const vanCount = Math.min(adaCount, inp.adaAuto === false ? Math.round(nn(inp.vanSpaces)) : req.van);
  const depth = cap(pos(s.stallDepth, 18), 8, 40);
  const aisleLf = adaCount > 0 ? hashLf((adaCount - vanCount) * 5 * depth + vanCount * 8 * depth, 0, s.hashSpacingIn) + (adaCount * 2 * depth) : 0;
  add(inp.adaColor || 'blue', inp.adaRestripe === false ? 0 : aisleLf);

  const st = { ...(inp.stencils && typeof inp.stencils === 'object' ? inp.stencils : {}) };
  if (inp.adaAuto !== false && adaCount) { st.handicap = Math.max(nn(st.handicap), adaCount); st.van = Math.max(nn(st.van), vanCount); }
  const stencilList = []; let stencilPrice = 0, stencilGal = 0, stencilCount = 0;
  for (const [k, qty] of Object.entries(st)) {
    const q = Math.round(nn(qty)); if (!q) continue;
    const def = s.stencils[k] || s.stencils.custom;
    stencilList.push({ key: k, label: def.label, qty: q, price: r2(q * nn(def.price)), gal: r2(q * nn(def.gal)), color: def.color });
    stencilPrice += q * nn(def.price); stencilGal += q * nn(def.gal); stencilCount += q;
  }
  const signs = Math.round(nn(inp.signs === '' || inp.signs == null ? (inp.adaAuto === false ? 0 : adaCount) : inp.signs));
  const wheelStops = Math.round(nn(inp.wheelStops));

  const totalLf = Object.values(byColor).reduce((t, v) => t + v, 0);
  const paint = Object.entries(byColor).map(([color, lf]) => ({ color, lf: Math.round(lf), gal: r2(lf / lfPerGal) }));
  for (const sl of stencilList) { const p = paint.find(x => x.color === sl.color); if (p) p.gal = r2(p.gal + sl.gal); else paint.push({ color: sl.color, lf: 0, gal: sl.gal }); }
  const paintGal = paint.reduce((t, p) => t + p.gal, 0);
  const materials = paint.map(p => ({ item: `${capWord(p.color)} traffic paint`, qty: Math.max(1, Math.ceil(p.gal)), unit: 'gal', cost: r2(Math.max(1, Math.ceil(p.gal)) * nn(s.paintCostPerGal)) }));
  const lineMinutes = totalLf / pos(s.lfPerPersonHour, 700) * 60;
  const personHours = (lineMinutes + stencilCount * nn(s.minutesPerStencil, 8) + (inp.newLayout ? stalls * nn(s.layoutMinutesPerStall, 1.5) : 0) + signs * 30 + wheelStops * 10) / 60;

  const perStall = nn(s.pricePerStall), perLf = nn(s.pricePerLf);
  const linePrice = perStall > 0 ? stalls * perStall + (totalLf - stallLf) * perLf : totalLf * perLf;
  const lines = [];
  if (perStall > 0 && stalls) lines.push({ label: `Stripe ${stalls} stalls`, amount: r2(stalls * perStall) });
  const lfForPrice = perStall > 0 ? totalLf - stallLf : totalLf;
  if (lfForPrice > 0) lines.push({ label: `Line striping, ${Math.round(lfForPrice).toLocaleString('en-US')} lf × $${perLf.toFixed(2)}`, amount: r2(lfForPrice * perLf) });
  for (const sl of stencilList) lines.push({ label: `${sl.label} × ${sl.qty}`, amount: sl.price });
  if (signs) lines.push({ label: `ADA sign + post × ${signs}`, amount: r2(signs * nn(s.signPrice)) });
  if (wheelStops) lines.push({ label: `Wheel stops × ${wheelStops}`, amount: r2(wheelStops * nn(s.wheelStopPrice)) });
  const signCost = signs * nn(s.signPrice) * 0.45, stopCost = wheelStops * nn(s.wheelStopPrice) * 0.45; // rough material share
  if (signs) materials.push({ item: 'ADA signs + posts', qty: signs, unit: 'each', cost: r2(signCost) });
  if (wheelStops) materials.push({ item: 'Wheel stops + rebar', qty: wheelStops, unit: 'each', cost: r2(stopCost) });

  return {
    stalls, totalStalls, ada: { required: req, accessible: adaCount, van: vanCount, aisleLf: Math.round(aisleLf) },
    lf: { stalls: Math.round(stallLf), other: Math.round(extraLf), stopBars: Math.round(stopBarLf), hash: Math.round(hashTotal), curb: Math.round(curbLf), total: Math.round(totalLf) },
    lfPerGal: Math.round(lfPerGal), paint, paintGal: r2(paintGal), stencils: stencilList, signs, wheelStops,
    materials, materialCost: r2(materials.reduce((t, m) => t + m.cost, 0)),
    personHours: r2(personHours),
    price: r2(linePrice + stencilPrice + signs * nn(s.signPrice) + wheelStops * nn(s.wheelStopPrice)),
    priceLines: lines
  };
}
const capWord = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// ---------- The whole job ----------
// job.inputs = { seal: {on, sqft, coats}, crack: {on, lf, widthIn, depthIn}, stripe: {on, ...striping input}, crewIds:[], extras: [{label, amount}], discountPct }
export function estimate(inputs = {}, settings = {}, crew = []) {
  inputs = inputs && typeof inputs === 'object' ? inputs : {};
  const S = merge(DEFAULTS, settings);
  const on = v => v === true || v === 'true';
  const out = { services: [], lines: [], materials: [], warnings: [] };
  let materialCost = 0, personHours = 0, price = 0;
  if (on(inputs.seal?.on) && n(inputs.seal.sqft) > 0) {
    const r = sealcoat(inputs.seal.sqft, inputs.seal.coats ?? S.sealcoat.coats, S.sealcoat);
    out.seal = r; out.services.push('Sealcoating'); out.lines.push({ label: `Sealcoat: ${r.priceLine}`, amount: r.price });
    materialCost += r.materialCost; personHours += r.personHours; price += r.price; out.materials.push(...r.materials.map(m => ({ ...m, service: 'Sealcoat' })));
  }
  if (on(inputs.crack?.on) && n(inputs.crack.lf) > 0) {
    const r = crackFill(inputs.crack.lf, S.crack, inputs.crack);
    out.crack = r; out.services.push('Crack filling'); out.lines.push({ label: `Crack fill: ${r.priceLine}`, amount: r.price });
    materialCost += r.materialCost; personHours += r.personHours; price += r.price; out.materials.push(...r.materials.map(m => ({ ...m, service: 'Crack fill' })));
  }
  if (on(inputs.stripe?.on)) {
    const r = striping(inputs.stripe, S.stripe);
    if (r.lf.total > 0 || r.stencils.length || r.signs || r.wheelStops) {
      out.stripe = r; out.services.push('Line striping'); out.lines.push(...r.priceLines.map(l => ({ ...l, label: l.label })));
      materialCost += r.materialCost; personHours += r.personHours; price += r.price; out.materials.push(...r.materials.map(m => ({ ...m, service: 'Striping' })));
      if (r.totalStalls > 0 && r.ada.accessible < r.ada.required.accessible) out.warnings.push(`ADA: ${r.totalStalls} stalls need at least ${r.ada.required.accessible} accessible (${r.ada.required.van} van). This layout has ${r.ada.accessible}.`);
    }
  }
  for (const e of Array.isArray(inputs.extras) ? inputs.extras : []) { const amt = n(e?.amount); if (amt) { out.lines.push({ label: (typeof e.label === 'string' && e.label.trim()) || 'Extra item', amount: r2(amt) }); price += amt; } }
  price = Math.max(0, price); // a credit line can't make the job pay the customer

  // crew + time
  const ids = Array.isArray(inputs.crewIds) ? inputs.crewIds : [];
  const team = (Array.isArray(crew) ? crew : []).filter(c => c && ids.includes(c.id));
  const crewSize = team.length || cap(Math.round(pos(inputs.crewSize, 2)), 1, 50);
  const avgWage = team.length ? team.reduce((t, c) => t + nn(c.wage), 0) / team.length : nn(inputs.avgWage, 20);
  const onSiteHours = personHours / crewSize;
  const days = Math.max(personHours > 0 ? 0.5 : 0, up(onSiteHours / cap(pos(S.hoursPerDay, 8), 1, 24), 0.5));
  const mobHours = Math.ceil(days) * nn(S.mobilizationHours, 1);
  const paidHoursEach = onSiteHours + mobHours;
  const laborCost = paidHoursEach * crewSize * avgWage * (1 + nn(S.laborBurdenPct) / 100);
  const equipmentCost = (onSiteHours + mobHours) * nn(S.equipmentPerHour);
  const directCost = materialCost + laborCost + equipmentCost;
  const overhead = directCost * nn(S.overheadPct) / 100;
  const totalCost = directCost + overhead;

  const discPct = cap(nn(inputs.discountPct), 0, 100);
  const discount = price * discPct / 100;
  if (discount) out.lines.push({ label: `Discount (${discPct}%)`, amount: -r2(discount) });
  let subtotal = price - discount;
  let minimumApplied = false;
  const minimumJob = inputs.kind === 'driveway' ? 0 : nn(S.minimumJob); // driveways carry their own per-driveway minimum
  if (subtotal > 0 && subtotal < minimumJob) { out.lines.push({ label: 'Minimum job charge adjustment', amount: r2(minimumJob - subtotal) }); subtotal = minimumJob; minimumApplied = true; }
  const tax = subtotal * cap(nn(S.taxPct), 0, 25) / 100;
  const total = subtotal + tax;
  const profit = subtotal - totalCost;
  if (subtotal > 250000) out.warnings.push(`This job comes to $${Math.round(subtotal).toLocaleString('en-US')}. Double-check your measurements and prices in Settings before sending it.`);
  if (subtotal > 0 && profit < 0) out.warnings.push(`This price loses about $${Math.abs(Math.round(profit)).toLocaleString('en-US')}. Raise your rates or cut the cost.`);
  else if (subtotal > 0 && profit / subtotal < 0.15) out.warnings.push(`Thin margin: only ${Math.round(profit / subtotal * 100)}% profit.`);

  return {
    ...out,
    crew: { size: crewSize, names: team.map(c => c.name), avgWage: r2(avgWage) },
    time: { personHours: r2(personHours), onSiteHours: r2(onSiteHours), days, mobilizationHours: mobHours },
    cost: { materials: r2(materialCost), labor: r2(laborCost), equipment: r2(equipmentCost), overhead: r2(overhead), total: r2(totalCost) },
    subtotal: r2(subtotal), tax: r2(tax), total: r2(total), minimum: minimumJob, minimumApplied,
    overMinimumBy: r2(Math.max(0, price - discount - minimumJob)),
    profit: r2(profit), marginPct: subtotal > 0 ? Math.round(profit / subtotal * 1000) / 10 : 0,
    breakEven: r2(totalCost), suggestedFor30: r2(totalCost / 0.7)
  };
}
