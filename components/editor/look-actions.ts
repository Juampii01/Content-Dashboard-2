"use server";

import { z } from "zod";
import { AiError } from "@/lib/ai/client";
import { isDenied, requireEditor } from "@/lib/auth";
import { applyLook, latestLook, LookError, lookChat, startLook, toggleLookItem, type LookView } from "@/lib/video/look";

/**
 * «Mira este video y dime qué ves» en el Estudio: empezar (link o video subido), ver en qué va, conversar, marcar qué
 * va y aplicar. Todo con requireEditor y datos validados con Zod.
 */
type Fail = { ok: false; error: string };
const idSchema = z.uuid();

function fail(error: unknown, fallback: string): Fail {
  if (error instanceof LookError) return { ok: false, error: error.message };
  if (error instanceof AiError) return { ok: false, error: error.userMessage };
  console.error("[mirar]", error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

export async function startLookAction(projectId: string, input: { link?: string; upload?: boolean }): Promise<{ ok: true; look: LookView | null } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.object({ link: z.string().trim().max(500).optional(), upload: z.boolean().optional() }).safeParse(input);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: "Datos no válidos." };
  try {
    await startLook(projectId, parsed.data, user.id);
    return { ok: true, look: await latestLook(projectId) };
  } catch (error) {
    return fail(error, "No pudimos empezar. Prueba de nuevo.");
  }
}

export async function lookStatusAction(projectId: string): Promise<{ ok: true; look: LookView | null } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  try {
    return { ok: true, look: await latestLook(projectId) };
  } catch (error) {
    return fail(error, "No pudimos consultar en qué va.");
  }
}

export async function lookChatAction(projectId: string, lookId: string, text: string): Promise<{ ok: true; look: LookView | null } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const msg = z.string().trim().min(2, "Escribe tu mensaje.").max(2000, "Es demasiado largo: resúmelo un poco.").safeParse(text);
  if (!idSchema.safeParse(projectId).success || !idSchema.safeParse(lookId).success) return { ok: false, error: "Datos no válidos." };
  if (!msg.success) return { ok: false, error: msg.error.issues[0]?.message ?? "Mensaje no válido." };
  try {
    await lookChat(projectId, lookId, msg.data);
    return { ok: true, look: await latestLook(projectId) };
  } catch (error) {
    return fail(error, "No pudimos responder. Prueba de nuevo.");
  }
}

export async function toggleLookItemAction(projectId: string, lookId: string, moment: string, include: boolean): Promise<{ ok: true; look: LookView | null } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success || !idSchema.safeParse(lookId).success || !/^m[0-9]{1,3}$/.test(moment)) return { ok: false, error: "Datos no válidos." };
  try {
    await toggleLookItem(projectId, lookId, moment, include);
    return { ok: true, look: await latestLook(projectId) };
  } catch (error) {
    return fail(error, "No pudimos cambiarlo.");
  }
}

export async function applyLookAction(projectId: string, lookId: string): Promise<{ ok: true; count: number; failed: string[]; look: LookView | null } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success || !idSchema.safeParse(lookId).success) return { ok: false, error: "Datos no válidos." };
  try {
    const r = await applyLook(projectId, lookId, user.id);
    return { ok: true, ...r, look: await latestLook(projectId) };
  } catch (error) {
    return fail(error, "No pudimos aplicarlo. Prueba de nuevo.");
  }
}
