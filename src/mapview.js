// Satellite map + tap-to-draw measuring. Works with a finger on a phone (no dragging needed).
import L from 'leaflet';
import { h, toast, num, modal, field } from './ui.js';
import { KINDS, measureFeature, PAINT_COLORS, STENCILS, crosses, untangle } from './geo.js';
import { DEFAULTS } from './calc.js';

const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const STREETS = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const PAINT_HEX = { white: '#ffffff', yellow: '#ffd400', blue: '#2f7bff', red: '#ff3b30', green: '#2fbf71', black: '#111418' };
const STENCIL_ICON = { handicap: '♿', van: 'VAN', arrow: '➜', stop: 'STOP', noParking: 'NP', fireLane: 'FL', number: '#', custom: '★' };
const STENCIL_LABEL = k => DEFAULTS.stripe.stencils[k]?.label || k;

export function geocode(q) {
  return fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined })
    .then(r => r.ok ? r.json() : []).catch(() => []);
}

export function createMap(container, job, { onChange, readOnly = false, settings = {} }) {
  const stallWidth = Number(settings?.stripe?.stallWidth) || DEFAULTS.stripe.stallWidth;
  const map = L.map(container, { zoomControl: false, attributionControl: true, maxZoom: 22, tap: true }).setView([job.lat || 39.94, job.lng || -82.01], job.lat ? 19 : 13);
  const sat = L.tileLayer(SAT, { maxZoom: 22, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
  const labels = L.tileLayer(LABELS, { maxZoom: 22, maxNativeZoom: 19, opacity: 0.85 }).addTo(map);
  const streets = L.tileLayer(STREETS, { maxZoom: 22, maxNativeZoom: 19, subdomains: 'abc', attribution: '© OpenStreetMap' });
  L.control.zoom({ position: 'topright' }).addTo(map);
  let satOn = true;

  const layer = L.featureGroup().addTo(map);
  const draft = L.layerGroup().addTo(map);
  let fc = job.drawing && job.drawing.features ? job.drawing : { type: 'FeatureCollection', features: [] };
  let tool = null, pts = [], selected = null;

  const style = f => {
    const p = f.properties || {}; const k = KINDS[p.kind] || KINDS.measure; const sel = f === selected;
    const color = p.kind === 'line' || p.kind === 'hash' || p.kind === 'row' ? (PAINT_HEX[p.color] || k.color) : k.color;
    if (k.geom === 'polygon') return { color: sel ? '#f5b800' : (p.exclude ? '#ff3b30' : color), weight: sel ? 4 : 2.5, fillColor: p.exclude ? '#ff3b30' : (p.kind === 'hash' ? color : '#1d5fb4'), fillOpacity: p.kind === 'hash' ? 0.35 : 0.22, dashArray: p.exclude ? '6 6' : null };
    return { color: sel ? '#f5b800' : color, weight: sel ? 7 : (p.kind === 'crack' ? 4 : 5), opacity: 0.95, dashArray: p.kind === 'row' ? '2 8' : null, lineCap: 'round' };
  };
  function label(f) {
    const p = f.properties || {}; const m = measureFeature(f);
    if (p.kind === 'seal') return `${p.exclude ? 'Skip ' : ''}${num(m.sqft)} sq ft`;
    if (p.kind === 'crack') return `${num(m.lf)} ft crack`;
    if (p.kind === 'row') return `${p.stalls || m.stalls} stalls${p.style === 'double' ? ' (double)' : ''}`;
    if (p.kind === 'line') return `${num(m.lf)} ft ${p.color || 'white'}`;
    if (p.kind === 'hash') return `${num(m.sqft)} sq ft hash`;
    if (p.kind === 'measure') return `${num(m.lf, 1)} ft`;
    return '';
  }
  function render() {
    layer.clearLayers();
    for (const f of fc.features) {
      const p = f.properties || {}; let lyr;
      if (f.geometry.type === 'Point') {
        const [lng, lat] = f.geometry.coordinates; const door = p.kind === 'entrance';
        lyr = L.marker([lat, lng], { icon: L.divIcon({ className: (door ? 'stencil-pin door-pin' : 'stencil-pin' + (p.gen ? ' gen' : '')) + (f === selected ? ' sel' : ''), html: '', iconSize: door ? [40, 28] : (p.gen ? [24, 24] : [34, 34]) }), keyboard: true, title: door ? 'Building entrance' : STENCIL_LABEL(p.stencil) });
        lyr.on('add', () => { const el = lyr.getElement(); if (el) el.textContent = door ? 'DOOR' : STENCIL_ICON[p.stencil] || '★'; });
      } else if (p.kind === 'row' && Array.isArray(p.back) && p.back.length === 2 && f.geometry.coordinates.length === 2) {
        // a designed row: draw every stall line, front to back
        const [a, b] = f.geometry.coordinates, [c, d] = p.back; const k = Math.max(1, Math.min(400, Number(p.stalls) || 1));
        const col = f === selected ? '#f5b800' : (PAINT_HEX[p.color] || '#fff');
        const lines = []; for (let i = 0; i <= k; i++) { const t = i / k; lines.push([[a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t], [c[1] + (d[1] - c[1]) * t, c[0] + (d[0] - c[0]) * t]]); }
        lyr = L.featureGroup([L.polyline(lines, { color: col, weight: f === selected ? 4 : 2.5, opacity: 0.95 }), L.polyline([[a[1], a[0]], [b[1], b[0]]], { color: col, weight: 14, opacity: 0.01 })]);
        if (!p.ada) lyr.bindTooltip(label(f), { permanent: false, direction: 'center', className: 'm-label' });
      } else {
        const latlngs = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0].map(([x, y]) => [y, x]) : f.geometry.coordinates.map(([x, y]) => [y, x]);
        lyr = f.geometry.type === 'Polygon' ? L.polygon(latlngs, style(f)) : L.polyline(latlngs, style(f));
        const t = label(f); if (t) lyr.bindTooltip(t, { permanent: true, direction: 'center', className: 'm-label' });
      }
      lyr.on('click', e => { L.DomEvent.stop(e); if (tool) return addPoint(e.latlng); select(f); });
      layer.addLayer(lyr);
    }
  }
  function changed() { render(); onChange && onChange(fc); }

  // ---- drawing ----
  const bar = h('div.draw-bar', { hidden: true },
    h('p.draw-hint'),
    h('div.draw-actions',
      h('button.btn.ghost', { type: 'button', onclick: () => { pts.pop(); drawDraft(); } }, 'Undo point'),
      h('button.btn.ghost', { type: 'button', onclick: () => stop() }, 'Cancel'),
      h('button.btn.primary.finish', { type: 'button', onclick: () => finish() }, 'Finish')));
  container.parentElement.append(bar);
  function start(kind, props = {}, keepSelection = false) {
    if (readOnly) return;
    tool = { kind, props }; pts = []; if (!keepSelection) select(null);
    bar.hidden = false; bar.querySelector('.draw-hint').textContent = KINDS[kind].hint;
    bar.querySelector('.finish').hidden = KINDS[kind].geom === 'point';
    container.classList.add('drawing'); container.parentElement.classList.add('is-drawing');
    const r = container.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight) container.parentElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
    drawDraft();
  }
  function stop() { tool = null; pts = []; draft.clearLayers(); bar.hidden = true; container.classList.remove('drawing'); container.parentElement.classList.remove('is-drawing'); }
  function drawDraft() {
    draft.clearLayers(); if (!tool) return;
    const k = KINDS[tool.kind];
    if (pts.length > 1) (k.geom === 'polygon' ? L.polygon(pts, { color: '#f5b800', weight: 3, dashArray: '6 6', fillOpacity: 0.15 }) : L.polyline(pts, { color: '#f5b800', weight: 4, dashArray: '6 6' })).addTo(draft);
    pts.forEach(p => L.circleMarker(p, { radius: 7, color: '#23272b', weight: 2, fillColor: '#f5b800', fillOpacity: 1 }).addTo(draft));
    if (pts.length >= 2) {
      const tmp = toFeature(); const m = measureFeature(tmp); const t = m.sqft ? `${num(m.sqft)} sq ft` : m.lf ? (tool.kind === 'row' ? `${m.stalls} stalls · ${num(m.lf)} ft` : `${num(m.lf, 1)} ft`) : '';
      if (t) L.tooltip({ permanent: true, direction: 'top', className: 'm-label live' }).setLatLng(pts.at(-1)).setContent(t).addTo(draft);
    }
  }
  function toFeature() {
    const k = KINDS[tool.kind]; const coords = pts.map(p => [Number(p.lng.toFixed(7)), Number(p.lat.toFixed(7))]);
    const geometry = k.geom === 'polygon' ? { type: 'Polygon', coordinates: [[...coords, coords[0]]] } : k.geom === 'point' ? { type: 'Point', coordinates: coords[0] } : { type: 'LineString', coordinates: coords };
    return { type: 'Feature', properties: { kind: tool.kind, stallWidth: tool.kind === 'row' ? stallWidth : undefined, ...tool.props }, geometry };
  }
  function addPoint(latlng) {
    if (!tool) return;
    pts.push(latlng);
    if (KINDS[tool.kind].geom === 'point') return finish();
    if (tool.kind === 'row' && pts.length === 2) return finish();
    drawDraft();
  }
  function finish() {
    if (!tool) return;
    const k = KINDS[tool.kind];
    const need = k.geom === 'polygon' ? 3 : k.geom === 'line' ? 2 : 1;
    if (pts.length < need) { toast(k.geom === 'polygon' ? 'Tap at least 3 corners.' : 'Tap at least 2 points.', 'warn'); return; }
    const f = toFeature(); const kind = tool.kind;
    if (f.geometry.type === 'Polygon' && crosses(f.geometry.coordinates[0])) { f.geometry.coordinates = [untangle(f.geometry.coordinates[0])]; toast('The corners crossed over, so I put them in order. Check the shape looks right.', 'warn'); }
    if (kind === 'measure') { const m = measureFeature(f); stop(); toast(`${num(m.lf, 1)} ft`); return; }
    if (kind === 'entrance') fc.features = fc.features.filter(x => x.properties?.kind !== 'entrance'); // one main door
    fc.features.push(f); const keepGoing = kind === 'stencil' || kind === 'crack' || kind === 'row';
    const props = tool.props; stop(); selected = f; changed();
    if (keepGoing) start(kind, props, true); // keep placing stencils / cracks / rows until Cancel
  }
  map.on('click', e => { if (tool) addPoint(e.latlng); else select(null); });

  function select(f) { selected = f; render(); onSelect && onSelect(f); }
  let onSelect = null;
  function removeSelected() { if (!selected) return; fc.features = fc.features.filter(x => x !== selected); selected = null; changed(); onSelect && onSelect(null); }
  function updateSelected(patch) { if (!selected) return; Object.assign(selected.properties, patch); changed(); }

  function fit() { if (alive && layer.getLayers().length) map.fitBounds(layer.getBounds().pad(0.25), { maxZoom: 20, animate: false }); }
  function toggleBase() { satOn = !satOn; if (satOn) { map.removeLayer(streets); sat.addTo(map); labels.addTo(map); } else { map.removeLayer(sat); map.removeLayer(labels); streets.addTo(map); } return satOn; }
  function locate() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('This device has no GPS access in the browser.'));
      navigator.geolocation.getCurrentPosition(p => { const ll = [p.coords.latitude, p.coords.longitude]; map.setView(ll, 19); L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1d5fb4', fillOpacity: 1 }).addTo(draft); res({ lat: ll[0], lng: ll[1] }); },
        e => rej(new Error(e.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings.' : 'Could not get your location.')), { enableHighAccuracy: true, timeout: 12000 });
    });
  }
  let alive = true;
  render(); setTimeout(() => { if (!alive) return; map.invalidateSize(); if (fc.features.length) fit(); }, 50);
  return {
    map, start, stop, fit, locate, toggleBase, removeSelected, updateSelected,
    get selected() { return selected; }, set onSelect(fn) { onSelect = fn; },
    setView(lat, lng, z = 19) { map.setView([lat, lng], z); },
    // a see-through preview (AI outline) drawn over the map until you keep or drop it
    preview(features) {
      if (this._pv) { this._pv.remove(); this._pv = null; }
      if (!features?.length || !alive) return;
      this._pv = L.geoJSON({ type: 'FeatureCollection', features }, { interactive: false, style: f => f.properties?.exclude ? { color: '#ff5a5a', weight: 3, dashArray: '6 6', fillColor: '#ff5a5a', fillOpacity: 0.25 } : { color: '#f5b800', weight: 4, dashArray: '8 6', fillColor: '#f5b800', fillOpacity: 0.22 } }).addTo(map);
      try { map.fitBounds(this._pv.getBounds(), { padding: [30, 30], maxZoom: 20 }); } catch {}
    },
    view() { const b = map.getBounds(), c = map.getCenter(); const w = map.distance([c.lat, b.getWest()], [c.lat, b.getEast()]), hgt = map.distance([b.getSouth(), c.lng], [b.getNorth(), c.lng]); return { lat: c.lat, lng: c.lng, meters: Math.min(w, hgt) }; },
    get drawing() { return fc; }, set drawing(v) { fc = v; selected = null; render(); },
    destroy() { alive = false; stop(); bar.remove(); try { map.stop(); map.off(); } catch {} setTimeout(() => { try { map.remove(); } catch {} }, 450); } // let a zoom animation finish first
  };
}

