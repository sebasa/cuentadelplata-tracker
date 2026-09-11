# Monitor del Niño

Monitor web de crecidas del río Paraná y la Cuenca del Plata ante El Niño. Reúne en una sola página:

| Fuente | Qué aporta | Frecuencia |
|---|---|---|
| **Prefectura Naval Argentina** — [Estado de los ríos](https://contenidosweb.prefecturanaval.gob.ar/alturas/) | Altura, variación, tendencia y niveles de alerta/evacuación en ~90 escalas | 2 veces por día |
| **INA** — [Reporte diario Cuenca del Plata](https://alerta.ina.gob.ar/a5/diario/reporte_diario) | Perspectiva cualitativa por estación y texto de situación | diaria (hábiles) |
| **NOAA CPC** — [ONI](https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt), [Niño 3.4 semanal](https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for), [Diagnóstico ENSO](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml) | Intensidad de El Niño y estado de alerta | semanal / mensual |
| **GloFAS v4** vía [Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api) | Caudal modelado y pronóstico por ensamble (Brasil, Paraguay, Argentina) | diaria |
| **Open-Meteo Forecast** | Lluvia prevista a 16 días en 9 zonas de la cuenca | horaria |

El mapa SVG (Natural Earth, dominio público) colorea cada tramo según la escala más cercana o, aguas arriba donde no hay escalas argentinas, según el percentil de caudal de GloFAS. Todo es estático: un script en Node genera `public/data/latest.json` y el sitio lo lee.

> ⚠️ El índice de riesgo es orientativo. No reemplaza los avisos oficiales del INA, SMN, Prefectura ni Defensa Civil.

## Estructura

```
public/               sitio estático (index.html, styles.css, app.js)
public/data/          latest.json · history.json · geo.json · climatology.json
scripts/collect.mjs   colector principal
scripts/sources/      un módulo por fuente (prefectura, ina, noaa, openmeteo)
scripts/lib/risk.mjs  estados por estación, índice compuesto y observaciones
scripts/stations.mjs  catálogo de escalas, nodos GloFAS y zonas de lluvia
scripts/build-climatology.mjs  percentiles históricos de caudal (una vez)
scripts/build-geo.mjs          genera geo.json del mapa
test/                 tests de parsers con fixtures (node --test)
```

## Uso local

Requiere Node 20+ y no tiene dependencias.

```bash
npm test               # tests de parsers
npm run climatology    # una sola vez: ~10 min (respeta límites de Open-Meteo)
npm run collect        # baja todas las fuentes → public/data/latest.json
npm run dev            # http://localhost:5173
```

## Deploy

**GitHub + Vercel (recomendado)**
1. Subí el repo a GitHub. El workflow `.github/workflows/collect.yml` corre cada 6 h, ejecuta el colector y commitea `public/data/`.
2. Importá el repo en Vercel: sin build, directorio de salida `public` (ya definido en `vercel.json`). Cada commit de datos redeploya solo.

**GitHub Pages**: Settings → Pages → Deploy from branch → carpeta `/public` (o movela a `/docs`).

## Índice de riesgo (0–100)

| Componente | Cálculo | Peso |
|---|---|---|
| El Niño | anomalía Niño 3.4 semanal: 0 con +0,5 °C → 1 con +2,0 °C | 25 % |
| Nivel actual | mediana de altura/alerta en escalas de referencia (Posadas, Corrientes, Goya, Reconquista, La Paz, Paraná, Santa Fe, Rosario, San Nicolás, Formosa): 0,45 → 1,0 | 20 % |
| Tendencia | ½ proporción de escalas que crecen + ½ variación media (−0,02 → +0,10 m) | 10 % |
| Caudal pronosticado | percentil máximo a 30 días (mediana del ensamble GloFAS) en Itaipú, Iguazú, Asunción, Corrientes y Santa Fe: p50 → p95 | 30 % |
| Lluvia prevista | promedio acumulado 16 días en la alta cuenca: 35 → 150 mm | 15 % |

Niveles: bajo < 25 · moderado < 50 · alto < 75 · muy alto ≥ 75. Si una fuente falla, su peso se redistribuye y se muestra el último dato válido marcado en amarillo.

Estado por escala: normal < 70 % del alerta · atención 70–85 % · pre-alerta 85–100 % · alerta ≥ nivel de alerta · evacuación ≥ nivel de evacuación.

## Ideas para seguir

- Sumar alturas del **SNIH** (Base de Datos Hidrológica Integrada) y del **SIyAH/INA** vía WaterML para series largas.
- Agregar niveles de Itaipú/Yacyretá (erogación) y **ANA Brasil** (HidroWeb) aguas arriba.
- Alertas por Telegram/WhatsApp cuando una escala pasa a pre-alerta o el índice sube de nivel.
- Mapas de cota IGN por barrio (Santa Fe, Rosario, Corrientes) cruzados con la altura pronosticada.

## Licencias de datos

Prefectura Naval, INA y NOAA: datos públicos. GloFAS: Copernicus Emergency Management Service (CC BY 4.0) vía Open-Meteo (uso no comercial gratuito; atribución requerida). Natural Earth: dominio público.
