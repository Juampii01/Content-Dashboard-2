# Worker de Content 2: Python 3.12 + ffmpeg (con libass y zimg) + fuentes OFL de los subtítulos.
# Misma imagen para todos los clientes; cada cliente la despliega en su propia app de Fly (ver docs/worker.md).

# Carruseles: Codex CLI (imágenes con la cuenta de ChatGPT del cliente). Se instala con npm en una imagen de Node
# y se copian solo `node` y el paquete: la imagen final sigue siendo la de Python.
FROM node:22.20.0-bookworm-slim AS codex
RUN npm install -g @openai/codex@0.162.1 && npm cache clean --force

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

# Carruseles: Node 22 LTS (solo el binario) y Codex CLI desde la etapa de arriba.
COPY --from=codex /usr/local/bin/node /usr/local/bin/node
COPY --from=codex /usr/local/lib/node_modules/@openai /usr/local/lib/node_modules/@openai
RUN ln -s /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex && codex --version

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Fuentes de los subtítulos (Montserrat e Inter, SIL Open Font License), bajadas de sus repos oficiales.
COPY scripts/fetch_fonts.sh scripts/
RUN sh scripts/fetch_fonts.sh /app/fonts && fc-cache -f /app/fonts

# Editor de video: modelos open source (Parakeet + Silero VAD, faster-whisper small, YuNet), bajados una sola vez
# al construir la imagen (~1,2 GB). Al ejecutar no se descarga nada: HF_HUB_OFFLINE impide que se intente.
ENV MODELS_DIR=/app/models
COPY scripts/fetch_models.py scripts/
RUN python scripts/fetch_models.py /app/models
ENV HF_HUB_OFFLINE=1

COPY main.py .
COPY comunes comunes
COPY video video
# Efectos de sonido (generados con scripts/make_sfx.py) y emojis de los subtítulos (Noto Emoji, OFL).
COPY assets assets
COPY carruseles carruseles
COPY motion motion
COPY --from=motion /motion/node_modules motion/node_modules

# Sin root. /data es el volumen de Fly (caché de trabajo que sobrevive a los apagados de la máquina).
RUN useradd --create-home --uid 10001 worker && mkdir -p /data/work && chown -R worker /data /app
USER worker

CMD ["python", "main.py"]
