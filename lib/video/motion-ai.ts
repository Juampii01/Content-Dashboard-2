import "server-only";
import { generateStructured } from "@/lib/ai/client";
import {
  MOTION_RULES,
  motionAdjustTask,
  motionRequestFromWire,
  motionRequestWireSchema,
  motionRequestTask,
  motionRetryWireSchema,
  sceneFromWire,
  motionRetryTask,
  type MotionRequestAi,
} from "@/lib/ai/prompts/motion";
import { sceneFromV1 } from "./motion/v1";
import type { GraphicLook } from "./graphics";
import { resolveScenes, sceneToAi, type MotionJob, type RetryFn } from "./motion-build";
import { isMotionScene, sceneTexts, type BrollGraphic } from "./motion-graphics";
import type { MotionScene } from "./motion/schema";
import type { VideoFormat } from "./types";

/**
 * Gráficos con IA (servidor): el reintento con Claude que usan el plan del b-roll y "Pide tu gráfico". El armado,
 * la validación y los arreglos viven en motion-build.ts (sin servidor, con pruebas).
 */

/** Contexto en caché de Claude: reglas de motion graphics + marca. */
export const motionContext = (brandContext: string) => `${MOTION_RULES}\n\n${brandContext}`;

/** Reintento: le explica a Claude los problemas de cada escena y pide la versión corregida (una sola llamada). */
export function motionRetry(context: string): RetryFn {
  return async (items) => {
    const out = await generateStructured({
      feature: "video.motion.retry",
      model: "main",
      context,
      task: motionRetryTask(items.map((it) => ({ spoken: it.job.spoken, format: it.job.format, duration: it.job.duration, scene: it.scene, problems: it.problems, ...(it.job.request ? { request: it.job.request } : {}) }))),
      schema: motionRetryWireSchema,
      maxTokens: 3000 + items.length * 1500,
    });
    return items.map((_, i) => sceneFromWire(out.graphics[i]));
  };
}

export type GraphicRequest = {
  kind: "pedido" | "ajuste";
  request: string;
  spoken: string;
  around: string;
  current: BrollGraphic | null;
  look: GraphicLook;
  format: VideoFormat;
  duration: number;
  bannedWords: string[];
  brandContext: string;
};

export type GraphicRequestResult =
  | { ok: true; scene: MotionScene; title: string; note: string; warnings: string[]; simplified: boolean }
  | { ok: false; refusal: string; alternative: string };

/**
 * "Pide tu gráfico": la persona describe el gráfico (o un cambio sobre el actual) y Claude arma la escena.
 * Hasta 2 reintentos con los problemas explicados; después, arreglos automáticos o un componente más simple.
 */
export async function requestGraphic(input: GraphicRequest): Promise<GraphicRequestResult> {
  const context = motionContext(input.brandContext);
  const current = input.current ? (isMotionScene(input.current) ? input.current : sceneFromV1(input.current, { duration: input.duration, format: input.format })) : null;
  const common = { request: input.request, spoken: input.spoken, around: input.around, format: input.format, duration: input.duration };
  const wire = await generateStructured({
    feature: input.kind === "ajuste" ? "video.motion.ajuste" : "video.motion.pedido",
    model: "main",
    context,
    task: input.kind === "ajuste" && current ? motionAdjustTask({ ...common, current: sceneToAi(current) }) : motionRequestTask(common),
    schema: motionRequestWireSchema,
    maxTokens: 4000,
  });
  const ai: MotionRequestAi = motionRequestFromWire(wire);

  if (ai.refusal.trim() && !ai.layers.length) return { ok: false, refusal: ai.refusal.trim().slice(0, 300), alternative: ai.alternative.trim().slice(0, 200) };
  // En un ajuste, las cifras que ya tenía el gráfico (las aceptó la persona) siguen valiendo.
  const accepted = input.kind === "ajuste" && current ? ` ${sceneTexts(current).join(" ")}` : "";
  const job: MotionJob = { ai, spoken: input.spoken, request: `${input.request}${accepted}`, look: input.look, format: input.format, duration: input.duration, bannedWords: input.bannedWords };
  const [outcome] = await resolveScenes([job], { retries: 2, retry: motionRetry(context) });
  if (!outcome?.scene) {
    if (outcome?.problems.length) console.warn("[editor] gráfico pedido sin resolver:", outcome.problems.slice(0, 3).join(" | "));
    return {
      ok: false,
      refusal: ai.refusal.trim() || "No logramos armar un gráfico que se lea bien con ese pedido.",
      alternative: ai.alternative.trim() || "Prueba con algo más simple: una palabra clave, una lista corta o una cifra que digas en el tramo.",
    };
  }
  if (outcome.how !== "ok") console.info(`[editor] gráfico pedido resuelto (${outcome.how})`);
  // Un gráfico a un lado sigue a un lado después de un ajuste (si sigue sobre el video y en 16:9).
  const side = current && (current.position === "left" || current.position === "right") ? current.position : null;
  const scene = side && outcome.scene.mode === "overlay" && outcome.scene.format === "16:9" ? { ...outcome.scene, position: side } : outcome.scene;
  return {
    ok: true,
    scene,
    title: outcome.title || ai.title.trim().slice(0, 80),
    note: (outcome.how === "fallback" ? "Lo simplificamos para que se lea bien en el video." : ai.note.trim() || ai.refusal.trim()).slice(0, 300),
    warnings: outcome.warnings.slice(0, 3),
    simplified: outcome.how === "fallback",
  };
}
