/**
 * Sandbox de Node para las composiciones (validación en la app y render en el worker).
 *
 * Aislamiento en capas:
 * 1. Un hilo aparte (worker_threads) con memoria acotada: si el código se come la memoria, muere el hilo, no el proceso.
 * 2. Dentro del hilo, un contexto de node:vm vacío (`Object.create(null)`) sin generación de código
 *    (`codeGeneration: { strings: false, wasm: false }`): ni eval ni Function, aunque llegue a ellos.
 * 3. Al contexto no entra ningún objeto de afuera: los datos van como texto JSON y la lista de dibujo vuelve como
 *    texto JSON. Sin objetos del host no hay cadena de prototipos por la que escaparse a `process`.
 * 4. Tiempo límite por cuadro (el de vm corta bucles infinitos) y un reloj desde afuera que mata el hilo si no responde.
 */
import { Worker } from "node:worker_threads";
import { COMPOS_LIMITS, type ComposEnvData, type ComposFrame, type ComposFrameResult } from "./contract";
import { RUNTIME_SOURCE } from "./runtime-source";
import { checkStatic, moduleScript, sourceLine } from "./static";

const THREAD = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
let ctx = null;
function run(code, timeout, filename) {
  return new vm.Script(code, { filename }).runInContext(ctx, { timeout, breakOnSigint: false });
}
parentPort.on("message", (m) => {
  try {
    if (m.type === "open") {
      ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate", name: "composicion" });
      run(workerData.runtime, 2000, "runtime.js");
      run("__compos.setup(" + JSON.stringify(m.env) + ")", 1000, "setup.js");
      run(m.script, m.timeout, "composicion.js");
      const params = String(run("__compos.defaults()", 200, "defaults.js"));
      parentPort.postMessage({ id: m.id, ok: true, params });
    } else if (m.type === "frame") {
      const out = String(run("__compos.frame(" + Number(m.t) + ")", m.timeout, "frame.js"));
      parentPort.postMessage({ id: m.id, ok: true, out });
    }
  } catch (e) {
    let msg = "error";
    let line = null;
    let timeout = false;
    try {
      msg = String(e && e.message ? e.message : e).slice(0, 400);
      timeout = Boolean(e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT");
      const mm = /composicion\.js:(\d+)/.exec(String(e && e.stack ? e.stack : ""));
      line = mm ? Number(mm[1]) : null;
    } catch {}
    parentPort.postMessage({ id: m.id, ok: false, error: msg, line, timeout });
  }
});
`;

type Pending = { resolve: (v: Reply) => void; timer: ReturnType<typeof setTimeout> };
type Reply = { ok: true; out?: string; params?: string } | { ok: false; error: string; line: number | null; timeout?: boolean; kind?: "memory" | "timeout" | "error" };

export type OpenResult = { ok: true; sandbox: NodeSandbox; defaults: Record<string, string> } | { ok: false; error: string; line: number | null; kind: "static" | "error" | "timeout" | "memory" };

export class NodeSandbox {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private dead: string | null = null;

  private constructor(private worker: Worker) {
    worker.on("message", (m: { id: number } & Reply) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.resolve(m);
    });
    const die = (why: string, kind: "memory" | "error") => {
      if (this.dead) return;
      this.dead = why;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: why, line: null, kind });
      }
      this.pending.clear();
    };
    worker.on("error", (e: Error & { code?: string }) => die(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "La composición usó demasiada memoria." : `El sandbox se cerró: ${e.message}`.slice(0, 300), e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "error"));
    worker.on("exit", () => die("El sandbox se cerró.", "error"));
  }

  /** Revisa el código, abre un hilo y carga la composición. */
  static async open(code: string, env: ComposEnvData, opts: { memoryMb?: number; loadMs?: number } = {}): Promise<OpenResult> {
    const st = checkStatic(code);
    if (!st.ok) return { ok: false, error: st.issues.map((i) => (i.line ? `línea ${i.line}: ${i.message}` : i.message)).join(" · "), line: st.issues[0]?.line ?? null, kind: "static" };
    const mem = opts.memoryMb ?? COMPOS_LIMITS.memoryMb;
    const worker = new Worker(THREAD, {
      eval: true,
      workerData: { runtime: RUNTIME_SOURCE },
      resourceLimits: { maxOldGenerationSizeMb: mem, maxYoungGenerationSizeMb: 24, codeRangeSizeMb: 16, stackSizeMb: 4 },
      env: {},
      stdout: true,
      stderr: true,
    });
    worker.unref();
    const sb = new NodeSandbox(worker);
    const r = await sb.call({ type: "open", env: JSON.stringify(env), script: moduleScript(st.body), timeout: opts.loadMs ?? 500 }, (opts.loadMs ?? 500) + 4000);
    if (!r.ok) {
      await sb.close();
      return { ok: false, error: r.error, line: sourceLine(r.line), kind: r.kind === "memory" ? "memory" : r.timeout ? "timeout" : "error" };
    }
    let defaults: Record<string, string> = {};
    try {
      defaults = JSON.parse(r.params ?? "{}");
    } catch {}
    return { ok: true, sandbox: sb, defaults };
  }

  private call(msg: Record<string, unknown>, hardMs: number): Promise<Reply> {
    if (this.dead) return Promise.resolve({ ok: false, error: this.dead, line: null, kind: "error" });
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // No respondió ni con el corte de vm: se mata el hilo.
        void this.worker.terminate();
        this.dead = "La composición tardó demasiado en dibujar un cuadro.";
        resolve({ ok: false, error: this.dead, line: null, kind: "timeout" });
      }, hardMs);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ ...msg, id });
    });
  }

  /** Dibuja el instante t (segundos de la composición). */
  async frame(t: number, timeoutMs: number = COMPOS_LIMITS.renderFrameMs): Promise<ComposFrameResult> {
    const t0 = performance.now();
    const r = await this.call({ type: "frame", t, timeout: timeoutMs }, timeoutMs + 3000);
    const ms = performance.now() - t0;
    if (!r.ok) return { ok: false, error: r.timeout ? `Un cuadro tardó más de ${timeoutMs} ms (¿un bucle sin fin?).` : r.error, line: sourceLine(r.line), kind: r.kind === "memory" ? "memory" : r.timeout || r.kind === "timeout" ? "timeout" : "error" };
    let parsed: { ok: boolean; frame?: ComposFrame; error?: string; line?: number | null; kind?: string };
    try {
      parsed = JSON.parse(r.out ?? "");
    } catch {
      return { ok: false, error: "La composición devolvió algo que no se puede leer.", line: null, kind: "error" };
    }
    if (!parsed.ok || !parsed.frame) return { ok: false, error: String(parsed.error ?? "error"), line: sourceLine(parsed.line ?? null), kind: parsed.kind === "limit" ? "limit" : "error" };
    return { ok: true, frame: parsed.frame, ms };
  }

  async close(): Promise<void> {
    if (!this.dead) this.dead = "cerrado";
    await this.worker.terminate().catch(() => undefined);
  }
}
