/**
 * Sandbox del navegador: un Web Worker por composición, servido como /compos-sandbox.js con su propia CSP
 * (`default-src 'none'; script-src 'unsafe-eval'`: sin red, sin importScripts, sin nada de afuera). Se empaqueta con
 * scripts/motion-bundle.mjs en public/compos-sandbox.js.
 *
 * Antes de correr el código generado se cierran las puertas del global del worker (red, mensajes, almacenamiento,
 * temporizadores) y se revisa el código igual que en el servidor. El hilo principal no confía en lo que devuelve:
 * la lista de dibujo se vuelve a validar al dibujarla (lib/video/compos/replay.ts) y un cuadro que tarda se corta
 * matando el worker (lib/video/compos/sandbox-browser.ts).
 */
import { RUNTIME_SOURCE } from "./runtime-source";
import { checkStatic, moduleScript } from "./static";

type Msg = { type: "open"; id: number; code: string; env: string } | { type: "frame"; id: number; t: number };

const scope = globalThis as unknown as Record<string, unknown>;
const post = (scope.postMessage as (m: unknown) => void).bind(globalThis);
const listen = (scope.addEventListener as (t: string, fn: (e: { data: Msg }) => void) => void).bind(globalThis);
const compile = Function;

const CLOSE = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebTransport",
  "EventSource",
  "importScripts",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "MessageChannel",
  "indexedDB",
  "caches",
  "navigator",
  "location",
  "Request",
  "Response",
  "Headers",
  "FileReader",
  "FileReaderSync",
  "Blob",
  "URL",
  "OffscreenCanvas",
  "ImageBitmap",
  "createImageBitmap",
  "Notification",
  "postMessage",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "onmessage",
  "close",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "WebAssembly",
  "SharedArrayBuffer",
  "Atomics",
  "performance",
  "crypto",
  "Date",
];

function lockdown() {
  const targets: object[] = [globalThis];
  let proto = Object.getPrototypeOf(globalThis) as object | null;
  while (proto && proto !== Object.prototype) {
    targets.push(proto);
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  for (const t of targets) {
    for (const name of CLOSE) {
      try {
        Object.defineProperty(t, name, { value: undefined, writable: false, configurable: false });
      } catch {
        try {
          (t as Record<string, unknown>)[name] = undefined;
        } catch {}
      }
    }
  }
}

let ready = false;
let api: { setup(json: string): void; frame(t: number): string; defaults(): string } | null = null;

function errText(e: unknown): string {
  try {
    return String((e as { message?: unknown })?.message ?? e).slice(0, 400);
  } catch {
    return "error";
  }
}

listen("message", (ev) => {
  const m = ev.data;
  if (!m || typeof m !== "object") return;
  if (m.type === "open") {
    if (ready) return post({ id: m.id, ok: false, error: "Este sandbox ya tiene una composición." });
    ready = true;
    const st = checkStatic(String(m.code));
    if (!st.ok) return post({ id: m.id, ok: false, error: st.issues.map((i) => i.message).join(" · ") });
    try {
      compile(RUNTIME_SOURCE)();
      api = scope.__compos as typeof api;
      api!.setup(String(m.env));
      lockdown();
      compile(moduleScript(st.body))();
      post({ id: m.id, ok: true, params: api!.defaults() });
    } catch (e) {
      post({ id: m.id, ok: false, error: errText(e) });
    }
    return;
  }
  if (m.type === "frame") {
    if (!api) return post({ id: m.id, ok: false, error: "La composición no se cargó." });
    try {
      post({ id: m.id, ok: true, out: api.frame(Number(m.t)) });
    } catch (e) {
      post({ id: m.id, ok: false, error: errText(e) });
    }
  }
});
