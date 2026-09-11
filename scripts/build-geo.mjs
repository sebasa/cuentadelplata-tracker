// Genera public/data/geo.json a partir de las geometrías simplificadas de Natural Earth
// (ne_10m_rivers_lake_centerlines, ne_50m_admin_0_boundary_lines_land, ne_50m_coastline).
// Proyección equirectangular con corrección cos(25°S): x=(lon+66)*cos*K, y=(-14-lat)*K, K=36.
import { readFileSync, writeFileSync } from 'node:fs';
import { PROJ, project } from './lib/proj.mjs';

const here = new URL('.', import.meta.url);
const decode = (line) => {
  const [name, rest] = line.split(': ');
  let x = 0, y = 0;
  const pts = rest.split(' ').map((s, i) => {
    const [a, b] = s.split(',').map(Number);
    if (i === 0) { x = a; y = b; } else { x += a; y += b; }
    return [x, y];
  });
  return { name, pts };
};

const raw = readFileSync(new URL('geo-raw.txt', here), 'utf8').trim().split('\n').map(decode);
const borderRaw = readFileSync(new URL('borders-raw.txt', here), 'utf8').trim().split('\n').map(decode);

const idx = (i) => raw[i].pts;
const rev = (p) => [...p].reverse();
const chain = (...parts) => parts.reduce((acc, p) => acc.length ? acc.concat(p.slice(1)) : p.slice(), []);

// Río Iguazú: trazado aproximado (no está en Natural Earth 10m). Coordenadas lon/lat.
const iguazu = [
  [-49.27, -25.55], [-50.10, -25.95], [-51.08, -26.23], [-51.70, -26.02], [-52.25, -25.78],
  [-52.62, -25.60], [-53.10, -25.58], [-53.49, -25.54], [-53.80, -25.56], [-54.03, -25.58],
  [-54.30, -25.66], [-54.44, -25.69], [-54.59, -25.59],
].map(([lon, lat]) => project(lon, lat));

const rivers = [
  { id: 'paraguay', name: 'Río Paraguay', rank: 'major', pts: idx(27) },
  { id: 'parana-alto', name: 'Alto Paraná', rank: 'major', pts: chain(idx(58), idx(54), idx(59), idx(55), idx(60), rev(idx(57)), idx(63)) },
  { id: 'parana-bajo', name: 'Paraná (medio e inferior)', rank: 'major', pts: idx(28) },
  { id: 'parana-delta-1', name: 'Delta del Paraná', rank: 'major', pts: idx(29), group: 'parana-delta' },
  { id: 'parana-delta-2', name: 'Delta del Paraná', rank: 'major', pts: chain(idx(30), idx(31)), group: 'parana-delta' },
  { id: 'uruguay', name: 'Río Uruguay', rank: 'major', pts: idx(25) },
  { id: 'iguazu', name: 'Río Iguazú', rank: 'major', pts: iguazu },
  { id: 'bermejo', name: 'Río Bermejo', rank: 'major', pts: idx(52) },
  { id: 'pilcomayo', name: 'Río Pilcomayo', rank: 'major', pts: idx(26) },
];

const used = new Set([25, 26, 27, 28, 29, 30, 31, 52, 54, 55, 57, 58, 59, 60, 63]);
const pretty = {
  Miranda: 'Río Miranda', Verde: 'Río Verde', Taquari: 'Río Taquari', Paranaiba: 'Río Paranaíba', Ivai: 'Río Ivaí',
  Jejui_Guazu: 'Río Jejuí Guazú', Tercero: 'Río Tercero', Pardo: 'Río Pardo', Carcarana: 'Río Carcarañá', Grande: 'Río Grande',
  Salado: 'Río Salado', Negro: 'Río Negro', Paranapanema: 'Río Paranapanema', Tiete: 'Río Tietê', Itiquira: 'Río Itiquira',
  Ivinheima: 'Río Ivinhema', Bermejo: 'Río Bermejo', Ibicui: 'Río Ibicuí', Parana: 'Paraná (embalses)',
};
raw.forEach((r, i) => {
  if (used.has(i) || r.pts.length < 2) return;
  const major = r.name === 'Salado';
  rivers.push({ id: `${r.name.toLowerCase()}-${i}`, name: pretty[r.name] || r.name, rank: major ? 'mid' : 'minor', pts: r.pts });
});

const borders = borderRaw.filter((b) => b.name === 'B').map((b) => b.pts);
const coast = borderRaw.filter((b) => b.name === 'C' && b.pts.length > 2).map((b) => b.pts);

const P = (lon, lat) => project(lon, lat);
const labels = {
  countries: [
    { t: 'ARGENTINA', p: P(-63.2, -30.2) }, { t: 'PARAGUAY', p: P(-59.2, -22.6) }, { t: 'BRASIL', p: P(-50.5, -16.5) },
    { t: 'URUGUAY', p: P(-56.0, -32.7) }, { t: 'BOLIVIA', p: P(-63.5, -17.0) }, { t: 'Océano Atlántico', p: P(-47.5, -31.5), sea: true },
  ],
  cities: [
    { t: 'Buenos Aires', p: P(-58.38, -34.60) }, { t: 'Rosario', p: P(-60.64, -32.95) }, { t: 'Santa Fe', p: P(-60.70, -31.63) },
    { t: 'Corrientes', p: P(-58.83, -27.47) }, { t: 'Posadas', p: P(-55.90, -27.37) }, { t: 'Asunción', p: P(-57.63, -25.29) },
    { t: 'Foz do Iguaçu', p: P(-54.58, -25.52) }, { t: 'São Paulo', p: P(-46.63, -23.55) }, { t: 'Montevideo', p: P(-56.16, -34.90) },
    { t: 'Corumbá', p: P(-57.65, -19.01) }, { t: 'Concordia', p: P(-58.02, -31.39) },
  ],
};

const round = (p) => p.map(([x, y]) => [Math.round(x), Math.round(y)]);
const out = {
  attribution: 'Ríos, límites y costas: Natural Earth (dominio público). Río Iguazú trazado aproximado.',
  proj: PROJ,
  viewBox: [0, -20, 760, 860],
  rivers: rivers.map((r) => ({ ...r, pts: round(r.pts) })),
  borders, coast, labels,
};
writeFileSync(new URL('../public/data/geo.json', here), JSON.stringify(out));
console.log(`geo.json: ${rivers.length} ríos, ${borders.length} límites, ${coast.length} costas`);
