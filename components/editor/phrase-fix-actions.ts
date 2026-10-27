"use server";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { HeyGenError } from "@/lib/heygen/client";
import { loadHeyGen } from "@/lib/heygen/service";
import { readUrl } from "@/lib/storage/files";
import {
  advanceLipsync,
  createPhraseFix,
  getPhraseFix,
  listPhraseFixes,
  PhraseFixError,
  removePhraseFix,
  setPhraseFixCover,
  toPhraseFixItem,
  type PhraseFixItem,
} from "@/lib/video/phrase-fix-service";

/**
 * Acciones de "Corregir una frase sin regrabar" (revisión del Editor). Lectura con getCurrentUser; escritura con
 * requireEditor. La voz, el costo y la ventana se calculan de nuevo en el servidor (lib/video/phrase-fix-service.ts).
 */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
export type FixView = PhraseFixItem & { audioUrl: string | null };
export type VoiceChoice = { id: string; name: string; language: string };

function fail(error: unknown, scope: string): { ok: false; error: string } {
  if (error instanceof PhraseFixError) return { ok: false, error: error.message };
  if (error instanceof HeyGenError) {
    console.error(`[editor] ${scope}:`, error.detail);
    return { ok: false, error: error.userMessage };
  }
  console.error(`[editor] ${scope}:`, error instanceof Error ? error.message : "error");
  return { ok: false, error: "Algo salió mal. Vuelve a intentarlo en unos minutos." };
}

async function withAudio(item: PhraseFixItem, audioKey: string | null): Promise<FixView> {
  let audioUrl: string | null = null;
  if (audioKey) audioUrl = await readUrl(audioKey).catch(() => null);
  return { ...item, audioUrl };
}

async function views(projectId: string): Promise<FixView[]> {
  const rows = await getDb().select().from(schema.videoPhraseFixes).where(eq(schema.videoPhraseFixes.projectId, projectId));
  const items = await listPhraseFixes(projectId);
  const keys = new Map(rows.map((r) => [r.id, r.audioKey]));
  return Promise.all(items.map((i) => withAudio(i, keys.get(i.id) ?? null)));
}

const uuid = z.uuid();

export async function listPhraseFixesAction(projectId: string): Promise<ActionResult<FixView[]>> {
  await getCurrentUser();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  return { ok: true, data: await views(projectId) };
}

/**
 * Voces para decir la frase: las privadas de la cuenta de HeyGen (la del clon del cliente, sobre todo).
 * `preferred`: la voz del último video con clon, para dejarla elegida.
 */
export async function phraseFixVoicesAction(): Promise<ActionResult<{ voices: VoiceChoice[]; preferred: string | null }>> {
  await getCurrentUser();
  const conn = await loadHeyGen();
  if (!conn) return { ok: false, error: "Para corregir con tu voz clonada, conecta tu cuenta de HeyGen en Ajustes → Claves de servicios." };
  try {
    const page = await conn.client.listVoices({ type: "private", limit: 50 });
    const [last] = await getDb()
      .select({ voiceId: schema.cloneVideos.voiceId })
      .from(schema.cloneVideos)
      .where(eq(schema.cloneVideos.kind, "avatar"))
      .orderBy(desc(schema.cloneVideos.createdAt))
      .limit(1);
    const voices = page.data.map((v) => ({ id: v.voice_id, name: v.name, language: v.language }));
    const preferred = voices.find((v) => v.id === last?.voiceId)?.id ?? voices[0]?.id ?? null;
    return { ok: true, data: { voices, preferred } };
  } catch (error) {
    return fail(error, "voces para frases");
  }
}

const createSchema = z.object({
  projectId: z.uuid(),
  fromWord: z.number().int().min(0),
  toWord: z.number().int().min(0),
  newText: z.string().trim().min(1, "Escribe cómo tenía que decirse la frase.").max(600, "Es demasiado largo para una frase. Corrige de a una."),
  voiceId: z.string().trim().min(1, "Elige tu voz.").max(200),
  voiceName: z.string().trim().max(200).nullish(),
  cover: z.enum(["broll", "none", "lipsync"]),
  lipsyncMode: z.enum(["speed", "precision"]),
  corrections: z.record(z.string().regex(/^\d+$/), z.string().max(60)),
});

export async function createPhraseFixAction(input: z.input<typeof createSchema>): Promise<ActionResult<FixView>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa la frase." };
  try {
    const row = await createPhraseFix({ ...parsed.data, voiceName: parsed.data.voiceName ?? null, userId: user.id });
    return { ok: true, data: await withAudio(toPhraseFixItem(row), row.audioKey) };
  } catch (error) {
    return fail(error, "crear frase");
  }
}

export async function setPhraseFixCoverAction(input: { projectId: string; fixId: string; cover: "broll" | "none" | "lipsync"; lipsyncMode: "speed" | "precision" }): Promise<ActionResult<FixView>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = z.object({ projectId: z.uuid(), fixId: z.uuid(), cover: z.enum(["broll", "none", "lipsync"]), lipsyncMode: z.enum(["speed", "precision"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pedido no válido." };
  try {
    const row = await setPhraseFixCover(parsed.data.projectId, parsed.data.fixId, parsed.data.cover, parsed.data.lipsyncMode, user.id);
    return { ok: true, data: await withAudio(toPhraseFixItem(row), row.audioKey) };
  } catch (error) {
    return fail(error, "cambiar imagen de la frase");
  }
}

export async function deletePhraseFixAction(projectId: string, fixId: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(fixId).success) return { ok: false, error: "Pedido no válido." };
  const row = await getPhraseFix(projectId, fixId);
  if (!row) return { ok: true, data: undefined };
  await removePhraseFix(row);
  return { ok: true, data: undefined };
}

/** Lo llama la revisión cada ~5 s mientras haya labios en curso: avanza cada uno y devuelve la lista. */
export async function pollPhraseFixesAction(projectId: string): Promise<ActionResult<FixView[]>> {
  await getCurrentUser();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  const rows = await getDb().select().from(schema.videoPhraseFixes).where(eq(schema.videoPhraseFixes.projectId, projectId));
  for (const row of rows) {
    if (row.status !== "LIPSYNC") continue;
    try {
      await advanceLipsync(row);
    } catch (error) {
      console.error("[editor] avanzar labios:", error instanceof Error ? error.message : "error");
    }
  }
  return { ok: true, data: await views(projectId) };
}
