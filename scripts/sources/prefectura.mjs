// Prefectura Naval Argentina — Registro del estado de los ríos
// Columnas: Puerto | Río | Últ. registro | Variación | Período | Fecha Hora | Estado | (ícono) | Registro anterior | Fecha anterior | Alerta | Evacuación | Hist.
import { fetchText, tableRows, num } from '../lib/util.mjs';
import { STATIONS, normalizeName } from '../stations.mjs';

export const URL_PNA = 'https://contenidosweb.prefecturanaval.gob.ar/alturas/';
const MESES = { ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12 };

// "11/SEP/26 - 0900" -> ISO en hora argentina (UTC-3)
export function parsePnaDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/([A-Z]{3})\/(\d{2,4})\s*-?\s*(\d{2}):?(\d{2})/i);
  if (!m) return null;
  const [, d, mon, y, hh, mm] = m;
  const month = MESES[mon.toUpperCase()];
  if (!month) return null;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(d)}T${hh}:${mm}:00-03:00`;
}

export function parsePrefectura(html) {
  const rows = tableRows(html);
  const header = rows.findIndex((r) => r.some((c) => /puerto/i.test(c)) && r.some((c) => /alerta/i.test(c)));
  if (header < 0) throw new Error('Prefectura: no se encontró la tabla de alturas');
  const out = [];
  for (const c of rows.slice(header + 1)) {
    if (c.length < 12) continue;
    const id = normalizeName(c[0]);
    const meta = STATIONS[id];
    const estado = normalizeName(c[6]);
    out.push({
      id,
      name: meta?.name || c[0],
      river: normalizeName(c[1]),
      level: num(c[2]),
      change: num(c[3]),
      periodH: num(c[4]),
      time: parsePnaDate(c[5]),
      trend: /CRECE/.test(estado) ? 'crece' : /BAJA/.test(estado) ? 'baja' : /ESTAC/.test(estado) ? 'estacionario' : 'sin-datos',
      prevLevel: num(c[8]),
      alert: num(c[10]),
      evac: num(c[11]),
      known: Boolean(meta),
    });
  }
  if (!out.length) throw new Error('Prefectura: tabla vacía');
  return out;
}

export async function getPrefectura() {
  const html = await fetchText(URL_PNA, { timeout: 45000 });
  return parsePrefectura(html);
}
