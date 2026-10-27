/**
 * Generador de música propio (licencia nuestra): síntesis por software, sin muestras ni loops de terceros. Una pista es
 * su estilo, su semilla y su tempo; el mismo código arma el audio en la vista previa (navegador) y en el worker (Node,
 * empaquetado en worker/motion/music-engine.mjs), así suena igual en los dos.
 *
 * Cómo suena bien sin muestras: progresiones con acordes de 7.ª y 9.ª según el estilo, una forma (intro, A, B,
 * puente y salida) que crece y descansa, instrumentos con su envolvente (piano eléctrico FM, cuerdas pulsadas
 * Karplus-Strong, colchones con tablas de onda de banda limitada, campanas FM, bajo y 808), batería sintetizada con swing
 * o tresillos, reverb de sala en un envío, compresión por el bombo (sidechain) y un master con saturación suave.
 *
 * Mono (el video final mezcla en mono). Determinista: la misma pista da los mismos números.
 */
import type { MusicGenSpec, MusicStyle } from "./spec";

export const MUSIC_ENGINE_VERSION = 1;

// ─── Utilidades ────────────────────────────────────────────────────────────

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Tablas de onda de banda limitada (diente de sierra y cuadrada) para colchones, cuerdas y arpegios. */
const TABLE = 2048;
function makeTable(kind: "saw" | "square", harmonics: number): Float32Array {
  const t = new Float32Array(TABLE + 1);
  for (let h = 1; h <= harmonics; h++) {
    if (kind === "square" && h % 2 === 0) continue;
    const amp = 1 / h;
    for (let i = 0; i <= TABLE; i++) t[i]! += amp * Math.sin((TAU * h * i) / TABLE);
  }
  let max = 0;
  for (let i = 0; i <= TABLE; i++) max = Math.max(max, Math.abs(t[i]!));
  for (let i = 0; i <= TABLE; i++) t[i]! /= max;
  return t;
}
let tables: { saw: Float32Array; sawHi: Float32Array; square: Float32Array } | null = null;
function getTables() {
  if (!tables) tables = { saw: makeTable("saw", 40), sawHi: makeTable("saw", 12), square: makeTable("square", 25) };
  return tables;
}

// ─── El lienzo de audio ────────────────────────────────────────────────────

type Bus = Float32Array;
type Ctx = { sr: number; n: number; r: () => number; dry: Bus; send: Bus; drums: Bus; duck: Bus };

function addTone(buf: Bus, sr: number, start: number, dur: number, gen: (i: number, t: number) => number): void {
  const i0 = Math.max(0, Math.round(start * sr));
  const i1 = Math.min(buf.length, Math.round((start + dur) * sr));
  for (let i = i0; i < i1; i++) buf[i]! += gen(i - i0, (i - i0) / sr);
}

/** Envolvente ADSR simple en segundos (release después de `hold`). */
function adsr(t: number, a: number, d: number, s: number, hold: number, rel: number): number {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < hold) return s;
  const r = (t - hold) / rel;
  return r >= 1 ? 0 : s * (1 - r) * (1 - r);
}

// ─── Instrumentos ──────────────────────────────────────────────────────────

function kick(c: Ctx, t: number, vel = 1, deep = false): void {
  const len = deep ? 0.6 : 0.35;
  let ph = 0;
  addTone(c.drums, c.sr, t, len, (_i, x) => {
    const f = (deep ? 42 : 48) + (deep ? 120 : 110) * Math.exp(-x * 28);
    ph += (TAU * f) / c.sr;
    const click = x < 0.004 ? (1 - x / 0.004) * 0.4 : 0;
    return (Math.sin(ph) * Math.exp(-x * (deep ? 5 : 9)) + click) * 0.95 * vel;
  });
  // Envolvente para el sidechain.
  addTone(c.duck, c.sr, t, 0.32, (_i, x) => Math.exp(-x * 9) * vel);
}

function snare(c: Ctx, t: number, vel = 1, soft = false): void {
  let lp = 0;
  let ph = 0;
  addTone(c.drums, c.sr, t, 0.3, (_i, x) => {
    const n = c.r() * 2 - 1;
    lp += 0.35 * (n - lp);
    const hp = n - lp;
    ph += (TAU * 190) / c.sr;
    const body = Math.sin(ph) * Math.exp(-x * 30) * (soft ? 0.25 : 0.5);
    return (hp * Math.exp(-x * (soft ? 26 : 16)) * (soft ? 0.22 : 0.42) + body) * vel;
  });
}

