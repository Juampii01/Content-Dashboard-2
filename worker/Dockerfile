# Worker de Content 2: Python 3.12 + ffmpeg (con libass y zimg) + fuentes OFL de los subtítulos.
# Misma imagen para todos los clientes; cada cliente la despliega en su propia app de Fly (ver docs/worker.md).
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FONTS_DIR=/app/fonts \
    WORK_DIR=/data/work

# ffmpeg de Debian bookworm (5.1) trae libx264, libass, libzimg (zscale para el tonemap HDR) y libopus.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fontconfig curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Fuentes de los subtítulos (Montserrat e Inter, SIL Open Font License), bajadas de sus repos oficiales.
COPY scripts/fetch_fonts.sh scripts/
RUN sh scripts/fetch_fonts.sh /app/fonts && fc-cache -f /app/fonts

COPY main.py .
COPY comunes comunes
COPY video video

# Sin root. /data es el volumen de Fly (caché de trabajo que sobrevive a los apagados de la máquina).
RUN useradd --create-home --uid 10001 worker && mkdir -p /data/work && chown -R worker /data /app
USER worker

CMD ["python", "main.py"]
