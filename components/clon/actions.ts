"use server";

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { getCloneVideoRow, getCloneVideosByIds, type CloneVideoItem } from "@/lib/dal/clone";
import { balanceFromUser, HeyGenError, type HeyGenBalance } from "@/lib/heygen/client";
import { countWords, ENGINE_ORDER, estimateCost, formatCredits, formatUsd, type EngineKey } from "@/lib/heygen/pricing";
import { loadHeyGen, pollCloneVideos, type CloneVideoRow } from "@/lib/heygen/service";
import { MAX_SCRIPT_CHARS } from "@/lib/heygen/text";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown, scope: string): { ok: false; error: string } {
  if (error instanceof HeyGenError) {
    console.error(`[clon] ${scope}:`, error.detail);
    return { ok: false, error: error.userMessage };
  }
  console.error(`[clon] ${scope}:`, error instanceof Error ? error.message : "error");
  return { ok: false, error: "Algo salió mal al hablar con HeyGen. Vuelve a intentarlo en unos minutos." };
}

const NO_KEY = "Todavía no hay una API key de HeyGen guardada. El dueño de la cuenta la agrega en Ajustes → Claves de servicios.";

// ─── Avatares y voces ─────────────────────────────────────────────────────

export type AvatarOption = {
  id: string;
  name: string;
  type: string;
  previewImage: string | null;
  previewVideo: string | null;
  defaultVoiceId: string | null;
  engines: EngineKey[];
  status: "processing" | "completed" | "failed" | null;
};

export type VoiceOption = { id: string; name: string; language: string; gender: string; previewAudio: string | null; type: "public" | "private" };

const cursor = z.string().max(2000).nullish();

export async function listAvatarsAction(input: { ownership: "private" | "public"; token?: string | null }): Promise<ActionResult<{ items: AvatarOption[]; nextToken: string | null }>> {
  await getCurrentUser();
  const parsed = z.object({ ownership: z.enum(["private", "public"]), token: cursor }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pedido no válido." };
  const conn = await loadHeyGen();
  if (!conn) return { ok: false, error: NO_KEY };
  try {
    const page = await conn.client.listLooks({ ownership: parsed.data.ownership, token: parsed.data.token, limit: 24 });
    return {
      ok: true,
      data: {
        nextToken: page.next_token,
        items: page.data.map((look) => ({
          id: look.id,
          name: look.name,
          type: look.avatar_type,
          previewImage: look.preview_image_url,
          previewVideo: look.preview_video_url,
          defaultVoiceId: look.default_voice_id,
          engines: (look.supported_api_engines?.length ? look.supported_api_engines : ENGINE_ORDER).filter((e): e is EngineKey => ENGINE_ORDER.includes(e as EngineKey)),
          status: look.status ?? null,
        })),
      },
    };
  } catch (error) {
    return fail(error, "avatares");
  }
}

export async function listVoicesAction(input: { type: "private" | "public"; language?: string; token?: string | null }): Promise<ActionResult<{ items: VoiceOption[]; nextToken: string | null }>> {
  await getCurrentUser();
  const parsed = z.object({ type: z.enum(["private", "public"]), language: z.string().max(40).optional(), token: cursor }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pedido no válido." };
  const conn = await loadHeyGen();
  if (!conn) return { ok: false, error: NO_KEY };
  try {
    const page = await conn.client.listVoices({ type: parsed.data.type, language: parsed.data.language, token: parsed.data.token, limit: 30 });
    return {
      ok: true,
      data: {
        nextToken: page.next_token,
        items: page.data.map((v) => ({ id: v.voice_id, name: v.name, language: v.language, gender: v.gender, previewAudio: v.preview_audio_url, type: v.type })),
      },
    };
  } catch (error) {
    return fail(error, "voces");
  }
}

export async function getBalanceAction(): Promise<ActionResult<HeyGenBalance>> {
  await getCurrentUser();
  const conn = await loadHeyGen();
  if (!conn) return { ok: false, error: NO_KEY };
  try {
    return { ok: true, data: balanceFromUser(await conn.client.getMe()) };
  } catch (error) {
    return fail(error, "saldo");
  }
}

// ─── Crear video ──────────────────────────────────────────────────────────

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "El color tiene que ser un código como #0070F8.");

const createSchema = z.object({
  scriptId: z.uuid().nullish(),
  title: z.string().trim().min(1, "Ponle un título al video.").max(120, "El título es demasiado largo."),
  text: z.string().trim().min(3, "Escribe el texto que va a decir tu clon.").max(MAX_SCRIPT_CHARS, `El texto es demasiado largo (máximo ${MAX_SCRIPT_CHARS.toLocaleString("es-419")} caracteres). Divídelo en dos videos.`),
  avatarId: z.string().trim().min(1, "Elige un avatar.").max(200),
  avatarName: z.string().trim().max(200).nullish(),
  voiceId: z.string().trim().min(1, "Elige una voz.").max(200),
  engine: z.enum(["avatar_iii", "avatar_iv", "avatar_v"], "Elige un motor."),
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]),
  resolution: z.enum(["1080p", "720p"]),
  background: z.object({ type: z.literal("color"), value: hex }).nullable(),
  speed: z.number().min(0.5).max(1.5),
  captions: z.boolean(),
  confirmedCostUsd: z.number().min(0),
});

