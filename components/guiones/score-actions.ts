"use server";

import { z } from "zod";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import { AiError, aiConfigured, generateStructured } from "@/lib/ai/client";
import { getBrand } from "@/lib/ai/brand-context";
import { HOOK_CATEGORIES, HOOK_RULES, hookClassificationSchema } from "@/lib/ai/prompts/metricas";
import { scoreExplanationRules, scoreExplanationSchema, type ScoreExplanation } from "@/lib/ai/prompts/puntaje";
import { getScoreHistory } from "@/lib/dal/score";
import { allowAttempt } from "@/lib/rate-limit";
import { computeScore, scoreFacts, type HistoryPiece, type HookKind } from "@/lib/scripts/score";

/**
 * Acciones del puntaje antes de publicar. Leer el historial pide sesión; clasificar y explicar usan IA,
 * así que piden permiso de edición y tienen tope por hora.
 */
export type ScoreActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof AiError) {
    console.error("[ia]", error.detail);
    return { ok: false, error: error.userMessage };
  }
  console.error("[puntaje]", error instanceof Error ? error.message : error);
  return { ok: false, error: "No pudimos calcular el puntaje. Prueba de nuevo." };
}

export async function loadScoreHistoryAction(): Promise<ScoreActionResult<HistoryPiece[]>> {
  await getCurrentUser();
  try {
    return { ok: true, data: await getScoreHistory() };
  } catch (error) {
    return fail(error);
  }
}

const hookText = z.string().trim().min(3, "Escribe el gancho primero.").max(600, "El gancho es demasiado largo.");

/** Vuelve a clasificar un gancho editado a mano, con la misma clasificación que usan tus piezas publicadas. */
export async function classifyHookAction(text: string): Promise<ScoreActionResult<HookKind>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = hookText.safeParse(text);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa el gancho." };
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación. Avísale a soporte." };
  if (!(await allowAttempt(`puntaje:${user.id}`, 60, 3600))) return { ok: false, error: "Hiciste muchos pedidos seguidos. Espera unos minutos y vuelve a intentar." };
  try {
    const result = await generateStructured({
      feature: "metricas.ganchos",
      model: "fast",
      context: HOOK_RULES,
      task: `#1 ${parsed.data.replace(/\s+/g, " ")}`,
      schema: hookClassificationSchema,
      maxTokens: 300,
      userId: user.id,
    });
    const type = result.items.find((i) => i.n === 1)?.type ?? "otro";
    return { ok: true, data: (HOOK_CATEGORIES as readonly string[]).includes(type) ? type : "otro" };
  } catch (error) {
    return fail(error);
  }
}

const explainInput = z.object({
  hook: hookText,
  hookType: z.enum(HOOK_CATEGORIES).nullable(),
  estimatedSeconds: z.number().int().min(1).max(7200),
  format: z.enum(["REEL", "SHORT", "YT_LONG", "STORY"]),
});

/** Explica el puntaje con IA. El puntaje se recalcula aquí con los datos de la base: no se confía en el navegador. */
export async function explainScoreAction(input: z.input<typeof explainInput>): Promise<ScoreActionResult<ScoreExplanation>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = explainInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa el guion." };
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación. Avísale a soporte." };
  if (!(await allowAttempt(`puntaje:${user.id}`, 60, 3600))) return { ok: false, error: "Hiciste muchos pedidos seguidos. Espera unos minutos y vuelve a intentar." };
  try {
    const [history, brand] = await Promise.all([getScoreHistory(), getBrand()]);
    const result = computeScore(history, parsed.data);
    if (result.confidence === "sin-datos") return { ok: false, error: "Todavía no hay suficientes piezas publicadas para comparar este guion." };
    const explanation = await generateStructured({
      feature: "guiones.puntaje",
      model: "fast",
      context: scoreExplanationRules(brand?.language ?? "es-neutro"),
      task: `PUNTAJE CALCULADO\n${scoreFacts(result, parsed.data.hook)}\n\nTAREA\nExplica el puntaje y da una o dos acciones concretas.`,
      schema: scoreExplanationSchema,
      maxTokens: 800,
      userId: user.id,
    });
    return { ok: true, data: { ...explanation, tips: explanation.tips.slice(0, 2) } };
  } catch (error) {
    return fail(error);
  }
}
