"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audible, dbToGain, DUCK_ATTACK, DUCK_RELEASE, duckWindows, fadeGainAt, fitMusicFade, loudnessOf, MUSIC_DUCK_DB, previewBalance, type AudioMix, type MusicFade } from "@/lib/video/audio-mix";
import { bufferPeaks, toDbfs, voiceLevelAt, type Peaks } from "@/lib/video/peaks";
import { cueSpan, type SfxCue } from "@/lib/video/sfx";
import type { Timeline } from "@/lib/video/timeline";
import { audioContext, sfxBuffer } from "../sound/use-sound";

/**
 * Sonido de la vista previa del Estudio con la mezcla: la voz es el audio del video (su volumen se pone en el elemento
 * de video), la música y los efectos van por Web Audio, cada uno en su bus con un medidor. Los volúmenes, los fundidos,
 * el ducking de la música y lo silenciado son los mismos números que usa el render (lib/video/audio-mix.ts).
 */

export type MixMeters = { voice: number; music: number; sfx: number; master: number };
const SILENT: MixMeters = { voice: -60, music: -60, sfx: -60, master: -60 };

type Buses = { ctx: AudioContext; music: GainNode; sfx: GainNode; musicMeter: AnalyserNode; sfxMeter: AnalyserNode };
let buses: Buses | null = null;
function getBuses(): Buses | null {
  const ctx = audioContext();
  if (!ctx) return null;
  if (buses && buses.ctx === ctx) return buses;
  const music = ctx.createGain();
  const sfx = ctx.createGain();
  const musicMeter = ctx.createAnalyser();
  const sfxMeter = ctx.createAnalyser();
  musicMeter.fftSize = 2048;
  sfxMeter.fftSize = 2048;
  music.connect(musicMeter).connect(ctx.destination);
  sfx.connect(sfxMeter).connect(ctx.destination);
  buses = { ctx, music, sfx, musicMeter, sfxMeter };
  return buses;
}

const scratch = new Float32Array(2048);
function analyserRms(a: AnalyserNode): number {
  a.getFloatTimeDomainData(scratch);
  let sum = 0;
  for (let i = 0; i < scratch.length; i++) sum += scratch[i]! * scratch[i]!;
  return Math.sqrt(sum / scratch.length);
}

const decoded = new Map<string, Promise<AudioBuffer | null>>();
/**
 * La música de la biblioteca como AudioBuffer (para su forma de onda, su sonoridad y para tocarla con los mismos
 * fundidos y el ducking del render). Si el archivo no se deja leer desde la página, null: suena como antes.
 */
export function useMusicBuffer(url: string | null, id: string | null): AudioBuffer | null {
  const [state, setState] = useState<{ id: string | null; buffer: AudioBuffer | null }>({ id: null, buffer: null });
  useEffect(() => {
    if (!url || !id) return;
    const ctx = audioContext();
    if (!ctx) return;
    let p = decoded.get(id);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      decoded.set(id, p);
    }
    let alive = true;
    void p.then((buffer) => alive && setState({ id, buffer }));
    return () => {
      alive = false;
    };
  }, [url, id]);
  return state.id === id ? state.buffer : null;
}

/** Picos de un AudioBuffer (canal 1), una vez por buffer. */
const peaksCache = new WeakMap<AudioBuffer, Peaks>();
export function peaksOfBuffer(buffer: AudioBuffer | null): Peaks | null {
  if (!buffer) return null;
  let p = peaksCache.get(buffer);
  if (!p) {
    p = bufferPeaks(buffer.getChannelData(0), buffer.sampleRate);
    peaksCache.set(buffer, p);
  }
  return p;
}

export type StudioMixInput = {
  playing: boolean;
  time: number;
  duration: number;
  timeline: Pick<Timeline, "clips" | "words">;
  cues: SfxCue[];
  /** Música: buffer (generada o una pista que se pudo leer) o la URL (si no se pudo leer: suena con su volumen, sin más). */
  music: { kind: "buffer"; buffer: AudioBuffer | null } | { kind: "url"; url: string } | null;
  musicDb: number;
  musicFade: MusicFade;
  voiceDb: number;
  mix: AudioMix;
  target: number;
  voicePeaks: Peaks | null;
  video: () => HTMLVideoElement | null;
};

