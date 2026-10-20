"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { analyzeUploads, createTemplate, deleteTemplate, renameTemplate, TemplateError } from "@/lib/carousels/templates";

export type TemplateActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const LIMIT = "Creaste muchas plantillas seguidas. Espera unos minutos y vuelve a intentar.";

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof TemplateError) return { ok: false, error: error.message };
  console.error("[carruseles/plantillas]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Algo salió mal. Prueba de nuevo." };
}

const startSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("upload"), name: z.string().trim().max(80).default("") }),
  z.object({ source: z.literal("link"), name: z.string().trim().max(80).default(""), url: z.string().trim().min(10, "Pega el link del carrusel.").max(300) }),
]);

/** Crea la plantilla. Con un link, encola el análisis enseguida; con imágenes, después se suben y se llama a analizar. */
export async function startTemplateAction(input: z.input<typeof startSchema>): Promise<TemplateActionResult<string>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await allowAttempt(`carruseles-plantilla:${user.id}`, 20, 3600))) return { ok: false, error: LIMIT };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  try {
    const d = parsed.data;
    return { ok: true, data: await createTemplate({ name: d.name || null, source: d.source, url: d.source === "link" ? d.url : null, userId: user.id }) };
  } catch (error) {
    return fail(error);
  }
}

export async function analyzeTemplateAction(id: string, keys: string[]): Promise<TemplateActionResult<string>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success || !Array.isArray(keys) || keys.some((k) => typeof k !== "string")) return { ok: false, error: "Pedido no válido." };
  try {
    return { ok: true, data: await analyzeUploads(id, keys, user.id) };
  } catch (error) {
    return fail(error);
  }
}

export async function renameTemplateAction(id: string, name: string): Promise<TemplateActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.string().trim().min(1, "Ponle un nombre a la plantilla.").max(80, "El nombre es demasiado largo.").safeParse(name);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: parsed.success ? "Plantilla no válida." : (parsed.error.issues[0]?.message ?? "Nombre no válido.") };
  try {
    await renameTemplate(id, parsed.data);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Borra la plantilla; los carruseles que la usaban pasan a Editorial. Devuelve cuántos cambiaron. */
export async function deleteTemplateAction(id: string): Promise<TemplateActionResult<number>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Plantilla no válida." };
  try {
    const changed = await deleteTemplate(id);
    refresh();
    return { ok: true, data: changed };
  } catch (error) {
    return fail(error);
  }
}
