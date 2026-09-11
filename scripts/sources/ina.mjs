// INA — Reporte hidrometeorológico diario de la Cuenca del Plata
// Tabla #tabla-alturas: Estación | Río | Nivel (m) | Alerta | Evacuación | Perspectiva
import { fetchText, tableRows, stripTags, num } from '../lib/util.mjs';
import { normalizeName } from '../stations.mjs';

export const URL_INA = 'https://alerta.ina.gob.ar/a5/diario/reporte_diario';

// Mapeo de nombres INA -> claves Prefectura
const ALIAS = { 'PUERTO IGUAZU': 'IGUAZU', 'PUERTO PILCOMAYO': 'PILCOMAYO', 'PUERTO FORMOSA': 'FORMOSA' };

export function parseINA(html) {
  const tbl = html.match(/<table[^>]*id=["']tabla-alturas["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tbl) throw new Error('INA: no se encontró #tabla-alturas');
  const rows = tableRows(tbl[1]);
  const stations = rows
    .filter((r) => r.length >= 5 && !/estaci/i.test(r[0]))
    .map((r) => {
      const n = normalizeName(r[0]);
      return {
        id: ALIAS[n] || n,
        name: r[0],
        river: r[1],
        level: num(r[2]),
        alert: num(r[3]),
        evac: num(r[4]),
        outlook: (r[5] || '').replace(/^agua /i, 'aguas '),
      };
    });

  // Fecha del reporte (primer dd/mm/aaaa o "10 de septiembre de 2026")
  const text = stripTags(html);
  let date = null;
  const m1 = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) date = `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;

  // Narrativa: párrafos largos que mencionen ríos de la cuenca
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((p) => p.length > 90 && /(Paran|Paraguay|Iguaz|Uruguay|precipitaci|Delta)/i.test(p))
    .slice(0, 8);

  return { date, stations, paragraphs };
}

export async function getINA() {
  const html = await fetchText(URL_INA, { timeout: 45000 });
  return parseINA(html);
}
