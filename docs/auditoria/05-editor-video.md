# Editor de video · Content 2: auditoría, diseño y MVP

**Hay que decidir algo antes de escribir el worker.** El brief dice "Neon vía Vercel", pero `CLAUDE.md`, `lib/env.ts` y `package.json` usan **Supabase**. pg-boss funciona con los dos si se conecta de forma directa, sin pooler.

## 1. Auditoría (archivo:línea)

**editor-de-video**
1. `editar.py:187-190`: corta con un `trim` por corte sobre la misma entrada y después hace `concat`. ffmpeg guarda cuadros en memoria, así que con un 4K de 4 GB es lento y puede quedarse sin memoria. Los cortes no tienen fundido de audio, así que cada salto suena con un clic.
2. `editar.py:232`: usa `loudnorm` en una sola pasada (modo dinámico). Comprime y "bombea" el volumen.
3. `editar.py:25,203`: el tamaño está fijo en 1080×1920 y el recorte es estático en 0.5. **No hay salida 16:9** ni seguimiento de la cara.
4. `editar.py:194,204`: fuerza `fps=30` sin manejar el VFR (cuadros por segundo variables) y no convierte el HDR del iPhone, que sale lavado. No marca BT.709.
5. `editar.py:137`: la fuente es "Arial", que no existe en Linux, y no se pasa `fontsdir`. libass la reemplaza sin avisar.
6. `editar.py:220`: el zoom de las imágenes se hace con `scale` y `eval=frame`, y la imagen tiembla.
7. `transcribir.py:88-91`: el fin de cada palabra se calcula como su inicio más 0,12 s, o sea, inventado. Con `pad_out` en 0,15 (`editar.py:38`) se cortan sílabas.
8. `transcribir.py:121` e `ia.py:145`: Claude ve **frases**, no palabras. No puede cortar una toma fallida que quede a mitad de frase.
9. `ia.py:44-76`: los tiempos son números libres que escribe el modelo y nada evita que se superpongan. `piezas()` (`editar.py:35`) no los elimina, así que el audio sale duplicado.
10. Se descartan:
    - `main.py:136-152`: hilos y JSON, sin forma de retomar un trabajo.
    - `main.py:42-53`: claves en `.env`.
    - `main.py:269-281`: `ant` y osascript.
    - `chatgpt.py`.
    - `generar_broll.py:70-108`: Codex y rutas de macOS; además, `:31` solo genera 9:16.

**crear-videos-3-0**
1. `_cortar.py:152`: detecta silencios con un umbral absoluto de -35 dB y falla con ruido de sala.
2. `_cortar.py:179`: usa `select/aselect` con `setpts=N/FRAME_RATE/TB`. Como el video se corta por cuadros y el audio por muestras, el desfase crece con cada corte (peor en VFR). No tiene fundidos.
3. `tiempos.py:232,240`: depende de whisper.cpp local y solo acepta español e inglés. **Sirven** los tiempos con DTW y la comparación con guion (líneas 305-322).
4. `mezclar.sh:113-114`: las ganancias fijas son el criterio correcto. Pero la música baja bajo la voz gracias a HyperFrames, que no se porta. La línea 121 mide el pico de muestra, no el pico real. No hay objetivo de sonoridad.
5. Todo el flujo depende del chat de Claude Code y de HyperFrames, así que no es portable. De `medir.py` se toma solo la idea de los presets medidos.

**Qué se porta:** las reglas de `ia.py`, la generación de subtítulos ASS (`editar.py:117-171`), el troceo de Parakeet (`transcribir.py:60-99`), la comparación con guion y el criterio de `mezclar.sh`. **Qué se reescribe:** el render, el corte, los trabajos y el b-roll.

## 2. Pipeline del servidor

Cada etapa es idempotente y guarda su resultado en R2.

1. **Ingesta:** con `ffprobe` se leen VFR y HDR. Se genera un *mezzanine* 1080p a 30 cuadros fijos en SDR (con `zscale+tonemap` si el original es HDR), un proxy de 540p y el audio en WAV.
2. **Transcripción:** palabras con ID y bordes ajustados a la energía del audio.
3. **Análisis:** se detectan candidatos a cortar sin IA, Claude arma el plan y se ubica la cara en el proxy a 3-5 fps.
4. **Revisión humana:** el trabajo queda en estado `AWAITING_REVIEW`.
5. **Render:** los cortes se ajustan a la rejilla de cuadros y se aplican igual al audio y al video, así no hay desfase. Cada tramo se codifica con `-ss` exacto y se unen con `concat`. Cada corte lleva un fundido de audio de 10 ms. Después van los subtítulos y la cadena de audio.
6. **Control de calidad:** se revisan duración, LUFS y sincronía. Sale el MP4 con su SRT.

