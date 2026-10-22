"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { fileDriver } from "@/lib/storage";
import { setAutoExport } from "@/lib/video/auto-export";
import { brollItemSchema } from "@/lib/video/plan";
import { MUSIC_DB, SFX_LEVELS } from "@/lib/video/sfx";
import { STUDIO_LEVELS } from "@/lib/video/studio-audio";
import { CAPTION_PRESET_KEYS, type CaptionPresetKey } from "@/lib/video/types";
import {
  completeUpload,
  createFromClone,
  createProject,
  deleteProject,
  reopenProject,
  retryProject,
  saveReview,
  startRender,
  updateDraft,
  VideoError,
  type DraftSettings,
  type Review,
} from "@/lib/video/service";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof VideoError) return { ok: false, error: error.message };
  console.error("[editor]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Algo salió mal. Prueba de nuevo." };
}

const formatSchema = z.enum(["9:16", "16:9"]);
const presetSchema = z.enum(CAPTION_PRESET_KEYS);
const idSchema = z.uuid();
const brollModeSchema = z.enum(["auto", "off"]);

const newProject = z.object({
  title: z.string().trim().min(1, "Ponle un nombre al video.").max(120, "El nombre es demasiado largo."),
  fileName: z.string().min(1).max(300),
  fileType: z.string().max(100),
  fileSize: z.number().int().positive(),
  format: formatSchema,
  preset: presetSchema,
  scriptId: z.uuid().nullable(),
  styleId: z.uuid().nullable().optional(),
  brollMode: brollModeSchema.optional(),
  autoExport: z.boolean().optional(),
  origin: z.enum(["upload", "recorder"]).optional(),
});

/** Paso 1 de la subida: reserva el proyecto y la ruta del original. El archivo va directo al almacenamiento. */
export async function createProjectAction(input: z.input<typeof newProject>): Promise<ActionResult<{ id: string; key: string; mode: "blob" | "local" }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = newProject.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  try {
    const { id, key } = await createProject({ ...parsed.data, userId: user.id });
    return { ok: true, data: { id, key, mode: fileDriver() === "blob" ? "blob" : "local" } };
  } catch (error) {
    return fail(error);
  }
}

const settingsSchema = z.object({
  title: z.string().trim().min(1, "Ponle un nombre al video.").max(120, "El nombre es demasiado largo."),
  format: formatSchema,
  preset: presetSchema,
  scriptId: z.uuid().nullable(),
  styleId: z.uuid().nullable().optional(),
  brollMode: brollModeSchema.optional(),
  autoExport: z.boolean().optional(),
});

/** Paso 2: la subida terminó y la persona tocó "Procesar". Se verifica el archivo y se encola el análisis. */
export async function completeUploadAction(projectId: string, settings: DraftSettings): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = settingsSchema.safeParse(settings);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Proyecto no válido." };
  try {
    await completeUpload(projectId, user.id, parsed.data);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function updateDraftAction(projectId: string, settings: DraftSettings): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = settingsSchema.safeParse(settings);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Proyecto no válido." };
  await updateDraft(projectId, parsed.data);
  return { ok: true };
}

export async function createFromCloneAction(
  cloneId: string,
  format: "9:16" | "16:9",
  preset: CaptionPresetKey,
  extra: { styleId?: string | null; brollMode?: "auto" | "off"; autoExport?: boolean } = {},
): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z
    .object({ cloneId: idSchema, format: formatSchema, preset: presetSchema, styleId: z.uuid().nullable().optional(), brollMode: brollModeSchema.optional(), autoExport: z.boolean().optional() })
    .safeParse({ cloneId, format, preset, ...extra });
  if (!parsed.success) return { ok: false, error: "Datos no válidos." };
  let id: string;
  try {
    id = await createFromClone(parsed.data.cloneId, parsed.data.format, parsed.data.preset, user.id, { styleId: parsed.data.styleId, brollMode: parsed.data.brollMode, autoExport: parsed.data.autoExport });
  } catch (error) {
    return fail(error);
  }
  redirect(`/editor/${id}`);
}

const reviewSchema = z.object({
  removed: z.array(z.number().int().min(0)).max(50_000),
  selectedHook: z.number().int().min(0).max(4).nullable(),
  preset: presetSchema,
  offsetX: z.number().min(-1).max(1),
  corrections: z.record(z.string().regex(/^\d+$/), z.string().max(60)),
  broll: z.array(brollItemSchema).max(20).optional(),
  zooms: z.boolean().optional(),
  emoji: z.boolean().optional(),
  sfx: z.enum(SFX_LEVELS).optional(),
  studio: z.enum(STUDIO_LEVELS).optional(),
  music: z.object({ trackId: z.uuid().nullable(), db: z.number().min(MUSIC_DB.min).max(MUSIC_DB.max) }).optional(),
});

export async function saveReviewAction(projectId: string, review: Review, format: "9:16" | "16:9"): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = reviewSchema.safeParse(review);
  if (!parsed.success || !idSchema.safeParse(projectId).success || !formatSchema.safeParse(format).success) return { ok: false, error: "Los cambios no son válidos." };
  try {
    await saveReview(projectId, parsed.data, format);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function renderAction(projectId: string, review: Review, format: "9:16" | "16:9"): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = reviewSchema.safeParse(review);
  if (!parsed.success || !idSchema.safeParse(projectId).success || !formatSchema.safeParse(format).success) return { ok: false, error: "Los cambios no son válidos." };
  try {
    await startRender(projectId, parsed.data, format, user.id, { manual: true });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** "Hazlo por mí": encenderlo o apagarlo mientras el video se prepara (apagado, queda para revisar). */
export async function setAutoExportAction(projectId: string, on: boolean): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success || typeof on !== "boolean") return { ok: false, error: "Proyecto no válido." };
  try {
    await setAutoExport(projectId, on, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function reopenAction(projectId: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  try {
    await reopenProject(projectId);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function retryAction(projectId: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  try {
    await retryProject(projectId, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function renameAction(projectId: string, title: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const clean = title.trim().slice(0, 120);
  if (!clean || !idSchema.safeParse(projectId).success) return { ok: false, error: "Ponle un nombre al video." };
  await getDb().update(schema.videoProjects).set({ title: clean }).where(eq(schema.videoProjects.id, projectId));
  refresh();
  return { ok: true };
}

/** Descarta un borrador que todavía se estaba subiendo (cuando la persona cambia de archivo). */
export async function discardDraftAction(projectId: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  const [row] = await getDb().select({ status: schema.videoProjects.status }).from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  if (row?.status !== "UPLOADING") return { ok: true };
  try {
    await deleteProject(projectId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteAction(projectId: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  try {
    await deleteProject(projectId);
  } catch (error) {
    return fail(error);
  }
  redirect("/editor");
}
