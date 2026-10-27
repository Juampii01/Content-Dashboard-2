"use server";

import { z } from "zod";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import type { MotionScene } from "@/lib/video/motion/schema";
import { requestProjectGraphic, VideoError } from "@/lib/video/service";

/**
 * "Pide tu gráfico" en la revisión del Editor: la persona describe el gráfico (o un cambio) y Claude arma la escena
 * con el motor de motion graphics. Exige permiso de edición y tiene un límite de pedidos por hora.
 */
export type GraphicActionResult =
  | { ok: true; scene: MotionScene; title: string; note: string; warnings: string[]; simplified: boolean }
  | { ok: false; error: string }
  | { ok: false; refusal: string; alternative: string };

const MAX_PER_HOUR = 40;

const inputSchema = z.object({
  projectId: z.uuid(),
  fromWord: z.number().int().min(0).max(100_000),
  toWord: z.number().int().min(0).max(100_000),
  request: z.string().trim().min(3, "Describe el gráfico con algunas palabras más.").max(400, "El pedido es demasiado largo: resúmelo en una o dos frases."),
  kind: z.enum(["pedido", "ajuste"]),
  current: z.unknown().optional(),
  format: z.enum(["9:16", "16:9"]),
});

export async function requestGraphicAction(input: z.input<typeof inputSchema>): Promise<GraphicActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pedido no válido." };
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación. Puedes armar el gráfico a mano." };
  if (!(await allowAttempt(`editor-grafico:${user.id}`, MAX_PER_HOUR, 3600))) {
    return { ok: false, error: "Pediste muchos gráficos en poco tiempo. Espera unos minutos y vuelve a intentarlo." };
  }
  try {
    const result = await requestProjectGraphic({ ...parsed.data, current: parsed.data.current ?? null });
    return result.ok ? result : { ok: false, refusal: result.refusal, alternative: result.alternative };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, error: error.userMessage };
    if (error instanceof VideoError) return { ok: false, error: error.message };
    console.error("[editor] gráfico pedido:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos armar el gráfico. Prueba de nuevo." };
  }
}