export type CreateCloneVideoInput = z.input<typeof createSchema>;

function insufficient(balance: HeyGenBalance, usd: number, credits: number): string | null {
  if (balance.amount == null) return null;
  if (balance.unit === "usd" && balance.amount < usd) {
    return `Tu saldo de API en HeyGen (${formatUsd(balance.amount)}) no alcanza para este video (unos ${formatUsd(usd)}). Carga saldo en HeyGen o elige un motor más económico.`;
  }
  if (balance.unit === "credits" && balance.amount < credits) {
    return `Tu saldo de API en HeyGen (${formatCredits(balance.amount)}) no alcanza para este video (unos ${formatCredits(credits)}). Carga saldo en HeyGen o elige un motor más económico.`;
  }
  return null;
}

/** Envía el pedido a HeyGen para una fila ya guardada. El Idempotency-Key es el id de la fila: reenviar no duplica. */
async function submitToHeyGen(row: CloneVideoRow): Promise<CloneVideoRow> {
  const conn = await loadHeyGen();
  if (!conn) throw new HeyGenError("INVALID_KEY", NO_KEY, "sin key");
  const created = await conn.client.createVideo(
    {
      type: "avatar",
      avatar_id: row.avatarId,
      voice_id: row.voiceId,
      script: row.scriptText,
      // Siempre explícito: si no se manda, HeyGen usa Avatar IV, que cuesta 8 veces más que el III.
      engine: { type: row.engine as EngineKey },
      title: row.title,
      voice_settings: { speed: row.speed },
      ...(row.background ? { background: row.background } : {}),
      // El SRT llega siempre; `style: default` además los quema en el video.
      caption: { file_format: "srt", style: row.captions ? "default" : null },
      resolution: row.resolution as "1080p" | "720p",
      aspect_ratio: row.aspectRatio as "9:16" | "1:1" | "16:9",
      callback_id: row.id,
    },
    `clone-video-${row.id}`,
  );
  const [updated] = await getDb()
    .update(schema.cloneVideos)
    .set({ heygenVideoId: created.video_id, status: created.status === "processing" ? "PROCESSING" : "QUEUED", errorMessage: null, lastCheckedAt: new Date() })
    .where(eq(schema.cloneVideos.id, row.id))
    .returning();
  return updated ?? row;
}

export async function createCloneVideoAction(input: CreateCloneVideoInput): Promise<ActionResult<{ id: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos del video." };
  const d = parsed.data;

  const conn = await loadHeyGen();
  if (!conn) return { ok: false, error: NO_KEY };

  const words = countWords(d.text);
  const estimate = estimateCost({ words, speed: d.speed, engine: d.engine, resolution: d.resolution });
  if (Math.abs(estimate.usd - d.confirmedCostUsd) > 0.01) {
    return { ok: false, error: "La estimación cambió desde que la confirmaste. Revisa el monto y confirma de nuevo." };
  }

  // El saldo se vuelve a consultar aquí: no se confía en lo que mostró la pantalla.
  try {
    const balance = balanceFromUser(await conn.client.getMe());
    const blocked = insufficient(balance, estimate.usd, estimate.credits);
    if (blocked) return { ok: false, error: blocked };
  } catch (error) {
    return fail(error, "saldo antes de crear");
  }

  let scriptId = d.scriptId ?? null;
  if (scriptId) {
    const [script] = await getDb().select({ id: schema.scripts.id }).from(schema.scripts).where(eq(schema.scripts.id, scriptId)).limit(1);
    if (!script) scriptId = null;
  }

  const [row] = await getDb()
    .insert(schema.cloneVideos)
    .values({
      title: d.title,
      scriptId,
      scriptText: d.text,
      avatarId: d.avatarId,
      avatarName: d.avatarName ?? null,
      voiceId: d.voiceId,
      engine: d.engine,
      aspectRatio: d.aspectRatio,
      resolution: d.resolution,
      captions: d.captions,
      background: d.background,
      speed: d.speed,
      estimatedSeconds: estimate.seconds,
      estimatedCostUsd: estimate.usd,
      createdBy: user.id,
    })
    .returning();

  try {
    await submitToHeyGen(row!);
  } catch (error) {
    const result = fail(error, "crear video");
    await getDb().update(schema.cloneVideos).set({ status: "FAILED", errorMessage: result.error }).where(eq(schema.cloneVideos.id, row!.id));
    return result;
  }
  refresh();
  return { ok: true, data: { id: row!.id } };
}