function clap(c: Ctx, t: number, vel = 1): void {
  let lp = 0;
  addTone(c.drums, c.sr, t, 0.25, (_i, x) => {
    const n = c.r() * 2 - 1;
    lp += 0.25 * (n - lp);
    const bp = n - lp;
    const bursts = x < 0.03 ? Math.exp(-((x % 0.01) * 300)) : Math.exp(-(x - 0.03) * 18);
    return bp * bursts * 0.4 * vel;
  });
}

function hat(c: Ctx, t: number, vel = 1, open = false): void {
  let lp = 0;
  addTone(c.drums, c.sr, t, open ? 0.25 : 0.06, (_i, x) => {
    const n = c.r() * 2 - 1;
    lp += 0.6 * (n - lp);
    return (n - lp) * Math.exp(-x * (open ? 14 : 70)) * 0.16 * vel;
  });
}

function rim(c: Ctx, t: number, vel = 1): void {
  let ph = 0;
  addTone(c.drums, c.sr, t, 0.05, (_i, x) => {
    ph += (TAU * 1700) / c.sr;
    return Math.sin(ph) * Math.exp(-x * 90) * 0.35 * vel;
  });
}

function bigDrum(c: Ctx, t: number, vel = 1): void {
  let ph = 0;
  let lp = 0;
  addTone(c.drums, c.sr, t, 1.1, (_i, x) => {
    ph += (TAU * (55 + 40 * Math.exp(-x * 12))) / c.sr;
    const n = c.r() * 2 - 1;
    lp += 0.04 * (n - lp);
    return (Math.sin(ph) * Math.exp(-x * 3.5) + lp * 3 * Math.exp(-x * 6)) * 0.9 * vel;
  });
  addTone(c.duck, c.sr, t, 0.5, (_i, x) => Math.exp(-x * 6) * vel);
}

function bass(c: Ctx, t: number, f: number, dur: number, vel = 1, kind: "round" | "pluck" | "808" = "round"): void {
  let ph = 0;
  let lp = 0;
  const { saw } = getTables();
  const len = dur + (kind === "808" ? 0.25 : 0.08);
  addTone(c.dry, c.sr, t, len, (_i, x) => {
    const glide = kind === "808" ? f * (1 + 0.6 * Math.exp(-x * 30)) : f;
    ph += glide / c.sr;
    if (ph >= 1) ph -= 1;
    let s: number;
    if (kind === "808") {
      s = Math.tanh(Math.sin(ph * TAU) * 1.8) * 0.8;
      return s * adsr(x, 0.005, 0.1, 0.85, dur, 0.25) * vel * 0.9;
    }
    const v = saw[Math.floor(ph * TABLE)]!;
    const cut = kind === "pluck" ? 0.05 + 0.25 * Math.exp(-x * 9) : 0.06;
    lp += cut * (v - lp);
    s = lp * 0.8 + Math.sin(ph * TAU) * 0.6;
    return s * adsr(x, 0.006, 0.12, 0.75, dur, 0.08) * vel * 0.7;
  });
}

/** Piano eléctrico FM (tine): ataque brillante que se apaga en un tono redondo. */
function epiano(c: Ctx, t: number, f: number, dur: number, vel = 1, bus: Bus = c.dry): void {
  let pc = 0;
  let pm = 0;
  const len = Math.min(dur + 0.6, 3.5);
  addTone(bus, c.sr, t, len, (_i, x) => {
    pm += (f * 1.0) / c.sr;
    pc += f / c.sr;
    const idx = 1.6 * Math.exp(-x * 4) + 0.3;
    const tine = Math.sin(TAU * pm * 14) * Math.exp(-x * 30) * 0.08;
    const s = Math.sin(TAU * pc + idx * Math.sin(TAU * pm)) + tine;
    const env = Math.exp(-x * 1.4) * (x > dur ? Math.exp(-(x - dur) * 8) : 1) * Math.min(1, x / 0.003);
    return s * env * 0.22 * vel;
  });
}

