// Estado por estación e Índice compuesto de riesgo de crecida (0–100)
// IMPORTANTE: índice orientativo propio, no reemplaza los avisos oficiales de INA / SMN / Prefectura.
import { clamp01, median, round } from './util.mjs';

export const STATUS_ORDER = ['sin-datos', 'normal', 'atencion', 'prealerta', 'alerta', 'evacuacion'];
export const STATUS_LABEL = {
  'sin-datos': 'Sin datos', normal: 'Normal', atencion: 'Atención', prealerta: 'Pre-alerta', alerta: 'Alerta', evacuacion: 'Evacuación',
};

export function stationStatus({ level, alert, evac }) {
  if (level == null) return { ratio: null, status: 'sin-datos' };
  if (alert == null || alert <= 0) return { ratio: null, status: 'sin-datos' };
  const ratio = level / alert;
  let status = 'normal';
  if (evac != null && level >= evac) status = 'evacuacion';
  else if (level >= alert) status = 'alerta';
  else if (ratio >= 0.85) status = 'prealerta';
  else if (ratio >= 0.7) status = 'atencion';
  return { ratio: round(ratio, 3), status };
}

const lerp = (v, a, b) => (v == null ? null : clamp01((v - a) / (b - a)));

export function computeRisk({ enso, stations, glofas, rain }) {
  const c = {};

  // 1) ENSO — anomalía semanal Niño 3.4 (o último ONI)
  const lastWeek = enso?.weekly?.at(-1);
  const lastOni = enso?.oni?.at(-1);
  const n34 = lastWeek?.nino34 ?? lastOni?.anom ?? null;
  c.enso = {
    label: 'El Niño (Niño 3.4)', weight: 0.25, value: n34, unit: '°C',
    score: lerp(n34, 0.5, 2.0),
    detail: n34 == null ? 'Sin datos' : `Anomalía ${n34 > 0 ? '+' : ''}${n34} °C`,
  };

  // 2) Nivel actual — mediana de altura/alerta en estaciones de referencia argentinas
  const keySt = (stations || []).filter((s) => s.key && s.ratio != null);
  const medRatio = median(keySt.map((s) => s.ratio));
  c.nivel = {
    label: 'Nivel actual del Paraná', weight: 0.2, value: round(medRatio, 2), unit: '× alerta',
    score: lerp(medRatio, 0.45, 1.0),
    detail: medRatio == null ? 'Sin datos' : `Mediana ${Math.round(medRatio * 100)} % del nivel de alerta`,
  };

  // 3) Tendencia — proporción de estaciones en crecida y variación media
  const trendSt = (stations || []).filter((s) => s.key && s.change != null);
  const rising = trendSt.filter((s) => s.trend === 'crece').length;
  const meanChg = trendSt.length ? trendSt.reduce((a, s) => a + s.change, 0) / trendSt.length : null;
  const tScore = trendSt.length ? 0.5 * (rising / trendSt.length) + 0.5 * clamp01((meanChg + 0.02) / 0.12) : null;
  c.tendencia = {
    label: 'Tendencia de niveles', weight: 0.1, value: round(meanChg, 3), unit: 'm',
    score: tScore,
    detail: trendSt.length ? `${rising} de ${trendSt.length} estaciones crecen · var. media ${meanChg >= 0 ? '+' : ''}${round(meanChg, 2)} m` : 'Sin datos',
  };

  // 4) Caudal pronosticado (GloFAS) — percentil máximo a 30 días (mediana del ensamble) en nodos clave
  const keyNodes = (glofas || []).filter((n) => n.key && (n.fcMedianMaxPct ?? n.fcMaxPct) != null);
  const pcts = keyNodes.map((n) => n.fcMedianMaxPct ?? n.fcMaxPct);
  const pMax = pcts.length ? Math.max(...pcts) : null;
  const pMed = median(pcts);
  const flowVal = pMax == null ? null : 0.6 * pMax + 0.4 * pMed;
  const top = keyNodes.find((n) => (n.fcMedianMaxPct ?? n.fcMaxPct) === pMax);
  c.caudal = {
    label: 'Caudal pronosticado 30 días (GloFAS)', weight: 0.3, value: round(flowVal, 0), unit: 'percentil',
    score: lerp(flowVal, 50, 95),
    detail: pMax == null ? 'Sin climatología / datos' : `Máx. percentil ${Math.round(pMax)} en ${top?.name}`,
  };

  // 5) Lluvia pronosticada 16 días en la alta cuenca
  const up = (rain || []).filter((z) => z.upstream && z.next16 != null);
  const mm = up.length ? up.reduce((a, z) => a + z.next16, 0) / up.length : null;
  c.lluvia = {
    label: 'Lluvia prevista 16 días (alta cuenca)', weight: 0.15, value: round(mm, 0), unit: 'mm',
    score: lerp(mm, 35, 150),
    detail: mm == null ? 'Sin datos' : `Promedio ${Math.round(mm)} mm en ${up.length} zonas`,
  };

  const avail = Object.values(c).filter((x) => x.score != null);
  const wSum = avail.reduce((a, x) => a + x.weight, 0);
  const score = wSum ? Math.round((100 * avail.reduce((a, x) => a + x.score * x.weight, 0)) / wSum) : null;
  for (const x of Object.values(c)) x.score = round(x.score, 3);
  const level = score == null ? 'sin-datos' : score >= 75 ? 'muy-alto' : score >= 50 ? 'alto' : score >= 25 ? 'moderado' : 'bajo';
  return { score, level, coverage: round(wSum, 2), components: c };
}