**Plan de edición v2.** Los tiempos se derivan de las palabras, así el modelo nunca escribe segundos:
```json
{"version":2,"format":"9:16|16:9",
 "segments":[{"id":"s1","from_word":120,"to_word":161,"role":"hook|body|cta"}],
 "order":["s1","s0","s2"],
 "removals":[{"from_word":40,"to_word":52,"reason":"retake|false_start|filler|silence|off_topic","confidence":0.9}],
 "hook_candidates":[{"from_word":120,"to_word":161,"score":0.86,"why":"..."}],
 "captions":{"preset":"clasico","emphasis_words":[130]},
 "overlays":[{"text":"...","from_word":120,"to_word":135,"position":"top"}],
 "broll":[{"from_word":70,"to_word":80,"query_en":"...","source":"pexels|upload"}],
 "audio":{"music_asset_id":null,"music_db":-22,"target_lufs":-14},
 "framing":{"mode":"face|center|manual"},"summary":"","warning":""}
```
Se valida con Zod: que los IDs existan, que nada se superponga y que la duración esté dentro del objetivo.

**Tomas malas.** Primero, sin IA:
- la misma secuencia de 3 o más palabras dentro de 30 s (la primera se descarta);
- un arranque corto seguido de una pausa y un reinicio con las mismas palabras;
- muletillas aisladas entre pausas.

Si hay guion, se alinea con el transcript. Si un tramo del guion aparece varias veces, gana la última toma completa. Lo que no está en el guion se marca, pero no se corta. Claude recibe estos candidatos con sus IDs y decide, con motivo y nivel de confianza.

**Gancho.** Claude propone 3 candidatos de 3 a 8 s que se entiendan solos. Si el guion ya abre con gancho, se respeta. El usuario elige.

**Subtítulos.** Cuatro presets, con fuentes incluidas en la imagen (Montserrat e Inter, con licencia OFL) y los colores de "Mi marca":
- *Clásico:* palabra activa en el color de acento, 3 palabras por bloque.
- *Pop:* 1 o 2 palabras en mayúsculas, con escalado al entrar.
- *Caja:* la palabra activa dentro de una caja dibujada con `\p` (v2).
- *Mínimo:* relleno karaoke con `\kf`.

Van debajo de la barbilla y fuera del 20 % inferior de la pantalla.

