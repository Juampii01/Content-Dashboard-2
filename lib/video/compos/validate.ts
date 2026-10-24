/**
 * Validación de una composición antes de guardarla: revisión estática + prueba de render en el sandbox de Node
 * (18 cuadros repartidos en su duración, sin errores, sin pasar el tiempo ni las operaciones por cuadro, que dibuje
 * algo y que sea determinista: el mismo instante da la misma lista). La usan la app (antes de guardar lo que escribió
 * Claude o lo que manda el navegador) y las pruebas.
 */
import { COMPOS_LIMITS, type ComposEnvData, type ComposFrame } from "./contract";
import { NodeSandbox } from "./sandbox-node";
import { codeHash } from "./validate-hash";

export { codeHash };

export type ComposCheck =
  | { ok: true; hash: string; defaults: Record<string, string>; stats: { frames: number; avgMs: number; maxMs: number; maxOps: number } }
  | { ok: false; hash: string; error: string; line: number | null; kind: string };

/** Instantes de prueba: el principio, el final y 16 repartidos (más densos al principio, donde suelen estar las entradas). */
export function sampleTimes(duration: number, n = 16): number[] {
  const d = Math.max(0.1, duration);
  const out = new Set<number>([0, Math.max(0, d - 1 / 30)]);
  for (let i = 1; i <= n; i++) out.add(Math.round(d * (i / (n + 1)) ** 1.15 * 1000) / 1000);
  return [...out].sort((a, b) => a - b);
}

/** ¿Dibuja algo además del video de fondo? */
function drawsSomething(f: ComposFrame): boolean {
  return f.o.some((op) => Array.isArray(op) && op[0] !== "v" && op[0] !== "p" && op[0] !== "s" && op[0] !== "r");
}

export async function validateComposition(code: string, env: ComposEnvData, opts: { strictTiming?: boolean } = {}): Promise<ComposCheck> {
  const hash = codeHash(code);
  const opened = await NodeSandbox.open(code, env);
  if (!opened.ok) return { ok: false, hash, error: opened.error, line: opened.line, kind: opened.kind };
  const sb = opened.sandbox;
  try {
    const times = sampleTimes(env.duration);
    let total = 0;
    let maxMs = 0;
    let maxOps = 0;
    let drew = false;
    const seen = new Map<number, string>();
    for (const t of times) {
      const r = await sb.frame(t, COMPOS_LIMITS.renderFrameMs);
      if (!r.ok) return { ok: false, hash, error: `En el segundo ${t.toFixed(2)}: ${r.error}`, line: r.line, kind: r.kind };
      // El primer cuadro incluye la compilación del motor de JS: no cuenta para el tiempo.
      if (seen.size > 0) {
        total += r.ms;
        maxMs = Math.max(maxMs, r.ms);
      }
      maxOps = Math.max(maxOps, r.frame.n);
      drew ||= drawsSomething(r.frame);
      seen.set(t, JSON.stringify(r.frame));
    }
    if (!drew) return { ok: false, hash, error: "La composición no dibuja nada (solo se ve el video).", line: null, kind: "error" };
    // Determinista: dos instantes vuelven a dar exactamente lo mismo después de haber dibujado los demás.
    for (const t of [times[Math.floor(times.length / 2)]!, times[1]!]) {
      const again = await sb.frame(t, COMPOS_LIMITS.renderFrameMs);
      if (!again.ok || JSON.stringify(again.frame) !== seen.get(t)) {
        return { ok: false, hash, error: `No es determinista: el segundo ${t.toFixed(2)} dibuja distinto la segunda vez (no guardes estado entre cuadros; usa solo t y env).`, line: null, kind: "error" };
      }
    }
    const avgMs = total / Math.max(1, times.length - 1);
    if (opts.strictTiming !== false && (avgMs > COMPOS_LIMITS.validateAvgMs || maxMs > COMPOS_LIMITS.validateMaxMs)) {
      return { ok: false, hash, error: `Es demasiado lenta: ${Math.round(avgMs)} ms por cuadro en promedio y ${Math.round(maxMs)} ms el más lento (máximo ${COMPOS_LIMITS.validateAvgMs} y ${COMPOS_LIMITS.validateMaxMs}). Dibuja menos cosas por cuadro.`, line: null, kind: "limit" };
    }
    return { ok: true, hash, defaults: opened.defaults, stats: { frames: times.length, avgMs: Math.round(avgMs * 10) / 10, maxMs: Math.round(maxMs * 10) / 10, maxOps } };
  } finally {
    await sb.close();
  }
}
