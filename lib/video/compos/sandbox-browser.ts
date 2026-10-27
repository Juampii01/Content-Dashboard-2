/**
 * Lado del hilo principal del sandbox del navegador: un Web Worker (/compos-sandbox.js) por composición, con reloj.
 * Si un cuadro tarda más de lo permitido, se mata el worker y la composición queda marcada como rota (se ve el video
 * tal cual con un aviso). Los cuadros se guardan en caché por instante (la vista previa vuelve a pedir los mismos).
 */
import type { ComposEnvData, ComposFrame } from "./contract";

const FRAME_TIMEOUT_MS = 1200;
const OPEN_TIMEOUT_MS = 4000;
const CACHE_FRAMES = 240;
const MAX_LIVE = 4;

type Reply = { id: number; ok: boolean; out?: string; params?: string; error?: string };

export type BrowserCompos = {
  /** Estado: cargando, lista o rota (con el motivo). */
  status: "loading" | "ready" | "broken";
  error: string | null;
  defaults: Record<string, string>;
};

class Box {
  worker: Worker | null = null;
  status: BrowserCompos["status"] = "loading";
  error: string | null = null;
  defaults: Record<string, string> = {};
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  private cache = new Map<number, ComposFrame>();
  private inflight = new Map<number, Promise<ComposFrame | null>>();
  readonly opened: Promise<void>;
  lastUse = Date.now();

  constructor(
    code: string,
    env: ComposEnvData,
    private onChange: () => void,
  ) {
    this.opened = this.open(code, env);
  }

  private fail(error: string) {
    this.status = "broken";
    this.error = error;
    this.kill();
    this.onChange();
  }

  private kill() {
    this.worker?.terminate();
    this.worker = null;
    for (const [, w] of this.waiting) {
      clearTimeout(w.timer);
      w.resolve({ id: -1, ok: false, error: "cerrado" });
    }
    this.waiting.clear();
  }

  private call(msg: Record<string, unknown>, ms: number): Promise<Reply> {
    const w = this.worker;
    if (!w) return Promise.resolve({ id: -1, ok: false, error: this.error ?? "cerrado" });
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve({ id, ok: false, error: "timeout" });
        this.fail("La animación tardó demasiado en dibujar un cuadro y se detuvo.");
      }, ms);
      this.waiting.set(id, { resolve, timer });
      w.postMessage({ ...msg, id });
    });
  }

  private async open(code: string, env: ComposEnvData): Promise<void> {
    try {
      this.worker = new Worker("/compos-sandbox.js", { name: "composicion" });
    } catch {
      this.fail("Este navegador no puede mostrar la animación (Web Workers apagados).");
      return;
    }
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data;
      if (!r || typeof r.id !== "number") return;
      const w = this.waiting.get(r.id);
      if (!w) return;
      clearTimeout(w.timer);
      this.waiting.delete(r.id);
      w.resolve(r);
    };
    this.worker.onerror = () => this.fail("La animación no se pudo cargar.");
    const r = await this.call({ type: "open", code, env: JSON.stringify(env) }, OPEN_TIMEOUT_MS);
    if (this.status === "broken") return;
    if (!r.ok) {
      this.fail(r.error ? `La animación tiene un error: ${r.error}` : "La animación no se pudo cargar.");
      return;
    }
    try {
      this.defaults = JSON.parse(r.params ?? "{}");
    } catch {}
    this.status = "ready";
    this.onChange();
  }

  cached(index: number): ComposFrame | null {
    return this.cache.get(index) ?? null;
  }

  /** El cuadro `index` (a 30 por segundo). */
  frame(index: number, t: number): Promise<ComposFrame | null> {
    this.lastUse = Date.now();
    const hit = this.cache.get(index);
    if (hit) return Promise.resolve(hit);
    const going = this.inflight.get(index);
    if (going) return going;
    const p = (async () => {
      await this.opened;
      if (this.status !== "ready") return null;
      const r = await this.call({ type: "frame", t }, FRAME_TIMEOUT_MS);
      if (!r.ok || !r.out) return null;
      let parsed: { ok: boolean; frame?: ComposFrame; error?: string };
      try {
        parsed = JSON.parse(r.out);
      } catch {
        return null;
      }
      if (!parsed.ok || !parsed.frame) {
        this.fail(`La animación tiene un error: ${String(parsed.error ?? "").slice(0, 200)}`);
        return null;
      }
      if (this.cache.size >= CACHE_FRAMES) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(index, parsed.frame);
      return parsed.frame;
    })().finally(() => this.inflight.delete(index));
    this.inflight.set(index, p);
    return p;
  }

  close() {
    this.kill();
  }
}

/** Sandboxes vivos por clave (código + datos). Se cierran los que no se usan si hay más de MAX_LIVE. */
const boxes = new Map<string, Box>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribeCompos(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function composBox(key: string, code: string, env: ComposEnvData): Box {
  let b = boxes.get(key);
  if (!b) {
    b = new Box(code, env, notify);
    boxes.set(key, b);
    if (boxes.size > MAX_LIVE) {
      const old = [...boxes.entries()].filter(([k]) => k !== key).sort((x, y) => x[1].lastUse - y[1].lastUse)[0];
      if (old) {
        old[1].close();
        boxes.delete(old[0]);
      }
    }
  }
  return b;
}

/** Clave estable de una composición (cambia si cambia el código o algo de sus datos). */
export function composKey(code: string, env: ComposEnvData): string {
  const s = `${code}\u0000${JSON.stringify(env)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return `${h.toString(36)}-${s.length}`;
}
