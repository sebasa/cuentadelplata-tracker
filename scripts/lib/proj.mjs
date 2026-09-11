// Proyección compartida por el mapa (misma fórmula en public/app.js)
export const PROJ = { lon0: -66, lat0: -14, k: 36, c: Math.cos((25 * Math.PI) / 180) };
export const project = (lon, lat) => [(lon - PROJ.lon0) * PROJ.c * PROJ.k, (PROJ.lat0 - lat) * PROJ.k];
