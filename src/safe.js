// Browser storage that never crashes the app (private browsing and some privacy settings block it).
const mem = new Map();
function ls() { try { const s = window.localStorage; const k = '__lc_test'; s.setItem(k, '1'); s.removeItem(k); return s; } catch { return null; } }
const real = ls();
export const storageWorks = !!real;
export const store = {
  getItem(k) { try { return real ? real.getItem(k) : (mem.has(k) ? mem.get(k) : null); } catch { return mem.get(k) ?? null; } },
  setItem(k, v) { if (!real) { mem.set(k, String(v)); return; } try { real.setItem(k, String(v)); } catch (e) { if (/quota/i.test(e?.name + e?.message)) throw new Error('This device is out of space for the demo. Delete some demo photos.'); mem.set(k, String(v)); } },
  removeItem(k) { try { if (real) real.removeItem(k); } catch {} mem.delete(k); }
};
