"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { aiConfigured } from "@/lib/ai/client";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { RepurposeError, resetPart, runPack, saveCopy, schedulePack, startPack, type PartKey } from "@/lib/repurpose/service";
import { loadSource } from "@/lib/repurpose/source";

/**
 * Acciones de "Sacarle todo el jugo". Cada una valida el permiso de edición y los datos antes de escribir.
 * La generación corre después de responder (`after`): la pantalla se actualiza sola y se puede salir y volver.
 */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const uuid = z.string().uuid();
const kind = z.enum(["video", "guion", "pieza"]);
const partKey = z.enum(["carousel", "copy", "shorts"]);

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof RepurposeError) return { ok: false, error: error.message };
  console.error("[jugo]", error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

function runLater(packId: string, userId: string, only?: PartKey[]) {
  after(() => runPack(packId, userId, only).catch((error: unknown) => console.error("[jugo] generar", error instanceof Error ? error.message : error)));
}

export async function startPackAction(sourceKind: string, sourceId: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const k = kind.safeParse(sourceKind);
  if (!k.success || !uuid.safeParse(sourceId).success) return { ok: false, error: "No encontramos ese contenido." };
  if (!aiConfigured()) return { ok: false, error: "Falta configurar la IA en esta instalación. Avísale a soporte." };
  if (!(await allowAttempt(`jugo:${user.id}`, 15, 3600))) return { ok: false, error: "Pediste muchos paquetes seguidos. Espera unos minutos y vuelve a intentar." };
  try {
    const source = await loadSource(k.data, sourceId);
    if (!source) return { ok: false, error: "No encontramos ese contenido. Puede que se haya borrado." };
    if (source.blocked) return { ok: false, error: source.blocked };
    const id = await startPack(source, user.id);
    runLater(id, user.id);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "No pudimos empezar. Prueba de nuevo.");
  }
}

export async function retryPartAction(packId: string, part: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const p = partKey.safeParse(part);
  if (!uuid.safeParse(packId).success || !p.success) return { ok: false, error: "Datos no válidos." };
  if (!(await allowAttempt(`jugo:${user.id}`, 15, 3600))) return { ok: false, error: "Pediste muchos reintentos seguidos. Espera unos minutos." };
  try {
    await resetPart(packId, p.data);
    runLater(packId, user.id, [p.data]);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "No pudimos reintentar. Prueba de nuevo.");
  }
}

const tags = z.array(z.string().trim().max(80)).max(30);
const copySchema = z.object({
  instagram: z.object({ caption: z.string().trim().max(2200, "El caption de Instagram admite hasta 2.200 caracteres."), hashtags: tags }),
  tiktok: z.object({ caption: z.string().trim().max(2200, "El caption de TikTok admite hasta 2.200 caracteres."), hashtags: tags }),
  youtube: z.object({
    title: z.string().trim().max(100, "El título de YouTube admite hasta 100 caracteres."),
    description: z.string().trim().max(5000, "La descripción de YouTube admite hasta 5.000 caracteres."),
    hashtags: tags,
  }),
});

export async function saveCopyAction(packId: string, copy: z.input<typeof copySchema>): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(packId).success) return { ok: false, error: "Paquete no válido." };
  const parsed = copySchema.safeParse(copy);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los textos." };
  try {
    await saveCopy(packId, parsed.data);
    return { ok: true };
  } catch (error) {
    return fail(error, "No pudimos guardar los textos. Prueba de nuevo.");
  }
}

const piece = z.object({ kind: z.enum(["guion", "carrusel", "editor"]), id: uuid });

/** "Agregar todo al calendario" (sin pieza) o "Agregar al calendario" de una pieza: en los próximos días libres. */
export async function schedulePackAction(packId: string, only?: z.input<typeof piece>): Promise<ActionResult<{ created: { date: string }[]; skipped: number }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(packId).success || (only && !piece.safeParse(only).success)) return { ok: false, error: "Datos no válidos." };
  try {
    const out = await schedulePack(packId, user.id, only);
    refresh();
    return { ok: true, data: { created: out.created.map((c) => ({ date: c.date })), skipped: out.skipped } };
  } catch (error) {
    return fail(error, "No pudimos agregarlo al calendario. Prueba de nuevo.");
  }
}