**B-roll.** Pexels: es gratis, permite uso comercial, filtra por orientación vertical, tiene un límite de 200 solicitudes por hora y exige atribución ([docs](https://www.pexels.com/api/documentation/)). El video generado con IA es caro, lento y se ve artificial. Por defecto, entre 0 y 3 tomas.

**Música.** No se incluye una biblioteca propia. En el MVP, el cliente sube su pista o exporta solo la voz y agrega el audio de tendencia en Instagram. Pixabay deja en el usuario la responsabilidad por los derechos de terceros, lo que trae riesgo de reclamos de Content ID ([licencia](https://pixabay.com/service/license-summary/)). Para la v2 está la Partner API de Epidemic Sound: el plan gratis no incluye licencia comercial y los planes pagos se cobran por descargas ([docs](https://developers.epidemicsound.com/docs/)).

**Audio.** La cadena es:
1. `highpass=80`
2. `afftdn` (DeepFilterNet en la v2)
3. +2 dB entre 3 y 5 kHz
4. `deesser`
5. `acompressor` 3:1
6. música con `sidechaincompress`
7. `alimiter`
8. **`loudnorm` en dos pasadas con `linear=true`** a -14 LUFS y -1 dBTP

En modo lineal, `loudnorm` solo aplica ganancia, sin comprimir.

**Reencuadre 16:9 → 9:16.** Es factible. Se usa MediaPipe en CPU. El MVP hace un recorte estático por corte, centrado en la mediana de la cara. La v2 hace un seguimiento suave con `sendcmd`.

**Codificación.** H.264 High, yuv420p, 30 fps fijos, `-crf 18 -preset slow -maxrate 12M -bufsize 24M -g 60`, BT.709, AAC a 48 kHz y 192k, `+faststart`.

## 3. Revisión humana (UX)
- **Editor por transcript:** cada palabra es un elemento. Lo cortado aparece tachado, con una etiqueta del motivo, y se corta o restaura con un clic o una selección. Arriba se eligen los 3 ganchos.
- **Vista previa sin render:** el proxy se reproduce saltando los cortes con JS y los subtítulos se dibujan en HTML. Así hay un solo render final.
- **Progreso:** ffmpeg informa con `-progress pipe:1` y el worker escribe `jobs.progress/stage` cada 2 s. La interfaz consulta con la misma frecuencia.
- **Reanudar:** cada etapa deja un checkpoint (`stage_outputs`). pg-boss reintenta 2 veces con espera creciente y usa `expireIn` para detectar trabajos colgados. Los errores se muestran en español.

## 4. Infraestructura

**Worker: Fly Machines.** Una performance-4x de 8 GB cuesta $0,1833/h. Detenida, solo se paga el disco a $0,15/GB al mes ([precios](https://docs.fly.io/about/pricing)). Vercel la arranca con la Machines API y se apaga sola cuando no hay trabajos. Es la misma imagen para cada cliente.
- **Railway:** $20 por vCPU y $10 por GB al mes ([precios](https://docs.railway.com/reference/pricing/plans)). Con 4 vCPU y 8 GB todo el mes son unos $160.
- **Modal:** L4 a $0,000222/s ([precios](https://modal.com/pricing)). No hace falta GPU para esto.

**Transcripción**

| Opción | Precio | Notas |
|---|---|---|
| Groq whisper-large-v3-turbo | $0,04/h | Tiempos por palabra; adjuntos de hasta 25 MB ([docs](https://console.groq.com/docs/speech-to-text), [modelo](https://console.groq.com/docs/model/whisper-large-v3-turbo)) |
| Deepgram Nova-3 | $0,0043/min, unos $0,26/h | ([precios](https://deepgram.com/pricing)) |
| AssemblyAI | Universal-2 a $0,15/h | ([precios](https://www.assemblyai.com/pricing.md)) |
| Parakeet en CPU | Solo el cómputo del worker | Ya está escrito |

Whisper tiende a borrar las repeticiones y los arranques en falso, que es justo lo que hay que detectar. **Recomendación:** Parakeet en el worker, detrás de una interfaz, con Deepgram de respaldo. Hay que medir la velocidad en Fly el día 1.

**Cola: pg-boss.** Requiere Postgres 13+ y trae reintentos y cola de mensajes fallidos ([repo](https://github.com/timgit/pg-boss)). Ya es la decisión de `CLAUDE.md` y existe la tabla `jobs` (`lib/db/schema.ts:247`). Con Neon, conviene sondear solo mientras el worker está encendido, porque el sondeo impide que la base se suspenda.
- **Vercel Queues:** se cobra por operación y tiene un máximo de 60 min de *visibility timeout* ([precios](https://vercel.com/docs/queues/pricing)).
- **Trigger.dev:** no tiene duración máxima; la Large 2x cuesta $0,00068/s ([precios](https://trigger.dev/pricing)).
- **Inngest:** igual que Trigger.dev, suma una cuenta por cliente.

Ninguna de las tres alternativas es más fácil de replicar.

**Almacenamiento: R2 con multipart prefirmado.** La salida de datos es gratis y cuesta $0,015/GB al mes ([precios](https://developers.cloudflare.com/r2/pricing/)), con hasta 10.000 partes ([límites](https://developers.cloudflare.com/r2/platform/limits/)). En el CORS hay que exponer `ETag`. Vercel Blob admite hasta 5 TB, pero no cachea archivos de más de 512 MB y cobra cada descarga al worker ([precios](https://vercel.com/docs/vercel-blob/usage-and-pricing)).

**Costo por video (5 min crudo → reel de 60 s)**

| Concepto | Costo |
|---|---|
| Claude Opus 5.5 ([$4/$20 por millón de tokens](https://platform.claude.com/docs/en/about-claude/pricing)), unos 15k de entrada y 8k de salida | unos $0,22 (Sonnet 5.5: $0,11) |
| Worker, unos 12 min | unos $0,04 |
| Transcripción | unos $0,005 |
| R2 | unos $0,03 |
| **Total** | **unos $0,30-0,45** |

## 5. Lanzamiento

El diseño completo son unos 13 días de desarrollo.

**MVP en unos 8 días:**

| Tarea | Días |
|---|---|
| R2 | 1 |
| Worker, cola y progreso | 2 |
| Ingesta | 0,5 |
| Parakeet | 1 |
| Análisis y plan v2 con 3 ganchos | 1,5 |
| Editor por transcript con vista previa | 2 |
| Render (fundidos, recorte por cara, presets Clásico y Pop, -14 LUFS, 9:16 y 16:9) | 1,5 |
| Pruebas con 5 videos reales | 0,5 |

**v2 (unos 6 días):** Pexels, comparación con guion en la interfaz, seguimiento dinámico de la cara, presets Caja y Mínimo, Epidemic Sound, DeepFilterNet y recortes desde videos largos.

**Recomendación:** lanzar Content 2 la semana que viene con el editor marcado como "beta en 2 semanas". No hay que esperar a este módulo para vender.