/** Colchón: tres dientes de sierra un poco desafinados con un pasabajos que respira. */
function pad(c: Ctx, t: number, f: number, dur: number, vel = 1, bright = 0.06, attack = 0.6): void {
  const { saw } = getTables();
  const ph = [c.r(), c.r(), c.r()];
  const det = [1, 1.0045, 0.9962];
  let lp1 = 0;
  let lp2 = 0;
  addTone(c.send, c.sr, t, dur + 1.2, (_i, x) => {
    let s = 0;
    for (let k = 0; k < 3; k++) {
      ph[k]! += (f * det[k]!) / c.sr;
      if (ph[k]! >= 1) ph[k]! -= 1;
      s += saw[Math.floor(ph[k]! * TABLE)]!;
    }
    const cut = bright * (1 + 0.35 * Math.sin(x * 0.9));
    lp1 += cut * (s - lp1);
    lp2 += cut * (lp1 - lp2);
    return lp2 * adsr(x, attack, 0.5, 0.8, dur, 1.1) * 0.09 * vel;
  });
}

/** Cuerdas: colchón con vibrato y ataque de arco. */
function strings(c: Ctx, t: number, f: number, dur: number, vel = 1): void {
  const { saw } = getTables();
  const ph = [c.r(), c.r(), c.r(), c.r()];
  const det = [1, 1.003, 0.997, 2.001];
  let lp = 0;
  let lp2 = 0;
  addTone(c.send, c.sr, t, dur + 0.9, (_i, x) => {
    const vib = 1 + 0.004 * Math.sin(TAU * 5.2 * x) * Math.min(1, x / 0.6);
    let s = 0;
    for (let k = 0; k < 4; k++) {
      ph[k]! += (f * det[k]! * vib) / c.sr;
      if (ph[k]! >= 1) ph[k]! -= 1;
      s += saw[Math.floor(ph[k]! * TABLE)]! * (k === 3 ? 0.35 : 1);
    }
    lp += 0.08 * (s - lp);
    lp2 += 0.08 * (lp - lp2);
    return lp2 * adsr(x, 0.35, 0.3, 0.85, dur, 0.8) * 0.085 * vel;
  });
}

/** Metales sintetizados: diente de sierra con filtro que se abre. */
function brass(c: Ctx, t: number, f: number, dur: number, vel = 1): void {
  const { sawHi } = getTables();
  let ph = 0;
  let ph2 = 0.3;
  let lp = 0;
  addTone(c.send, c.sr, t, dur + 0.4, (_i, x) => {
    ph += f / c.sr;
    ph2 += (f * 1.006) / c.sr;
    if (ph >= 1) ph -= 1;
    if (ph2 >= 1) ph2 -= 1;
    const s = sawHi[Math.floor(ph * TABLE)]! + sawHi[Math.floor(ph2 * TABLE)]!;
    const cut = 0.03 + 0.12 * Math.min(1, x / 0.15) * Math.exp(-Math.max(0, x - 0.15) * 1.5);
    lp += cut * (s - lp);
    return lp * adsr(x, 0.06, 0.2, 0.75, dur, 0.3) * 0.14 * vel;
  });
}

/** Cuerda pulsada (Karplus-Strong): guitarra acústica y pulsos de los motivacionales. */
function pluck(c: Ctx, t: number, f: number, dur: number, vel = 1, bright = 0.5, bus: Bus = c.dry): void {
  const period = Math.max(2, Math.round(c.sr / f));
  const buf = new Float32Array(period);
  let lpi = 0;
  for (let i = 0; i < period; i++) {
    const n = c.r() * 2 - 1;
    lpi += bright * (n - lpi);
    buf[i] = lpi;
  }
  const damp = 0.996 - (1 - bright) * 0.004;
  let j = 0;
  const len = Math.min(dur + 0.4, 2.8);
  addTone(bus, c.sr, t, len, (_i, x) => {
    const out = buf[j]!;
    const nx = buf[(j + 1) % period]!;
    buf[j] = damp * 0.5 * (out + nx);
    j = (j + 1) % period;
    return out * 0.45 * vel * (x > dur ? Math.exp(-(x - dur) * 10) : 1);
  });
}

/** Campana FM (razón inarmónica) para arpegios de trap, ambiente y destellos. */
function bell(c: Ctx, t: number, f: number, vel = 1, decay = 1.2, bus: Bus = c.send): void {
  let pc = 0;
  let pm = 0;
  addTone(bus, c.sr, t, decay * 2.4, (_i, x) => {
    pc += f / c.sr;
    pm += (f * 3.5) / c.sr;
    const idx = 2.2 * Math.exp(-x * 3);
    return Math.sin(TAU * pc + idx * Math.sin(TAU * pm)) * Math.exp(-x / decay) * Math.min(1, x / 0.002) * 0.16 * vel;
  });
}

