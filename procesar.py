"""Baja packs CC0 de Kenney, los pasa a WAV mono 48 kHz normalizados como la biblioteca (100 ms más fuertes a -12 dBFS
RMS, pico bajo -1 dBFS) y anota duración y punto fuerte. Las voces de anunciador se bajan de tono y llevan eco."""
import json, subprocess, sys, zipfile, io, urllib.request, wave
from pathlib import Path
import numpy as np

RATE = 48000
PACKS = {
    "interfaz": "https://opengameart.org/sites/default/files/kenney_interfaceSounds.zip",
    "scifi": "https://opengameart.org/sites/default/files/sci-fi_sounds.zip",
    "rpg": "https://opengameart.org/sites/default/files/RPGsounds_Kenney.zip",
    "luchador": "https://opengameart.org/sites/default/files/kenney_voiceoverFighter.zip",
    "voces": "https://opengameart.org/sites/default/files/Voiceover%20Pack.zip",
}
EXTRA = {
    "digital": "https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc",
    "casino": "https://opengameart.org/content/54-casino-sound-effects-cards-dice-chips",
}

def zip_from_page(url):
    html = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read().decode("utf-8", "replace")
    import re
    m = re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+\.zip)"', html)
    return m[0] if m else None

def normalize(y):
    win = int(0.1 * RATE)
    rms = np.sqrt(np.convolve(y**2, np.ones(win) / win, mode="valid").max()) if len(y) > win else np.sqrt(np.mean(y**2))
    y = y * (10 ** (-12 / 20) / max(rms, 1e-9))
    peak = np.abs(y).max()
    if peak > 10 ** (-1 / 20):
        y = y * (10 ** (-1 / 20) / peak)
    return y

def decode(data, filt=None):
    args = ["ffmpeg", "-v", "error", "-i", "pipe:0"]
    if filt:
        args += ["-af", filt]
    args += ["-ac", "1", "-ar", str(RATE), "-f", "f32le", "pipe:1"]
    out = subprocess.run(args, input=data, capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).astype(np.float64)

def write(path, y):
    pcm = np.clip(np.round(y * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(pcm.tobytes())

out = Path("salida"); out.mkdir(exist_ok=True)
manifest = []
packs = dict(PACKS)
for k, page in EXTRA.items():
    try:
        z = zip_from_page(page)
        if z: packs[k] = z
    except Exception as e:
        print("sin", k, e)
for pack, url in packs.items():
    try:
        data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=120).read()
    except Exception as e:
        print("no bajó", pack, e); continue
    zf = zipfile.ZipFile(io.BytesIO(data))
    lic = [n for n in zf.namelist() if "licen" in n.lower()]
    if lic:
        (out / f"LICENCIA-{pack}.txt").write_bytes(zf.read(lic[0]))
    for n in zf.namelist():
        if not n.lower().endswith((".ogg", ".wav", ".mp3")):
            continue
        voice = pack in ("luchador", "voces")
        # Anunciador: más grave, con cuerpo y eco de arena.
        filt = "asetrate=44100*0.84,aresample=44100,atempo=1.08,bass=g=4,aecho=0.8:0.55:70|140:0.35|0.2" if voice else None
        try:
            y = decode(zf.read(n), filt)
        except Exception as e:
            print("no decodificó", n, e); continue
        if len(y) < 200: continue
        y = y[: int(4.0 * RATE)]
        y = normalize(y)
        stem = Path(n).stem.lower().replace(" ", "_").replace("-", "_").replace("(", "").replace(")", "").replace("'", "")
        name = f"{pack}__{stem}"
        write(out / f"{name}.wav", y)
        env = np.abs(y)
        hit = float(np.argmax(np.convolve(env, np.ones(480) / 480, mode="same")) / RATE)
        manifest.append({"name": name, "pack": pack, "file": n, "duration": round(len(y) / RATE, 3), "hit": round(hit, 3)})
(out / "manifest.json").write_text(json.dumps(manifest, indent=1))
print(len(manifest), "sonidos")