/**
 * Reintentar un video fallido.
 * - Si nunca llegó a HeyGen: se reenvía con el mismo Idempotency-Key (si en realidad sí llegó, HeyGen devuelve el mismo video, sin cobrar dos veces).
 * - Si HeyGen lo rechazó o falló: se crea un video nuevo con los mismos ajustes.
 */
export async function retryCloneVideoAction(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const row = await getCloneVideoRow(id);
  if (!row) return { ok: false, error: "Ese video ya no existe." };
  if (row.status !== "FAILED") return { ok: false, error: "Ese video no falló: no hace falta reintentarlo." };

  try {
    if (!row.heygenVideoId) {
      await getDb().update(schema.cloneVideos).set({ status: "QUEUED", errorMessage: null }).where(eq(schema.cloneVideos.id, row.id));
      await submitToHeyGen(row);
      refresh();
      return { ok: true, data: { id: row.id } };
    }
    // Un video nuevo vuelve a cobrar: se revisa el saldo igual que al crearlo.
    const conn = await loadHeyGen();
    if (!conn) return { ok: false, error: NO_KEY };
    const words = countWords(row.scriptText);
    const estimate = estimateCost({ words, speed: row.speed, engine: row.engine as EngineKey, resolution: row.resolution as "1080p" | "720p" });
    const blocked = insufficient(balanceFromUser(await conn.client.getMe()), estimate.usd, estimate.credits);
    if (blocked) return { ok: false, error: blocked };

    const [fresh] = await getDb()
      .insert(schema.cloneVideos)
      .values({
        title: row.title,
        scriptId: row.scriptId,
        scriptText: row.scriptText,
        avatarId: row.avatarId,
        avatarName: row.avatarName,
        voiceId: row.voiceId,
        engine: row.engine,
        aspectRatio: row.aspectRatio,
        resolution: row.resolution,
        captions: row.captions,
        background: row.background,
        speed: row.speed,
        estimatedSeconds: row.estimatedSeconds,
        estimatedCostUsd: row.estimatedCostUsd,
        createdBy: user.id,
      })
      .returning();
    try {
      await submitToHeyGen(fresh!);
    } catch (error) {
      const result = fail(error, "reintentar");
      await getDb().update(schema.cloneVideos).set({ status: "FAILED", errorMessage: result.error }).where(eq(schema.cloneVideos.id, fresh!.id));
      return { ok: true, data: { id: fresh!.id } };
    }
    refresh();
    return { ok: true, data: { id: fresh!.id } };
  } catch (error) {
    const result = fail(error, "reintentar");
    // Solo el reenvío toca la fila original; si falló al preparar un video nuevo, el error original se conserva.
    if (!row.heygenVideoId) await getDb().update(schema.cloneVideos).set({ status: "FAILED", errorMessage: result.error }).where(eq(schema.cloneVideos.id, row.id));
    return result;
  }
}

// ─── Seguimiento (polling de respaldo) ────────────────────────────────────

/**
 * La llaman la lista y el detalle cada ~10 s mientras hay videos en curso.
 * Consulta en HeyGen como máximo 3 videos por llamada y cada video como mucho una vez cada 8 s.
 */
export async function pollCloneVideosAction(ids: string[]): Promise<ActionResult<CloneVideoItem[]>> {
  await getCurrentUser();
  const parsed = z.array(z.uuid()).max(50).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Pedido no válido." };
  try {
    await pollCloneVideos({ ids: parsed.data, limit: 3, minAgeSec: 8 });
  } catch (error) {
    console.error("[clon] polling:", error instanceof Error ? error.message : "error");
  }
  return { ok: true, data: await getCloneVideosByIds(parsed.data) };
}
