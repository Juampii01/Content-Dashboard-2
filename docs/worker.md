# Worker de video (Fly Machines)

El Editor de video no procesa nada dentro de Vercel. Los trabajos pesados (ingesta, transcripción, análisis de estilos, render) los hace un **worker en Python** (`worker/`) que corre en una **Fly Machine por cliente**. La IA (plan de edición y b-roll con Claude) queda en la app.

Todo lo que se puede hacer en CPU dentro del worker se hace con **software open source**, sin claves ni costo por uso: transcripción (Parakeet / faster-whisper), detección de cortes (ffmpeg), zooms y caras (OpenCV + YuNet), OCR de subtítulos (Tesseract) y descarga de links (yt-dlp).

Trabajos del worker (tabla `jobs`):

| Tipo | Qué hace |
|---|---|
| `VIDEO_ANALYZE` | Ingesta, transcripción por palabra, "ojos" (escenas, caras, nitidez, texto y hojas de contacto) y el director de edición paso a paso (con `input.mode = "edit"`: "Edítalo así"). |
| `VIDEO_RENDER` | Tramos, audio, zooms del estilo, b-roll, subtítulos, control de calidad y subida. |
| `VIDEO_STYLE` | "Edita como este": baja la referencia (subida o link) y mide su estilo (`worker/video/style.py`). |
| `VIDEO_CLIP` | Biblioteca de b-roll: datos (duración, tamaño) y miniatura de un clip del cliente. |
| `VIDEO_FX` | Recorte de la persona para la vista previa de los efectos (tiras de máscaras por segundo del original). |
| `LONG_VIDEO_CLIPS` | Clips desde un video largo: baja (o recibe) el video, transcribe, pide los momentos a la app y sigue las caras de cada uno (ver abajo). |

## Cómo funciona

```
Navegador ──(subida directa, URL firmada)──▶ Vercel Blob privado
    │
    ▼ "Procesar"
App (Vercel) ── INSERT en jobs ──▶ Postgres (Neon) ◀── toma trabajos ── Worker (Fly)
    │  └─ enciende la máquina (Machines API)                │
    ◀──── /api/worker/storage (URLs firmadas) ─────────────┤
    ◀──── /api/worker/projects/<id>/plan (Claude) ─────────┘
```

- **Cola**: tabla `jobs`. El worker toma trabajos con `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, renueva `locked_until` cada `LEASE_SECONDS/3`, escribe `progress`/`stage` cada ~2 s y reintenta con espera creciente (30 s, 2 min, 8 min) hasta `max_attempts` (3). Si una máquina muere a mitad, el lease vence y otro intento retoma el trabajo. Sin pg-boss ni Redis.
- **Latido**: `worker_heartbeats` cada 15 s. La app muestra "El servicio de procesamiento está apagado" si no hay latido y no puede encenderlo sola.
- **Apagado**: sin trabajos durante `IDLE_EXIT_MINUTES`, el proceso termina y la máquina queda detenida (solo se paga el volumen). Mientras está apagada no consulta la base, así Neon puede suspenderse.
- **Encendido**: si la app tiene `FLY_API_TOKEN` y `FLY_WORKER_APP`, al encolar llama a la Machines API (`POST /v1/apps/<app>/machines/<id>/start`). Si no, asume un worker siempre encendido.
- **Archivos**: el worker nunca tiene la clave de Blob. Pide a la app un acceso (método, URL firmada y cabeceras) por archivo con `/api/worker/storage`. Solo se firman archivos del dueño que indica: proyecto (`editor/<id>/…`), estilo (`editor/estilos/<id>/…`) o clip de la biblioteca (`editor/biblioteca/<id>/…`). El b-roll de stock lo baja directo del CDN de su banco (solo de `*.pixabay.com` o `*.pexels.com`).
- **Director**: al terminar de transcribir y de mirar el video, el worker maneja al director de edición paso a paso con `POST /api/worker/projects/<id>/director` (ver "Director de edición" más abajo). La ruta vieja `/plan` sigue funcionando para un worker anterior.
- **Plan (ruta vieja)**: el worker anterior llama a `POST /api/worker/projects/<id>/plan`. La app calcula los candidatos a cortar, Claude arma el plan v2, se valida con Zod y el proyecto queda en revisión. Es idempotente; si la llamada falla, el trabajo se reintenta. Si la IA falla, se arma un plan sin IA (solo cortes muy seguros) y se avisa en la revisión.
- **Caché de trabajo**: `/data/work/<proyecto>` en un volumen de Fly (original, mezzanine, WAV, tramos). Cada etapa se saltea si su salida ya existe; un reintento no rehace lo hecho. Si el volumen se pierde, se rehace desde el original.

## Variables de entorno

### Worker (Fly secrets)

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DATABASE_URL_UNPOOLED` | sí | Conexión **sin pooler** de Neon (la misma que usa la app para migraciones). |
| `APP_URL` | sí | URL de producción de la app, sin barra final (`https://cliente.com`). |
| `WORKER_SECRET` | sí | Igual al de la app. Mínimo 32 caracteres: `openssl rand -base64 32`. |
| `DEEPGRAM_API_KEY` | no | Opcional. Transcripción por API (Nova-3). Por defecto se transcribe en local (ver abajo). |
| `GROQ_API_KEY` | no | Opcional. Transcripción por API (whisper-large-v3-turbo). |
| `TRANSCRIBE_ORDER` | no (`parakeet,whisper,deepgram,groq`) | Orden de los proveedores; los que no están (sin modelo o sin clave) se saltan. Ej.: `deepgram,parakeet`. |
| `MODELS_DIR` | no (`/app/models`) | Modelos open source; ya vienen en la imagen. |
| `WHISPER_MODEL` | no (`small`) | Modelo de faster-whisper de respaldo (la imagen trae `small`). |
| `IDLE_EXIT_MINUTES` | no (5) | Minutos sin trabajos antes de apagarse. `0` = nunca. |
| `LEASE_SECONDS` | no (90) | Duración del lease. |
| `X264_PRESET` | no (`slow`) | Preset de x264 del render final. |
| `WORK_DIR`, `FONTS_DIR` | no | Ya vienen en la imagen (`/data/work`, `/app/fonts`). |

`WORKER_TEST_TRANSCRIPT` y `WORKER_TEST_STYLE_TRANSCRIPT` (transcripciones falsas desde un archivo, para el video y para la referencia de un estilo) y `BROLL_EXTRA_HOSTS` (hosts extra para bajar b-roll, para el simulador de Pexels) son solo para pruebas locales y se ignoran en Fly.

**Carruseles** (trabajos `CAROUSEL_STYLE`, `CAROUSEL_IMAGES`, `CODEX_LOGIN`): no necesitan variables nuevas en el worker. La sesión de ChatGPT o la API key de OpenAI del cliente las manda la app, descifradas, solo dentro de un trabajo en curso (`/api/worker/carruseles/credenciales`). La imagen trae `tesseract-ocr` (+ español), Node 22 y `@openai/codex` 0.162.1, Pillow y `gallery-dl`. Opcionales, solo para pruebas: `CODEX_BIN` y `GALLERY_DL_BIN` (rutas a los simulados de `worker/tests/fakes/`).

### App (Vercel)

