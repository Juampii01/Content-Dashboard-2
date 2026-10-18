# Mi marca, Guiones y Calendario: diseño definitivo

## 1. Auditoría del repo viejo (`juampii01/content-dashboard`)

| Archivo | Modelo | Entrada | Salida | Problemas |
|---|---|---|---|---|
| `app/api/guiones/generate/route.ts` | `claude-sonnet-4-6`, 400/1200 tokens | `topic`, `type` (reel/historia), `tone` | Texto plano con emojis 🎣📖📣; las variantes se separan por `\n` | Prompt en rioplatense ("Sos…", "Guardá esto"). **No usa la marca, el ICP ni las métricas.** No pide JSON (parsea líneas). Prohíbe acotaciones, así que no hay texto en pantalla ni b-roll. Solo 3 hooks y sin puntaje. Sin streaming ni caché. Todo en un `user` message, sin `system`. No registra el uso de tokens. |
| `app/api/copy/generate/route.ts` | `claude-sonnet-4-6` | tipo, categoría, tono, `icpContext` (texto libre del cliente) | `{"items":[...]}` sacado con regex `\{[\s\S]*\}` | JSON frágil, sin salidas estructuradas. El ICP llega del navegador. Tiene el único prompt en "tú", pero mezcla registros. |
| `app/api/bases/generate/route.ts` | Sonnet | ICP + bases (dolores, deseos, keywords, creencias) | listas JSON | "Escribí en español rioplatense (voseo…)". La estructura de las bases es buena y se puede reaprovechar. |
| `app/api/me/ai-insight/route.ts` | `claude-haiku-4-5` | snapshots de cuenta | 3 oraciones | Voseo ("Sos un estratega"). |
| `lib/claude/analyze-reel.ts`, `chat-reel.ts` | modelo a elegir (`lib/claude/models.ts`) | caption + transcripción | análisis | Se puede rescatar el formato del análisis. Los precios de `models.ts` están viejos. |
| `lib/groq/transcribe.ts` | `whisper-large-v3-turbo` (USD 0,04 por hora) | URL remota del video | texto + idioma | Sirve tal cual. La URL del CDN de IG vence, así que hay que transcribir enseguida. |
| `lib/youtube/transcript-fetch.ts` | — | URL de YT | transcript | Scraping de `ytInitialPlayerResponse` + actor de Apify. Prefiere inglés. Es frágil. |
| `lib/apify/instagram-reel-scraper.ts` | `apify~instagram-reel-scraper` | handle/URL | reel + `videoUrl` | Sirve para referencias de IG. |

**Diagnóstico:** los guiones salen genéricos porque el modelo no sabe quién habla, a quién le habla, qué vende ni qué funcionó antes. En `crear-videos-3-0`, `tiempos.py` alinea palabra por palabra el audio contra el guion (difflib). Ese mismo mecanismo sirve para medir cuánto se desvía la toma del guion. En `content-dashboard-2`, `brandProfile` y `scripts` en `lib/db/schema.ts` son mínimos: hay que ampliarlos.

## 2. Mi marca

**Campos que de verdad mejoran la salida** (en orden de impacto):

1. **Muestras de voz:** 3 a 8 transcripciones reales del creador, guardadas tal cual, con muletillas incluidas. Es lo que más mueve la aguja.
2. **Top contenido (automático):** las 10 piezas con mayor `views` sobre la mediana de su red en los últimos 180 días (outliers 2×+), con hook, transcripción y métricas. Se refresca en cada sync.
3. **Ofertas y CTAs:** lista `{oferta, promesa, palabra_clave_DM, link, cuándo_usarla}`. Un CTA por defecto por objetivo (seguir, guardar, DM).
4. **Audiencia:** quién es, dolores, deseos, objeciones y frases literales que usa.
5. **Pilares de contenido** (3 a 5): nombre, descripción, % objetivo del mes y ejemplos.
6. **Reglas de estilo:** palabras prohibidas, palabras propias o firma, nivel de formalidad, uso de emojis, largo de las frases.
7. **Idioma/dialecto:** `es-neutro` por defecto; también `es-MX`, `es-AR`, `en-US`.
8. **Postura:** 3 creencias del creador que van contra la corriente (de ahí salen los hooks de contraste).

Cambios de esquema: agregar `voiceSamples jsonb`, `offers jsonb`, `pillars jsonb`, `audiencePains text[]`, `audienceDesires text[]`, `objections text[]`, `signaturePhrases text[]`, `beliefs text[]`, `emojiPolicy`, `profileVersion int` (sirve para invalidar la caché).

