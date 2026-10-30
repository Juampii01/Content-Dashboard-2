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

/**
 * ¿Dibuja a la persona en este cuadro? `kind`: "pe" la persona recortada, "sil" su silueta. Busca en la lista principal
 * y en sus capas.
 */
export function drawsPerson(f: ComposFrame, kind: "pe" | "sil" = "pe"): boolean {
  const has = (list: unknown[]) => list.some((op) => Array.isArray(op) && op[0] === kind);
  return has(f.o) || Object.values(f.l ?? {}).some((l) => Array.isArray(l) && has(l));
}

/** Qué del recorte usa el código: la persona (drawPerson, env.person, env.popOut), solo su silueta, o nada. */
export function personUse(code: string): "pe" | "sil" | null {
  if (/\b(drawPerson|env\.person|popOut)\b/.test(code)) return "pe";
  if (/\bsilhouette\b/.test(code)) return "sil";
  return null;
}

export async function validateComposition(code: string, env: ComposEnvData, opts: { strictTiming?: boolean } = {}): Promise<ComposCheck> {
  const hash = codeHash(code);
  const opened = await NodeSandbox.open(code, env);
  if (!opened.ok) return { ok: false, hash, error: opened.error, line: opened.line, kind: opened.kind };
  const sb = opened.sandbox;
  try {
    // Una pieza larga se prueba en más puntos (uno cada ~2 s, hasta 48).
    const times = sampleTimes(env.duration, Math.min(48, Math.max(16, Math.ceil(env.duration / 2))));
    let total = 0;
    let maxMs = 0;
    let maxOps = 0;
    let drew = false;
    let personFrames = 0;
    const use = env.mask ? personUse(code) : null;
    const seen = new Map<number, string>();
    for (const t of times) {
      const r = await sb.frame(t, COMPOS_LIMITS.renderFrameMs);
      if (!r.ok) return { ok: false, hash, error: `En el segundo ${t.toFixed(2)}: ${r.error}`, line: r.line, kind: r.kind };
      // El primer cuadro incluye la compilación del motor de JS: no cuenta para el tiempo.
      if (seen.size > 0) {
        total += r.ms;
        maxMs = Math.max(maxMs, r.ms);
      }
      if (r.frame.b) return { ok: false, hash, error: `En el segundo ${t.toFixed(2)} un texto dice «${r.frame.b}»: falta un valor. Si es un texto editable, léelo de env.params con su clave exacta y dale un valor en params.`, line: null, kind: "error" };
      maxOps = Math.max(maxOps, r.frame.n);
      drew ||= drawsSomething(r.frame);
      if (use && drawsPerson(r.frame, use)) personFrames++;
      seen.set(t, JSON.stringify(r.frame));
    }
    if (!drew) return { ok: false, hash, error: "La composición no dibuja nada (solo se ve el video).", line: null, kind: "error" };
    // Si usa el recorte, la persona tiene que aparecer en buena parte de la animación (si no, queda una tarjeta vacía).
    if (use && personFrames < Math.ceil(times.length / 3)) {
      return {
        ok: false,
        hash,
        error: `Usa el recorte de la persona pero casi no ${use === "pe" ? "la dibuja" : "dibuja su silueta"} (aparece en ${personFrames} de ${times.length} cuadros de prueba). Dibújala con ctx.drawPerson() o env.popOut(ctx, { rect, … }) durante la animación, no solo al final.`,
        line: null,
        kind: "error",
      };
    }
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
