# Worker de video (Fly Machines)

El Editor de video no procesa nada dentro de Vercel. Los trabajos pesados (ingesta, transcripción, render) los hace un **worker en Python** (`worker/`) que corre en una **Fly Machine por cliente**. La IA (plan de edición con Claude) queda en la app.

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
- **Archivos**: el worker nunca tiene la clave de Blob. Pide a la app un acceso (método, URL firmada y cabeceras) por archivo con `/api/worker/storage`. Solo se firman archivos del propio proyecto (`editor/<id>/…`).
- **Plan**: al terminar de transcribir, el worker llama a `POST /api/worker/projects/<id>/plan`. La app calcula los candidatos a cortar, Claude arma el plan v2, se valida con Zod y el proyecto queda en revisión. Es idempotente; si la llamada falla, el trabajo se reintenta. Si la IA falla, se arma un plan sin IA (solo cortes muy seguros) y se avisa en la revisión.
- **Caché de trabajo**: `/data/work/<proyecto>` en un volumen de Fly (original, mezzanine, WAV, tramos). Cada etapa se saltea si su salida ya existe; un reintento no rehace lo hecho. Si el volumen se pierde, se rehace desde el original.

## Variables de entorno

### Worker (Fly secrets)

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DATABASE_URL_UNPOOLED` | sí | Conexión **sin pooler** de Neon (la misma que usa la app para migraciones). |
| `APP_URL` | sí | URL de producción de la app, sin barra final (`https://cliente.com`). |
| `WORKER_SECRET` | sí | Igual al de la app. Mínimo 32 caracteres: `openssl rand -base64 32`. |
| `DEEPGRAM_API_KEY` | una de las dos | Transcripción preferida (Nova-3, conserva repeticiones y muletillas). |
| `GROQ_API_KEY` | una de las dos | Respaldo (whisper-large-v3-turbo). Si Deepgram falla, se usa Groq. |
| `IDLE_EXIT_MINUTES` | no (5) | Minutos sin trabajos antes de apagarse. `0` = nunca. |
| `LEASE_SECONDS` | no (90) | Duración del lease. |
| `X264_PRESET` | no (`slow`) | Preset de x264 del render final. |
| `WORK_DIR`, `FONTS_DIR` | no | Ya vienen en la imagen (`/data/work`, `/app/fonts`). |

`WORKER_TEST_TRANSCRIPT` (transcripción falsa desde un archivo) es solo para pruebas locales y se ignora en Fly.

### App (Vercel)

| Variable | Qué es |
|---|---|
| `VIDEO_BLOB_READ_WRITE_TOKEN` | Store de Blob **privado** para los videos (ver abajo). |
| `WORKER_SECRET` | El mismo del worker. |
| `FLY_API_TOKEN` | Opcional. Token de la app del worker: `fly tokens create deploy -a <app>`. |
| `FLY_WORKER_APP` | Opcional. Nombre de la app de Fly del worker. |
| `FLY_WORKER_MACHINE_ID` | Opcional. Si no está, la app busca una máquina detenida de esa app. |

### Store de Blob privado

Los videos crudos del cliente no deben ser públicos, y en Vercel Blob el acceso (público o privado) se elige **por store** al crearlo. Las miniaturas de Métricas siguen en el store público existente (`BLOB_READ_WRITE_TOKEN`). Para los videos:

1. Vercel → proyecto del cliente → Storage → Create → Blob → acceso **Private**.
2. Conectarlo al proyecto con el prefijo de variables `VIDEO_BLOB` (crea `VIDEO_BLOB_READ_WRITE_TOKEN`).

El navegador sube directo a Blob con `uploadPresigned` (multipart para más de 100 MB, hasta 8 GB) y lee con URLs firmadas (`issueSignedToken` + `presignUrl`) que vencen a las 6 h. Nada pasa por una función.

En desarrollo, sin esa variable, se usa disco local (`.data/storage/`, fuera de git) servido por `/api/editor/files/…` (con sesión) y `/api/worker/files/…` (con `WORKER_SECRET`).

