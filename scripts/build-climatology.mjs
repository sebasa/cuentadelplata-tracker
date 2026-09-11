// Construye public/data/climatology.json (correr una vez; opcionalmente una vez por año)
//  1. "Engancha" cada nodo GloFAS a la celda de mayor caudal en un entorno de ±0.10°
//  2. Descarga el caudal diario 2009–(año pasado) en bloques de 4 años y calcula percentiles
//     por día del año con ventana móvil de ±15 días.
// Open-Meteo pondera las consultas largas (≈1 llamada cada 14 días de datos por punto) y limita
// a 600 llamadas/minuto y 10.000/día en el plan gratuito: por eso los bloques y las pausas.
import { writeFileSync } from 'node:fs';
import { fetchJSON } from './lib/util.mjs';
import { GLOFAS_NODES } from './stations.mjs';
import { URL_FLOOD, dayOfYear } from './sources/openmeteo.mjs';

const FIRST_YEAR = 2009;
const LAST_YEAR = new Date().getUTCFullYear() - 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (o) => new URLSearchParams(o).toString();

async function snap(node) {
  const lats = [], lons = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    lats.push((node.lat + dy * 0.05).toFixed(3));
    lons.push((node.lon + dx * 0.05).toFixed(3));
  }
  const url = `${URL_FLOOD}?${q({ latitude: lats.join(','), longitude: lons.join(','), daily: 'river_discharge', start_date: `${LAST_YEAR}-03-01`, end_date: `${LAST_YEAR}-03-28` })}`;
  const res = await fetchJSON(url, { timeout: 90000 });
  let best = null;
  res.forEach((r) => {
    const v = r.daily.river_discharge.filter((x) => x != null);
    const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
    if (!best || mean > best.mean) best = { lat: +r.latitude.toFixed(3), lon: +r.longitude.toFixed(3), mean };
  });
  return best;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function main() {
  const out = { generatedAt: new Date().toISOString(), period: `${FIRST_YEAR}-${LAST_YEAR}`, window: '±15 días', snapped: {}, nodes: {} };
  for (const node of GLOFAS_NODES) {
    process.stdout.write(`• ${node.name}: `);
    const s = await snap({ lat: node.glat ?? node.lat, lon: node.glon ?? node.lon });
    out.snapped[node.id] = { lat: s.lat, lon: s.lon };
    process.stdout.write(`celda ${s.lat},${s.lon} `);
    const byDoy = Array.from({ length: 366 }, () => []);
    for (let a = FIRST_YEAR; a <= LAST_YEAR; a += 4) {
      const b = Math.min(LAST_YEAR, a + 3);
      await sleep(9000);
      const url = `${URL_FLOOD}?${q({ latitude: s.lat, longitude: s.lon, daily: 'river_discharge', start_date: `${a}-01-01`, end_date: `${b}-12-31` })}`;
      const r = await fetchJSON(url, { timeout: 120000 });
      r.daily.time.forEach((t, i) => {
        const v = r.daily.river_discharge[i];
        if (v != null) byDoy[Math.min(dayOfYear(t), 366) - 1].push(v);
      });
      process.stdout.write('.');
    }
    const keys = { p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9, p97: 0.97 };
    const res = Object.fromEntries(Object.keys(keys).map((k) => [k, []]));
    for (let d = 0; d < 366; d++) {
      const pool = [];
      for (let w = -15; w <= 15; w++) pool.push(...byDoy[(d + w + 366) % 366]);
      pool.sort((x, y) => x - y);
      for (const [k, p] of Object.entries(keys)) res[k].push(Math.round(percentile(pool, p)));
    }
    out.nodes[node.id] = res;
    console.log(' ok');
  }
  writeFileSync(new URL('../public/data/climatology.json', import.meta.url), JSON.stringify(out));
  console.log('climatology.json listo');
}

main().catch((e) => { console.error(e); process.exit(1); });