export function buildInsights({ enso, stations, glofas, rain, risk }) {
  const out = [];
  const w = enso?.weekly?.at(-1);
  if (w) {
    const s = w.nino34;
    const cat = s >= 2 ? 'muy fuerte' : s >= 1.5 ? 'fuerte' : s >= 1 ? 'moderado' : s >= 0.5 ? 'débil' : null;
    out.push({
      level: s >= 1.5 ? 'alto' : s >= 0.5 ? 'moderado' : 'bajo',
      text: cat
        ? `Niño 3.4 semanal en ${s > 0 ? '+' : ''}${s} °C (semana del ${w.week}): condiciones de El Niño ${cat}. Históricamente, eventos así elevan las lluvias en el Litoral y sur de Brasil entre primavera y otoño.`
        : `Niño 3.4 semanal en ${s} °C: sin condiciones de El Niño.`,
    });
  }
  if (enso?.discussion?.status) out.push({ level: /Ni.o Advisory|Watch/i.test(enso.discussion.status) ? 'moderado' : 'bajo', text: `NOAA (${enso.discussion.status}): “${enso.discussion.synopsis || 'sin síntesis disponible'}”` });

  const alerts = (stations || []).filter((s) => ['alerta', 'evacuacion'].includes(s.status));
  const pre = (stations || []).filter((s) => s.status === 'prealerta');
  if (alerts.length) out.push({ level: 'muy-alto', text: `${alerts.length} estación(es) superan el nivel de alerta: ${alerts.map((s) => `${s.name} (${s.level} m)`).join(', ')}.` });
  if (pre.length) out.push({ level: 'alto', text: `${pre.length} estación(es) por encima del 85 % del nivel de alerta: ${pre.slice(0, 6).map((s) => s.name).join(', ')}.` });
  if (!alerts.length && !pre.length && stations?.length) out.push({ level: 'bajo', text: 'Ninguna estación con escala de alerta supera el 85 % de su nivel de alerta.' });

  const risingUp = (glofas || []).filter((n) => n.upstream && n.trend30 != null && n.trend30 > 0.2);
  if (risingUp.length) out.push({ level: 'moderado', text: `GloFAS proyecta aumento de caudal >20 % a 30 días en: ${risingUp.map((n) => `${n.name} (+${Math.round(n.trend30 * 100)} %)`).join(', ')}.` });
  const high = (glofas || []).filter((n) => (n.fcMedianMaxPct ?? 0) >= 90);
  if (high.length) out.push({ level: 'alto', text: `Caudal pronosticado por encima del percentil 90 histórico en: ${high.map((n) => n.name).join(', ')}.` });

  const wet = (rain || []).filter((z) => z.next16 >= 120);
  if (wet.length) out.push({ level: 'moderado', text: `Lluvias acumuladas ≥120 mm previstas en 16 días para: ${wet.map((z) => `${z.name} (${Math.round(z.next16)} mm)`).join(', ')}.` });

  return out;
}
