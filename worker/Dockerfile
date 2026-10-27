# Worker de Content 2: Python 3.12 + ffmpeg (con libass y zimg) + fuentes OFL de los subtítulos.
# Misma imagen para todos los clientes; cada cliente la despliega en su propia app de Fly (ver docs/worker.md).

# Gráficos animados del editor: skia-canvas (MIT, Canvas 2D sin navegador) para el motor de motion graphics
# (worker/motion, el mismo código que la vista previa). Se instala en la imagen de Node (mismo Debian bookworm).
FROM node:22.20.0-bookworm-slim AS motion
WORKDIR /motion
COPY motion/package.json motion/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FONTS_DIR=/app/fonts \
    WORK_DIR=/data/work

# ffmpeg de Debian bookworm (5.1) trae libx264, libass, libzimg (zscale para el tonemap HDR) y libopus.
# Tesseract (español e inglés): medir carruseles de referencia y leer subtítulos de videos de referencia.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fontconfig curl unzip ca-certificates tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*

# Node 22 LTS (solo el binario) para el motor de motion graphics (skia-canvas).
COPY --from=motion /usr/local/bin/node /usr/local/bin/node
RUN node --version

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Fuentes de los subtítulos (Montserrat e Inter, SIL Open Font License), bajadas de sus repos oficiales.
COPY scripts/fetch_fonts.sh scripts/
RUN sh scripts/fetch_fonts.sh /app/fonts && fc-cache -f /app/fonts

# Editor de video: modelos open source (Parakeet + Silero VAD, faster-whisper small, YuNet, DeepFilterNet3 para el
# audio de estudio), bajados una sola vez al construir la imagen (~1,2 GB). Al ejecutar no se descarga nada: HF_HUB_OFFLINE impide que se intente.
ENV MODELS_DIR=/app/models
COPY scripts/fetch_models.py scripts/
RUN python scripts/fetch_models.py /app/models
# Miniaturas de YouTube: U²-Net para recortar la foto del personaje (Apache-2.0, ~168 MB). Ver youtube/recorte.py.
COPY scripts/fetch_cutout_model.py scripts/
RUN python scripts/fetch_cutout_model.py /app/models
# Sacar la música de un reel: HT-Demucs en ONNX (MIT, ~158 MB) para separar la voz del resto. Ver video/separar.py.
COPY scripts/fetch_separar_model.py scripts/
RUN python scripts/fetch_separar_model.py /app/models
ENV HF_HUB_OFFLINE=1

COPY main.py diag_render.py diag_separar.py diag_costos.py ./
COPY comunes comunes
COPY video video
# Efectos de sonido (generados con scripts/make_sfx.py) y emojis de los subtítulos (Noto Emoji, OFL).
COPY assets assets
COPY carruseles carruseles
COPY youtube youtube
COPY motion motion
COPY --from=motion /motion/node_modules motion/node_modules

# Sin root. /data es el volumen de Fly (caché de trabajo que sobrevive a los apagados de la máquina).
RUN useradd --create-home --uid 10001 worker && mkdir -p /data/work && chown -R worker /data /app
USER worker

CMD ["python", "main.py"]
