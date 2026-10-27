"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { allowAttempt } from "@/lib/rate-limit";
import {
  createPackage,
  deletePackage,
  PackageError,
  regenerateTitles,
  removeBrandPhoto,
  requestCutouts,
  selectTitle,
  startBackgrounds,
  updateConcept,
} from "@/lib/youtube/packages";

/** Acciones de "Títulos y miniaturas". */
type Fail = { ok: false; error: string };
const uuid = z.string().uuid();

function failure(error: unknown, fallback: string): Fail {
  if (error instanceof PackageError) return { ok: false, error: error.message };
  if (error instanceof AiError) {
    console.error("[ia]", error.detail);
    return { ok: false, error: error.userMessage };
  }
  console.error("[miniaturas]", error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

const createInput = z.object({
  kind: z.enum(["guion", "video", "pieza", "tema"]),
  id: z.string().uuid().nullable(),
  topic: z.string().max(4000).nullable(),
  format: z.enum(["VIDEO", "SHORT"]).nullable(),
});

export async function createPackageAction(input: z.infer<typeof createInput>): Promise<{ ok: true; id: string } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Elige de qué es el video." };
  if (parsed.data.kind !== "tema" && !parsed.data.id) return { ok: false, error: "Elige de qué es el video." };
  if (!aiConfigured()) return { ok: false, error: "La IA todavía no está configurada en esta instalación." };
  if (!(await allowAttempt(`miniaturas:${user.id}`, 30, 3600))) return { ok: false, error: "Creaste muchos paquetes seguidos. Prueba de nuevo en un rato." };
  try {
    const id = await createPackage({ ...parsed.data, userId: user.id });
    return { ok: true, id };
  } catch (error) {
    return failure(error, "No pudimos crear los títulos y las miniaturas. Prueba de nuevo.");
  }
}

export async function regenerateTitlesAction(id: string): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Paquete no válido." };
  if (!(await allowAttempt(`miniaturas:${user.id}`, 30, 3600))) return { ok: false, error: "Pediste muchos títulos seguidos. Prueba de nuevo en un rato." };
  try {
    await regenerateTitles(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos escribir otros títulos. Prueba de nuevo.");
  }
}

export async function selectTitleAction(id: string, text: string | null): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Paquete no válido." };
  await selectTitle(id, text);
  refresh();
  return { ok: true };
}

const patchSchema = z
  .object({
    text: z.string().max(80),
    highlight: z.string().max(80),
    layout: z.enum(["texto-izquierda", "texto-derecha", "texto-centro"]),
    photoKey: z.string().max(200).nullable(),
    scene: z.string().min(3).max(600),
    font: z.enum(["anton", "oswald", "montserrat", "inter", "playfair"]).nullable(),
    name: z.string().min(1).max(60),
  })
  .partial();

export async function updateConceptAction(id: string, conceptId: string, patch: z.infer<typeof patchSchema>): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = patchSchema.safeParse(patch);
  if (!uuid.safeParse(id).success || !/^[a-z0-9]{1,20}$/.test(conceptId) || !parsed.success) return { ok: false, error: "Cambio no válido." };
  try {
    await updateConcept(id, conceptId, parsed.data);
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos guardar el cambio.");
  }
}

export async function generateBackgroundsAction(id: string, conceptIds: string[]): Promise<{ ok: true; jobId: string } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success || !conceptIds.length || conceptIds.some((c) => !/^[a-z0-9]{1,20}$/.test(c))) return { ok: false, error: "Elige al menos una miniatura." };
  try {
    const jobId = await startBackgrounds({ packageId: id, conceptIds, provider: null, userId: user.id });
    refresh();
    return { ok: true, jobId };
  } catch (error) {
    return failure(error, "No pudimos empezar a generar los fondos. Prueba de nuevo.");
  }
}

export async function retryCutoutAction(key: string): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  try {
    await requestCutouts([key], user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos pedir el recorte.");
  }
}

export async function removePhotoAction(key: string): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  try {
    await removeBrandPhoto(key);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos quitar la foto.");
  }
}

export async function deletePackageAction(id: string): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Paquete no válido." };
  await deletePackage(id);
  return { ok: true };
}
