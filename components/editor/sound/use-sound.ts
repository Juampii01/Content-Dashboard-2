"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { renderMusicSteps } from "@/lib/video/music-gen/engine";
import type { MusicGenSpec } from "@/lib/video/music-gen/spec";
import { sfxUrl, type SfxName } from "@/lib/video/sfx-library";

/**
 * Sonido en el navegador: los efectos de sonido de la biblioteca (los mismos WAV del render, en public/sfx), la música
 * generada (el mismo generador del worker, armado de a poco para no trabar la página) y su reproducción en la vista
 * previa del Estudio, en sincronía con el cabezal.
 */

let shared: AudioContext | null = null;
export function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!shared) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    shared = new Ctor();
  }
  if (shared.state === "suspended") void shared.resume().catch(() => undefined);
  return shared;
}

const buffers = new Map<string, Promise<AudioBuffer | null>>();
/** El WAV de un sonido de la biblioteca, decodificado una sola vez. */
export function sfxBuffer(name: SfxName): Promise<AudioBuffer | null> {
  const ctx = audioContext();
  if (!ctx) return Promise.resolve(null);
  let p = buffers.get(name);
  if (!p) {
    p = fetch(sfxUrl(name))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("sin archivo"))))
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null);
    buffers.set(name, p);
  }
  return p;
}

const dbGain = (db: number) => 10 ** (db / 20);

/** Toca un sonido una vez (para escucharlo en la biblioteca). */
export async function playSfx(name: SfxName, gainDb = -6): Promise<void> {
  const ctx = audioContext();
  const buf = await sfxBuffer(name);
  if (!ctx || !buf) return;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = dbGain(gainDb);
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start();
}

const musicCache = new Map<string, AudioBuffer>();
const musicKey = (spec: Pick<MusicGenSpec, "style" | "seed" | "bpm">, seconds: number) => `${spec.style}|${spec.seed}|${spec.bpm}|${Math.round(seconds)}`;

/**
 * La música generada como AudioBuffer (a 32 kHz para que sea rápido; el render la arma a 48 kHz con el mismo código).
 * Se arma en pasos (un compás por vez) cediendo el hilo entre pasos.
 */
