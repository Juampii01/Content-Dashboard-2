# Ruteo de modelos (27-oct-2026)

Qué modelo usa cada paso con IA y por qué. Precios oficiales en `lib/ai/pricing.ts` (USD por millón de tokens: Opus 5.5 4/20, Sonnet 5.5 2/10, Haiku 5.5 0,10/0,50).

| Paso | Archivo | Antes | Ahora | Por qué |
|---|---|---|---|---|
| Corregir la transcripción | `lib/video/transcript-fix.ts` | Sonnet | **Haiku** | Mecánico: palabras mal oídas contra el guion |
| Cortes y silencios | `lib/video/service.ts` (`video.plan`) | Sonnet | **Haiku** | Mecánico, con reglas de seguridad (tope de 20 %, sin cambiar el orden) |
| Segunda mirada del director (revisión con cuadros) | `lib/video/director/cost.ts` | Opus | **Sonnet** (razonamiento medio) | Revisión |
| Revisión con cuadros de cada animación | `lib/video/compos/work.ts` | Sonnet | Sonnet | Ya estaba (26-oct) |
| Correcciones del director | `lib/video/director/cost.ts` | Sonnet, 1 vuelta | Igual | Ya estaba (26-oct) |
| **Código de las animaciones** | `lib/video/compos/work.ts` | Opus | **Opus** | Es lo que el cliente ve. Solo cambia con la prueba A/B y el OK de Juampi |
| Mapa del video, dirección completa, recetas de referencia | `lib/video/director/service.ts`, `lib/video/look.ts`, `lib/video/compos/flows.ts` | Opus | Opus | Entender y decidir: no son mecánicos ni de revisión |

## Prueba A/B del código de las animaciones

`scripts/ab-animaciones.mts`: los mismos 10 pedidos con Opus y con Sonnet (mismo prompt, razonamiento bajo, 32.000 tokens). Guarda el código, si pasa la validación, el costo (api_usage) y una hoja de cuadros dibujada con el motor del worker, y arma `informe.html` lado a lado.

- En GitHub: Actions → «A/B de animaciones» → Run workflow (necesita el secreto `ANTHROPIC_API_KEY` y que el workflow esté en `main`). El informe queda como artefacto.
- En una computadora: `DATABASE_URL=<base de prueba> ANTHROPIC_API_KEY=… node --conditions=react-server --import tsx scripts/ab-animaciones.mts salida/`.
- Sin gastar (para probar el script): `AI_FAKE=1 NODE_ENV=test …` usa muestras de la biblioteca.
