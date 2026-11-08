// LotBoss: crew scheduling math. Who's on what, who's double-booked, who's off. Pure functions, no UI.
// job: { id, title, status, scheduled_date, scheduled_days, crew_ids }   crew: { id, name, time_off: [{ from, to, note }] }

const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00'));
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (day, k) => { const x = new Date(day + 'T12:00:00'); x.setDate(x.getDate() + k); return fmt(x); };

// every calendar day a job covers (a 2.5-day job takes 3 days)
export function jobDays(job) {
  if (!job || !isDay(job.scheduled_date) || job.status === 'lost') return [];
  const n = Math.max(1, Math.min(60, Math.ceil(Number(job.scheduled_days) || 1)));
  return Array.from({ length: n }, (_, i) => addDays(job.scheduled_date, i));
}

// Monday..Sunday of the week holding `day`
export function weekOf(day) {
  const d = isDay(day) ? day : fmt(new Date());
  const dow = (new Date(d + 'T12:00:00').getDay() + 6) % 7; // Monday = 0
  const mon = addDays(d, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

// time off: list of { from, to, note }; junk entries ignored
export const cleanOff = list => (Array.isArray(list) ? list : []).filter(o => o && isDay(o.from)).map(o => ({ from: o.from, to: isDay(o.to) && o.to >= o.from ? o.to : o.from, note: String(o.note || '').slice(0, 80) }));
export const offOn = (crew, day) => cleanOff(crew?.time_off).find(o => day >= o.from && day <= o.to) || null;

// one person's jobs on one day
export const jobsOn = (jobs, crewId, day) => (jobs || []).filter(j => j && Array.isArray(j.crew_ids) && j.crew_ids.includes(crewId) && jobDays(j).includes(day));

// every problem in a set of days: double-booked people and people booked on a day off
export function problems(jobs, crew, days) {
  const out = [];
  for (const c of crew || []) for (const d of days || []) {
    const js = jobsOn(jobs, c.id, d).filter(j => j.status !== 'done');
    if (js.length > 1) out.push({ type: 'double', crewId: c.id, name: c.name, day: d, jobs: js });
    const off = offOn(c, d);
    if (off && js.length) out.push({ type: 'off', crewId: c.id, name: c.name, day: d, jobs: js, off });
  }
  return out;
}

// Warnings when booking a job: who's already busy or off on those days. `job` is the job being booked (with its new date/crew).
export function bookingWarnings(job, allJobs, crew, dayWord = d => d) {
  const days = jobDays(job); if (!days.length) return [];
  const others = (allJobs || []).filter(j => j && j.id !== job.id && j.status !== 'done');
  const warn = [];
  for (const id of job.crew_ids || []) {
    const c = (crew || []).find(x => x.id === id); if (!c) continue;
    const busy = new Map();
    for (const d of days) for (const j of jobsOn(others, id, d)) { if (!busy.has(j.id)) busy.set(j.id, { j, days: [] }); busy.get(j.id).days.push(d); }
    for (const { j, days: ds } of busy.values()) warn.push(`${c.name} is already on ${j.title || 'another job'} ${ds.length > 1 ? `${dayWord(ds[0])} to ${dayWord(ds.at(-1))}` : dayWord(ds[0])}.`);
    const offDays = days.filter(d => offOn(c, d));
    if (offDays.length) { const o = offOn(c, offDays[0]); warn.push(`${c.name} is off ${offDays.length > 1 ? `${dayWord(offDays[0])} to ${dayWord(offDays.at(-1))}` : dayWord(offDays[0])}${o.note ? ` (${o.note})` : ''}.`); }
  }
  return warn;
}

// Who's free on a day (not booked, not off). Handy for "who can I send?"
export const freeOn = (jobs, crew, day) => (crew || []).filter(c => !offOn(c, day) && !jobsOn(jobs, c.id, day).filter(j => j.status !== 'done').length);

// The text a crew member gets for their week
export function weekText(person, jobs, days, company, dayWord = d => d) {
  const lines = [`${person?.name || 'Your'} schedule${company ? ' from ' + company : ''}:`];
  let any = false;
  for (const d of days || []) {
    const off = offOn(person, d);
    const js = jobsOn(jobs, person?.id, d);
    if (!js.length && !off) continue;
    any = true;
    if (off && !js.length) { lines.push(`${dayWord(d)}: off${off.note ? ' (' + off.note + ')' : ''}`); continue; }
    for (const j of js) {
      const span = jobDays(j); const i = span.indexOf(d);
      lines.push(`${dayWord(d)}: ${j.title || 'Job'}${j.address ? ', ' + j.address : ''}${span.length > 1 ? ` (day ${i + 1} of ${span.length})` : ''}`);
    }
  }
  if (!any) lines.push('Nothing scheduled this week.');
  return lines.join('\n');
}

// Pick the crew record that belongs to the person logged in (crew logins are linked in Settings > Crew)
export const myCrew = (crewNames, userId) => (crewNames || []).find(c => c.is_me || (userId && c.user_id === userId)) || null;