**Onboarding en 4 pasos** (con la ruta de pasos):
1. "Pega 3 links de tus mejores reels o videos", o elige del top de Métricas si ya conectaste las cuentas → transcripción.
2. Responde 4 preguntas cortas: qué vendes, a quién, qué te diferencia, qué nunca dirías.
3. Sonnet arma el perfil completo con salida estructurada (stream campo a campo).
4. Editas, apruebas y queda la "Prueba de voz": un guion de muestra con tu perfil. Si no te suena, ajustas.

## 3. Guiones

### Entradas
- **Idea libre / tema + pilar** (pilar obligatorio, propone el más atrasado del mes).
- **Video de referencia**:
  - *YouTube*: la API oficial `captions.download` solo sirve para videos propios ([docs](https://developers.google.com/youtube/v3/docs/captions/download)). Para terceros: actor de Apify (ya en el repo) y, como respaldo, Whisper sobre el audio.
  - *Instagram/TikTok*: no existe una API oficial para contenido de terceros. Se usa Apify (`apify~instagram-reel-scraper`, actor de TikTok) o ScrapeCreators ([scrapecreators.com](https://scrapecreators.com)) para obtener `videoUrl` → Groq Whisper ([docs](https://console.groq.com/docs/speech-to-text)). Solo se transcribe para analizar la estructura; el prompt prohíbe copiar frases. Hay que avisar al cliente que la fuente es pública y de uso analítico.
  - *Propio*: piezas de `content_items` vía las APIs ya conectadas.
- **Top propio:** el botón "Haz otra como esta" en cualquier outlier.

### Salida (JSON con `output_config.format`, [docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs))
```
{ title, format: reel|short|yt_long|story, pillar, angle,
  hooks: [{text, type: contraste|curiosidad|dolor|resultado|historia, score 1-10, why}],
  selectedHook,
  beats: [{id, purpose, spoken, onScreenText, broll, seconds}],
  cta: {offerId, spoken, onScreenText},
  caption, estimatedSeconds, wordCount }
```
Duración: reel de 30–60 s, a unas 2,5 palabras por segundo (75–150 palabras); short de ≤45 s; YT largo de 6–12 min con capítulos. `estimatedSeconds` se calcula en el código, no se le pide al modelo.

### Acciones (cada una con su prompt en `lib/ai/prompts/guiones/*.ts`)
| Acción | Modelo | Salida |
|---|---|---|
| Generar guion | Sonnet 5.5, streaming | objeto completo |
| 5 hooks con puntaje | Sonnet 5.5 | `hooks[5]` + justificación; el puntaje se calibra con los hooks del top propio |
| Regenerar hook / CTA / un beat | Haiku 5.5 | parche JSON sobre un solo campo |
| Acortar / más directo | Haiku 5.5 | beats reescritos con el mismo esquema |
| Adaptar a otra red (reel→YT largo) | Opus 5.5 | guion nuevo vinculado (`parentId`) |
| Analizar referencia (estructura, no texto) | Sonnet 5.5 | `{hookType, beats[], whyItWorks}` |

Precios por millón de tokens, entrada/salida: Opus 5.5 USD 4/20, Sonnet 5.5 USD 2/10, Haiku 5.5 USD 0,10/0,50 hasta 100k tokens de prompt ([precios](https://platform.claude.com/docs/en/about-claude/pricing), [modelos](https://platform.claude.com/docs/en/models/overview)). Un guion con Sonnet cuesta alrededor de USD 0,02. No vale la pena ahorrar en la generación principal.

**Caché del perfil:** el bloque `system` lleva las reglas, el perfil de marca, las muestras de voz y el top propio, con `cache_control` de 1 h (mínimo 512 tokens; un acierto en caché cuesta 0,05× en Sonnet/Opus, [docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). El orden queda fijo y la clave incluye `profileVersion`. Ojo: cambiar el esquema de salida invalida la caché, así que conviene usar **un solo esquema por familia de acciones**.

**Streaming en la UI:** la ruta devuelve SSE; el cliente parsea el JSON parcial y va pintando hooks y beats a medida que llegan. Se registra `ai_usage` con el campo `feature`.

**Versionado y estados:** tabla `script_versions` (snapshot JSON + acción que la generó + autor); con "Deshacer" y comparación entre versiones. Estados: `IDEA → BORRADOR → LISTO → GRABADO → PUBLICADO` (más `ARCHIVADO`). Botones para mandarlo al **Editor** (el guion viaja como referencia para la comparación tipo `tiempos.py` y los subtítulos), al **Clon** (solo `spoken`, concatenado) y al **Calendario** (crea la `calendar_entry` con `scriptId`).

### Esqueleto del system prompt (`lib/ai/prompts/guiones/system.ts`)
```
Eres el guionista personal de {{name}} ({{handle}}). Escribes como habla esta persona, no como un copywriter.

IDIOMA: {{language}}. Si es es-neutro: trato de "tú", sin voseo ni España, "video" sin tilde, sin regionalismos.

MARCA
Nicho: {{niche}} · Audiencia: {{audience}}
Dolores: {{pains}} · Deseos: {{desires}} · Objeciones: {{objections}}
Creencias del creador: {{beliefs}}
Pilares: {{pillars}}
Ofertas y CTAs: {{offers}}
Nunca uses: {{bannedWords}}. Frases propias (úsalas con moderación): {{signaturePhrases}}.

VOZ (imita el ritmo, el largo de las frases y el vocabulario; no copies frases)
<muestras>{{voiceSamples}}</muestras>

LO QUE YA FUNCIONÓ (patrones de hook y estructura, no el tema)
<top>{{topPieces: hook · vistas · ×mediana}}</top>

REGLAS
- El hook se entiende en 2 segundos y sin contexto. Nada de "Hola, hoy te voy a hablar de".
- Cada beat cumple un solo propósito y empuja al siguiente.
- Un solo CTA, de las ofertas listadas, coherente con el objetivo.
- Ejemplos concretos, números y casos; cero generalidades ni promesas que la marca no pueda cumplir.
- onScreenText: máximo 6 palabras. broll: una toma filmable, concreta.
- Si hay referencia: toma la estructura y el ángulo, nunca el texto.
- Responde solo con el JSON del esquema.
```
El mensaje de usuario lleva la tarea concreta (`idea`, `pillar`, `format`, `objective`, `reference.structure`).

## 4. Calendario

- **Vistas:** mes (chips por día con un ícono por red y un color por estado), semana (columnas por día, con hora) y una lista "Sin fecha" a la izquierda para arrastrar ideas.
- **Arrastrar:** mover entre días o desde "Sin fecha"; actualización optimista con rollback si el servidor falla.
- **Estados:** los de `calendarStatusEnum` (`IDEA…PUBLISHED`), sincronizados con el estado del guion.
- **Vinculación con métricas:** después de cada sync, por cada `content_item` nuevo se buscan entradas `READY`/`PUBLISHED` de la misma red en ±3 días. El puntaje se calcula como 0,6 × similitud (trigramas de `pg_trgm` entre el caption o título y `title + hook` del guion) + 0,4 × cercanía de fecha. Si da ≥0,75, se vincula solo; entre 0,5 y 0,75, se sugiere ("¿Es esta?"). La entrada muestra las vistas reales contra la mediana.
- **Recordatorios (opcional):** email el día anterior a las 9:00 por las piezas que no están en `READY`. Lo dispara el cron diario.
- **Librería:** **`@dnd-kit/core` 6.x** con una grilla propia. Pesa poco, no impone UI (respeta la estética MaestrIA), es accesible por teclado y el equipo ya la usó en el repo viejo (`components/calendario/month/*`, que se puede portar). Se descartan FullCalendar (pesado, con estilos que pelean contra el diseño y licencia premium para algunas vistas) y la nueva `@dnd-kit/react` (0.x, [npm](https://www.npmjs.com/package/@dnd-kit/react)), que todavía es joven para un producto de USD 5k. Comparativa: [pkgpulse](https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026).

## 5. Tres funciones "wow" (de 1 a 3 días cada una)

1. **"Ideas de tus outliers":** detecta las piezas con 2× o más sobre la mediana, Sonnet explica por qué funcionaron (hook, ángulo, formato) y propone 5 ideas derivadas con el hook incluido. Cada idea se convierte en guion con un clic.
2. **Plan semanal automático:** cada lunes arma 3 a 5 piezas con los pilares atrasados, los patrones ganadores y las ofertas activas, y las deja como `IDEA` en el calendario con hook y pilar. El usuario acepta o descarta cada una.
3. **"Guion vs. resultado":** cuando una pieza vinculada cumple 7 días, muestra cuánto se desvió la toma del guion (con la alineación de `tiempos.py`) y cómo rindió frente a la mediana. El hook ganador alimenta "Lo que ya funcionó" en Mi marca, así que el sistema aprende solo.
