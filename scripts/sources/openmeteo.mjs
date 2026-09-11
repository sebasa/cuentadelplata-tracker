// Open-Meteo
//  - Flood API: caudal diario modelado por GloFAS v4 (Copernicus EMS), pronóstico por ensamble
//  - Forecast API: precipitación diaria pronosticada (modelo "best match")
import { fetchJSON, round } from '../lib/util.mjs';
import { GLOFAS_NODES, RAIN_ZONES } from '../stations.mjs';

export const URL_FLOOD = 'https://flood-api.open-meteo.com/v1/flood';
export const URL_FORECAST = 'https://api.open-meteo.com/v1/forecast';

const coords = (list) => ({
  latitude: list.map((n) => n.lat.toFixed(3)).join(','),
  longitude: list.map((n) => n.lon.toFixed(3)).join(','),
});
const qs = (o) => new URLSearchParams(o).toString();
const asArray = (j) => (Array.isArray(j) ? j : [j]);

export const dayOfYear = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1; // 1..366
};

// Percentil aproximado de q según climatología diaria {p10,p25,p50,p75,p90,p97}
export function percentileOf(q, c) {
  if (q == null || !c) return null;
  const pts = [[0, 0], [10, c.p10], [25, c.p25], [50, c.p50], [75, c.p75], [90, c.p90], [97, c.p97]];
  for (let i = 1; i < pts.length; i++) {
    const [pa, va] = pts[i - 1];
    const [pb, vb] = pts[i];
    if (q <= vb) return vb === va ? pb : round(pa + ((q - va) / (vb - va)) * (pb - pa), 1);
  }
  const top = c.p97;
  return round(Math.min(99.9, 97 + 3 * Math.min(1, (q - top) / (top * 0.35))), 1);
}

export function climFor(nodeClim, iso) {
  if (!nodeClim) return null;
  const i = Math.min(dayOfYear(iso), 366) - 1;
  const g = (k) => nodeClim[k]?.[i];
  return { p10: g('p10'), p25: g('p25'), p50: g('p50'), p75: g('p75'), p90: g('p90'), p97: g('p97') };
}

export function glofasStatus(pct) {
  if (pct == null) return 'sin-datos';
  if (pct >= 97) return 'alerta';
  if (pct >= 90) return 'prealerta';
  if (pct >= 75) return 'atencion';
  return 'normal';
}

// Resume la respuesta del Flood API para un nodo
export function summarizeFlood(node, resp, climatology, today) {
  const d = resp.daily;
  const t = d.time;
  let iToday = t.indexOf(today);
  if (iToday < 0) iToday = t.findIndex((x) => x > today) - 1;
  if (iToday < 0) iToday = Math.min(t.length - 1, 30);
  const clim = climatology?.nodes?.[node.id];
  const q = d.river_discharge[iToday];
  const pct = percentileOf(q, climFor(clim, t[iToday]));

  const horizon = Math.min(t.length - 1, iToday + 30);
  let fcMax = -Infinity, fcMaxDate = null, fcMaxPct = null, ensMaxPct = null, medMaxPct = null;
  // Máximo previsto: mediana del ensamble (el miembro de control puede ser extremo)
  const central = d.river_discharge_median || d.river_discharge;
  for (let i = iToday + 1; i <= horizon; i++) {
    const c = climFor(clim, t[i]);
    const v = d.river_discharge[i];
    const vc = central[i];
    if (vc != null && vc > fcMax) { fcMax = vc; fcMaxDate = t[i]; }
    const p = percentileOf(v, c);
    if (p != null && (fcMaxPct == null || p > fcMaxPct)) fcMaxPct = p;
    const pm = percentileOf(d.river_discharge_median?.[i], c);
    if (pm != null && (medMaxPct == null || pm > medMaxPct)) medMaxPct = pm;
    const pe = percentileOf(d.river_discharge_max?.[i], c);
    if (pe != null && (ensMaxPct == null || pe > ensMaxPct)) ensMaxPct = pe;
  }
  const qAhead = central[horizon];
  const s = Math.max(0, iToday - 30);
  const e = Math.min(t.length, iToday + 46);
  const r0 = (a) => (a || []).slice(s, e).map((v) => (v == null ? null : Math.round(v)));
  const climSeries = clim ? t.slice(s, e).map((x) => climFor(clim, x)) : null;
  return {
    id: node.id, name: node.name, seg: node.seg, lat: node.lat, lon: node.lon, key: !!node.key, upstream: !!node.upstream,
    date: t[iToday],
    q: round(q, 0),
    pct,
    status: glofasStatus(pct),
    trend30: q && qAhead ? round((qAhead - q) / q, 3) : null,
    fcMax: Number.isFinite(fcMax) ? round(fcMax, 0) : null,
    fcMaxDate,
    fcMaxPct,
    fcMedianMaxPct: medMaxPct,
    fcEnsMaxPct: ensMaxPct,
    fcStatus: glofasStatus(medMaxPct ?? fcMaxPct),
    climToday: clim ? { p50: climFor(clim, t[iToday]).p50, p90: climFor(clim, t[iToday]).p90 } : null,
    series: {
      start: t[s], today: iToday - s, step: 1,
      q: r0(d.river_discharge), med: r0(d.river_discharge_median), max: r0(d.river_discharge_max), min: r0(d.river_discharge_min),
      p50: climSeries ? climSeries.map((c) => c.p50) : null,
      p90: climSeries ? climSeries.map((c) => c.p90) : null,
    },
  };
}

export async function getGlofas(climatology, today) {
  const nodes = GLOFAS_NODES;
  const cell = nodes.map((n) => ({ lat: climatology?.snapped?.[n.id]?.lat ?? n.glat ?? n.lat, lon: climatology?.snapped?.[n.id]?.lon ?? n.glon ?? n.lon }));
  const url = `${URL_FLOOD}?${qs({
    ...coords(cell),
    daily: 'river_discharge,river_discharge_median,river_discharge_max,river_discharge_min',
    past_days: 31, forecast_days: 60,
  })}`;
  const resp = asArray(await fetchJSON(url, { timeout: 60000 }));
  return nodes.map((n, i) => summarizeFlood(n, resp[i], climatology, today));
}

export function summarizeRain(zone, resp, today) {
  const t = resp.daily.time;
  const p = resp.daily.precipitation_sum.map((v) => v ?? 0);
  let i0 = t.indexOf(today);
  if (i0 < 0) i0 = Math.min(7, t.length - 1);
  const sum = (a, b) => round(p.slice(a, b).reduce((x, y) => x + y, 0), 1);
  return {
    id: zone.id, name: zone.name, lat: zone.lat, lon: zone.lon, upstream: !!zone.upstream,
    past7: sum(Math.max(0, i0 - 7), i0),
    next7: sum(i0, i0 + 7),
    next16: sum(i0, i0 + 16),
    start: t[i0],
    daily: p.slice(i0, i0 + 16).map((v) => round(v, 1)),
  };
}

export async function getRain(today) {
  const url = `${URL_FORECAST}?${qs({
    ...coords(RAIN_ZONES),
    daily: 'precipitation_sum', past_days: 7, forecast_days: 16, timezone: 'America/Argentina/Buenos_Aires',
  })}`;
  const resp = asArray(await fetchJSON(url, { timeout: 60000 }));
  return RAIN_ZONES.map((z, i) => summarizeRain(z, resp[i], today));
}
