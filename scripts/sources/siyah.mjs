// INA — Sistema de Información Hidrológica (a5): series históricas puntuales por estación.
// API pública sin autenticación, con registros desde 1884 en varias estaciones.
import { fetchJSON } from '../lib/util.mjs';

export const URL_SIYAH_SERIES = 'https://alerta.ina.gob.ar/a5/obs/puntual/series';
const VAR_ALTURA = 2; // "H" — Altura hidrométrica (m)

// Devuelve la altura diaria (ART) de una estación entre dos fechas (YYYY-MM-DD), de-duplicada
// a un valor por día (el último reportado). Las series de a5 no están garantizadas a 1/día.
export async function getSiyahDaily(siyahId, timestart, timeend) {
  const url = `${URL_SIYAH_SERIES}?estacion_id=${siyahId}&var_id=${VAR_ALTURA}&timestart=${timestart}&timeend=${timeend}`;
  const json = await fetchJSON(url, { timeout: 60000 });
  const obs = json?.rows?.[0]?.observaciones || [];
  const byDay = new Map();
  for (const o of obs) {
    if (o.valor == null) continue;
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(o.timestart));
    byDay.set(d, o.valor); // last write wins: queda la lectura más reciente de ese día
  }
  return [...byDay.entries()].map(([d, level]) => ({ d, level })).sort((a, b) => a.d.localeCompare(b.d));
}
