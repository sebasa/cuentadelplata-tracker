/* Monitor del Niño — frontend (sin dependencias) */
(() => {
  const $ = (s) => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const PROJ = { lon0: -66, lat0: -14, k: 36, c: Math.cos((25 * Math.PI) / 180) };
  const project = (lon, lat) => [(lon - PROJ.lon0) * PROJ.c * PROJ.k, (PROJ.lat0 - lat) * PROJ.k];

  const STATUS = {
    'sin-datos': { label: 'Sin datos', v: 'var(--st-nd)', r: 3.2 },
    normal: { label: 'Normal', v: 'var(--st-normal)', r: 4.2 },
    atencion: { label: 'Atención', v: 'var(--st-atencion)', r: 5 },
    prealerta: { label: 'Pre-alerta', v: 'var(--st-prealerta)', r: 6 },
    alerta: { label: 'Alerta', v: 'var(--st-alerta)', r: 7 },
    evacuacion: { label: 'Evacuación', v: 'var(--st-evacuacion)', r: 8 },
  };
  const RISK = {
    bajo: { label: 'Riesgo bajo', v: 'var(--st-normal)' },
    moderado: { label: 'Riesgo moderado', v: 'var(--st-atencion)' },
    alto: { label: 'Riesgo alto', v: 'var(--st-prealerta)' },
    'muy-alto': { label: 'Riesgo muy alto', v: 'var(--st-alerta)' },
    'sin-datos': { label: 'Sin datos suficientes', v: 'var(--st-nd)' },
  };
  const SEGS = {
    paraguay: ['paraguay'], 'parana-alto': ['parana-alto'], 'parana-bajo': ['parana-bajo', 'parana-delta'],
    'parana-delta-1': ['parana-delta'], 'parana-delta-2': ['parana-delta'], uruguay: ['uruguay'],
    iguazu: ['iguazu'], bermejo: ['bermejo'], pilcomayo: [],
  };
  const ENSO_ES = {
    'el nino advisory': 'Aviso de El Niño', 'el nino watch': 'Vigilancia de El Niño', 'la nina advisory': 'Aviso de La Niña',
    'la nina watch': 'Vigilancia de La Niña', 'not active': 'Sin alerta ENSO', 'final el nino advisory': 'Fin de El Niño', 'final la nina advisory': 'Fin de La Niña',
  };

  const fmt = (v, d = 2) => (v == null ? '–' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtInt = (v) => (v == null ? '–' : Math.round(v).toLocaleString('es-AR'));
  const signed = (v, d = 2) => (v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v), d)}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tz = 'America/Argentina/Buenos_Aires';
  const dShort = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: tz }).replace('.', '') : '–');
  const dTime = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz }) : '–');
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');

  const state = { layer: 'obs', selected: null, data: null, geo: null, hist: null };

  async function load() {
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [data, geo, hist] = await Promise.all([get('data/latest.json'), get('data/geo.json'), get('data/history.json')]);
    if (!data || !geo) {
      $('#updated').textContent = 'No se pudieron cargar los datos. Ejecutá "npm run collect" y recargá la página.';
      return;
    }
    Object.assign(state, { data, geo, hist });
    renderHeader(); renderRisk(); renderEnso(); renderInsights(); renderMap(); renderStations();
    renderFlows(); renderRain(); renderHistory(); renderINA();
  }

  /* ---------- Encabezado ---------- */
  function renderHeader() {
    const { data } = state;
    $('#updated').textContent = `Actualizado ${dTime(data.generatedAt)} (hora argentina)${data.demo ? ' · datos de muestra' : ''}`;
    const ul = $('#sources');
    ul.innerHTML = '';
    for (const s of Object.values(data.sources || {})) {
      const li = document.createElement('li');
      li.textContent = s.name.split(' ')[0] === 'INA' ? 'INA' : s.name.replace(/ (Naval Argentina|CPC \(ENSO\)|v4 vía Open-Meteo|Forecast)$/, '');
      li.className = s.ok ? '' : s.stale ? 'stale' : 'fail';
      li.title = s.ok ? `${s.name}: OK` : `${s.name}: ${s.error || 'error'}${s.stale ? ' — se muestra el último dato válido' : ''}`;
      ul.appendChild(li);
    }
  }

  /* ---------- Índice ---------- */
  function renderRisk() {
    const r = state.data.risk || {};
    const lv = RISK[r.level] || RISK['sin-datos'];
    $('#riskScore').textContent = r.score ?? '–';
    $('#riskLevel').innerHTML = `<i style="background:${lv.v}"></i>${lv.label}`;

    // Escala vertical 0–100
    const box = $('#riskGauge');
    box.innerHTML = '';
    const H = 220, W = 56, top = 8, bot = 8, x0 = 20, w = 16;
    const y = (v) => top + (1 - v / 100) * (H - top - bot);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' }, box);
    [[0, 25, 'bajo'], [25, 50, 'moderado'], [50, 75, 'alto'], [75, 100, 'muy-alto']].forEach(([a, b, k]) => {
      el('rect', { x: x0, y: y(b), width: w, height: y(a) - y(b) - 2, rx: 4, style: `fill:${RISK[k].v};opacity:${k === r.level ? 1 : 0.28}` }, svg);
    });
    for (let v = 0; v <= 100; v += 10) {
      el('line', { x1: x0 - (v % 50 ? 4 : 8), x2: x0, y1: y(v), y2: y(v), style: 'stroke:var(--muted);stroke-width:1' }, svg);
      if (v % 50 === 0) el('text', { x: x0 - 10, y: y(v) + 3.5, 'text-anchor': 'end', style: 'fill:var(--muted);font:400 9.5px var(--font-mono)' }, svg).textContent = v;
    }
    if (r.score != null) {
      const yy = y(r.score);
      el('path', { d: `M${x0 + w + 2} ${yy} l8 -5 v10 z`, style: 'fill:var(--ink)' }, svg);
      el('line', { x1: x0 - 2, x2: x0 + w + 2, y1: yy, y2: yy, style: 'stroke:var(--ink);stroke-width:2' }, svg);
    }

    const ul = $('#riskComponents');
    ul.innerHTML = '';
    for (const c of Object.values(r.components || {})) {
      const li = document.createElement('li');
      if (c.score == null) li.className = 'na';
      li.innerHTML = `<span class="c-name">${esc(c.label)}</span><span class="c-val">${c.score == null ? 'sin dato' : Math.round(c.score * 100)}<small style="color:var(--muted)"> · ${Math.round(c.weight * 100)}%</small></span>
        <span class="c-bar"><span style="width:${c.score == null ? 0 : Math.max(2, c.score * 100)}%"></span></span>
        <span class="c-detail">${esc(c.detail)}</span>`;
      ul.appendChild(li);
    }
  }

  /* ---------- ENSO ---------- */
  function renderEnso() {
    const e = state.data.enso || {};
    const w = e.weekly?.at(-1);
    const o = e.oni?.at(-1);
    $('#n34').textContent = w ? `${signed(w.nino34, 1)} °C` : '–';
    $('#n34lbl').textContent = w ? `anomalía semanal · ${dShort(w.week)}` : 'anomalía semanal';
    $('#oni').textContent = o ? signed(o.anom, 2) : '–';
    $('#onilbl').textContent = o ? `ONI ${o.season} ${o.year}` : 'ONI trimestral';
    const st = e.discussion?.status;
    const key = (st || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    $('#ensoStatus').textContent = st ? `NOAA · ${ENSO_ES[key] || st}` : 'NOAA';
    $('#ensoNote').textContent = e.discussion?.issued ? `Diagnóstico ENSO del ${e.discussion.issued}. Umbrales: ±0,5 °C evento; +1,5 °C fuerte.` : 'Umbrales: ±0,5 °C evento; +1,5 °C fuerte.';

    // Barras ONI (una escala, línea de 0 y umbrales)
    const data = (e.oni || []).slice(-12);
    const box = $('#ensoChart');
    box.innerHTML = '';
    if (!data.length) return;
    const W = 340, H = 118, L = 26, R = 6, T = 8, B = 20;
    const maxV = Math.max(2, ...data.map((d) => d.anom)) , minV = Math.min(-1, ...data.map((d) => d.anom));
    const y = (v) => T + ((maxV - v) / (maxV - minV)) * (H - T - B);
    const bw = (W - L - R) / data.length;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'ONI de los últimos trimestres' }, box);
    for (let v = Math.ceil(minV); v <= Math.floor(maxV); v++) {
      el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : 'gridline' }, svg);
      el('text', { x: L - 5, y: y(v) + 3.5, 'text-anchor': 'end' }, svg).textContent = v > 0 ? `+${v}` : v;
    }
    [[0.5, 'Niño'], [1.5, 'fuerte']].forEach(([v, t]) => {
      if (v > maxV) return;
      el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), style: 'stroke:var(--muted);stroke-width:1;stroke-dasharray:3 4;stroke-linecap:round' }, svg);
      el('text', { x: L + 3, y: y(v) - 3, style: 'fill:var(--muted);font:600 10px var(--font-body)' }, svg).textContent = t;
    });
    data.forEach((d, i) => {
      const x = L + i * bw + 2;
      const y1 = y(Math.max(0, d.anom)), y2 = y(Math.min(0, d.anom));
      const g = el('g', {}, svg);
      el('rect', { x, y: y1, width: Math.max(2, bw - 4), height: Math.max(1, y2 - y1), rx: 4, style: `fill:${d.anom >= 0.5 ? 'var(--nino)' : d.anom <= -0.5 ? 'var(--st-normal)' : 'var(--st-nd)'}` }, g);
      el('title', {}, g).textContent = `${d.season} ${d.year}: ${signed(d.anom, 2)} °C`;
      if (i % 2 === (data.length - 1) % 2) el('text', { x: x + (bw - 4) / 2, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = `${d.season}`;
    });
    const last = data.at(-1);
    el('text', { x: L + (data.length - 1) * bw + bw / 2, y: y(Math.max(0, last.anom)) - 4, 'text-anchor': 'middle', style: 'fill:var(--ink);font:500 10.5px var(--font-mono)' }, svg).textContent = signed(last.anom, 1);
  }

  /* ---------- Observaciones ---------- */
  function renderInsights() {
    const ul = $('#insights');
    ul.innerHTML = '';
    const sev = { bajo: 'var(--st-normal)', moderado: 'var(--st-atencion)', alto: 'var(--st-prealerta)', 'muy-alto': 'var(--st-alerta)' };
    (state.data.insights || []).slice(0, 7).forEach((i) => {
      const li = document.createElement('li');
      li.style.setProperty('--sev', sev[i.level] || 'var(--st-nd)');
      li.textContent = i.text;
      ul.appendChild(li);
    });
  }

  /* ---------- Mapa ---------- */
  function pointsForLayer() {
    const { data } = state;
    const st = (data.stations || [])
      .filter((s) => s.map && s.kind !== 'embalse' && s.status !== 'sin-datos')
      .map((s) => ({ ...s, xy: project(s.lon, s.lat), type: 'st', st: s.status }));
    const nodes = (data.glofas || []).map((n) => ({ ...n, xy: project(n.lon, n.lat), type: 'node', st: state.layer === 'obs' ? n.status : n.fcStatus }));
    return { st, nodes };
  }

  function colorRiver(r, pts) {
    const allowed = SEGS[r.id];
    if (!allowed || !allowed.length) return null;
    const { st, nodes } = pointsForLayer();
    const S = state.layer === 'obs' ? st.filter((p) => allowed.includes(p.seg)) : [];
    const N = nodes.filter((p) => allowed.includes(p.seg) && p.st && p.st !== 'sin-datos');
    return pts.map(([x, y]) => {
      let best = null, bd = Infinity;
      for (const p of S) { const d = Math.hypot(p.xy[0] - x, p.xy[1] - y); if (d < bd) { bd = d; best = p; } }
      if (best && bd <= 48) return best.st;
      best = null; bd = Infinity;
      for (const p of N) { const d = Math.hypot(p.xy[0] - x, p.xy[1] - y); if (d < bd) { bd = d; best = p; } }
      return best && bd <= 150 ? best.st : 'sin-datos';
    });
  }

  function renderMap() {
    const { geo } = state;
    const svg = $('#map');
    svg.innerHTML = '';
    const [vx, vy, vw, vh] = geo.viewBox;
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    el('rect', { x: vx, y: vy, width: vw, height: vh, class: 'land' }, svg);
    // Océano: costa cerrada contra el borde derecho/inferior
    for (const c of geo.coast) {
      const a = c[0], b = c.at(-1);
      const poly = [...c, [vx + vw + 10, b[1]], [vx + vw + 10, vy + vh + 10], [a[0], vy + vh + 10]];
      el('path', { d: `${path(poly)}Z`, style: 'fill:var(--sea)' }, svg);
      el('path', { d: path(c), class: 'coast' }, svg);
    }
    geo.borders.forEach((b) => el('path', { d: path(b), class: 'border' }, svg));
    geo.labels.countries.forEach((l) => { el('text', { x: l.p[0], y: l.p[1], class: `country${l.sea ? ' sea' : ''}`, 'text-anchor': 'middle' }, svg).textContent = l.t; });

    const gR = el('g', {}, svg);
    geo.rivers.filter((r) => r.rank === 'minor').forEach((r) => el('path', { d: path(r.pts), class: 'river-minor' }, gR));
    geo.rivers.filter((r) => r.rank === 'mid').forEach((r) => el('path', { d: path(r.pts), class: 'river-mid' }, gR));
    const majors = geo.rivers.filter((r) => r.rank === 'major');
    majors.forEach((r) => el('path', { d: path(r.pts), class: 'river-halo' }, gR));
    majors.forEach((r) => {
      const cls = colorRiver(r, r.pts);
      const thin = /delta|pilcomayo|bermejo|iguazu/.test(r.id);
      if (!cls) { el('path', { d: path(r.pts), class: `river-seg${thin ? ' thin' : ''}`, style: 'stroke:var(--river-idle)' }, gR); return; }
      let start = 0;
      for (let i = 1; i <= r.pts.length; i++) {
        if (i === r.pts.length || cls[i] !== cls[start]) {
          const seg = r.pts.slice(start, Math.min(i + 1, r.pts.length));
          const k = cls[start];
          el('path', { d: path(seg), class: `river-seg${thin ? ' thin' : ''}`, style: `stroke:${k === 'sin-datos' ? 'var(--river-idle)' : STATUS[k].v}` }, gR);
          start = i;
        }
      }
    });

    const rl = [['Paraná', -60.05, -30.1, 62], ['Paraguay', -57.55, -21.2, 80], ['Uruguay', -56.2, -29.0, -52], ['Alto Paraná', -52.6, -22.3, -52], ['Iguazú', -52.4, -25.35, 0], ['Bermejo', -61.9, -24.6, 38], ['Pilcomayo', -61.6, -22.0, 32], ['Salado', -62.3, -28.6, 58]];
    rl.forEach(([t, lon, lat, rot]) => {
      const [x, y] = project(lon, lat);
      el('text', { x, y, class: 'river-label', transform: `rotate(${rot} ${x} ${y})`, 'text-anchor': 'middle' }, svg).textContent = t;
    });
    geo.labels.cities.forEach((c) => {
      el('circle', { cx: c.p[0], cy: c.p[1], r: 2, class: 'city-dot' }, svg);
      const right = !['Rosario', 'Santa Fe', 'Corrientes', 'Asunción'].includes(c.t);
      el('text', { x: c.p[0] + (right ? 6 : -6), y: c.p[1] + 3.5, class: 'city', 'text-anchor': right ? 'start' : 'end' }, svg).textContent = c.t;
    });

    // Marcadores
    const { st, nodes } = pointsForLayer();
    const gN = el('g', {}, svg);
    nodes.forEach((n) => {
      const s = STATUS[n.st] || STATUS['sin-datos'];
      const size = 5.5;
      const m = el('rect', { x: n.xy[0] - size, y: n.xy[1] - size, width: size * 2, height: size * 2, transform: `rotate(45 ${n.xy[0]} ${n.xy[1]})`, class: 'node', style: `fill:${s.v}`, tabindex: 0, 'data-id': `node:${n.id}` }, gN);
      bindTip(m, () => nodeTip(n), n.xy);
    });
    if (state.layer === 'obs') {
      const gS = el('g', {}, svg);
      [...st].sort((a, b) => STATUS[a.st].r - STATUS[b.st].r).forEach((s) => {
        const d = STATUS[s.st];
        const c = el('circle', { cx: s.xy[0], cy: s.xy[1], r: d.r, class: `st${state.selected === s.id ? ' sel' : ''}`, style: `fill:${d.v}`, tabindex: 0, 'data-id': s.id }, gS);
        bindTip(c, () => stationTip(s), s.xy);
        c.addEventListener('click', () => select(s.id, true));
      });
    }

    const legend = $('#legend');
    legend.innerHTML = '';
    const keys = state.layer === 'obs' ? ['normal', 'atencion', 'prealerta', 'alerta', 'evacuacion', 'sin-datos'] : ['normal', 'atencion', 'prealerta', 'alerta', 'sin-datos'];
    const desc = state.layer === 'obs'
      ? { normal: '< 70 % del alerta', atencion: '70–85 %', prealerta: '85–100 %', alerta: '≥ nivel de alerta', evacuacion: '≥ evacuación', 'sin-datos': 'sin escala / datos' }
      : { normal: '< p75', atencion: 'p75–p90', prealerta: 'p90–p97', alerta: '≥ p97', 'sin-datos': 'sin datos' };
    keys.forEach((k) => {
      const li = document.createElement('li');
      li.innerHTML = `<i style="background:${k === 'sin-datos' ? 'var(--river-idle)' : STATUS[k].v}"></i>${STATUS[k].label} <span class="note">${desc[k]}</span>`;
      legend.appendChild(li);
    });
    $('#mapNote').textContent = state.layer === 'obs'
      ? 'Tramos coloreados por la escala hidrométrica más cercana (círculos, Prefectura/INA); donde no hay escalas, por el caudal actual del modelo GloFAS (rombos) respecto de su historia 2009–2025.'
      : 'Máximo caudal previsto en los próximos 30 días por la mediana del ensamble GloFAS, expresado como percentil del registro 2009–2025 para esa época del año.';
  }

  const tip = () => $('#tip');
  function bindTip(node, html, xy) {
    const show = () => {
      const t = tip();
      t.innerHTML = html();
      t.hidden = false;
      const svg = $('#map');
      const box = svg.getBoundingClientRect();
      const [vx, vy, vw, vh] = state.geo.viewBox;
      const px = ((xy[0] - vx) / vw) * box.width, py = ((xy[1] - vy) / vh) * box.height;
      const tw = t.offsetWidth, th = t.offsetHeight;
      t.style.left = `${Math.min(box.width - tw - 6, Math.max(6, px + 12))}px`;
      t.style.top = `${py - th - 10 < 6 ? py + 14 : py - th - 10}px`;
    };
    node.addEventListener('mouseenter', show);
    node.addEventListener('focus', show);
    node.addEventListener('mouseleave', () => { tip().hidden = true; });
    node.addEventListener('blur', () => { tip().hidden = true; });
  }
  const pill = (k) => `<span class="pill"><i style="background:${STATUS[k]?.v || 'var(--st-nd)'}"></i>${STATUS[k]?.label || k}</span>`;
  function stationTip(s) {
    return `<b>${esc(s.name)}</b>${pill(s.status)}
      <div class="t-row"><span>Altura</span><span>${fmt(s.level)} m ${s.change != null ? `(${signed(s.change)})` : ''}</span></div>
      <div class="t-row"><span>Alerta / evac.</span><span>${fmt(s.alert)} / ${fmt(s.evac)}</span></div>
      <div class="t-row"><span>Registro</span><span>${dTime(s.time)}</span></div>
      ${s.outlook ? `<div class="t-row"><span>INA</span><span>${esc(s.outlook)}</span></div>` : ''}`;
  }
  function nodeTip(n) {
    return `<b>${esc(n.name)}</b><span class="note">Modelo GloFAS</span>
      <div class="t-row"><span>Caudal hoy</span><span>${fmtInt(n.q)} m³/s</span></div>
      <div class="t-row"><span>Percentil hoy</span><span>${n.pct == null ? '–' : `p${Math.round(n.pct)}`}</span></div>
      <div class="t-row"><span>Máx. 30 días</span><span>${fmtInt(n.fcMax)} m³/s</span></div>
      <div class="t-row"><span>Percentil máx.</span><span>${n.fcMedianMaxPct == null ? '–' : `p${Math.round(n.fcMedianMaxPct)}`}</span></div>`;
  }

  /* ---------- Escalas ---------- */
  const PRINCIPAL = new Set(['parana-bajo']);
  function renderStations() {
    const f = $('#riverFilter').value;
    const list = (state.data.stations || []).filter((s) => {
      if (f === 'todas') return true;
      if (f === 'principal') return PRINCIPAL.has(s.seg) || ['VILLA CONSTITUCION', 'SAN NICOLAS', 'RAMALLO', 'SAN PEDRO'].includes(s.id);
      return s.seg === f;
    });
    const ol = $('#stationList');
    ol.innerHTML = '';
    for (const s of list) {
      const li = document.createElement('li');
      li.dataset.id = s.id;
      if (state.selected === s.id) li.className = 'sel';
      const color = STATUS[s.status]?.v || 'var(--st-nd)';
      let staff;
      if (s.alert != null && s.level != null) {
        const max = Math.max(s.evac ?? s.alert, s.level) * 1.12;
        const step = max > 24 ? 5 : 1;
        let ticks = '';
        for (let m = step; m < max; m += step) ticks += `<span class="tick${m % 5 === 0 ? ' m5' : ''}" style="left:${(m / max) * 100}%"></span>`;
        staff = `<div class="staff" role="img" aria-label="${fmt(s.level)} m de ${fmt(s.alert)} m de alerta">${ticks}
          <span class="fill" style="width:${Math.max(0.5, (s.level / max) * 100)}%;background:${color}"></span>
          <span class="mk a" style="left:${(s.alert / max) * 100}%"></span>${s.evac != null ? `<span class="mk e" style="left:${(s.evac / max) * 100}%"></span>` : ''}</div>`;
      } else {
        staff = `<p class="note">${s.kind === 'embalse' ? 'Embalse · cota sin nivel de alerta' : 'Sin lectura vigente'}</p>`;
      }
      const chg = s.change == null ? '' : `<small class="${s.change > 0 ? 'up' : ''}">${s.change > 0 ? '▲' : s.change < 0 ? '▼' : '='} ${fmt(Math.abs(s.change))}</small>`;
      li.innerHTML = `<div class="s-name">${esc(s.name)}<small>${pill(s.status)}</small></div>${staff}
        <div class="s-val">${s.level == null ? '–' : fmt(s.level)}${chg}</div>
        <div class="s-meta">${s.alert != null ? `<span>Alerta ${fmt(s.alert)} · Evac. ${fmt(s.evac)}</span>` : ''}<span>${dTime(s.time)}</span>${s.outlook ? `<span>INA: ${esc(s.outlook)}</span>` : ''}</div>`;
      li.addEventListener('click', () => select(s.id, false));
      ol.appendChild(li);
    }
    if (!list.length) ol.innerHTML = '<li class="note">Sin estaciones para este filtro.</li>';
  }

  function select(id, fromMap) {
    state.selected = state.selected === id ? null : id;
    document.querySelectorAll('#map .st').forEach((c) => c.classList.toggle('sel', c.dataset.id === state.selected));
    document.querySelectorAll('#stationList li').forEach((li) => li.classList.toggle('sel', li.dataset.id === state.selected));
    if (fromMap && state.selected) {
      const s = state.data.stations.find((x) => x.id === id);
      const sel = $('#riverFilter');
      const inList = [...document.querySelectorAll('#stationList li')].some((li) => li.dataset.id === id);
      if (!inList && s) { sel.value = s.seg; renderStations(); }
      document.querySelector(`#stationList li[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /* ---------- Caudales ---------- */
  function renderFlows() {
    const grid = $('#flowGrid');
    grid.innerHTML = '';
    const nodes = [...(state.data.glofas || [])].sort((a, b) => (b.key - a.key) || 0);
    for (const n of nodes) {
      const card = document.createElement('div');
      card.className = 'flow';
      const pk = n.pct == null ? null : Math.round(n.pct);
      card.innerHTML = `<div class="f-row"><h3>${esc(n.name)}</h3>${pill(n.status)}</div>
        <div class="f-row"><span class="f-q">${fmtInt(n.q)} <small>m³/s</small></span><span class="note">${pk == null ? 'sin climatología' : `percentil ${pk}`}</span></div>`;
      const s = n.series;
      if (s && s.q?.length > 2) {
        const W = 260, H = 76, T = 4, B = 4;
        const len = s.q.length;
        // Escala desde 0; el techo lo fijan el caudal, la mediana y el p90 (el máximo del ensamble se recorta)
        const vals = [...s.q, ...(s.med || []), ...(s.p90 || [])].filter((v) => v != null);
        const maxV = Math.max(...vals) * 1.3, minV = 0;
        const x = (i) => (i / (len - 1)) * W;
        const y = (v) => T + ((maxV - v) / (maxV - minV)) * (H - T - B);
        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Caudal de ${n.name}` });
        const clipId = `clip-${n.id}`;
        el('rect', { x: 0, y: 0, width: W, height: H }, el('clipPath', { id: clipId }, svg));
        if (s.p50 && s.p90) {
          const up = s.p90.map((v, i) => [x(i), y(v)]);
          const lo = s.p50.map((v, i) => [x(i), y(v)]).reverse();
          el('path', { d: `${path([...up, ...lo])}Z`, class: 'band' }, svg);
        }
        const ti = s.today ?? Math.floor(len / 2);
        if (s.max && s.min) {
          const up = s.max.map((v, i) => [x(i), y(v)]).slice(ti);
          const lo = s.min.map((v, i) => [x(i), y(v)]).slice(ti).reverse();
          if (up.length > 1) el('path', { d: `${path([...up, ...lo])}Z`, class: 'ens', 'clip-path': `url(#${clipId})` }, svg);
        }
        el('path', { d: path(s.q.slice(0, ti + 1).map((v, i) => [x(i), y(v)])), class: 'line' }, svg);
        const fc = (s.med || s.q).slice(ti).map((v, i) => [x(i + ti), y(v)]);
        if (fc.length > 1) el('path', { d: path(fc), class: 'fc' }, svg);
        el('line', { x1: x(ti), x2: x(ti), y1: 0, y2: H, class: 'today' }, svg);
        el('circle', { cx: x(ti), cy: y(s.q[ti]), r: 3, style: 'fill:var(--ink);stroke:var(--surface);stroke-width:1.5' }, svg);
        const hover = el('line', { x1: 0, x2: 0, y1: 0, y2: H, style: 'stroke:var(--ink);stroke-width:1;opacity:0' }, svg);
        card.appendChild(svg);
        const foot = document.createElement('p');
        foot.className = 'f-foot';
        const base = n.fcMax != null ? `Máx. a 30 días ${fmtInt(n.fcMax)} m³/s${n.fcMaxDate ? ` (${dShort(n.fcMaxDate)})` : ''}${n.fcMedianMaxPct != null ? ` · p${Math.round(n.fcMedianMaxPct)}` : ''}` : '';
        foot.textContent = base;
        card.appendChild(foot);
        const startDate = new Date(`${s.start}T12:00:00Z`);
        svg.addEventListener('mousemove', (ev) => {
          const r = svg.getBoundingClientRect();
          const i = Math.max(0, Math.min(len - 1, Math.round(((ev.clientX - r.left) / r.width) * (len - 1))));
          hover.setAttribute('x1', x(i)); hover.setAttribute('x2', x(i)); hover.style.opacity = 0.5;
          const d = new Date(startDate.getTime() + i * (s.step || 1) * 864e5).toISOString().slice(0, 10);
          const v = i <= ti ? s.q[i] : (s.med || s.q)[i];
          foot.textContent = `${dShort(d)} · ${fmtInt(v)} m³/s${i > ti ? ' (pronóstico)' : ''}${s.p50 ? ` · mediana hist. ${fmtInt(s.p50[i])}` : ''}`;
        });
        svg.addEventListener('mouseleave', () => { hover.style.opacity = 0; foot.textContent = base; });
      } else if (n.fcMax != null) {
        const p = document.createElement('p');
        p.className = 'f-foot';
        p.textContent = `Máx. a 30 días ${fmtInt(n.fcMax)} m³/s${n.fcMedianMaxPct != null ? ` · p${Math.round(n.fcMedianMaxPct)}` : ''}`;
        card.appendChild(p);
      }
      grid.appendChild(card);
    }
    if (!nodes.length) grid.innerHTML = '<p class="note">Sin datos del modelo GloFAS.</p>';
  }

  /* ---------- Lluvia ---------- */
  function renderRain() {
    const ol = $('#rainList');
    ol.innerHTML = '';
    const zones = [...(state.data.rain || [])].sort((a, b) => b.next16 - a.next16);
    const maxDay = Math.max(10, ...zones.flatMap((z) => z.daily || []));
    for (const z of zones) {
      const li = document.createElement('li');
      const start = new Date(`${z.start}T12:00:00Z`);
      const bars = (z.daily || []).map((v, i) => {
        const d = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
        return `<span class="${v < 0.2 ? 'zero' : ''}" style="height:${Math.max(4, (v / maxDay) * 100)}%" title="${dShort(d)}: ${fmt(v, 1)} mm"></span>`;
      }).join('');
      li.innerHTML = `<span class="r-name">${esc(z.name)}${z.upstream ? '<small>alta cuenca</small>' : ''}</span><span class="r-val">${fmtInt(z.next16)}</span><span class="r-bars" role="img" aria-label="Lluvia diaria prevista en ${esc(z.name)}">${bars}</span>`;
      ol.appendChild(li);
    }
    if (!zones.length) ol.innerHTML = '<li class="note">Sin pronóstico de lluvia.</li>';
  }

  /* ---------- Historial ---------- */
  function renderHistory() {
    const box = $('#historyChart');
    const legend = $('#historyLegend');
    box.innerHTML = ''; legend.innerHTML = '';
    const days = state.hist?.days || [];
    const series = [['CORRIENTES', 'Corrientes', 'var(--s1)'], ['GOYA', 'Goya', 'var(--s2)'], ['SANTA FE', 'Santa Fe', 'var(--s3)'], ['ROSARIO', 'Rosario', 'var(--s4)']]
      .map(([id, name, c]) => ({ id, name, c, pts: days.map((d) => [d.d, d.st?.[id]]).filter((p) => p[1] != null) }))
      .filter((s) => s.pts.length);
    if (days.length < 2 || !series.length) { box.innerHTML = '<p class="note">El historial se completa con cada corrida diaria del colector.</p>'; return; }
    const W = 640, H = 210, L = 34, R = 78, T = 10, B = 24;
    const t0 = new Date(`${days[0].d}T12:00:00Z`).getTime(), t1 = new Date(`${days.at(-1).d}T12:00:00Z`).getTime();
    const x = (d) => L + ((new Date(`${d}T12:00:00Z`).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const all = series.flatMap((s) => s.pts.map((p) => p[1]));
    const maxV = Math.ceil(Math.max(...all) + 0.3), minV = Math.floor(Math.min(...all) - 0.3);
    const y = (v) => T + ((maxV - v) / (maxV - minV)) * (H - T - B);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Evolución de alturas en escalas de referencia' }, box);
    const stepV = maxV - minV > 4 ? 1 : 0.5;
    for (let v = minV; v <= maxV + 1e-9; v += stepV) {
      el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'gridline' }, svg);
      el('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, svg).textContent = fmt(v, stepV < 1 ? 1 : 0);
    }
    // Etiquetas de fecha sin colisiones (mínimo 56 px entre sí; la última siempre visible)
    let lastX = Infinity;
    [...days].reverse().forEach((d) => {
      const xx = x(d.d);
      if (lastX - xx < 56) return;
      el('text', { x: xx, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = dShort(d.d);
      lastX = xx;
    });
    const labels = [];
    series.forEach((s) => {
      el('path', { d: path(s.pts.map((p) => [x(p[0]), y(p[1])])), style: `fill:none;stroke:${s.c};stroke-width:2;stroke-linejoin:round` }, svg);
      s.pts.forEach((p) => {
        const g = el('g', {}, svg);
        el('circle', { cx: x(p[0]), cy: y(p[1]), r: 3.5, style: `fill:${s.c};stroke:var(--surface);stroke-width:2` }, g);
        el('title', {}, g).textContent = `${s.name} · ${dShort(p[0])}: ${fmt(p[1])} m`;
      });
      const last = s.pts.at(-1);
      labels.push({ y: y(last[1]), t: `${s.name} ${fmt(last[1])}`, x: x(last[0]) });
    });
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
    labels.forEach((l) => { el('text', { x: W - R + 6, y: l.y + 3.5, style: 'fill:var(--ink-2);font:400 10.5px var(--font-mono)' }, svg).textContent = l.t; });
    series.forEach((s) => {
      const li = document.createElement('li');
      li.innerHTML = `<i style="background:${s.c}"></i>${s.name}`;
      legend.appendChild(li);
    });
  }

  /* ---------- INA ---------- */
  function renderINA() {
    const ina = state.data.ina;
    const box = $('#inaText');
    box.innerHTML = '';
    if (!ina) { box.innerHTML = '<p>Sin reporte disponible.</p>'; return; }
    $('#inaDate').textContent = ina.date ? `Reporte hidrológico del ${dShort(ina.date)}` : '';
    (ina.paragraphs || []).slice(0, 4).forEach((p) => { const e = document.createElement('p'); e.textContent = p; box.appendChild(e); });
    if (ina.stations?.length) {
      const t = document.createElement('table');
      t.className = 'ina-table';
      t.innerHTML = `<tbody>${ina.stations.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.outlook)}</td></tr>`).join('')}</tbody>`;
      box.appendChild(t);
    }
  }

  /* ---------- Eventos ---------- */
  $('#riverFilter').addEventListener('change', renderStations);
  const setLayer = (l) => {
    state.layer = l;
    $('#layerObs').classList.toggle('on', l === 'obs'); $('#layerObs').setAttribute('aria-pressed', l === 'obs');
    $('#layerFc').classList.toggle('on', l === 'fc'); $('#layerFc').setAttribute('aria-pressed', l === 'fc');
    renderMap();
  };
  $('#layerObs').addEventListener('click', () => setLayer('obs'));
  $('#layerFc').addEventListener('click', () => setLayer('fc'));

  load();
})();
