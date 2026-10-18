"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { allowAttempt } from "@/lib/rate-limit";
import { analyzePiece } from "@/lib/metrics/analysis";
import { classifyPendingHooks } from "@/lib/metrics/hooks";

export type AnalyzeResult = { ok: true } | { ok: false; error: string };

export async function analyzePieceAction(id: string): Promise<AnalyzeResult> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Pieza no válida." };
  if (!aiConfigured()) return { ok: false, error: "La IA todavía no está configurada en esta instalación." };
  if (!(await allowAttempt(`analisis:${user.id}`, 30, 3600))) return { ok: false, error: "Hiciste muchos análisis seguidos. Prueba de nuevo en un rato." };
  try {
    await analyzePiece(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[ia]", error.detail);
      return { ok: false, error: error.userMessage };
    }
    console.error("[metricas] análisis", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos analizar la pieza. Prueba de nuevo." };
  }
}

export async function classifyHooksAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!aiConfigured()) return { ok: false, error: "La IA todavía no está configurada en esta instalación." };
  if (!(await allowAttempt(`ganchos:${user.id}`, 10, 3600))) return { ok: false, error: "Espera un rato antes de volver a clasificar." };
  try {
    const done = await classifyPendingHooks(200);
    refresh();
    return { ok: true, message: done > 0 ? `Listo: clasificamos ${done} piezas.` : "No había piezas nuevas para clasificar." };
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[ia]", error.detail);
      return { ok: false, error: error.userMessage };
    }
    console.error("[metricas] ganchos", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos clasificar los ganchos. Prueba de nuevo." };
  }
}