// The panel that edits the selected shape's details (paint color, single/double row, stencil type…)
export function featureEditor(f, mv) {
  if (!f) return null;
  const p = f.properties; const m = measureFeature(f); const k = KINDS[p.kind] || {};
  const rows = [h('div.fe-head', h('strong', k.label || 'Shape'), h('span.muted', p.kind === 'seal' || p.kind === 'hash' ? `${num(m.sqft)} sq ft · ${num(m.perimeter)} ft around` : m.lf ? `${num(m.lf, 1)} ft` : ''))];
  const sel = (label, key, options, val) => field(label, { type: 'select', options, value: val ?? p[key], onchange: e => mv.updateSelected({ [key]: e.target.value }) });
  if (p.kind === 'seal') rows.push(sel('This area', 'exclude', [{ value: '', label: 'Sealcoat it' }, { value: 'true', label: 'Skip it (island, building, concrete)' }], p.exclude ? 'true' : ''));
  if (p.kind === 'row') {
    rows.push(sel('Stall lines', 'style', [{ value: 'single', label: 'Single lines' }, { value: 'double', label: 'Double lines (hairpin)' }]));
    rows.push(field('Stalls in this row', { type: 'number', value: p.stalls ?? m.stalls, inputmode: 'numeric', help: `Counted ${m.stalls} at ${p.stallWidth || 9} ft wide. Type a number to override.`, onchange: e => mv.updateSelected({ stalls: e.target.value === '' ? undefined : Number(e.target.value) }) }));
    rows.push(sel('Color', 'color', PAINT_COLORS, p.color || 'white'));
  }
  if (p.kind === 'line') { rows.push(sel('Color', 'color', PAINT_COLORS, p.color || 'white')); rows.push(field('What is it', { value: p.label || '', placeholder: 'Stop bar, lane line, red curb…', onchange: e => mv.updateSelected({ label: e.target.value }) })); }
  if (p.kind === 'hash') rows.push(sel('Color', 'color', PAINT_COLORS, p.color || 'yellow'));
  if (p.kind === 'stencil') { rows.push(sel('Stencil', 'stencil', STENCILS.map(s => ({ value: s, label: STENCIL_LABEL(s) })), p.stencil)); }
  rows.push(h('button.btn.danger.ghost', { type: 'button', onclick: () => mv.removeSelected() }, 'Delete this shape'));
  return h('div.feature-editor', rows);
}

export async function pickStencil() {
  const s = field('Which stencil?', { type: 'select', options: STENCILS.map(k => ({ value: k, label: STENCIL_LABEL(k) })) });
  return modal('Place stencils', h('div', s, h('p.muted', 'Tap the map for each one. Tap Cancel when you\'re done.')), [{ label: 'Cancel', result: null }, { label: 'Start placing', kind: 'primary', value: () => s.input.value }]);
}
