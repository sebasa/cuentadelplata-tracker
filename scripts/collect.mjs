// Colector principal: baja todas las fuentes, normaliza y escribe public/data/latest.json + history.json
// Uso: node scripts/collect.mjs
// Si una fuente falla, se conserva la última versión buena (marcada como "stale").
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getPrefectura, URL_PNA } from './sources/prefectura.mjs';
import { getINA, URL_INA } from './sources/ina.mjs';
import { getENSO, URL_ONI } from './sources/noaa.mjs';
import { getGlofas, getRain, URL_FLOOD, URL_FORECAST } from './sources/openmeteo.mjs';
import { STATIONS } from './stations.mjs';
import { stationStatus, computeRisk, buildInsights } from './lib/risk.mjs';

const DATA = new URL('../public/data/', import.meta.url);
const readJSON = (name) => {
  const f = new URL(name, DATA);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

// Fecha de hoy en Argentina (YYYY-MM-DD)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

async function run(name, fn, prev, url) {
  const t0 = Date.now();
  try {
    const data = await fn();
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
    return { data, meta: { ok: true, stale: false, fetchedAt: new Date().toISOString(), url } };
  } catch (e) {
    console.warn(`✗ ${name}: ${e.message}`);
    return { data: prev ?? null, meta: { ok: false, stale: prev != null, error: e.message, fetchedAt: new Date().toISOString(), url, lastGood: undefined } };
  }
}

export function mergeStations(pna, ina) {
  const inaById = Object.fromEntries((ina?.stations || []).map((s) => [s.id, s]));
  const base = pna?.length ? pna : (ina?.stations || []).map((s) => ({ ...s, trend: 'sin-datos', change: null, time: ina.date }));
  return base
    .map((s) => {
      const meta = STATIONS[s.id] || {};
      const i = inaById[s.id];
      const alert = s.alert ?? i?.alert ?? null;
      const evac = s.evac ?? i?.evac ?? null;
      // Los embalses (cotas de lago regulado) no se evalúan contra alerta: su nivel lo fija la operación de la represa
      const { ratio, status } = meta.kind === 'embalse' ? { ratio: null, status: 'sin-datos' } : stationStatus({ level: s.level, alert, evac });
      return {
        id: s.id, name: meta.name || s.name, river: s.river, seg: meta.seg || null,
        lat: meta.lat ?? null, lon: meta.lon ?? null, map: meta.map !== false && meta.lat != null,
        kind: meta.kind || 'escala', country: meta.country || 'AR', key: !!meta.key,
        level: s.level, change: s.change, periodH: s.periodH ?? null, trend: s.trend, time: s.time,
        alert, evac, ratio, status, outlook: i?.outlook || null,
      };
    })
    .filter((s) => s.seg); // sólo estaciones de la Cuenca del Plata catalogadas
}

async function main() {
  const prev = readJSON('latest.json') || {};
  const climatology = readJSON('climatology.json');
  if (!climatology) console.warn('! Falta climatology.json: correr "npm run climatology" para percentiles de caudal');

  const [pna, ina, enso, glofas, rain] = await Promise.all([
    run('Prefectura Naval', getPrefectura, prev.raw?.prefectura, URL_PNA),
    run('INA reporte diario', getINA, prev.ina, URL_INA),
    run('NOAA ENSO', getENSO, prev.enso, URL_ONI),
    run('GloFAS (Open-Meteo)', () => getGlofas(climatology, today), prev.glofas, URL_FLOOD),
    run('Precipitación (Open-Meteo)', () => getRain(today), prev.rain, URL_FORECAST),
  ]);

  const stations = pna.meta.ok || ina.meta.ok ? mergeStations(pna.data, ina.data) : prev.stations || [];
  const risk = computeRisk({ enso: enso.data, stations, glofas: glofas.data, rain: rain.data });
  const insights = buildInsights({ enso: enso.data, stations, glofas: glofas.data, rain: rain.data, risk });

  const latest = {
    generatedAt: new Date().toISOString(),
    today,
    sources: {
      prefectura: { name: 'Prefectura Naval Argentina', ...pna.meta, lastGood: pna.meta.ok ? new Date().toISOString() : prev.sources?.prefectura?.lastGood },
      ina: { name: 'INA – Alerta Hidrológico', ...ina.meta, lastGood: ina.meta.ok ? new Date().toISOString() : prev.sources?.ina?.lastGood },
      enso: { name: 'NOAA CPC (ENSO)', ...enso.meta, lastGood: enso.meta.ok ? new Date().toISOString() : prev.sources?.enso?.lastGood },
      glofas: { name: 'GloFAS v4 vía Open-Meteo', ...glofas.meta, climatology: climatology ? climatology.period : null, lastGood: glofas.meta.ok ? new Date().toISOString() : prev.sources?.glofas?.lastGood },
      rain: { name: 'Open-Meteo Forecast', ...rain.meta, lastGood: rain.meta.ok ? new Date().toISOString() : prev.sources?.rain?.lastGood },
    },
    risk, insights, enso: enso.data, stations, glofas: glofas.data, rain: rain.data,
    ina: ina.data ? { date: ina.data.date, paragraphs: ina.data.paragraphs, stations: ina.data.stations } : null,
    raw: { prefectura: pna.data },
  };
  writeFileSync(new URL('latest.json', DATA), JSON.stringify(latest));

  // Historial diario (una entrada por día, se sobrescribe la del día)
  const hist = readJSON('history.json') || { days: [] };
  const entry = {
    d: today, idx: risk.score, n34: enso.data?.weekly?.at(-1)?.nino34 ?? null,
    st: Object.fromEntries(stations.filter((s) => s.key && s.level != null).map((s) => [s.id, s.level])),
  };
  hist.days = hist.days.filter((x) => x.d !== today).concat(entry).sort((a, b) => a.d.localeCompare(b.d)).slice(-730);
  writeFileSync(new URL('history.json', DATA), JSON.stringify(hist));

  console.log(`Índice ${risk.score}/100 (${risk.level}) · ${stations.length} estaciones · ${insights.length} observaciones`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