/** Arpegio de sintetizador (cuadrada con filtro que se cierra). */
function synthNote(c: Ctx, t: number, f: number, dur: number, vel = 1): void {
  const { square } = getTables();
  let ph = 0;
  let lp = 0;
  addTone(c.dry, c.sr, t, dur + 0.05, (_i, x) => {
    ph += f / c.sr;
    if (ph >= 1) ph -= 1;
    const cut = 0.04 + 0.3 * Math.exp(-x * 18);
    lp += cut * (square[Math.floor(ph * TABLE)]! - lp);
    return lp * adsr(x, 0.003, 0.08, 0.4, dur, 0.04) * 0.13 * vel;
  });
}

function riser(c: Ctx, t: number, dur: number, vel = 1): void {
  let lp = 0;
  addTone(c.send, c.sr, t, dur, (_i, x) => {
    const p = x / dur;
    const n = c.r() * 2 - 1;
    lp += (0.02 + 0.5 * p * p) * (n - lp);
    return lp * p * p * 0.22 * vel;
  });
}

function crackle(c: Ctx, amount: number): void {
  let lp = 0;
  for (let i = 0; i < c.n; i++) {
    const n = c.r() * 2 - 1;
    lp += 0.05 * (n - lp);
    let s = lp * 0.02 * amount;
    if (c.r() < 0.00012 * amount) s += (c.r() - 0.5) * 0.5 * amount;
    c.dry[i]! += s;
  }
}

// ─── Armonía ───────────────────────────────────────────────────────────────

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Acorde por grado de la escala (en semitonos desde la tónica), con 7.ª y 9.ª opcionales. */
function chord(scale: number[], degree: number, extra: 0 | 7 | 9): number[] {
  const at = (k: number) => {
    const d = degree + k;
    return scale[((d % 7) + 7) % 7]! + 12 * Math.floor(d / 7);
  };
  const notes = [at(0), at(2), at(4)];
  if (extra >= 7) notes.push(at(6));
  if (extra === 9) notes.push(at(8));
  return notes;
}

type StyleDef = {
  scale: number[];
  progressions: number[][];
  extra: 0 | 7 | 9;
  /** Compases por acorde. */
  barsPerChord: number;
};

const STYLES: Record<MusicStyle, StyleDef> = {
  lofi: { scale: MAJOR, progressions: [[1, 4, 0, 5], [3, 4, 2, 5], [1, 4, 2, 5], [5, 3, 1, 4]], extra: 9, barsPerChord: 1 },
  corporativo: { scale: MAJOR, progressions: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 3, 5, 4], [3, 0, 4, 5]], extra: 0, barsPerChord: 1 },
  trap: { scale: MINOR, progressions: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 5, 3, 4], [5, 3, 0, 6]], extra: 7, barsPerChord: 1 },
  ambiente: { scale: MAJOR, progressions: [[0, 3], [0, 5, 3, 4], [3, 0], [5, 3]], extra: 9, barsPerChord: 2 },
  acustico: { scale: MAJOR, progressions: [[0, 3, 5, 4], [0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4]], extra: 0, barsPerChord: 1 },
  tension: { scale: MINOR, progressions: [[0, 0, 5, 6], [0, 1, 0, 6], [0, 5, 0, 4], [0, 3, 5, 6]], extra: 7, barsPerChord: 1 },
  epica: { scale: MINOR, progressions: [[0, 5, 2, 6], [0, 3, 6, 5], [5, 2, 6, 0], [0, 6, 5, 6]], extra: 0, barsPerChord: 1 },
};

/** Sección de cada compás: intro, A, B (llena), puente (baja) y salida. */
export type Section = "intro" | "a" | "b" | "puente" | "salida";
export function sectionOf(bar: number, totalBars: number): Section {
  // En pistas cortas (reels de 15 s) la intro y la salida duran un compás: entra enseguida.
  const edge = totalBars < 12 ? 1 : 2;
  if (bar < edge) return "intro";
  if (bar >= totalBars - edge && totalBars > 3) return "salida";
  const k = Math.floor((bar - edge) / 8) % 4;
  return k === 0 ? "a" : k === 1 ? "b" : k === 2 ? "puente" : "b";
}

