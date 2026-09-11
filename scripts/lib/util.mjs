const UA = 'Mozilla/5.0 (monitor-crecidas-parana; +https://github.com/) Node.js';

export async function fetchText(url, { timeout = 30000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, ...headers } });
      if (res.status === 429 && i < retries) {
        // Límite por minuto (Open-Meteo): esperar y reintentar
        await new Promise((r) => setTimeout(r, 65000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.split('?')[0]}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Algunos sitios .gob.ar sirven ISO-8859-1
      const ct = res.headers.get('content-type') || '';
      const latin = /iso-8859-1|latin1|windows-1252/i.test(ct) || (!/utf-8/i.test(ct) && !isUtf8(buf));
      return new TextDecoder(latin ? 'latin1' : 'utf-8').decode(buf);
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const fetchJSON = async (url, opts) => JSON.parse(await fetchText(url, opts));

function isUtf8(buf) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}

export const stripTags = (html) =>
  decodeEntities(String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();

export function decodeEntities(s) {
  const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', deg: '°' };
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return map[e] ?? m;
  });
}

// Extrae filas de una tabla HTML como arrays de texto de celdas
export function tableRows(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => stripTags(c[2]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export const num = (s) => {
  if (s == null) return null;
  const t = String(s).trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const round = (v, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
export const median = (a) => {
  const s = a.filter((v) => v != null).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