export function useStudioMix(input: StudioMixInput): { read: () => MixMeters } {
  const { playing, duration, cues, music, musicDb, voiceDb, mix, target, voicePeaks, video } = input;
  const fade = fitMusicFade(input.musicFade, duration);
  const voiceLoud = useMemo(() => (voicePeaks ? loudnessOf(voicePeaks.rms) : null), [voicePeaks]);
  const musicBuffer = music?.kind === "buffer" ? music.buffer : null;
  const musicLoud = useMemo(() => {
    const p = peaksOfBuffer(musicBuffer);
    return p ? loudnessOf(p.rms) : null;
  }, [musicBuffer]);
  const balance = previewBalance({ target, voiceDb, musicDb, voiceLoudness: voiceLoud, musicLoudness: musicLoud });
  const hear = { voice: audible(mix, "voice"), music: audible(mix, "music"), sfx: audible(mix, "sfx") };

  // Voz: el volumen del video (nunca más de 1) y silenciada si no se escucha.
  useEffect(() => {
    const v = video();
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, dbToGain(balance.voice)));
    v.muted = !hear.voice;
  });

  // Buses: volumen de los efectos (con la compensación del balance) y de la música, al instante.
  useEffect(() => {
    const b = getBuses();
    if (!b) return;
    b.sfx.gain.setTargetAtTime(hear.sfx ? dbToGain(balance.others) : 0, b.ctx.currentTime, 0.015);
    b.music.gain.setTargetAtTime(hear.music ? 1 : 0, b.ctx.currentTime, 0.015);
  }, [balance.others, hear.sfx, hear.music]);

  const timeRef = useRef(input.time);
  const lastTime = useRef(input.time);
  const live = useRef<{ musicGain: GainNode | null; musicStatic: HTMLAudioElement | null } | null>(null);
  const timelineRef = useRef(input.timeline);
  useEffect(() => {
    timeRef.current = input.time;
    timelineRef.current = input.timeline;
  });
  // Un salto del cabezal mientras suena (más de medio segundo de diferencia) reprograma todo.
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (playing && Math.abs(input.time - lastTime.current) > 0.6) setEpoch((e) => e + 1);
    lastTime.current = input.time;
  }, [input.time, playing]);

  const cuesKey = JSON.stringify(cues);
  const speechKey = useMemo(() => JSON.stringify(duckWindows(input.timeline.words.map((w) => ({ start: w.start, end: w.end })))), [input.timeline.words]);
  const musicKey = music ? (music.kind === "url" ? music.url : music.buffer ? `${music.buffer.length}-${music.buffer.sampleRate}-${music.buffer.duration}` : "pendiente") : "sin";
  const musicGain = dbToGain(balance.music);

  useEffect(() => {
    if (!playing) return;
    const b = getBuses();
    if (!b) return;
    const { ctx } = b;
    const from = timeRef.current;
    const t0 = ctx.currentTime + 0.05;
    const at = (t: number) => t0 + (t - from);
    const sources: AudioScheduledSourceNode[] = [];
    let alive = true;
    let musicEl: HTMLAudioElement | null = null;
    let musicNode: GainNode | null = null;

    // Efectos: cada uno con su recorte y sus fundidos; los que ya empezaron suenan desde donde va el cabezal.
    for (const c of JSON.parse(cuesKey) as SfxCue[]) {
      const span = cueSpan(c);
      if (span.end <= from + 0.01 || span.start > duration) continue;
      void sfxBuffer(c.name).then((buf) => {
        if (!alive || !buf) return;
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        src.buffer = buf;
        const skip = Math.max(0, from - span.start);
        const offset = (c.from ?? 0) + skip;
        const length = Math.max(0.01, span.end - span.start - skip);
        const start = Math.max(ctx.currentTime, at(Math.max(from, span.start)));
        const peak = dbToGain(c.gain);
        // Envolvente de los fundidos (la misma rampa lineal del afade del render), en puntos de 10 ms.
        const fi = c.fade_in ?? 0;
        const fo = c.fade_out ?? 0;
        if (fi > 0 || fo > 0) {
          const local = (t: number) => fadeGainAt(t, span.start, span.end, fi, fo);
          g.gain.setValueAtTime(peak * local(Math.max(from, span.start)), start);
          for (const edge of [span.start + fi, span.end - fo, span.end]) {
            if (edge > Math.max(from, span.start)) g.gain.linearRampToValueAtTime(peak * local(Math.min(edge, span.end - 1e-4)), start + (edge - Math.max(from, span.start)));
          }
        } else g.gain.value = peak;
        src.connect(g).connect(b.sfx);
        src.start(start, offset, length);
        sources.push(src);
      });
    }

    // Música: en bucle (como el render), con sus fundidos y bajando cuando hablas.
    if (music?.kind === "buffer" && music.buffer) {
      const buf = music.buffer;
      const src = ctx.createBufferSource();
      const level = ctx.createGain();
      const duck = ctx.createGain();
      const env = ctx.createGain();
      src.buffer = buf;
      src.loop = true;
      level.gain.value = musicGain;
      // Fundidos de toda la pista sobre el tiempo del video final.
      const f = (t: number) => fadeGainAt(t, 0, duration, fade.in, fade.out);
      env.gain.setValueAtTime(f(from), t0);
      for (const edge of [fade.in, duration - fade.out, duration]) if (edge > from) env.gain.linearRampToValueAtTime(f(Math.min(edge, duration - 1e-4)), at(edge));
      // Ducking: mientras hablas, -9 dB (entra en 60 ms, vuelve en 450 ms).
      const low = dbToGain(MUSIC_DUCK_DB);
      duck.gain.setValueAtTime(1, t0);
      for (const w of JSON.parse(speechKey) as { start: number; end: number }[]) {
        if (w.end + DUCK_RELEASE <= from) continue;
        if (w.start <= from) duck.gain.setValueAtTime(from < w.end ? low : 1, t0);
        else {
          duck.gain.setValueAtTime(1, at(w.start));
          duck.gain.linearRampToValueAtTime(low, at(w.start + DUCK_ATTACK));
        }
        if (w.end > from) {
          duck.gain.setValueAtTime(low, at(w.end));
          duck.gain.linearRampToValueAtTime(1, at(w.end + DUCK_RELEASE));
        }
      }
      src.connect(level).connect(duck).connect(env).connect(b.music);
      src.start(t0, from % buf.duration);
      sources.push(src);
      musicNode = level;
    } else if (music?.kind === "url") {
      musicEl = new Audio(music.url);
      musicEl.volume = Math.max(0, Math.min(1, musicGain));
      musicEl.muted = !audible(mix, "music");
      musicEl.loop = true;
      musicEl.currentTime = from;
      void musicEl.play().catch(() => undefined);
    }
    live.current = { musicGain: musicNode, musicStatic: musicEl };
    return () => {
      alive = false;
      for (const s of sources)
        try {
          s.stop();
        } catch {
          /* ya terminó */
        }
      musicEl?.pause();
      live.current = null;
    };
    // `musicGain` y la mezcla se aplican en vivo (abajo): no reprograman.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cuesKey, musicKey, duration, epoch, speechKey, fade.in, fade.out]);

  // Volumen de la música en vivo (mover el control mientras suena no la corta).
  useEffect(() => {
    const l = live.current;
    if (!l) return;
    if (l.musicGain) l.musicGain.gain.setTargetAtTime(musicGain, l.musicGain.context.currentTime, 0.02);
    if (l.musicStatic) {
      l.musicStatic.volume = Math.max(0, Math.min(1, musicGain));
      l.musicStatic.muted = !hear.music;
    }
  }, [musicGain, hear.music]);

  // Medidores: lo que suena ahora, en el nivel que tendría en el render.
  const state = useRef({ playing, hear, balance, voicePeaks, voiceDb, target, voiceLoud });
  useEffect(() => {
    state.current = { playing, hear, balance, voicePeaks, voiceDb, target, voiceLoud };
  });
  // El cabezal avanza entre los avisos de la vista previa (~10 por segundo): se interpola con el reloj.
  const tick = useRef({ t: input.time, at: 0 });
  useEffect(() => {
    tick.current = { t: input.time, at: performance.now() };
  }, [input.time]);
  const read = useCallback((): MixMeters => {
    const st = state.current;
    if (!st.playing) return SILENT;
    const t = tick.current.t + (performance.now() - tick.current.at) / 1000;
    let voice = 0;
    if (st.hear.voice && st.voicePeaks) voice = voiceLevelAt(st.voicePeaks, timelineRef.current, t) * dbToGain(st.balance.voice + st.balance.meter);
    const b = buses;
    const music = b && st.hear.music ? analyserRms(b.musicMeter) * dbToGain(st.balance.meter) : 0;
    const sfx = b && st.hear.sfx ? analyserRms(b.sfxMeter) * dbToGain(st.balance.meter) : 0;
    const master = Math.sqrt(voice * voice + music * music + sfx * sfx);
    return { voice: toDbfs(voice), music: toDbfs(music), sfx: toDbfs(sfx), master: toDbfs(master) };
  }, []);

  return { read };
}
