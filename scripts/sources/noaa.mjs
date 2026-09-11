// NOAA CPC — Índices ENSO
//  - ONI (Oceanic Niño Index): trimestres móviles, ERSSTv5
//  - Niño 3.4 semanal (OISST)
//  - Estado del Sistema de Alerta ENSO (ENSO Diagnostic Discussion)
import { fetchText, stripTags } from '../lib/util.mjs';

export const URL_ONI = 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt';
export const URL_WEEKLY = 'https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for';
export const URL_DISC = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml';

export function parseONI(txt) {
  const out = [];
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z]{3})\s+(\d{4})\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)/);
    if (m) out.push({ season: m[1], year: Number(m[2]), total: Number(m[3]), anom: Number(m[4]) });
  }
  if (!out.length) throw new Error('ONI: sin datos');
  return out;
}

const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// Líneas tipo " 02SEP2026     25.3 4.6     28.4 3.5     29.4 2.7     29.6 1.0"
export function parseWeekly(txt) {
  const out = [];
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*(\d{2})([A-Z]{3})(\d{4})\s+(.*)$/);
    if (!m) continue;
    const pairs = [...m[4].matchAll(/(-?\d+\.\d)\s*(-?\d+\.\d)/g)].map((p) => [Number(p[1]), Number(p[2])]);
    if (pairs.length < 4) continue;
    out.push({
      week: `${m[3]}-${MON[m[2]]}-${m[1]}`,
      nino12: pairs[0][1], nino3: pairs[1][1], nino34: pairs[2][1], nino4: pairs[3][1], nino34sst: pairs[2][0],
    });
  }
  if (!out.length) throw new Error('Niño semanal: sin datos');
  return out;
}

export function parseDiscussion(html) {
  const text = stripTags(html);
  const status = text.match(/ENSO Alert System Status:\s*([A-Za-zñÑ \/-]+?)(?:\s{1,}Synopsis|\s{2,}|$)/i)?.[1]?.trim() || null;
  const synopsis = text.match(/Synopsis:\s*(.+?\.)(?:\s+[A-Z][a-z]+\s|$)/)?.[1]?.trim() || null;
  const issued = text.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/)?.[1] || null;
  return { status, synopsis, issued };
}

export async function getENSO() {
  const [oniTxt, wkTxt, disc] = await Promise.allSettled([fetchText(URL_ONI), fetchText(URL_WEEKLY), fetchText(URL_DISC)]);
  if (oniTxt.status === 'rejected' && wkTxt.status === 'rejected') throw oniTxt.reason;
  const oni = oniTxt.status === 'fulfilled' ? parseONI(oniTxt.value) : [];
  const weekly = wkTxt.status === 'fulfilled' ? parseWeekly(wkTxt.value) : [];
  const discussion = disc.status === 'fulfilled' ? parseDiscussion(disc.value) : {};
  return { oni: oni.slice(-36), weekly: weekly.slice(-26), discussion };
}