| Variable | Qué es |
|---|---|
| `VIDEO_BLOB_READ_WRITE_TOKEN` | Store de Blob **privado** para los videos (ver abajo). |
| `WORKER_SECRET` | El mismo del worker. |
| `FLY_API_TOKEN` | Opcional. Token de la app del worker: `fly tokens create deploy -a <app>`. |
| `FLY_WORKER_APP` | Opcional. Nombre de la app de Fly del worker. |
| `FLY_WORKER_MACHINE_ID` | Opcional. Si no está, la app busca una máquina detenida de esa app. |
| `OPENAI_API_BASE` | Opcional (`https://api.openai.com/v1`). Solo para probar con un simulador. |
| `OPENAI_IMAGE_MODEL` | Opcional (`gpt-image-2.5-flare`). Modelo de imágenes cuando el cliente usa su API key de OpenAI. |
| `CODEX_MODEL` | Opcional (`gpt-5.6-terra`). Modelo con el que Codex llama a su herramienta de imágenes con la cuenta de ChatGPT del cliente. |
| `PIXABAY_API_KEY` | Opcional. B-roll de stock de [Pixabay](https://pixabay.com/api/docs/) (clave gratuita al instante, uso comercial sin atribución obligatoria). |
| `PEXELS_API_KEY` | Opcional. B-roll de stock de [Pexels](https://www.pexels.com/api/) (clave gratuita, uso comercial). Sin ninguna de las dos, el b-roll sale solo de la biblioteca del cliente. |
| `PEXELS_API_BASE` | Solo pruebas: dirección del simulador (`tests/mocks/pexels-mock.mjs`). Por defecto, la API oficial. |

### Store de Blob privado

Los videos crudos del cliente no deben ser públicos, y en Vercel Blob el acceso (público o privado) se elige **por store** al crearlo. Las miniaturas de Métricas siguen en el store público existente (`BLOB_READ_WRITE_TOKEN`). Para los videos:

1. Vercel → proyecto del cliente → Storage → Create → Blob → acceso **Private**.
2. Conectarlo al proyecto con el prefijo de variables `VIDEO_BLOB` (crea `VIDEO_BLOB_READ_WRITE_TOKEN`).

El navegador sube directo a Blob con `uploadPresigned` (multipart para más de 100 MB, hasta 8 GB) y lee con URLs firmadas (`issueSignedToken` + `presignUrl`) que vencen a los 90 minutos. Nada pasa por una función.

En desarrollo, sin esa variable, se usa disco local (`.data/storage/`, fuera de git) servido por `/api/editor/files/…` (con sesión) y `/api/worker/files/…` (con `WORKER_SECRET`).

## Desplegar el worker para un cliente

**Sin terminal (recomendado):** el repo trae `.github/workflows/worker-deploy.yml`. Crea la app y el volumen en Fly (o con el primer intento del panel), pon el nombre de la app en `worker/fly.toml`, crea un token de deploy en Fly → app → **Tokens** y guárdalo en GitHub → Settings → Secrets and variables → Actions como `FLY_API_TOKEN`. Después: Actions → **Desplegar worker** → Run workflow. Cada cambio en `worker/` se despliega solo. No uses "Launch an app from GitHub" del panel de Fly para los deploys: agrega un servicio HTTP con apagado automático que corta los trabajos a la mitad.

**Con terminal:**

Requiere [flyctl](https://fly.io/docs/flyctl/) y una cuenta de Fly del cliente (o una organización por cliente).

```bash
cd worker
# 1. Crear la app (sin desplegar) y poner el nombre en fly.toml
fly apps create content2-worker-<cliente>
sed -i 's/content2-worker-CAMBIAR/content2-worker-<cliente>/' fly.toml

# 2. Volumen para la caché de trabajo (misma región que fly.toml)
fly volumes create work --size 20 --region iad -a content2-worker-<cliente>

# 3. Secretos
fly secrets set -a content2-worker-<cliente> \
  DATABASE_URL_UNPOOLED='postgres://…' \
  APP_URL='https://<dominio-del-cliente>' \
  WORKER_SECRET='<el mismo de Vercel>'
# (Opcional) DEEPGRAM_API_KEY / GROQ_API_KEY si se quiere transcribir por API en lugar de en local.

# 4. Desplegar (crea una máquina performance-4x de 8 GB)
fly deploy -a content2-worker-<cliente>

# 5. Token para que la app encienda la máquina
fly tokens create deploy -a content2-worker-<cliente>
```

Después, en Vercel: `FLY_API_TOKEN`, `FLY_WORKER_APP=content2-worker-<cliente>` y `WORKER_SECRET`. Redeploy de la app.

Comprobar: subir un video corto. En los logs (`fly logs -a …`) aparece `trabajo … (VIDEO_ANALYZE)` y, a los 5 minutos sin trabajos, `me apago`.

La máquina sin puertos públicos: el worker solo hace conexiones salientes (Neon, la app, Blob, Pixabay/Pexels y, para "Edita como este" con link, Instagram/TikTok/YouTube; Deepgram/Groq solo si se configuran).

## Transcripción open source (por defecto)

| Proveedor | Qué es | RAM | Velocidad esperada en performance-4x |
|---|---|---|---|
| **Parakeet TDT 0.6b v3** (NVIDIA, CC-BY-4.0) con [onnx-asr](https://github.com/istupakov/onnx-asr), cuantizado int8, troceado con Silero VAD | Multilingüe (25 idiomas europeos, español e inglés incluidos). Literal: conserva muletillas, repeticiones y arranques en falso. | ~1,5–2 GB | ~10–30× tiempo real (5 min de audio en 10–30 s) |
| **faster-whisper** `small` (CTranslate2, int8, `word_timestamps=True`) | Respaldo si Parakeet no está o falla. Con un prompt de muletillas para que no "limpie" el texto. | ~1 GB | ~4–8× tiempo real |

- Los modelos se bajan **una sola vez, al construir la imagen** (`scripts/fetch_models.py`, desde HuggingFace y GitHub) y quedan en `/app/models`. Al ejecutar, `HF_HUB_OFFLINE=1`: nunca se baja nada por trabajo.
- Se cargan una vez por proceso (la primera transcripción tarda unos segundos más) y se reutilizan.
- Tamaño de la imagen: unos **2,3–2,6 GB** (ffmpeg y Python ~0,6 GB, librerías ~0,3 GB, Parakeet int8 ~0,67 GB, whisper small ~0,48 GB, Tesseract con español ~0,04 GB). La máquina de 8 GB alcanza con margen.
- **Pendiente: una corrida real.** En el entorno de desarrollo no había acceso a HuggingFace: el mapeo de la salida de los dos modelos está probado con salidas simuladas (`tests/test_transcribe_local.py`) y el e2e usó el proveedor de prueba. Antes de vender: construir la imagen, transcribir 3 videos reales (uno con muletillas y tomas repetidas) y anotar la velocidad real en esta tabla.

## Estilos ("Edita como este")

El cliente sube un video de referencia o pega un link (Instagram, TikTok, YouTube; se baja con **yt-dlp**). Si el link no se puede bajar (Instagram suele pedir sesión), el estilo queda con el error *"No pudimos bajar ese link. Descarga el video y súbelo."*. Lo que mide el worker (`worker/video/style.py`), sobre los primeros 3 minutos:

- **Cortes**: `scdet` de ffmpeg sobre todos los cuadros → cortes por minuto y duración media de toma.
- **Zooms y punch-ins**: entre cuadros (5 por segundo, en gris) una similitud con puntos ORB y RANSAC (OpenCV). El texto fijo encima (subtítulos, marcas) no se mueve: si el mejor modelo es la identidad se busca el segundo. Zoom suave = escala sostenida dentro de una toma; punch-in = misma imagen a otra escala a ambos lados de un corte.
- **B-roll**: cara del hablante con el detector **YuNet** (OpenCV Zoo, 230 KB) a 2 cuadros por segundo. Una toma sin cara en un video con cara es b-roll → proporción, cadencia y duración.
- **Subtítulos**: OCR con **Tesseract** (`spa+eng`) en los mismos cuadros; se descarta el texto fijo y queda la banda que cambia: posición vertical, tamaño, mayúsculas, palabras por bloque, color del texto y del resaltado (muestreo de píxeles con k-means) y caja de fondo.
- **Habla**: con la transcripción local, palabras por segundo, largo del gancho (primera frase) y pausas.
- **Audio**: sonoridad (EBU R128) y música (energía en las pausas de la voz).

La app arma el preset (`lib/video/style.ts`, Zod) y borra la referencia. Se copia el estilo, nunca el contenido. El preset alimenta: la tolerancia de pausas y la agresividad de los cortes del plan, el largo preferido del gancho, los zooms del render (`zoompan`, hacia la altura de la cara), los subtítulos ASS (`\an5\pos`, tamaño, colores, caja con `BorderStyle=3`) y la cadencia del b-roll.

Análisis de un reel de 30 s en 2 vCPU de desarrollo: unos 30–60 s (lo más lento es el OCR, ~0,3 s por cuadro).

## B-roll

- **Fuentes** (`lib/video/broll.ts`, interfaz `BrollSource`): Pixabay (si hay `PIXABAY_API_KEY`), Pexels (si hay `PEXELS_API_KEY`) y la biblioteca del cliente (`/editor/biblioteca`, clips con etiquetas). Gráficos animados con la marca (`graphic`, ver abajo). Videos generados con IA: todavía no; la interfaz está lista para sumar una fuente `ai`.
- **Plan**: Claude (`video.broll`) elige rangos de palabras (nunca en el gancho, la apertura ni el llamado a la acción) y qué buscar (consulta en inglés para el stock y palabras clave para la biblioteca). Primero van los clips propios que coinciden; después el stock, intercalando Pixabay y Pexels. Hasta 6 alternativas por tramo.
- **Revisión**: los b-roll aparecen sobre el texto; se cambian (sugeridos, biblioteca o una búsqueda nueva), se quitan, se mueven a otra selección o se agregan. La vista previa los muestra.
- **Editar b-roll** (revisión, botón "Ajustar"; `components/editor/broll-edit-panel.tsx`): cada b-roll de video tiene `edit` opcional en el plan (`lib/video/broll-edit.ts`, Zod; sin el campo, todo queda como antes). Cuatro grupos:
  - **Ubicación**: `full` (pantalla completa), `split` (pantalla dividida, el clip arriba o abajo y su alto entre 30 y 70 %), `card` (tarjeta flotante con esquinas redondeadas, sombra y borde fino; 5 posiciones, tamaño y forma: como el clip, 16:9, 1:1 o 4:5) y, en 16:9, `side` (el clip a un lado y la persona al otro; en vertical se dibuja como dividida). En dividida o a un lado la persona se recorta (encuadrada en la cara del estilo) y se mueve a su parte; el resto queda con el fondo de la marca.
  - **Encuadre**: corrimiento X/Y y zoom del clip dentro de su marco (sliders o arrastrando sobre la vista previa).
  - **Look**: filtro (normal, blanco y negro, duotono con el acento de Mi marca, cálido, frío) con intensidad, opacidad, brillo, contraste y saturación. Presets ("Tu marca", "Suave"…) y "Aplicar este look a todos los b-roll".
  - **Tiempo**: correr la entrada y la salida (±3 s), elegir desde qué segundo del clip se ve y la transición (fundido, corte o zoom de entrada).
  - **Una sola fuente de verdad**: la app calcula las cajas en píxeles de salida y una matriz de color 3×4 (`brollRenderEdit`) y las manda en el trabajo. La vista previa usa los mismos números (CSS y `feColorMatrix` en sRGB); el worker (`worker/video/broll_edit.py`) prepara el clip a la medida de su marco con `scale`+`crop`, una LUT 3D (`.cube`) con la matriz y `zoompan` para el zoom de entrada; la tarjeta sale como capa con alfa (FFV1 en MKV, máscara, sombra y borde dibujados con Pillow). `framing_graph` mueve a la persona y compone con la opacidad y el fundido de cada b-roll.
  - **Gráficos**: el panel solo ajusta su tiempo; en 16:9 "sobre tu video" también pueden ir a la izquierda o a la derecha (`position: left|right`, el gráfico ocupa esa mitad a todo el alto y la persona pasa a la otra), para que embudos y listas no queden chicos. En vertical, o a pantalla completa, esa posición se dibuja como "arriba".
- **Render**: sin edición, a pantalla completa, recortado al formato, sin su audio (la voz sigue), con fundido de 0,2 s. Los de stock se bajan directo del CDN de su banco.
- **Atribución** (la pide Pexels; en Pixabay es cortesía): visible en la revisión ("Video de X en Pixabay/Pexels") y en un `creditos.txt` que se descarga junto al video.
- **Gráficos con la marca ("a medida")**: fuente `graphic` (`lib/video/graphics.ts`). Seis plantillas: número que cuenta (x2, +40 %, 10K), lista de 2 a 4 puntos, frase fuerte (palabra por palabra, con una resaltada), palabra clave (resaltado o subrayado), comparación (antes/después o mito/realidad) y flujo de 3 pasos. Dos modos: `full` (pantalla completa con el fondo de la marca, arriba de los subtítulos) y `overlay` (velo del color de la marca y el gráfico arriba o a la altura del pecho, sin tapar la cara). Colores y fuente salen de Mi marca (la misma paleta que los carruseles) y se guardan en el `spec` del plan, validado con Zod.
  - **IA** (`video.broll.motion`, `lib/ai/prompts/motion.ts`): en cada tramo Claude decide `stock` o `graphic` y, si es un gráfico, arma una **escena v2** con los 15 componentes del motor (y primitivas cuando hace falta), íconos por etiqueta, modo y posición. El prompt trae el catálogo (hint y forma de cada componente), las etiquetas de los íconos, reglas de dirección (una idea por gráfico, textos cortísimos, jerarquía, ritmo), los límites y ejemplos buenos y malos. Claude nunca escribe colores: usa tokens y el tema sale de Mi marca en el servidor (`motionTheme`). Las escenas nuevas se guardan en el plan como v2; los specs v1 de planes viejos se siguen aceptando, viendo y renderizando.
  - **Validación con reintento** (`lib/video/motion-build.ts`): cada escena pasa por `checkScene` (lo que revisa el motor —desbordes, choques, zona segura, contraste— más cifras que no se dicen en el tramo, más de un componente y palabras prohibidas de la marca). Las que fallan vuelven a Claude con los problemas explicados (`video.motion.retry`, una sola llamada para todas; 1 vez en el plan, hasta 2 en un pedido). Si siguen mal, se arreglan sin IA (recortar textos al límite del componente, achicar, pasar a pantalla completa) o pasan a un componente más simple (palabra clave o frase, sin cifras dudosas). Si tampoco, el tramo queda como toma de stock. El consumo se registra en `ai_usage` como el resto.
  - **"Pide tu gráfico"** (revisión, `components/editor/graphic-studio.tsx`): en un tramo seleccionado ("Pide un gráfico aquí") o en un gráfico existente, la persona describe el gráfico con sus palabras (o toca un ejemplo) y Claude lo arma (`video.motion.pedido`); "Ajustar" cambia el actual con otra frase (`video.motion.ajuste`) y "Deshacer" vuelve al anterior. Vista previa animada al lado, edición a mano de los textos, el modo y la posición. Límites, explicados en la misma pantalla: sin personas ni caras, sin fotos o video realistas, sin logos de terceros, sin cifras que no se dicen (las que la persona escribe en su pedido valen, con aviso si no están en el tramo). Si el pedido entra en un límite, Claude responde con una explicación corta y una alternativa que se prueba con un toque. Hasta 40 pedidos por hora por persona (`lib/rate-limit.ts`). Lo que se dice en el tramo sale de la transcripción guardada, no del navegador.
  - **Motor de motion graphics** (`lib/video/motion`): un solo motor TypeScript que dibuja con la API Canvas 2D, en el navegador (`<canvas>`, `components/editor/graphic-canvas.tsx`) y en el worker (**skia-canvas**, MIT, sin Chromium). Escena v2 con Zod (`schema.ts`: duración, formato, modo, tema de marca por tokens y capas), primitivas, pistas de keyframes con curvas con nombre y resorte, comportamientos (`fadeUp`, `pop`, `countUp`, `draw`, `fill`, `highlight`…), 103 íconos de Lucide como datos (`pnpm motion:icons`) y 15 componentes prearmados (número que cuenta, lista, frase, palabra clave, comparación, pasos, embudo, notificación de mensaje, barras, línea, checklist, línea de tiempo, ícono con estallido, progreso y de X a Y), con `scale` por componente. `validateScene` revisa desbordes, choques, zona segura de Reels y contraste, con mensajes en español. Los gráficos v1 de los planes se convierten a una escena v2 con el componente equivalente (`v1.ts`). Galería de desarrollo: `/motion`. Pruebas: `pnpm test:motion` (motor, y armado, validación y reintento de los gráficos con IA con el director simulado de `AI_FAKE`).
  - **Render**: `worker/motion/render.mjs` (Node 22 + skia-canvas 3.0.8) dibuja cuadro a cuadro con el motor empaquetado (`worker/motion/engine.mjs`, se genera con `pnpm motion:bundle`; las pruebas avisan si quedó viejo) y lo manda por un pipe a ffmpeg: `full` en MP4 H.264 y `overlay` en MOV qtrle con alfa, que el grafo de `render.py` compone como cualquier b-roll (con el fundido de 0,2 s). Un gráfico de 3 s a 1080×1920 tarda unos 5 s en 2 vCPU. Caché por hash del gráfico, tamaño, duración y versión del motor. Usa las fuentes del worker (Inter y Montserrat de 500 a 900, `FONTS_DIR`). `MOTION_RENDER=0` vuelve al dibujo anterior con Pillow (`worker/video/graphics.py`), que también es el respaldo automático si el motor falla con un gráfico v1; las escenas v2 solo las dibuja el motor. En local: `cd worker/motion && npm ci`.
  - **Revisión**: vista previa animada en el reproductor y en el selector; pestaña "Gráfico" con "Pide tu gráfico" y la edición a mano (textos de la escena v2; en los gráficos v1, plantilla, textos y modo). Si se escribe una cifra que no se dice en el tramo, se avisa.
  - Los gráficos son propios: no van en `creditos.txt`.
- Límites: Pixabay 100 búsquedas por minuto, Pexels 200 por hora; si se pasa, el editor avisa y sigue con la biblioteca.

## Subtítulos animados (galería)

Seis estilos además de Clásico, Pop y "Del estilo": **Caja** (píldora del acento que salta de palabra en palabra), **Hormozi** (mayúsculas con contorno, la palabra clave en el acento y más grande), **Karaoke** (la frase completa que se va pintando), **Palabra a palabra** (una palabra enorme con salto), **Minimal** (minúsculas Inter con sombra suave) y **Resaltador** (marcador del acento detrás de la palabra clave). Usan el acento y la fuente de títulos de Mi marca (Montserrat o Inter, las del worker; no se agregó ninguna fuente).

- **Una sola fuente de verdad** (`lib/video/caption-styles.ts`): la app arma, por bloque, el renglón de cada palabra y sus pistas (color, opacidad, escala, caja, resaltador, emoji) como claves con tiempos del video final. La vista previa (`components/editor/caption-overlay.tsx`) evalúa esas claves en cada cuadro y el worker (`worker/video/ass.py`, `build_look_ass`) las traduce a `\t` lineales de ASS, con la caja y el resaltador como dibujos `\p1` y la sombra como una copia desenfocada. El worker solo mide los anchos (Pillow, misma fuente) y corrige la línea de base con las métricas de la fuente (libass y el navegador las usan distinto). Si un renglón no entra, el bloque se achica igual en los dos lados.
- **Posición segura de Reels**: el centro del bloque va al 66 % del alto en vertical (lejos de la interfaz de abajo y de la cara).
- **Emojis opcionales** sobre la palabra clave (uno por frase, solo en el primer renglón): imágenes de **Noto Emoji** (OFL, `worker/assets/emoji` y `public/emoji`, generadas con `scripts/make_emoji.py`), superpuestas con `overlay` en el grafo (hasta 24 por video). Se eligen por la raíz de la palabra (dinero, tiempo, idea, error…); si no hay una que encaje, no va emoji.
- **Comparación**: `scripts/caption-dump.mts` vuelca lo que la app manda al worker (también es el fixture `worker/tests/fixtures/caption-styles.json`) y `/subtitulos?style=caja&t=2.9` (solo en desarrollo) dibuja la vista previa a tamaño real para compararla cuadro a cuadro con el render.
- Los planes viejos siguen igual: Clásico, Pop y "Del estilo" usan el ASS de antes.

## Efectos de sonido y música

- **Efectos** (`lib/video/sfx.ts`): "whoosh" cuando entra un b-roll o un gráfico; en "Marcado", además, un "pop" en cada emoji y un "riser" que termina justo en el corte entre el gancho y el resto. Nivel global en la revisión: Sin efectos, Sutil (nuevo por defecto) o Marcado; los planes de antes quedan sin efectos. Los sonidos son **procedurales** (`worker/scripts/make_sfx.py`: ruido filtrado con envolvente, senoidal corta y barrido, semilla fija; sin licencias de terceros) y viven en `worker/assets/sfx` y `public/sfx` (para escucharlos en la revisión).
- **Música**: el cliente sube sus pistas en Editor → Biblioteca → Música (`music_tracks`, subida directa al almacenamiento privado, `editor/musica/<id>/`) y elige una en la revisión con su volumen (de -30 a -8 dB respecto de la voz). La app no trae música de terceros.
- **Mezcla** (`render.mix_audio`): la voz ya normalizada a -14 LUFS no se toca; los efectos van con `adelay` y su ganancia, la música se mide, se lleva a "voz + volumen", se repite hasta el final con fundidos y baja ~9 dB mientras hablas (`sidechaincompress` con la voz como llave, ataque 20 ms, salida 450 ms). `amix` sin normalizar y un limitador al techo de la voz (-1 dBFS, que la voz sola no toca, con la latencia compensada).
- **Medido** en un render real de 24 s (Caja con emojis, Marcado y música a -12 dB): sonoridad -14,3 LUFS con y sin efectos y música (igual), pico -3,8 dBFS; en los whoosh, el efecto queda 11 a 14 dB por debajo de la voz cuando hablas; la música, unos 19 dB por debajo bajo la voz. Pruebas: `tests/test_audio_mix.py`.

## Audio de estudio

Para que una toma con el teléfono en una habitación con eco y ruido suene limpia. En la revisión, panel de sonido: **Apagado / Suave / Fuerte** (`plan.audio.studio`; los planes nuevos arrancan en Suave y los de antes, sin el campo, quedan apagados y suenan igual que antes).

- **Ruido**: [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) (MIT o Apache-2.0, a elección), un modelo de 8,6 MB que corre en CPU. Sus tres redes ONNX (`enc`, `erb_dec`, `df_dec`) corren con **onnxruntime** (ya venía en la imagen por la transcripción) sobre el audio entero, en tramos de 45 s con 15 s de contexto; el procesado de señal de libDF (STFT de 960 con ventana de Vorbis, 32 bandas ERB, normalizaciones exponenciales, máscara por banda y filtro profundo de orden 5 en los primeros 96 bins) está reescrito en numpy (`worker/video/studio.py`). La salida es igual a la del binario oficial `deep-filter -D` (diferencia por debajo de -55 dB con el audio entero de una vez; -41 dB por tramos) y **~12 veces más rápida** que ese binario, que procesa cuadro a cuadro.
- **Eco**: DeepFilterNet3 se entrenó también con reverberación y ya recorta parte de la cola. Encima, supresión de la reverberación tardía (modelo estadístico de Lebart/Habets: la cola es la energía de hace 50 ms caída según el tiempo de reverberación), con el T60 estimado a ciegas por la velocidad de caída de la energía al final de las palabras. Si la sala es seca (estimación < 0,17 s) no se toca. Suave usa el T60 estimado y un piso de -8 dB; Fuerte, 1,8 veces el estimado y un piso de -14 dB.
- **Zumbido de la red** (50 o 60 Hz y armónicos): DeepFilterNet no lo quita bien. Se detecta en los silencios (un armónico que sobresale 10 dB de sus vecinos) y se corta con filtros angostos.
- **Voz** (después, en ffmpeg, sin volver a reducir ruido): pasa altos (80 Hz Suave, 90 Hz Fuerte), -2/-3 dB en 250 Hz (menos "caja"), +2/+3 dB en 3,5 kHz (presencia), +1,5/+2 dB arriba de 10 kHz, de-esser y compresión 3:1 / 4:1. Apagado usa la cadena de siempre (`afftdn`).
- **Suave** deja el ruido unos 28 dB más bajo en vez de borrarlo (mezcla el original por debajo): suena natural. **Fuerte** lo borra del todo y quita más eco; la voz puede sonar más seca.
- **Muestra "Escuchar antes y después"**: el worker la arma **al analizar** (después de transcribir): la ventana de 10 s con más voz, en tres MP3 (original, Suave y Fuerte) a -14 LUFS, en `editor/<id>/audio-estudio/`. Se eligió hacerlo ahí y no con un trabajo aparte porque cuesta unos segundos, no necesita tipo de trabajo nuevo (ni migración), y cuando la persona abre la revisión suena al instante sin encender el worker. Si falla, el análisis sigue y la revisión lo dice. MP3 y no AAC: Chromium sin códecs propietarios no reproduce AAC.
- **Modelo en la imagen**: `scripts/fetch_models.py` lo baja al construir (`/app/models/deepfilternet3`), primero del `.tar.gz` del repo en v0.5.6 y, si no responde, del binario oficial de la misma versión (lo trae adentro); en los dos casos se comprueba el sha256 de cada archivo. Sin el modelo (solo en desarrollo), el render usa la cadena de siempre y lo anota en `outputMeta.audio.studio`.

**Sincronía**: `afftdn` (la reducción de ruido de ffmpeg de la cadena de siempre) corría la voz **25 ms** respecto del video y el limitador sin `latency=1`, otros **5 ms**. Ahora el retraso de la cadena se mide con una señal de prueba (una vez por proceso, `render.chain_latency`) y se compensa, y el limitador compensa su anticipación: la voz queda alineada muestra a muestra en los tres niveles (prueba en `tests/test_studio_audio.py`).

**Normalización**: el `loudnorm` final con `linear=true` caía casi siempre al modo dinámico (con "bombeo"): le alcanzaba con que la ganancia final llevara el pico verdadero apenas por encima de -1 dBTP. Ahora la última pasada es la ganancia exacta (lo que haría el modo lineal) con un limitador a -1,5 dBFS, y una vuelta de corrección si el limitador se comió más de 0,25 dB.

**Medido** (60 s de voz de MS-SNSD, MIT, con reverberación por convolución —RT60 0,7 s— y ruido real de aire acondicionado con zumbido a 12 dB de SNR; "piso" = RMS en una pausa de 0,6 s; SNR y cola estimados contra la voz limpia; todo a -14 LUFS):

| | LUFS | Pico (dBTP) | Piso en la pausa | SNR estimado | Cola de eco (0–250 ms) | STOI |
|---|---|---|---|---|---|---|
| Grabación | -13,9 | — | -25,2 dB | 12,5 dB | -8,1 dB | 0,706 |
| Apagado | -14,0 | -1,3 | -30,6 dB | 17,7 dB | -9,0 dB | 0,687 |
| Suave | -14,1 | -1,0 | -49,5 dB | 36,1 dB | -13,4 dB | 0,750 |
| Fuerte | -14,2 | -1,0 | -68,6 dB | 51,9 dB | -15,5 dB | 0,752 |

Con ruido no estacionario (tecleo, vecinos, puertas): SNR 13,7 → 31,6 (Suave) y 37,4 dB (Fuerte). En una toma **seca** con ruido, Suave y Fuerte no aplican la quita de eco (sala seca detectada) y la inteligibilidad (STOI) queda igual que Apagado.

**Velocidad**: unos 4,6 s de CPU por minuto de audio (Suave) y 5,4 s (Fuerte) en la máquina de desarrollo (2 vCPU compartidas, con carga); el modelo solo, ~2 s de CPU por minuto. En una performance-4x (4 vCPU dedicadas) se estima ~2–3 s por minuto de video final; la muestra de 10 s, ~1 s por nivel. Memoria: ~1,1 GB de pico con 5 min de audio (sin la reserva de memoria de onnxruntime). Pruebas: `tests/test_studio_audio.py`.

## Clips desde un video largo

El cliente sube un podcast, un live o un video de YouTube de 10 a 120 minutos (hasta 2 h 30 min y 8 GB; mínimo 3 min), o pega un link que el worker baja con **yt-dlp** (hasta 1080p y 6 GB; YouTube suele funcionar, Instagram suele pedir sesión). Pantalla: Editor de video → **Clips desde un video largo** (`/editor/clips`).

1. **Worker (`worker/video/clips.py`, `LONG_VIDEO_CLIPS`)**: original en `/data/work/largos/<id>` (si vino de un link, se guarda una vez en el almacenamiento privado como `editor/largos/<id>/original.mp4`), audio y transcripción por palabra con los mismos proveedores del Editor.
2. **Momentos (app, `lib/clips/`)**: `POST /api/worker/clips/<id>/moments`. El código arma candidatos de 30 a 90 s que empiezan y terminan en un límite de frase y los mide (`lib/clips/score.ts`: gancho, duración, ritmo de habla relativo al propio video, pausas, preguntas, cifras y cierre); se eligen los mejores sin que se pisen (hasta 24) y Claude (`clips.momentos`, `lib/ai/prompts/clips.ts`) elige de 5 a 10, puede mover los bordes por palabra y escribe título, texto de gancho, "por qué este momento" y el tipo de gancho. **Puntaje** = 45 % reglas + 55 % criterio de Claude, más entre -5 y +8 puntos según el ranking de tipos de gancho de Métricas (si hay al menos 3 piezas de ese tipo). Es relativo dentro del video: no es una probabilidad de nada. Sin IA, se eligen por reglas y se avisa.
3. **Reencuadre que sigue la cara (`worker/video/reframe.py`)**: en la ventana de cada clip (el clip ± 20 s, que es también el margen para mover el inicio y el fin) se muestrean 5 cuadros por segundo a 960 px y se detectan caras con **YuNet** (el mismo modelo de los estilos: 230 KB, rápido en CPU, ya en la imagen; MediaPipe sumaba ~40 MB para ganar poco). Pistas por cercanía, cortes de plano por diferencia de imagen, y a quién mirar: una cara → esa; dos que entran juntas en el 9:16 → el grupo; si no entran → la que mueve la boca mientras hay voz (histéresis de 1 s, 2 s mínimos entre cambios, el cambio se adelanta a cuando empezó a hablar). Cámara virtual con zona muerta, resorte amortiguado con aceleración y velocidad máximas, y corte seco en cambios de plano o de persona; sin cara, mantiene 1,5 s y vuelve al centro. El camino se guarda como puntos clave y se vuelve una expresión de `crop` de ffmpeg (la vista previa 360×640 y el corte final 1080×1920 usan el mismo).
   - **Límite**: es una heurística visual (no identifica voces). Con bocas tapadas, perfiles, planos muy abiertos o dos personas hablando a la vez puede elegir mal; entonces se queda con la cara más grande o la última.
   - En 2 vCPU de desarrollo, seguir las caras en 2 minutos de video 1080p tarda ~40 s (casi todo es decodificar); en performance-4x, bastante menos.
4. **Del clip al Editor**: "Abrir en el editor" o "Exportar directo" crean un proyecto (`video_projects`, 9:16, con la transcripción del tramo ya cargada). Su `VIDEO_ANALYZE` lleva `clip` en la entrada: el worker corta y reencuadra el tramo del video largo como original del proyecto (y lo sube), no vuelve a transcribir y sigue como cualquier video. "Exportar directo" se exporta solo apenas está el plan (cortes seguros, subtítulos por defecto de Mi marca: `brand_profile.subtitle_preset` si es uno de los estilos de la galería, si no Clásico) y avisa al terminar el render.
5. **Avisos**: `LONG_VIDEO_CLIPS` avisa en la campana y por correo ("Tus clips están listos").
6. **Limpieza**: `/data/work/largos/<id>` se borra si el video largo se borró o tras 7 días sin uso.

Probar en local: `python scripts/make_podcast_video.py /tmp/podcast` (podcast sintético de ~3,5 min con dos personas que se turnan, una lámina sin caras al principio y su transcripción) y el worker con `WORKER_TEST_TRANSCRIPT=/tmp/podcast/transcript.json`. Pruebas: `pytest tests/test_reframe.py` y `pnpm test:clips`.

## "Hazlo por mí" (exportar sin revisión)

Un solo mecanismo para todo lo que se exporta solo: `video_projects.auto_export` (`lib/video/auto-export.ts`). Lo encienden el interruptor del flujo de subida, la grabación en el navegador, la pantalla de progreso (mientras se prepara se puede encender o apagar) y "Exportar directo" de los clips (antes era `long_video_clips.export_mode`; la migración 0023 pasó los que había).

1. El análisis es el mismo (`VIDEO_ANALYZE`). Al pedir el plan, la ruta del worker (`/api/worker/projects/<id>/plan`) llama a `maybeAutoExport`: si el proyecto tiene `auto_export`, se arma la revisión que haría la persona aceptando la propuesta (`lib/video/auto-review.ts`: cortes, gancho —salvo en un clip—, b-roll y gráficos, subtítulos, emojis, audio de estudio, efectos y música) y se encola el `VIDEO_RENDER` en el mismo pedido.
2. Valores por defecto del editor (Mi marca → "Cómo salen tus videos", `brand_profile.editor_defaults`, `lib/video/defaults.ts`): formato, subtítulos (y emojis), b-roll sí o no, audio de estudio, efectos y música con su volumen. Los usa todo plan nuevo (no solo "Hazlo por mí"): el flujo de subida arranca con ellos y `generatePlan` pone el sonido y la música en el plan. `subtitle_preset` se sigue leyendo (y se escribe en sincronía) para no romper lo que ya lo usaba.
3. Progreso: una sola barra para análisis (primera mitad) y render (segunda), con seis etapas. El instante entre el plan y el render no muestra la revisión; si en 90 s el render no arrancó, se muestra la revisión.
4. Si no se puede exportar solo (por ejemplo, el plan cortó todo), el proyecto queda en revisión con el motivo a la vista y se avisa en la campana y por correo. Avisos: no sale "listo para revisar", solo "Tu video está listo" al terminar el render.
5. "Revisar y volver a exportar" (en el resultado) lo devuelve a la revisión y apaga `auto_export`: lo que siga lo decide la persona.

## Grabar en el navegador y "Día de grabación"

`/editor/grabar` (`components/editor/recorder/`): cámara y micrófono con MediaRecorder, elección de dispositivos, 9:16 o 16:9, cuenta regresiva, repetir toma y un teleprompter con velocidad en palabras por minuto. "Seguir mi voz" detiene el texto mientras no hablas (energía del micrófono con Web Audio y un piso de ruido que se adapta, sin servicios externos). **No reconoce palabras**: el reconocimiento de voz del navegador (Web Speech API) en Chrome manda el audio a los servidores de Google, en Firefox no existe y en Safari depende del sistema; correr un modelo de voz dentro de la página pesaría cientos de MB. Por eso no se usa: si la persona se salta una frase, mueve el texto con la rueda o el dedo.

- **Formato**: se graba lo que entrega la cámara (en computadoras, horizontal) y el Editor recorta al formato elegido, como con un video subido; la pantalla marca el recorte. Se pide `video/mp4` (Safari en iPhone y Mac, y Chrome reciente) y si no, WebM (Chrome, Firefox). El worker acepta los dos; los WebM de MediaRecorder no traen la duración en la cabecera y se re-empaquetan a MKV sin recodificar antes de la ingesta (`ingest.remux_for_duration`, también si la toma quedó cortada). El MP4 fragmentado de Safari pasa por el mismo arreglo si le faltara la duración. 5 Mb/s de video (unos 37 MB por minuto).
- **Que no se pierda una toma**: mientras se graba, cada segundo se guarda en IndexedDB (`take-store.ts`); al terminar se une en un archivo. Si se cierra la pestaña a mitad de una toma o de una subida, al volver a `/editor/grabar` se arma la toma con lo que quedó y se sigue subiendo (el Editor muestra "Tienes N tomas sin subir"). La toma se borra del navegador cuando el Editor confirma que el archivo llegó entero. Sin IndexedDB (algunas ventanas privadas) se graba igual y se avisa que no se cierre la pestaña.
- **Subida**: directa al Blob privado como el resto del Editor (`putFile`: en partes y con reintentos por parte a partir de 100 MB), una toma a la vez, con reintentos de toda la subida (3 s a 3 min) y espera a que vuelva la conexión. Si la ruta reservada venció, se reserva otra. No se retoma a mitad de un archivo: se vuelve a subir la toma completa (son de pocos minutos).
- **Día de grabación**: se eligen varios guiones (de Guiones y de "Tu semana lista") y se graban seguidos; **cada toma es su propio proyecto del Editor** (con el guion asociado, que mejora los cortes y los subtítulos, y el guion pasa a "Grabado"). Se eligió esto y no grabar todo de corrido y cortar por guion con la transcripción porque es más robusto: una toma mala se repite sola, una subida que falla no arrastra a las demás, no depende de que la transcripción encuentre bien el borde entre guiones y cada video arranca a procesarse apenas termina su toma.
- Permisos: errores en español para permiso negado (con cómo darlo en iPhone), sin cámara, cámara ocupada y sin HTTPS.

Pruebas: `/home/claude/e2e/grabar-*.mjs` (Chromium con `--use-fake-device-for-media-stream`), `pytest tests/test_recording.py` y `pnpm test:video` (`tests/video-defaults.test.mts`).

## Director de edición (con ojos)

Un editor humano cobra unos USD 15 por video; el director de edición usa la IA como ese editor: **mira** el video, lo **entiende**, decide **toda** la edición junta con su "por qué" y **revisa** su trabajo antes y después de renderizar. Código: `worker/video/eyes.py`, `worker/video/director.py`, `lib/video/director/*`, prompts en `lib/ai/prompts/director.ts`.

### 1. Ojos (worker, CPU, open source)

Después de transcribir, sobre el mezzanine (`eyes.analyze`):

- **Escenas**: ffmpeg `select='gt(scene,0.25)'` sobre una copia de 192 px (exacto al cuadro, rápido).
- **Muestreo**: un cuadro cada 1 a 3 s (según el largo) más uno al empezar cada escena, con tope (240 con tope de IA ≥ USD 4; 160 con ≥ 2,5; 90 si es menor: `eyesMaxFrames`). Se escanea 1 de cada 15 cuadros (0,5 s) a 432 px de lado corto.
- **Por cuadro**: cara (YuNet con sus 5 puntos: posición, tamaño y si mira a cámara por el giro de la nariz respecto de los ojos), nitidez (varianza del laplaciano en el centro), exposición (brillo, quemado, contraluz cara vs. fondo), movimiento de cámara (correlación de fase entre cuadros a 0,5 s), texto quemado (Tesseract por renglón: gradiente + cierre horizontal para encontrar renglones y `--psm 7` sobre cada uno; si no hay renglones y no hay cara, el cuadro entero) y energía de la voz (dB del WAV de 16 kHz).
- **Tramos**: cada escena partida donde cambia lo que se ve (aparece o desaparece la cara, se desenfoca, aparece texto) y en ventanas de hasta 6 s, con los promedios.
- **Hojas de contacto**: grillas de 6 × 3 (vertical, cuadros de 216×384), 4 × 5 (horizontal) o 5 × 4 (cuadrado), con "#n m:ss.s" debajo de cada cuadro, en JPEG. Menos de 2000 px por lado (unos 2.000–2.500 tokens por hoja, ~130 por cuadro). Se suben a `editor/<id>/ojos/hoja-NN.jpg`; las medidas van a `video_projects.eyes`. La app recorta las miniaturas de "Lo que entendió" de estas hojas (sin pedir otras imágenes).

Un video de 35 s se mide en ~20 s en 2 vCPU (lo más lento es el OCR, tope de 48 cuadros). Si algo falla (sin modelo de caras, sin Tesseract), sigue sin esa medida y lo anota.

### 2. Pasos del director (app, `lib/video/director/service.ts`)

Cada llamada a `/director` hace **un** paso (una llamada de IA como mucho) y responde cuál sigue; así ninguna llamada HTTP es eterna (`maxDuration = 800`) y un reintento retoma donde quedó:

```
start → understand → direct → preview → critique → [revise → preview → critique] → finalize
                                        (worker)
"Edítalo así" / "Arreglarlo": start → edit → preview → critique → [revise] → finalize
Después del render: final (revisión del MP4)
```

| Paso | Qué hace | Modelo |
|---|---|---|
| `understand` | **Mapa del video**: Claude mira las hojas + la tabla de medidas + las frases. Tipo de video, tramos visuales (lo importante que no se tapa: producto, pantalla, gesto), tomas malas, texto en pantalla, historia por partes (gancho, problema, promesa, punto, prueba, cifra, objeción, oferta, CTA) y el brief inferido. | Opus, razonamiento medio |
| `direct` | **Dirección única**: con el mapa, el brief (o el inferido), la marca (incluye el ranking de ganchos y lo que mejor funcionó), la retención de YouTube si hay y el estilo de referencia, decide todo junto: cortes, bloques movidos, gancho, b-roll y gráficos (formato de cable de `motion.ts`), palabras resaltadas, zooms, subtítulos ocultos, ritmo y 0–2 versiones. Cada decisión con su "por qué". Reglas por objetivo (anuncio: gancho en 2 s, ritmo alto, nunca tapar producto ni oferta, CTA al final, versiones de 15/30/60 s). | Opus, razonamiento alto |
| `preview` | **Worker**: arma el plan con el mismo grafo del render (tramos, b-roll, gráficos, subtítulos, zooms) **sin codificar** y saca los cuadros clave (gancho, antes y después de cada corte, cada b-roll y gráfico en su lugar, el texto en pantalla, el final). Hojas en `editor/<id>/director/vuelta-N-NN.jpg`. | — |
| `critique` | **Segunda mirada**: crítico con visión sobre esos cuadros + las verificaciones automáticas (`checks.ts`). Puntaje 0–100 y problemas con su arreglo. Si hay problemas serios, `revise`. | Opus, razonamiento medio |
| `revise` / `edit` | El director corrige con los problemas o con el pedido de la persona; "qué cambió" se calcula sobre los planes de verdad (`diff.ts`). | Opus, razonamiento alto |
| `finalize` | Arreglos seguros sin IA (quitar un b-roll sobre algo importante, ocultar subtítulos sobre texto quemado, cortar una toma mala que quedó, devolver una CTA cortada), queda en revisión y, con "Hazlo por mí", se exporta. | — |
| `final` | Después del render, cuadros del MP4 en los momentos clave → revisión con visión. Si algo quedó mal, aviso en el resultado con la sugerencia y "Arreglarlo". | Opus, razonamiento bajo |

**Reglas duras** (no dependen de la IA, `assemble.ts`): lo que el brief pide que quede no se corta; la oferta, la CTA y lo que se muestra (producto, pantalla) quedan al menos al 60 % (una toma repetida adentro sí se limpia); el b-roll nunca va sobre el gancho, la apertura, la CTA ni un tramo importante del mapa; los bloques movidos son frases completas; cifras de los gráficos solo las dichas (validación del motor). Si el director falla, se usa el plan de antes (Sonnet) y se avisa.

**"Hazlo por mí" y clips** pasan por el mismo director (el proyecto queda en revisión un instante y se exporta solo).

### 3. Costo y tope por video

Todo el consumo se registra en `ai_usage` con `video_project_id`, tokens de caché y `cost_usd` por etapa (`lib/ai/pricing.ts`: Opus 5.5 USD 4/20 por millón, Sonnet 5.5 2/10, Haiku 5.5 0,10/0,50; caché de 1 h). Tope por video: USD 5 por defecto (de 1 a 15), en la subida y en la revisión. Antes de empezar se arma un plan de costo (`cost.ts`) y, si no entra, se degrada en orden: revisión final con Sonnet → una sola vuelta de segunda mirada → mitad de los cuadros en el mapa → crítico con Sonnet → mapa con Sonnet → sin revisión final con IA → sin segunda mirada con IA (solo verificaciones y arreglos seguros) → dirección con menos razonamiento → dirección con Sonnet. Antes de cada paso se vuelve a mirar lo gastado de verdad. Lo que se dejó de hacer se muestra en "Lo que entendió".

Estimación con todo encendido (Opus en todo, dos vueltas, revisión final):

| Video crudo | Mapa | Dirección | Cada vuelta (crítica + corrección) | Revisión final | Total |
|---|---|---|---|---|---|
| 1 min | ~$0,15 | ~$0,34 | ~$0,48 | ~$0,08 | **~$1,50** |
| 3 min | ~$0,23 | ~$0,44 | ~$0,60 | ~$0,08 | **~$1,95** |
| 10 min | ~$0,35 | ~$0,56 | ~$0,73 | ~$0,09 | **~$2,45** |

Más unos centavos por reintentos de gráficos (Sonnet). Cada "Edítalo así" o "Arreglarlo": ~$0,40–0,90. El razonamiento de Opus varía: los números reales pueden ser hasta un 50 % más altos; con USD 5 de tope todo entra sin degradar. **Pendiente: medir con la API real** (en el desarrollo se probó con `AI_FAKE=1`).

### 4. Probar sin la API

`AI_FAKE=1` no ve imágenes: el simulador (`lib/video/director/simulate.ts`) responde con reglas sobre las medidas **reales** del worker (tramos sin cara con texto = pantalla importante; borrosos o fuera de cuadro = tomas malas; cifras dichas = gráficos) y registra un costo estimado (proveedor "simulado") para probar el tope. Video de prueba con escenas (a cámara, un panel con texto, una toma borrosa fuera de cuadro, una toma repetida y una CTA con rótulo):

```bash
.venv/bin/python scripts/make_director_video.py /tmp/director   # anuncio-1080x1920.mp4, transcript.json, escenas.json
```

Pruebas: `pnpm test:director` (plan del director, reglas duras, verificaciones, cuadros clave, tope y "Edítalo así") y `pytest tests/test_eyes.py` (medidas, tramos, hojas y un análisis real con ffmpeg).

## Efectos de firma (17)

Una biblioteca de efectos con nombre para reels (`lib/video/fx`): portada de revista, zoom digital, checklist, letras de vidrio, teléfono con tareas, gráfico que crece, muro de titulares, giro 3D, pared de capturas, ventana de tu app, sales del cuadro, corte con zoom, zoom out, pantalla verde, recorte de papel, garabatos y vértigo. Siete siguen una especificación de referencia (tamaños, tiempos y colores); los otros diez son diseño propio a partir de una descripción. Nada de HyperFrames ni GSAP: todo con nuestro motor.

- **En el plan**: `plan.effects` (Zod en `lib/video/fx/schema.ts`): tipo, rango de palabras (como el b-roll), textos (`text`, `items`, `kicker`), palabras fuertes del zoom digital (`words`) y su "por qué". Un tramo lleva b-roll **o** efecto, no los dos (validación del plan). Sin el campo (planes de antes), sin efectos.
- **Una sola fuente de verdad**: `compileFx` (`lib/video/fx/compile.ts`) arma el *spec* de cada efecto en píxeles y segundos del efecto: textos, colores y fuente de Mi marca, la cara (mediana de las caras que midieron los ojos en esos segundos, pasada al encuadre final), las palabras con sus tiempos (las tareas del checklist se tildan cuando se dicen; el zoom digital salta en las palabras fuertes) y el corte del video dentro del tramo (corte con zoom). El motor (`lib/video/fx/engine`, Canvas 2D) lo dibuja igual en la vista previa (`<canvas>`) y en el worker (skia-canvas, empaquetado en `worker/motion/fx-engine.mjs` con `pnpm motion:bundle`).
- **Capas**: cada cuadro se arma con el video (encuadrado como en el render), lo que va detrás de la persona, la persona recortada (el cuadro × la máscara) y lo que va adelante. Fuentes: Inter y Montserrat (las de siempre), **Instrument Serif** (portada y titulares), **Caveat** (garabatos), **Anton** (letras recortadas) y **JetBrains Mono** (rótulos); todas OFL, en `scripts/fetch_fonts.sh` y, en el navegador, las autoalojadas de `public/fonts`.
- **Render** (`worker/video/fx.py`): por efecto, el tramo del video unido con el encuadre final y sin zooms → (si va detrás) la máscara de esos cuadros → `worker/motion/fx.mjs` dibuja cada cuadro y lo manda a ffmpeg (H.264). Entra al grafo final como una capa a pantalla completa sin fundido (`FX_EDIT`); los subtítulos van encima, salvo en los efectos que llevan los suyos (zoom digital, portada). Los zooms del estilo o del director no caen sobre un efecto. Caché por hash del spec, de los cuadros y de la versión del motor; `outputMeta.effects` anota cuánto tardó cada uno.
- **"Tus reels"** (giro 3D, pared de capturas, ventana de tu app): las miniaturas más recientes de Métricas (`content_items.thumbnail_url`); el worker las baja solo de la app o del Blob público. Si no hay, o una no se puede leer, el motor dibuja tarjetas con la marca y el título del reel, y la revisión lo dice. Ningún logo ni interfaz de terceros: la "ventana" y el "teléfono" son genéricos, con la marca.

### Recorte de la persona

Diez efectos ponen cosas **detrás** de la persona. La máscara se calcula en el worker, en CPU, solo para los segundos que la necesitan (`worker/video/fx_mask.py`).

**Elección del modelo, con datos.** Video sintético con personas reales recortadas (la foto de la astronauta de la NASA, dominio público, y dos retratos de prueba) sobre un fondo con textura que se mueve, con balanceo, giro y "respiración" de la persona, cambios de luz, ruido de sensor y compresión H.264 (`scripts/make_fx_video.py`; la máscara exacta de cada cuadro es la verdad). Medido a 1080×1920 sobre 60 cuadros por persona, en la máquina de desarrollo (2 vCPU compartidas), con el mismo refinado para todos (suavizado temporal + guided filter):

| Modelo | Licencia | Peso | IoU | Error medio | Error en el borde | Parpadeo | ms por cuadro |
|---|---|---|---|---|---|---|---|
| **MediaPipe Selfie (mosaico 2×256)** | Apache-2.0 | 0,44 MB | **0,96** | 16,5 | 164 | **19,7** | **98** |
| MediaPipe Selfie (un cuadrado) | Apache-2.0 | 0,44 MB | 0,95 | 24,1 | 168 | 18,9 | 83 |
| PP-HumanSeg (OpenCV Zoo) | Apache-2.0 | 6 MB | 0,94 | 22,0 | 173 | 17,9 | 89 |
| U²-Net p | Apache-2.0 | 4,6 MB | 0,96 | 14,2 | 158 | 30,8 | 332 |
| U²-Net human_seg (ya estaba, miniaturas) | Apache-2.0 | 168 MB | 0,96 | 11,4 | 147 | 27,8 | 659 |
| BiRefNet lite (1024) | MIT | 224 MB | — | — | — | — | se quedó sin memoria (>7 GB) |

(Error ×1000; "borde" = error medio en una franja de 12 px alrededor del contorno; "parpadeo" = cuánto cambia la máscara entre cuadros descontando lo que se movió de verdad. La verdad de las fotos salió de U²-Net human_seg refinado: favorece un poco a U²-Net en el borde.) **MODNet** (Apache-2.0, código y pesos) no se pudo evaluar: sus pesos están en Google Drive, que no se alcanza desde esta máquina. **RobustVideoMatting** es GPL-3.0: descartado. **RMBG** de BRIA, no comercial: descartado.

Se eligió **MediaPipe Selfie Segmentation**: el más estable en el tiempo (lo que más se nota en un video), casi tan preciso como U²-Net y 7 veces más rápido, hecho para video de selfies (talking heads). El `.tflite` (paquete npm `@mediapipe/selfie_segmentation`) usa una operación propia de MediaPipe; `scripts/tflite_selfie_to_onnx.py` lo convierte a ONNX y el resultado (440 KB) va en `assets/fx/` con su licencia, así corre con el onnxruntime que ya está en la imagen. `FX_MASK_MODEL` permite probar otro modelo ONNX.

**Cómo se calcula**: el cuadro vertical se mira en dos cuadrados (arriba y abajo) que se mezclan en la zona común (el doble de resolución útil que aplastar el 9:16), un filtro bilateral en el tiempo (±2 cuadros: apaga el parpadeo sin dejar estela en un movimiento real), guided filter con el cuadro en gris a 540×960 (el borde se pega al de la imagen) y un leve "choke" (el borde de afuera traía color del fondo viejo, que se nota sobre un fondo nuevo). La máscara depende solo del original y del encuadre: se guarda por **segundo del original** en `/data/work/<proyecto>/fx-mask/<encuadre>/` y la usan la vista previa y el render.

**Vista previa**: al guardar la revisión con un efecto que te recorta, la app pide al worker los segundos que faltan (trabajo `VIDEO_FX`, migración 0026). El worker sube una tira PNG por segundo (10 máscaras de 180×320, blancas con la máscara en el alfa) a `editor/<id>/fx/<encuadre>/` y la anota en `media.fxMasks`; la revisión las consulta cada 5 s y compone **en vivo** con el mismo motor y la misma máscara que el render. Mientras no está, el efecto se ve más tenue y lo dice. Si el trabajo falla, no se vuelve a pedir durante 10 minutos (no hay bucles) y el render lo calcula igual.

### En la revisión, en Mi marca y en el director

- **Revisión**: panel **Efectos** (muestra del efecto, texto, tiempo, "por qué", Editar y Quitar), galería animada de los 17 con una persona de muestra recortada (`public/efectos/`, en bucle; quieta con "reducir movimiento"), "Poner un efecto aquí" y "Mover el efecto elegido aquí" sobre un tramo de la transcripción, y una hoja para cambiar sus textos, las palabras fuertes del zoom digital o cambiar de efecto.
- **Mi marca → Cómo salen tus videos**: qué efectos puede elegir el director y con qué frecuencia (ninguno, pocos: 1–2 por video; normal: ~3 por minuto; muchos: hasta 5 por minuto), con una separación mínima entre efectos.
- **Director**: la biblioteca va en sus reglas (cuándo usar cada uno, campos y duración), los permitidos y la cantidad en la tarea, y la salida en el formato de cable chico (`effects: [{from_word, to_word, kind, text, items, why}]`). Reglas duras (`lib/video/fx/director.ts`): solo los permitidos, cantidad y separación, nunca sobre b-roll, lo importante que se ve o una toma mala, los que te recortan solo donde se te ve a cámara, y los que puso la persona se quedan. "Edítalo así" pide efectos con palabras ("ponle el efecto revista al principio"): el pedido entra aunque se llegue al tope. La segunda mirada marca un efecto que tapa algo importante y el arreglo seguro lo quita. Con `AI_FAKE=1`, el simulador pone la portada al abrir, un checklist si enumeras pasos, el gráfico si hablas de crecer y lo que pidas.

### Tiempos (render extra por efecto)

Medidos en la máquina de desarrollo (2 vCPU compartidas, con la app corriendo al lado) con `scripts/fx_contact.py` sobre efectos de ~3 s a 1080×1920 (dibujo; la máscara se calcula una vez por segundo del original y queda en caché):

| | s de dibujo por s de efecto | máscara (s por s) |
|---|---|---|
| Zoom digital, checklist, gráfico que crece, teléfono, zoom out | 2,7–3,3 | — |
| Portada, titulares, giro 3D, pared, ventana, pantalla verde | 3,5–4,7 | ~4 |
| Sales del cuadro | 6,2 | ~4 |
| Letras de vidrio, recorte de papel, garabatos | 8–10 | ~4 |
| Vértigo | 13,6 | ~4 |
| Corte con zoom (0,9 s) | ~8 s fijos | — |

En una performance-4x (4 vCPU dedicadas) se estima entre 2,5 y 3 veces menos. Un reel de 60 s con 3 efectos de 3 s suma unos 30–90 s de render en Fly. Lo que más cuesta en skia-canvas es leer el cuadro terminado y los desenfoques grandes; las siluetas (bordes, contornos, huecos) se dibujan a media resolución.

### Probar

```bash
.venv/bin/python scripts/make_fx_video.py /tmp/fx --no-alpha     # persona real sobre un fondo con textura, 27 s, con transcripción
.venv/bin/python scripts/fx_contact.py /tmp/fx/fx-1080x1920.mp4 /tmp/fx/transcript.json /tmp/fx/hojas   # los 17, hojas de contacto y tiempos
.venv/bin/python -m pytest -q tests/test_fx.py                     # máscara (precisión, parpadeo, caché, tiras) y composición
pnpm test:video && pnpm test:director                              # plan, dibujo (los 17 en skia-canvas), director y "Edítalo así"
```

Límites conocidos: el recorte de MediaPipe es de selfie: con varias personas, cuerpo entero lejos de la cámara u objetos en la mano puede dejar partes afuera o adentro; el pelo suelto queda más suave que con un modelo de matting. El "vértigo" rellena el hueco que deja la persona con el fondo de los costados (sin inpainting): con fondos muy cargados puede verse una zona borrosa alrededor tuyo cuando el fondo se agranda.

## Costos aproximados (5 min de video crudo → reel de 60 s)

| Concepto | Costo |
|---|---|
| Fly performance-4x 8 GB, ~$0,18/h, unos 10–12 min encendida | ~$0,04 |
| Volumen de 20 GB ($0,15/GB al mes), siempre | ~$3 al mes |
| Transcripción local (Parakeet en el worker) | $0 (unos segundos más de máquina) |
| Pexels | $0 |
| Claude (director de edición: mapa, dirección, dos vueltas de segunda mirada y revisión final) | ~$1,50–2,50 (tope por video, USD 5 por defecto; ver "Director de edición") |
| Vercel Blob (almacenamiento y descargas) | centavos |

Una máquina detenida no cobra CPU. Precios a octubre de 2026; verificarlos en cada proveedor.

## Probar en local

```bash
cd worker
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
sh scripts/fetch_fonts.sh                     # Montserrat e Inter (OFL) en worker/fonts
.venv/bin/python scripts/fetch_models.py models --only yunet   # detector de caras (los demás modelos, opcionales en local)
# Tesseract: sudo apt install tesseract-ocr tesseract-ocr-spa
.venv/bin/python -m pytest -q                 # unitarias y render real con ffmpeg
.venv/bin/python -m pytest -q --slow tests/test_sync.py   # sincronía con el plan completo de un reel (~10 min por nivel de audio)
TEST_DATABASE_URL=postgres://… .venv/bin/python -m pytest -q tests/test_queue.py   # cola (base de prueba)

# Video de prueba sintético con su transcripción, y una referencia de estilo (cortes cada 2 s, un zoom,
# un punch-in, subtítulos amarillos abajo, tomas con y sin cara)
.venv/bin/python scripts/make_test_video.py /tmp/editor --size 1080x1920
.venv/bin/python scripts/make_style_reference.py /tmp/estilo

# Simulador de Pexels (en la app: PEXELS_API_KEY=x y PEXELS_API_BASE=http://localhost:4105)
node ../tests/mocks/pexels-mock.mjs --port 4105 --dir <carpeta con pexels-N.mp4, pexels-N-sd.mp4 y pexels-N.jpg>

# Worker contra la app local (pnpm dev) con el proveedor de prueba
DATABASE_URL_UNPOOLED=postgres://… APP_URL=http://localhost:3000 WORKER_SECRET=… \
WORKER_TEST_TRANSCRIPT=/tmp/editor/transcript.json WORKER_TEST_STYLE_TRANSCRIPT=/tmp/estilo/referencia.transcript.json \
BROLL_EXTRA_HOSTS=localhost IDLE_EXIT_MINUTES=0 .venv/bin/python main.py
```

Requiere ffmpeg con libass, libx264, libopus y zimg, y Tesseract.

## Pipeline (resumen)

1. **Ingesta**: ffprobe (rotación, VFR, HDR, audio). Mezzanine 1080p a 30 fps fijos en SDR (tonemap si es HDR), WAV 48 kHz alineado, audio para transcribir (Opus 32 kbps), proxy 540p (un cuadro clave cada 0,5 s) y póster. Límites: 20 minutos, 8 GB.
2. **Transcripción** por palabra con bordes ajustados a la energía del audio (ventanas de 10 ms, umbral relativo al ruido).
3. **Plan** en la app (candidatos sin IA en `lib/video/candidates.ts`, Claude con `video.plan`, validación en `lib/video/plan.ts`).
4. **Revisión** de la persona. La vista previa y el render usan el mismo timeline (`lib/video/timeline.ts`).
5. **Render**: tramos con `-ss` exacto y cantidad fija de cuadros (1600 muestras de audio por cuadro, sin desfase), fundido de 10 ms, unión con concat, cadena de voz y `loudnorm` lineal en dos pasadas a -14 LUFS / -1 dBTP, efectos y música bajo la voz (opcionales), reencuadre, subtítulos ASS (galería animada, Clásico, Pop o del estilo) y emojis, H.264 High CRF 18, BT.709, AAC 192k, `+faststart`.
6. **Control de calidad**: duración, tamaño, fps, sonoridad, pico y sincronía. Si fallan duración o sincronía, se reintenta; los demás quedan como aviso en el resultado. Sale el MP4 con su SRT.
   La sincronía se mide de verdad (`render.sync_check`): el audio del MP4 se correlaciona con el audio del original en el lugar que dice el timeline, en 16 puntos (ventanas de 1,2 s dentro de un tramo, búsqueda de ±0,6 s). Si un punto confiable está corrido más de 60 ms, o en la mayoría de los puntos el audio no se parece al esperado, el video no se entrega: se borran sus tramos de la caché y el reintento los rehace desde el original. La prueba de punta a punta (`tests/test_sync.py`) renderiza un original sintético cuya imagen y cuyo audio codifican el tiempo y verifica cada cuadro y el audio (±40 ms); el caso completo lo arma la app (`node --import tsx scripts/make-sync-fixture.mts` → `tests/fixtures/sync-plan.json`).
   Antes, la app compara lo que mostraba la vista previa (tramos y gancho) con el timeline que arma el servidor al exportar; si no coinciden (el plan guardado cambió por detrás), no exporta (`lib/video/review.ts`, `previewMismatch`).

Pendiente para v2: seguimiento de cara, b-roll generado con IA, mezclar el audio en la vista previa (hoy los efectos y la música se escuchan por separado en la revisión), aplicar la sonoridad medida en la referencia (hoy se mide y se muestra; el render sigue a -14 LUFS).