// ─── Render ────────────────────────────────────────────────────────────────

export type RenderOptions = { seconds: number; sampleRate?: number };

/** Arma la pista entera (Float32Array mono, entre -1 y 1). */
export function renderMusic(spec: Pick<MusicGenSpec, "style" | "seed" | "bpm">, opts: RenderOptions): Float32Array {
  const gen = renderMusicSteps(spec, opts);
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

/**
 * Lo mismo en pasos (un compás por paso, después la reverb y el master): el navegador lo corre de a poco sin trabar
 * la página. Devuelve el avance (0 a 1) en cada paso y el audio al final.
 */
export function* renderMusicSteps(spec: Pick<MusicGenSpec, "style" | "seed" | "bpm">, opts: RenderOptions): Generator<number, Float32Array, void> {
  const sr = opts.sampleRate ?? 48000;
  const seconds = Math.max(2, Math.min(600, opts.seconds));
  const n = Math.round(seconds * sr);
  const r = rng(spec.seed * 7919 + spec.style.length * 101 + 17);
  const c: Ctx = { sr, n, r, dry: new Float32Array(n), send: new Float32Array(n), drums: new Float32Array(n), duck: new Float32Array(n) };
  const style = STYLES[spec.style];
  const bpm = Math.max(50, Math.min(180, spec.bpm));
  const beat = 60 / bpm;
  const bar = beat * 4;
  const totalBars = Math.ceil(seconds / bar);
  const root = 48 + [0, 2, 3, 5, 7, 8, 9, 10][Math.floor(r() * 8)]!;
  const prog = style.progressions[Math.floor(r() * style.progressions.length)]!;
  const swing = spec.style === "lofi" ? 0.62 : spec.style === "acustico" ? 0.56 : 0.5;
  /** Corchea `eighth` del compás, con swing (la de contratiempo llega un poco tarde). */
  const sw = (b: number, eighth: number) => b * beat + (eighth % 2 ? swing * beat : 0);
  // Motivo de la melodía: 8 corcheas con grados del acorde y pasos de la escala (se repite con variaciones).
  const motif: (number | null)[] = Array.from({ length: 8 }, (_, i) => (r() < (i % 2 ? 0.45 : 0.75) ? Math.floor(r() * 5) : null));
  const scaleNote = (deg: number) => style.scale[((deg % 7) + 7) % 7]! + 12 * Math.floor(deg / 7);

  for (let b = 0; b < totalBars; b++) {
    const t0 = b * bar;
    const sec = sectionOf(b, totalBars);
    const full = sec === "b";
    const quiet = sec === "intro" || sec === "puente" || sec === "salida";
    const degree = prog[Math.floor(b / style.barsPerChord) % prog.length]!;
    const ch = chord(style.scale, degree, style.extra).map((x) => x + root);
    const bassNote = midiHz(root - 12 + style.scale[degree % 7]! + (spec.style === "trap" || spec.style === "tension" ? -12 : 0));
    const newChord = b % style.barsPerChord === 0;
    const vary = r();

    switch (spec.style) {
      case "lofi": {
        if (newChord) {
          // Acorde de piano eléctrico, arpegiado apenas (como tocado a mano).
          ch.forEach((m, i) => epiano(c, t0 + i * 0.018, midiHz(m + 12), bar * 0.95, 0.8 - i * 0.05, c.send));
          if (b % 2 === 1) epiano(c, t0 + beat * 2.5, midiHz(ch[ch.length - 1]! + 12), beat, 0.5, c.send);
        }
        if (!quiet || sec === "puente") bass(c, t0, bassNote, beat * 1.6, 0.9, "round");
        if (!quiet) bass(c, t0 + beat * 2.5, bassNote * (vary < 0.5 ? 1 : 1.5), beat, 0.7, "round");
        if (sec !== "intro" && sec !== "salida") {
          kick(c, t0, 0.8);
          if (vary < 0.6) kick(c, t0 + sw(2, 5), 0.6);
          snare(c, t0 + beat, 0.55, true);
          snare(c, t0 + beat * 3, 0.55, true);
          if (vary > 0.7) rim(c, t0 + sw(3, 7), 0.6);
          for (let e = 0; e < 8; e++) hat(c, t0 + sw(Math.floor(e / 2), e), e % 2 ? 0.35 : 0.55);
        }
        if (full)
          motif.forEach((d, i) => {
            if (d == null || r() < 0.35) return;
            epiano(c, t0 + sw(Math.floor(i / 2), i), midiHz(root + 24 + scaleNote(degree + d)), beat * 0.7, 0.45, c.send);
          });
        break;
      }
      case "corporativo": {
        // Piano en corcheas y guitarra limpia: el pulso que "empuja".
        for (let e = 0; e < 8; e++) {
          const m = ch[e % ch.length]!;
          if (!(sec === "intro" && e % 2)) epiano(c, t0 + e * beat * 0.5, midiHz(m + 12), beat * 0.45, e % 2 ? 0.45 : 0.6);
        }
        if (!quiet) for (let e = 0; e < 8; e++) pluck(c, t0 + e * beat * 0.5 + 0.01, midiHz(ch[(e + 1) % ch.length]! + 24), beat * 0.4, 0.35, 0.7, c.send);
        if (sec !== "intro") {
          bass(c, t0, bassNote, beat * 0.9, 0.9, "pluck");
          bass(c, t0 + beat, bassNote, beat * 0.9, 0.8, "pluck");
          bass(c, t0 + beat * 2, bassNote, beat * 0.9, 0.85, "pluck");
          bass(c, t0 + beat * 3, bassNote * (vary < 0.5 ? 1 : 1.5), beat * 0.9, 0.8, "pluck");
          for (let q = 0; q < 4; q++) kick(c, t0 + q * beat, sec === "puente" ? 0.5 : 0.85);
          if (!quiet) {
            clap(c, t0 + beat, 0.7);
            clap(c, t0 + beat * 3, 0.7);
          }
          for (let e = 0; e < 8; e++) hat(c, t0 + e * beat * 0.5 + beat * 0.25, 0.4, e % 4 === 3);
        }
        if (newChord) pad(c, t0, midiHz(ch[0]!), bar, 0.7, 0.05, 0.3);
        if (full)
          motif.forEach((d, i) => {
            if (d == null) return;
            bell(c, t0 + (i * beat) / 2, midiHz(root + 24 + scaleNote(degree + d)), 0.55, 0.6);
          });
        if (sec === "a" && (b - 2) % 8 === 7) riser(c, t0, bar, 0.8);
        break;
      }
      case "trap": {
        if (newChord) {
          pad(c, t0, midiHz(ch[0]!), bar, 0.6, 0.035, 0.4);
          pad(c, t0, midiHz(ch[2]!), bar, 0.5, 0.035, 0.4);
        }
        // Arpegio de campanas oscuro en semicorcheas.
        for (let s16 = 0; s16 < 16; s16 += sec === "intro" ? 2 : 1) {
          if (s16 % 3 === 2 && vary < 0.5) continue;
          bell(c, t0 + s16 * beat * 0.25, midiHz(ch[s16 % ch.length]! + 24), 0.38, 0.35, c.send);
        }
        if (sec !== "intro") {
          bass(c, t0, bassNote, beat * 1.4, 1, "808");
          bass(c, t0 + beat * 1.75, bassNote, beat * 0.6, 0.8, "808");
          if (vary < 0.5) bass(c, t0 + beat * 3, bassNote * 1.5, beat * 0.8, 0.8, "808");
          kick(c, t0, 0.9);
          kick(c, t0 + beat * 1.75, 0.6);
          clap(c, t0 + beat * 2, 0.8);
          snare(c, t0 + beat * 2, 0.4, true);
          // Hi-hats en corcheas con redobles en tresillos.
          for (let e = 0; e < 8; e++) {
            const roll = !quiet && (e === 7 || (e === 3 && vary > 0.6));
            if (roll) for (let k = 0; k < 3; k++) hat(c, t0 + e * beat * 0.5 + (k * beat * 0.5) / 3, 0.45);
            else hat(c, t0 + e * beat * 0.5, e % 2 ? 0.35 : 0.55);
          }
        }
        break;
      }
      case "ambiente": {
        if (newChord) {
          ch.forEach((m, i) => pad(c, t0 + i * 0.05, midiHz(m + (i ? 0 : -12)), bar * style.barsPerChord, 0.75, 0.025, 2.2));
          pad(c, t0, midiHz(ch[1]! + 12), bar * style.barsPerChord, 0.35, 0.02, 3);
        }
        // Campanas lejanas sueltas.
        for (let q = 0; q < 4; q++) if (r() < (full ? 0.45 : 0.25)) bell(c, t0 + q * beat + r() * 0.2, midiHz(root + 24 + scaleNote(degree + Math.floor(r() * 6))), 0.35, 1.6);
        if (!quiet && b % 2 === 0) bass(c, t0, bassNote, bar * 1.8, 0.4, "round");
        break;
      }
      case "acustico": {
        // Rasgueo con cuerdas pulsadas: abajo en los tiempos, arriba en los contratiempos.
        const voicing = [ch[0]! - 12, ...ch, ch[0]! + 12];
        const pattern = [0, 2, 3, 5, 6, 7];
        for (const e of pattern) {
          if (sec === "intro" && e > 3) continue;
          const up = e % 2 === 1;
          const notes = up ? [...voicing].reverse().slice(0, 3) : voicing;
          notes.forEach((m, k) => pluck(c, t0 + sw(Math.floor(e / 2), e) + k * 0.009, midiHz(m + 12), beat * 0.9, up ? 0.28 : 0.4, up ? 0.8 : 0.55));
        }
        if (sec !== "intro") {
          bass(c, t0, bassNote, beat * 1.8, 0.8, "round");
          bass(c, t0 + beat * 2, bassNote * 1.5, beat * 1.8, 0.7, "round");
          kick(c, t0, 0.5);
          kick(c, t0 + beat * 2, 0.45);
          if (!quiet) {
            clap(c, t0 + beat, 0.55);
            clap(c, t0 + beat * 3, 0.55);
          }
          for (let e = 0; e < 8; e++) hat(c, t0 + sw(Math.floor(e / 2), e), e % 2 ? 0.22 : 0.3);
        }
        if (full)
          motif.forEach((d, i) => {
            if (d == null || r() < 0.3) return;
            pluck(c, t0 + sw(Math.floor(i / 2), i), midiHz(root + 24 + scaleNote(degree + d)), beat * 0.8, 0.4, 0.9, c.send);
          });
        break;
      }
      case "tension": {
        // Arpegio en semicorcheas que no para; el bajo pulsa en corcheas.
        const arp = [ch[0]!, ch[2]!, ch[1]! + 12, ch[2]!, ch[0]! + 12, ch[2]!, ch[1]!, ch[3] ?? ch[2]! + 5];
        for (let s16 = 0; s16 < 16; s16++) synthNote(c, t0 + s16 * beat * 0.25, midiHz(arp[s16 % arp.length]! + 12), beat * 0.2, s16 % 4 === 0 ? 0.9 : 0.6);
        if (sec !== "intro") for (let e = 0; e < 8; e++) bass(c, t0 + e * beat * 0.5, bassNote * 2, beat * 0.4, 0.7, "pluck");
        if (!quiet) {
          for (let q = 0; q < 4; q++) kick(c, t0 + q * beat, 0.8);
          for (let e = 0; e < 8; e++) hat(c, t0 + e * beat * 0.5 + beat * 0.25, 0.35);
          if (b % 2 === 1) snare(c, t0 + beat * 3, 0.5);
        }
        if (newChord) pad(c, t0, midiHz(ch[0]! - 12), bar, 0.6, 0.02, 1.5);
        if ((b - 2) % 8 === 7) riser(c, t0, bar, 1);
        if (sec === "b" && (b - 2) % 8 === 0) bigDrum(c, t0, 0.7);
        break;
      }
      case "epica": {
        if (newChord) {
          ch.forEach((m) => strings(c, t0, midiHz(m), bar, 0.8));
          strings(c, t0, midiHz(ch[0]! - 12), bar, 0.7);
        }
        if (sec !== "intro") {
          bigDrum(c, t0, 0.9);
          if (!quiet) {
            bigDrum(c, t0 + beat * 1.5, 0.6);
            bigDrum(c, t0 + beat * 2, 0.8);
            if (full) for (let e = 0; e < 8; e++) snare(c, t0 + e * beat * 0.5, e % 2 ? 0.1 : 0.16, true);
          }
          bass(c, t0, bassNote, bar * 0.95, 0.8, "round");
        }
        if (full) {
          // Melodía de metales en blancas y negras.
          [0, 2, 3].forEach((q, i) => {
            const d = motif[i * 2] ?? i;
            brass(c, t0 + q * beat, midiHz(root + 12 + scaleNote(degree + d)), beat * (i === 0 ? 2 : 1) * 0.95, 0.85);
          });
        }
        if ((b - 2) % 8 === 7) riser(c, t0, bar, 0.9);
        break;
      }
    }
    yield (b + 1) / totalBars * 0.8;
  }

  if (spec.style === "lofi") crackle(c, 1);

  // Reverb de sala (Schroeder: cuatro peines y dos pasatodos) sobre el envío.
  const wet = schroeder(c.send, sr, spec.style === "ambiente" || spec.style === "epica" ? 0.86 : 0.78);
  yield 0.9;

  // Sidechain: lo armónico baja cuando pega el bombo (más en trap, motivacional y tensa).
  const depth = spec.style === "trap" || spec.style === "tension" || spec.style === "corporativo" ? 0.55 : spec.style === "epica" ? 0.35 : 0.2;
  const out = new Float32Array(n);
  const sendMix = spec.style === "ambiente" ? 1.0 : 0.8;
  // La batería acompaña (es música de fondo para una voz): más baja en lo acústico y en lo épico.
  const drumGain = { lofi: 0.6, corporativo: 0.6, trap: 0.75, ambiente: 0.5, acustico: 0.45, tension: 0.6, epica: 0.55 }[spec.style];
  let lpState = 0;
  const masterLp = spec.style === "lofi" ? 0.32 : 1;
  for (let i = 0; i < n; i++) {
    const duck = 1 - depth * Math.min(1, c.duck[i]!);
    let s = (c.dry[i]! * 1.0 + c.send[i]! * sendMix + wet[i]! * 0.55) * duck + c.drums[i]! * drumGain;
    if (masterLp < 1) {
      lpState += masterLp * (s - lpState);
      s = lpState;
    }
    out[i] = s;
  }
  master(out, sr, seconds);
  yield 1;
  return out;
}

function schroeder(input: Float32Array, sr: number, feedback: number): Float32Array {
  const n = input.length;
  const out = new Float32Array(n);
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round((d * sr) / 44100));
  for (const d of combs) {
    const buf = new Float32Array(d);
    let j = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const y = buf[j]!;
      lp = y * 0.6 + lp * 0.4;
      buf[j] = input[i]! + lp * feedback;
      out[i]! += y * 0.25;
      j = (j + 1) % d;
    }
  }
  for (const d of [225, 556].map((x) => Math.round((x * sr) / 44100))) {
    const buf = new Float32Array(d);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const b = buf[j]!;
      const x = out[i]!;
      const y = -x + b;
      buf[j] = x + b * 0.5;
      out[i] = y;
      j = (j + 1) % d;
    }
  }
  return out;
}

