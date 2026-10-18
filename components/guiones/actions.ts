"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { AiError } from "@/lib/ai/client";
import { FORMATS, OBJECTIVES, type FormatKey } from "@/lib/ai/prompts/guiones";
import { getDb, schema } from "@/lib/db";
import type { ScriptContent } from "@/lib/db/schema";
import { getSourcePiece } from "@/lib/dal/scripts";
import { allowAttempt } from "@/lib/rate-limit";
import { adaptScript, applyAction, createScript, restoreVersion, saveEdits, type ScriptAction } from "@/lib/scripts/service";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const LIMIT_MSG = "Hiciste muchos pedidos a la IA seguidos. Espera unos minutos y vuelve a intentar.";
/** Tope de llamadas de IA por persona y por hora (protege el costo de la clave del servidor). */
async function withinLimit(userId: string, kind: "ia" | "pesado"): Promise<boolean> {
  return kind === "pesado" ? allowAttempt(`guiones-pesado:${userId}`, 15, 3600) : allowAttempt(`guiones:${userId}`, 80, 3600);
}

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof AiError) {
    console.error("[ia]", error.detail);
    return { ok: false, error: error.userMessage };
  }
  console.error("[guiones]", error instanceof Error ? error.message : error);
  return { ok: false, error: error instanceof Error && /guion|bloque|versión/.test(error.message) ? error.message : "Algo salió mal. Prueba de nuevo." };
}

const newScript = z.object({
  idea: z.string().trim().min(8, "Cuenta la idea en una o dos frases.").max(2000, "La idea es demasiado larga."),
  format: z.enum(Object.keys(FORMATS) as [FormatKey, ...FormatKey[]]),
  objective: z.enum(Object.keys(OBJECTIVES) as [keyof typeof OBJECTIVES, ...(keyof typeof OBJECTIVES)[]]),
  pillar: z.string().trim().max(120).optional(),
  offer: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(12000).optional(),
  sourceUrl: z.string().trim().url("El enlace de referencia no es válido.").max(500).optional().or(z.literal("")),
  sourceContentItemId: z.string().uuid().optional().or(z.literal("")),
});

export type NewScriptState = { error?: string };

export async function createScriptAction(_prev: NewScriptState, formData: FormData): Promise<NewScriptState> {
  const user = await requireEditor();
  if (isDenied(user)) return { error: user.error };
  if (!(await withinLimit(user.id, formData.get("format") === "YT_LONG" ? "pesado" : "ia"))) return { error: LIMIT_MSG };
  const parsed = newScript.safeParse(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;

  let reference = d.reference || null;
  let referenceLabel = reference ? "texto de referencia pegado por la persona" : null;
  if (d.sourceContentItemId) {
    const piece = await getSourcePiece(d.sourceContentItemId);
    if (piece) {
      const own = [piece.title, piece.caption].filter(Boolean).join("\n\n");
      reference = [own, reference].filter(Boolean).join("\n\n---\n\n");
      referenceLabel = `pieza propia que rindió ${piece.perfScore ? `×${piece.perfScore.toFixed(1)} su mediana` : "bien"}: haz otra con el mismo patrón y un tema o ángulo nuevo`;
    }
  }

  let id: string;
  try {
    id = await createScript({
      idea: d.idea,
      format: d.format,
      objective: d.objective,
      pillar: d.pillar || null,
      offer: d.offer || null,
      reference,
      referenceLabel,
      sourceContentItemId: d.sourceContentItemId || null,
      sourceUrl: d.sourceUrl || null,
      userId: user.id,
    });
  } catch (error) {
    return { error: fail(error).error };
  }
  redirect(`/guiones/${id}`);
}

export async function runScriptAction(scriptId: string, action: ScriptAction): Promise<ActionResult<ScriptContent>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await withinLimit(user.id, "ia"))) return { ok: false, error: LIMIT_MSG };
  try {
    return { ok: true, data: await applyAction(scriptId, action, user.id) };
  } catch (error) {
    return fail(error);
  }
}

const contentSchema = z.object({
  title: z.string().max(200),
  angle: z.string().max(500),
  hooks: z.array(z.object({ text: z.string().max(600), type: z.string().max(40), score: z.number(), why: z.string().max(400) })).max(10),
  selectedHook: z.number().int().min(0),
  beats: z.array(z.object({ id: z.string().max(40), purpose: z.string().max(200), spoken: z.string().max(4000), onScreenText: z.string().max(200), broll: z.string().max(400), seconds: z.number().min(0).max(3600) })).max(60),
  cta: z.object({ spoken: z.string().max(1000), onScreenText: z.string().max(200), offer: z.string().max(200).nullable() }),
  caption: z.string().max(2200),
});

export async function saveScriptAction(scriptId: string, content: ScriptContent): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = contentSchema.safeParse(content);
  if (!parsed.success) return { ok: false, error: "Hay un campo demasiado largo. Revísalo y vuelve a guardar." };
  try {
    await saveEdits(scriptId, parsed.data as ScriptContent, user.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const statuses = ["IDEA", "DRAFT", "READY", "RECORDED", "PUBLISHED", "ARCHIVED"] as const;

export async function setScriptStatusAction(scriptId: string, status: (typeof statuses)[number]): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!statuses.includes(status)) return { ok: false, error: "Estado no válido." };
  await getDb().update(schema.scripts).set({ status }).where(eq(schema.scripts.id, scriptId));
  refresh();
  return { ok: true };
}

export async function adaptScriptAction(scriptId: string, to: FormatKey): Promise<ActionResult<string>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await withinLimit(user.id, "pesado"))) return { ok: false, error: LIMIT_MSG };
  if (!(to in FORMATS)) return { ok: false, error: "Formato no válido." };
  try {
    return { ok: true, data: await adaptScript(scriptId, to, user.id) };
  } catch (error) {
    return fail(error);
  }
}

export async function restoreVersionAction(scriptId: string, versionId: string): Promise<ActionResult<ScriptContent>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  try {
    const content = await restoreVersion(scriptId, versionId, user.id);
    refresh();
    return { ok: true, data: content };
  } catch (error) {
    return fail(error);
  }
}
