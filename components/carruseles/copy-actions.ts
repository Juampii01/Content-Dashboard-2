"use server";

import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { analyzeCopyUploads, CopyError, createCopy, switchCopyToUploads } from "@/lib/carousels/copy";
import { isTemplateRef } from "@/lib/carousels/theme";

export type CopyActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const LIMIT = "Copiaste muchos carruseles seguidos. Espera unos minutos y vuelve a intentar.";

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof CopyError) return { ok: false, error: error.message };
  console.error("[carruseles/copia]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Algo salió mal. Prueba de nuevo." };
}

const options = z.object({
  keyword: z
    .string()
    .trim()
    .max(30, "La palabra clave es demasiado larga.")
    .regex(/^[\p{L}\p{N}_-]*$/u, "La palabra clave va sin espacios ni símbolos (por ejemplo, GUIA).")
    .default(""),
  character: z.enum(["auto", "siempre", "nunca"]),
  design: z.enum(["original", "plantilla"]),
  template: z.string().max(60).refine((v) => v === "" || isTemplateRef(v), "Plantilla no válida.").default(""),
});

const startSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("upload"), options }),
  z.object({ source: z.literal("link"), url: z.string().trim().min(10, "Pega el link del carrusel.").max(300), options }),
]);

/** Crea la copia. Con un link, el worker empieza enseguida; con imágenes, después se suben y se llama a leer. */
export async function startCopyAction(input: z.input<typeof startSchema>): Promise<CopyActionResult<string>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await allowAttempt(`carruseles-copia:${user.id}`, 20, 3600))) return { ok: false, error: LIMIT };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const d = parsed.data;
  try {
    const id = await createCopy({
      source: d.source,
      url: d.source === "link" ? d.url : null,
      options: {
        keyword: d.options.keyword ? d.options.keyword.toUpperCase() : null,
        character: d.options.character,
        design: d.options.design,
        template: d.options.design === "plantilla" && d.options.template ? d.options.template : null,
      },
      userId: user.id,
    });
    return { ok: true, data: id };
  } catch (error) {
    return fail(error);
  }
}

export async function analyzeCopyAction(id: string, keys: string[]): Promise<CopyActionResult<string>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success || !Array.isArray(keys) || keys.some((k) => typeof k !== "string")) return { ok: false, error: "Pedido no válido." };
  try {
    return { ok: true, data: await analyzeCopyUploads(id, keys, user.id) };
  } catch (error) {
    return fail(error);
  }
}

/** Instagram no dejó bajar el link: la misma copia pasa a recibir las imágenes subidas. */
export async function switchToUploadsAction(id: string): Promise<CopyActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Copia no válida." };
  try {
    await switchCopyToUploads(id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