/** Nivel del cuerpo de la pista: el RMS de la ventana de 1 s en el percentil 75 (la intro y la salida no cuentan). */
export function bodyRms(y: Float32Array, sr: number): number {
  const win = Math.max(1, Math.round(sr));
  const vals: number[] = [];
  for (let i = 0; i + win <= y.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += y[j]! * y[j]!;
    vals.push(s / win);
  }
  if (!vals.length) {
    let s = 0;
    for (const v of y) s += v * v;
    return Math.sqrt(s / Math.max(1, y.length));
  }
  vals.sort((a, b) => a - b);
  return Math.sqrt(vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.75))]!);
}

/** Master: saturación suave, nivel parejo (cuerpo a -16 dBFS RMS), pico bajo -1 dBFS y fundido de salida. */
function master(out: Float32Array, sr: number, seconds: number): void {
  const n = out.length;
  const rms = bodyRms(out, sr) || 1e-6;
  const pre = 0.18 / rms;
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i]! * pre * 1.3) / 1.3;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const target = 10 ** (-16 / 20);
  let g = target / (bodyRms(out, sr) || 1e-6);
  if (peak * g > 0.89) g = 0.89 / peak;
  const fadeIn = Math.round(0.02 * sr);
  const fadeOut = Math.round(Math.min(1.5, seconds / 6) * sr);
  for (let i = 0; i < n; i++) {
    let k = g;
    if (i < fadeIn) k *= i / fadeIn;
    if (i > n - fadeOut) k *= (n - i) / fadeOut;
    out[i] = out[i]! * k;
  }
}

/** WAV de 16 bits mono (para el worker y para descargar). */
export function toWav(samples: Float32Array, sr: number): Uint8Array {
  const data = samples.length * 2;
  const buf = new Uint8Array(44 + data);
  const v = new DataView(buf.buffer);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), true);
  return buf;
}