## Desplegar el worker para un cliente

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
  WORKER_SECRET='<el mismo de Vercel>' \
  DEEPGRAM_API_KEY='…' GROQ_API_KEY='…'

# 4. Desplegar (crea una máquina performance-4x de 8 GB)
fly deploy -a content2-worker-<cliente>

# 5. Token para que la app encienda la máquina
fly tokens create deploy -a content2-worker-<cliente>
```

Después, en Vercel: `FLY_API_TOKEN`, `FLY_WORKER_APP=content2-worker-<cliente>` y `WORKER_SECRET`. Redeploy de la app.

Comprobar: subir un video corto. En los logs (`fly logs -a …`) aparece `trabajo … (VIDEO_ANALYZE)` y, a los 5 minutos sin trabajos, `me apago`.

La máquina sin puertos públicos: el worker solo hace conexiones salientes (Neon, la app, Deepgram/Groq, Blob).

## Costos aproximados (5 min de video crudo → reel de 60 s)

| Concepto | Costo |
|---|---|
| Fly performance-4x 8 GB, ~$0,18/h, unos 10–12 min encendida | ~$0,04 |
| Volumen de 20 GB ($0,15/GB al mes), siempre | ~$3 al mes |
| Deepgram Nova-3 ($0,0043/min) | ~$0,02 |
| Claude (plan) | ~$0,05–0,20 |
| Vercel Blob (almacenamiento y descargas) | centavos |

Una máquina detenida no cobra CPU. Precios a octubre de 2026; verificarlos en cada proveedor.

## Probar en local

```bash
cd worker
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
sh scripts/fetch_fonts.sh                     # Montserrat e Inter (OFL) en worker/fonts
.venv/bin/python -m pytest -q                 # unitarias y render real con ffmpeg
TEST_DATABASE_URL=postgres://… .venv/bin/python -m pytest -q tests/test_queue.py   # cola (base de prueba)

# Video de prueba sintético con su transcripción
.venv/bin/python scripts/make_test_video.py /tmp/editor --size 1080x1920

# Worker contra la app local (pnpm dev) con el proveedor de prueba
DATABASE_URL_UNPOOLED=postgres://… APP_URL=http://localhost:3000 WORKER_SECRET=… \
WORKER_TEST_TRANSCRIPT=/tmp/editor/transcript.json IDLE_EXIT_MINUTES=0 .venv/bin/python main.py
```

Requiere ffmpeg con libass, libx264, libopus y zimg.

## Pipeline (resumen)

1. **Ingesta**: ffprobe (rotación, VFR, HDR, audio). Mezzanine 1080p a 30 fps fijos en SDR (tonemap si es HDR), WAV 48 kHz alineado, audio para transcribir (Opus 32 kbps), proxy 540p (un cuadro clave cada 0,5 s) y póster. Límites: 20 minutos, 8 GB.
2. **Transcripción** por palabra con bordes ajustados a la energía del audio (ventanas de 10 ms, umbral relativo al ruido).
3. **Plan** en la app (candidatos sin IA en `lib/video/candidates.ts`, Claude con `video.plan`, validación en `lib/video/plan.ts`).
4. **Revisión** de la persona. La vista previa y el render usan el mismo timeline (`lib/video/timeline.ts`).
5. **Render**: tramos con `-ss` exacto y cantidad fija de cuadros (1600 muestras de audio por cuadro, sin desfase), fundido de 10 ms, unión con concat, cadena de voz y `loudnorm` lineal en dos pasadas a -14 LUFS / -1 dBTP, reencuadre, subtítulos ASS (Clásico o Pop), H.264 High CRF 18, BT.709, AAC 192k, `+faststart`.
6. **Control de calidad**: duración, tamaño, fps, sonoridad, pico y sincronía. Si fallan duración o sincronía, se reintenta; los demás quedan como aviso en el resultado. Sale el MP4 con su SRT.

Pendiente para v2: b-roll (Pexels), música con sidechain, seguimiento de cara, presets Caja y Mínimo.
