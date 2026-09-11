import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePrefectura, parsePnaDate } from '../scripts/sources/prefectura.mjs';
import { parseINA } from '../scripts/sources/ina.mjs';
import { parseONI, parseWeekly, parseDiscussion } from '../scripts/sources/noaa.mjs';
import { percentileOf, summarizeFlood, summarizeRain } from '../scripts/sources/openmeteo.mjs';
import { stationStatus, computeRisk, buildInsights } from '../scripts/lib/risk.mjs';
import { mergeStations } from '../scripts/collect.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('fecha Prefectura', () => {
  assert.equal(parsePnaDate('11/SEP/26 - 0900'), '2026-09-11T09:00:00-03:00');
  assert.equal(parsePnaDate('-'), null);
});

test('parser Prefectura', () => {
  const r = parsePrefectura(fx('prefectura.html'));
  assert.equal(r.length, 7);
  const c = r.find((s) => s.id === 'CORRIENTES');
  assert.deepEqual([c.level, c.change, c.trend, c.alert, c.evac], [3.06, -0.04, 'baja', 6.5, 7]);
  const p = r.find((s) => s.id === 'PILCOMAYO');
  assert.equal(p.level, null);
  assert.equal(r.find((s) => s.id === 'BARADERO').trend, 'estacionario');
  assert.equal(r.find((s) => s.id === 'REPRESA ITAIPU (BRASIL)').alert, null);
});

test('parser INA', () => {
  const r = parseINA(fx('ina.html'));
  assert.equal(r.date, '2026-09-10');
  assert.equal(r.stations.length, 3);
  assert.equal(r.stations[0].id, 'IGUAZU');
  assert.equal(r.stations[1].level, 3.06);
  assert.equal(r.stations[2].outlook, 'aguas medias');
  assert.equal(r.paragraphs.length, 1);
});

test('parser ONI y semanal', () => {
  const o = parseONI(fx('oni.txt'));
  assert.equal(o.at(-1).anom, 1.8);
  assert.equal(o.at(-1).season, 'JJA');
  const w = parseWeekly(fx('wksst.txt'));
  assert.equal(w.length, 3);
  assert.equal(w[0].nino12, -0.4);
  assert.equal(w.at(-1).week, '2026-09-02');
  assert.equal(w.at(-1).nino34, 2.7);
});

test('parser discusión ENSO', () => {
  const d = parseDiscussion('<p>ENSO Alert System Status: El Niño Advisory</p><p>Synopsis: El Niño is strengthening, with a greater than 90% chance of a very strong event. Discussion text</p><p>issued 10 September 2026</p>');
  assert.equal(d.status, 'El Niño Advisory');
  assert.match(d.synopsis, /^El Niño is strengthening/);
  assert.equal(d.issued, '10 September 2026');
});

test('estado por estación', () => {
  assert.equal(stationStatus({ level: 3.06, alert: 6.5, evac: 7 }).status, 'normal');
  assert.equal(stationStatus({ level: 4.7, alert: 6.5, evac: 7 }).status, 'atencion');
  assert.equal(stationStatus({ level: 5.6, alert: 6.5, evac: 7 }).status, 'prealerta');
  assert.equal(stationStatus({ level: 6.6, alert: 6.5, evac: 7 }).status, 'alerta');
  assert.equal(stationStatus({ level: 7.1, alert: 6.5, evac: 7 }).status, 'evacuacion');
  assert.equal(stationStatus({ level: 94, alert: null, evac: null }).status, 'sin-datos');
});

test('percentiles y resumen GloFAS', () => {
  const c = { p10: 8, p25: 10, p50: 15, p75: 20, p90: 30, p97: 40 };
  assert.equal(percentileOf(15, c), 50);
  assert.equal(percentileOf(25, c), 82.5);
  assert.ok(percentileOf(60, c) > 97);
  const time = Array.from({ length: 91 }, (_, i) => new Date(Date.UTC(2026, 7, 11 + i)).toISOString().slice(0, 10));
  const q = time.map((_, i) => 10000 + i * 100);
  const clim = { nodes: { x: Object.fromEntries(['p10', 'p25', 'p50', 'p75', 'p90', 'p97'].map((k, j) => [k, Array(366).fill([6000, 8000, 11000, 14000, 17000, 21000][j])])) } };
  const s = summarizeFlood({ id: 'x', name: 'X', seg: 'parana-bajo', lat: 0, lon: 0, key: true }, { daily: { time, river_discharge: q, river_discharge_median: q, river_discharge_max: q.map((v) => v * 1.2), river_discharge_min: q } }, clim, '2026-09-11');
  assert.equal(s.q, 13100);
  assert.equal(s.date, '2026-09-11');
  assert.equal(s.fcMax, 16100);
  assert.ok(s.fcMedianMaxPct > 85 && s.fcMedianMaxPct < 90);
  assert.equal(s.series.q.length, 76);
  const r = summarizeRain({ id: 'z', name: 'Z', upstream: true }, { daily: { time: time.slice(0, 23), precipitation_sum: Array(23).fill(5) } }, '2026-08-18');
  assert.deepEqual([r.past7, r.next7, r.next16], [35, 35, 80]);
});

test('merge + índice + observaciones', () => {
  const pna = parsePrefectura(fx('prefectura.html'));
  const ina = parseINA(fx('ina.html'));
  const st = mergeStations(pna, ina);
  assert.ok(!st.find((s) => s.id === 'EMBALSE RIO HONDO'));
  assert.equal(st.find((s) => s.id === 'CORRIENTES').outlook, 'aguas medias');
  assert.equal(st.find((s) => s.id === 'SAN PEDRO').status, 'alerta');
  const enso = { weekly: parseWeekly(fx('wksst.txt')), oni: parseONI(fx('oni.txt')) };
  const risk = computeRisk({ enso, stations: st, glofas: [], rain: [{ upstream: true, next16: 92 }] });
  assert.ok(risk.score > 0 && risk.score <= 100);
  assert.equal(risk.components.caudal.score, null);
  const ins = buildInsights({ enso, stations: st, glofas: [], rain: [], risk });
  assert.ok(ins.some((i) => /San Pedro/.test(i.text)));
  // sin datos de Prefectura: usa INA
  assert.equal(mergeStations(null, ina).length, 3);
});
