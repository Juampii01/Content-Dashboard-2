# Worker de video (Fly Machines)

El Editor de video no procesa nada dentro de Vercel. Los trabajos pesados (ingesta, transcripción, análisis de estilos, render) los hace un **worker en Python** (`worker/`) que corre en una **Fly Machine por cliente**. La IA (plan de edición y b-roll con Claude) queda en la app.

Todo lo que se puede hacer en CPU dentro del worker se hace con **software open source**, sin claves ni costo por uso: transcripción (Parakeet / faster-whisper), detección de cortes (ffmpeg), zooms y caras (OpenCV + YuNet), OCR de subtítulos (Tesseract) y descarga de links (yt-dlp).

Trabajos del worker (tabla `jobs`):

| Tipo | Qué hace |
|---|---|
| `VIDEO_ANALYZE` | Ingesta, transcripción por palabra y pedido del plan a la app. |
| `VIDEO_RENDER` | Tramos, audio, zooms del estilo, b-roll, subtítulos, control de calidad y subida. |
| `VIDEO_STYLE` | "Edita como este": baja la referencia (subida o link) y mide su estilo (`worker/video/style.py`). |
| `VIDEO_CLIP` | Biblioteca de b-roll: datos (duración, tamaño) y miniatura de un clip del cliente. |

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
- **Plan**: al terminar de transcribir, el worker llama a `POST /api/worker/projects/<id>/plan`. La app calcula los candidatos a cortar, Claude arma el plan v2, se valida con Zod y el proyecto queda en revisión. Es idempotente; si la llamada falla, el trabajo se reintenta. Si la IA falla, se arma un plan sin IA (solo cortes muy seguros) y se avisa en la revisión.
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

- **Fuentes** (`lib/video/broll.ts`, interfaz `BrollSource`): Pixabay (si hay `PIXABAY_API_KEY`), Pexels (si hay `PEXELS_API_KEY`) y la biblioteca del cliente (`/editor/biblioteca`, clips con etiquetas). Videos generados con IA: todavía no; la interfaz está lista para sumar una fuente `ai`.
- **Plan**: Claude (`video.broll`) elige rangos de palabras (nunca en el gancho, la apertura ni el llamado a la acción) y qué buscar (consulta en inglés para el stock y palabras clave para la biblioteca). Primero van los clips propios que coinciden; después el stock, intercalando Pixabay y Pexels. Hasta 6 alternativas por tramo.
- **Revisión**: los b-roll aparecen sobre el texto; se cambian (sugeridos, biblioteca o una búsqueda nueva), se quitan, se mueven a otra selección o se agregan. La vista previa los muestra.
- **Render**: a pantalla completa, recortado al formato, sin su audio (la voz sigue), con fundido de 0,2 s. Los de stock se bajan directo del CDN de su banco.
- **Atribución** (la pide Pexels; en Pixabay es cortesía): visible en la revisión ("Video de X en Pixabay/Pexels") y en un `creditos.txt` que se descarga junto al video.
- Límites: Pixabay 100 búsquedas por minuto, Pexels 200 por hora; si se pasa, el editor avisa y sigue con la biblioteca.

## Costos aproximados (5 min de video crudo → reel de 60 s)

| Concepto | Costo |
|---|---|
| Fly performance-4x 8 GB, ~$0,18/h, unos 10–12 min encendida | ~$0,04 |
| Volumen de 20 GB ($0,15/GB al mes), siempre | ~$3 al mes |
| Transcripción local (Parakeet en el worker) | $0 (unos segundos más de máquina) |
| Pexels | $0 |
| Claude (plan) | ~$0,05–0,20 |
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
5. **Render**: tramos con `-ss` exacto y cantidad fija de cuadros (1600 muestras de audio por cuadro, sin desfase), fundido de 10 ms, unión con concat, cadena de voz y `loudnorm` lineal en dos pasadas a -14 LUFS / -1 dBTP, reencuadre, subtítulos ASS (Clásico o Pop), H.264 High CRF 18, BT.709, AAC 192k, `+faststart`.
6. **Control de calidad**: duración, tamaño, fps, sonoridad, pico y sincronía. Si fallan duración o sincronía, se reintenta; los demás quedan como aviso en el resultado. Sale el MP4 con su SRT.

Pendiente para v2: música con sidechain, seguimiento de cara, presets Caja y Mínimo, b-roll generado con IA, aplicar la sonoridad medida en la referencia (hoy se mide y se muestra; el render sigue a -14 LUFS).
