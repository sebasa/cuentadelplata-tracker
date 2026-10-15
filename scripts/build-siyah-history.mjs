// Backfill de historial con series largas de INA (SIyAH/a5): completa public/data/history.json
// con alturas diarias reales de los últimos ~2 años en las estaciones de referencia, en vez de
// esperar a que el colector diario las acumule una por una.
// Uso: node scripts/build-siyah-history.mjs (correr una vez; opcionalmente para extender el rango)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getSiyahDaily } from './sources/siyah.mjs';
import { STATIONS } from './stations.mjs';

const DATA = new URL('../public/data/', import.meta.url);
const HIST_DAYS = 730; // mismo tope que usa collect.mjs

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const startDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  .format(new Date(Date.now() - HIST_DAYS * 86400000));

async function main() {
  const f = new URL('history.json', DATA);
  const hist = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { days: [] };
  const byDate = new Map(hist.days.map((d) => [d.d, d]));

  const stations = Object.entries(STATIONS).filter(([, m]) => m.siyahId);
  for (const [id, meta] of stations) {
    process.stdout.write(`• ${meta.name} (siyahId ${meta.siyahId}): `);
    const series = await getSiyahDaily(meta.siyahId, startDate, today);
    let added = 0;
    for (const { d, level } of series) {
      let day = byDate.get(d);
      if (!day) { day = { d, idx: null, n34: null, st: {} }; byDate.set(d, day); }
      if (day.st[id] == null) { day.st[id] = level; added++; }
    }
    console.log(`${series.length} lecturas, ${added} días completados`);
  }

  hist.days = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-HIST_DAYS);
  writeFileSync(f, JSON.stringify(hist));
  console.log(`history.json: ${hist.days.length} días totales`);
}

main().catch((e) => { console.error(e); process.exit(1); });