export function useGeneratedMusic(spec: Pick<MusicGenSpec, "style" | "seed" | "bpm"> | null, seconds: number): { buffer: AudioBuffer | null; progress: number } {
  const [state, setState] = useState<{ key: string | null; buffer: AudioBuffer | null; progress: number }>({ key: null, buffer: null, progress: 0 });
  const key = spec ? musicKey(spec, seconds) : null;
  const cached = key ? musicCache.get(key) : undefined;
  useEffect(() => {
    if (!spec || !key || musicCache.has(key)) return;
    let alive = true;
    const sr = 32000;
    const gen = renderMusicSteps(spec, { seconds: Math.max(2, seconds), sampleRate: sr });
    const step = () => {
      if (!alive) return;
      const t0 = performance.now();
      let r = gen.next();
      // Varios compases por tanda, hasta ~12 ms (la página sigue fluida).
      while (!r.done && performance.now() - t0 < 12) r = gen.next();
      if (r.done) {
        const ctx = audioContext();
        if (!ctx) return;
        const buf = ctx.createBuffer(1, r.value.length, sr);
        buf.copyToChannel(r.value as Float32Array<ArrayBuffer>, 0);
        musicCache.set(key, buf);
        setState({ key, buffer: buf, progress: 1 });
        return;
      }
      setState((s) => ({ key, buffer: s.key === key ? s.buffer : null, progress: r.value as number }));
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
    return () => {
      alive = false;
    };
    // `spec` se resume en `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (cached) return { buffer: cached, progress: 1 };
  return state.key === key ? { buffer: state.buffer, progress: state.progress } : { buffer: null, progress: 0 };
}

/** Reproductor de una muestra (música generada o un sonido): uno a la vez en toda la página. */
let stopCurrent: (() => void) | null = null;
export function usePreviewPlayer(): { playing: string | null; playBuffer: (id: string, buf: AudioBuffer, gainDb?: number) => void; stop: () => void } {
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = useCallback(() => {
    stopCurrent?.();
    stopCurrent = null;
    setPlaying(null);
  }, []);
  const playBuffer = useCallback((id: string, buf: AudioBuffer, gainDb = -4) => {
    stopCurrent?.();
    const ctx = audioContext();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = dbGain(gainDb);
    src.buffer = buf;
    src.connect(g).connect(ctx.destination);
    src.onended = () => setPlaying((p) => (p === id ? null : p));
    src.start();
    stopCurrent = () => {
      try {
        src.stop();
      } catch {
        /* ya terminó */
      }
    };
    setPlaying(id);
  }, []);
  useEffect(() => () => stopCurrent?.(), []);
  return { playing, playBuffer, stop };
}

export type StudioSoundCue = { name: SfxName; at: number; gain: number };

/**
 * Sonidos y música en la vista previa del Estudio: al reproducir, programa cada sonido en su instante (tiempo del
 * video final) y la música desde el cabezal; al pausar o saltar, los corta. Volúmenes como en el render (la voz es el
 * audio del video).
 */
export function useStudioSound({ enabled, playing, time, cues, music, musicDb, duration }: { enabled: boolean; playing: boolean; time: number; cues: StudioSoundCue[]; music: { kind: "buffer"; buffer: AudioBuffer | null } | { kind: "url"; url: string } | null; musicDb: number; duration: number }): void {
  const live = useRef<{ stop: () => void } | null>(null);
  const timeRef = useRef(time);
  const lastTime = useRef(time);
  const musicRef = useRef(music);
  useEffect(() => {
    timeRef.current = time;
    musicRef.current = music;
  });
  const cuesKey = JSON.stringify(cues);
  const musicKey = music ? (music.kind === "url" ? music.url : music.buffer ? `${music.buffer.length}-${music.buffer.sampleRate}` : "pendiente") : "sin";

  // Un salto del cabezal mientras suena (más de medio segundo de diferencia) reprograma todo.
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (playing && Math.abs(time - lastTime.current) > 0.6) setEpoch((e) => e + 1);
    lastTime.current = time;
  }, [time, playing]);

  useEffect(() => {
    if (!enabled || !playing) return;
    const ctx = audioContext();
    if (!ctx) return;
    const from = timeRef.current;
    const music = musicRef.current;
    const t0 = ctx.currentTime + 0.05;
    const sources: AudioScheduledSourceNode[] = [];
    let audioEl: HTMLAudioElement | null = null;
    let alive = true;
    const list = JSON.parse(cuesKey) as StudioSoundCue[];
    for (const c of list) {
      if (c.at + 0.02 < from || c.at > duration) continue;
      void sfxBuffer(c.name).then((buf) => {
        if (!alive || !buf) return;
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        g.gain.value = dbGain(c.gain);
        src.buffer = buf;
        src.connect(g).connect(ctx.destination);
        src.start(Math.max(ctx.currentTime, t0 + (c.at - from)));
        sources.push(src);
      });
    }
    // Música: debajo de la voz (en el render además baja cuando hablas).
    const level = dbGain(musicDb + 2);
    if (music?.kind === "buffer" && music.buffer && from < music.buffer.duration) {
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = level;
      src.buffer = music.buffer;
      src.connect(g).connect(ctx.destination);
      src.start(t0, from);
      sources.push(src);
    } else if (music?.kind === "url") {
      audioEl = new Audio(music.url);
      audioEl.volume = Math.min(1, level * 1.5);
      audioEl.currentTime = from;
      void audioEl.play().catch(() => undefined);
    }
    live.current = {
      stop: () => {
        alive = false;
        for (const s of sources)
          try {
            s.stop();
          } catch {
            /* ya terminó */
          }
        audioEl?.pause();
      },
    };
    return () => {
      live.current?.stop();
      live.current = null;
    };
  }, [enabled, playing, cuesKey, musicKey, musicDb, duration, epoch]);
}
