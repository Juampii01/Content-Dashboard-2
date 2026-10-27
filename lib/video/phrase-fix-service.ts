import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { notify } from "@/lib/notifications";
import { HeyGenError } from "@/lib/heygen/client";
import { estimateLipsync, estimateSpeech } from "@/lib/heygen/pricing";
import { loadHeyGen } from "@/lib/heygen/service";
import { openKey, saveToKey, TransferError, uploadToHeyGen } from "@/lib/heygen/transfer";
import { deleteKeys, fileDriver } from "@/lib/storage/files";
import { fitSpeech, fixWindow, lipsyncClip, MAX_FIX_SECONDS, MAX_FIX_WORDS, MAX_TEMPO, overlaps, speechSpan, spokenRange } from "./phrase-fix";
import type { MediaInfo, Transcript } from "./types";

/**
 * "Corregir una frase sin regrabar" (revisión del Editor), con la voz clonada del cliente en su cuenta de HeyGen.
 *
 * 1. Voz: POST /v3/voices/speech con la voz elegida (la que HeyGen clonó del cliente) → se guarda el audio en
 *    `editor/<id>/frases/<fix>/voz.<ext>` (las URLs de HeyGen vencen). Si no entra en el lugar de la frase vieja
 *    (más de ×1,2 de velocidad), se pide acortar el texto. Cuesta centavos.
 * 2. Imagen del tramo, a elección:
 *    - "broll": la revisión pone un b-roll encima (la boca no coincide, así que se tapa). Recomendado y sin costo.
 *    - "none": se deja la cara como está (solo si casi no se nota, por ejemplo una palabra).
 *    - "lipsync": el worker recorta el tramo con la voz nueva (VIDEO_PHRASE_CLIP), se sube a HeyGen y POST /v3/lipsyncs
 *      redibuja la boca; el resultado se guarda en `editor/<id>/frases/<fix>/labios.mp4` y el render lo pone encima.
 * 3. Render: `phraseFixesForRender` va en el trabajo VIDEO_RENDER; el worker reemplaza el audio (y, con labios, la imagen)
 *    del original antes de cortar las tomas (worker/video/phrase_fix.py).
 */

export class PhraseFixError extends Error {}

export type PhraseFixRow = typeof schema.videoPhraseFixes.$inferSelect;

export type PhraseFixItem = {
  id: string;
  fromWord: number;
  toWord: number;
  originalText: string;
  newText: string;
  voiceName: string | null;
  status: PhraseFixRow["status"];
  cover: "broll" | "none" | "lipsync";
  windowStart: number;
  windowEnd: number;
  audioSeconds: number | null;
  tempo: number;
  lipsyncStage: "clip" | "sent" | "done" | null;
  lipsyncMode: "speed" | "precision" | null;
  estimatedCostUsd: number | null;
  errorMessage: string | null;
  hasAudio: boolean;
};

export function toPhraseFixItem(row: PhraseFixRow): PhraseFixItem {
  return {
    id: row.id,
    fromWord: row.fromWord,
    toWord: row.toWord,
    originalText: row.originalText,
    newText: row.newText,
    voiceName: row.voiceName,
    status: row.status,
    cover: (["broll", "none", "lipsync"].includes(row.cover) ? row.cover : "broll") as PhraseFixItem["cover"],
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    audioSeconds: row.audioSeconds,
    tempo: row.tempo,
    lipsyncStage: row.lipsync?.stage ?? null,
    lipsyncMode: row.lipsync?.mode ?? null,
    estimatedCostUsd: row.estimatedCostUsd,
    errorMessage: row.errorMessage,
    hasAudio: Boolean(row.audioKey),
  };
}

const keyPrefix = (projectId: string, fixId: string) => `editor/${projectId}/frases/${fixId}/`;

async function projectForFix(projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new PhraseFixError("No encontramos ese proyecto.");
  const [project] = await getDb().select().from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  if (!project) throw new PhraseFixError("No encontramos ese proyecto.");
  if (project.status !== "AWAITING_REVIEW") throw new PhraseFixError("Las frases se corrigen durante la revisión. Reabre el video para corregir otra.");
  const transcript = project.transcript as Transcript | null;
  if (!transcript?.words?.length) throw new PhraseFixError("Este video todavía no tiene transcripción.");
  const media = (project.media ?? {}) as MediaInfo;
  return { project, transcript, duration: media.duration || transcript.duration };
}

export async function listPhraseFixes(projectId: string): Promise<PhraseFixItem[]> {
  const rows = await getDb().select().from(schema.videoPhraseFixes).where(eq(schema.videoPhraseFixes.projectId, projectId)).orderBy(asc(schema.videoPhraseFixes.fromWord));
  return rows.map(toPhraseFixItem);
}

export async function getPhraseFix(projectId: string, fixId: string): Promise<PhraseFixRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fixId)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.videoPhraseFixes)
    .where(and(eq(schema.videoPhraseFixes.id, fixId), eq(schema.videoPhraseFixes.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

/** Lo que cuesta, para mostrarlo antes de confirmar: voz siempre, labios solo si se piden. */
export function phraseFixEstimate(windowSeconds: number, cover: PhraseFixItem["cover"], mode: "speed" | "precision") {
  const speech = estimateSpeech(windowSeconds * MAX_TEMPO);
  const clip = windowSeconds + 0.8; // la ventana con el margen de lipsyncClip
  const lips = cover === "lipsync" ? estimateLipsync(clip, mode) : null;
  return { speechUsd: speech.usd, lipsyncUsd: lips?.usd ?? 0, totalUsd: Math.round((speech.usd + (lips?.usd ?? 0)) * 100) / 100, lipsyncSeconds: lips ? clip : 0 };
}

const AUDIO_TYPES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav" };

/**
 * Crea la corrección: genera la frase con la voz clonada, comprueba que entre y la guarda.
 * Reemplaza las correcciones anteriores que toquen las mismas palabras.
 */
export async function createPhraseFix(input: {
  projectId: string;
  fromWord: number;
  toWord: number;
  newText: string;
  voiceId: string;
  voiceName: string | null;
  cover: PhraseFixItem["cover"];
  lipsyncMode: "speed" | "precision";
  corrections: Record<string, string>;
  userId: string;
}): Promise<PhraseFixRow> {
  const { project, transcript, duration } = await projectForFix(input.projectId);
  const words = transcript.words;
  const from = Math.min(input.fromWord, input.toWord);
  const to = Math.max(input.fromWord, input.toWord);
  if (from < 0 || to >= words.length) throw new PhraseFixError("Esas palabras ya no están en la transcripción. Recarga la página.");
  if (to - from + 1 > MAX_FIX_WORDS) throw new PhraseFixError(`Marca una sola frase (hasta ${MAX_FIX_WORDS} palabras).`);
  const window = fixWindow(words, from, to, duration);
  if (!window) throw new PhraseFixError("No pudimos ubicar esas palabras en el video.");
  if (window.end - window.start > MAX_FIX_SECONDS) throw new PhraseFixError(`Marca una frase de hasta ${MAX_FIX_SECONDS} segundos.`);
  if (!fileDriver()) throw new PhraseFixError("Esta instalación no tiene almacenamiento de archivos para guardar la voz nueva.");

  const conn = await loadHeyGen();
  if (!conn) throw new PhraseFixError("Para corregir con tu voz clonada, conecta tu cuenta de HeyGen en Ajustes → Claves de servicios.");

  let speech;
  try {
    speech = await conn.client.generateSpeech({ text: input.newText, voice_id: input.voiceId, language: transcript.language?.slice(0, 2) || "es" });
  } catch (error) {
    if (error instanceof HeyGenError) {
      console.error("[editor] frase con voz clonada:", error.detail);
      throw new PhraseFixError(
        error.kind === "INVALID" ? "HeyGen no pudo decir esa frase con esta voz. Revisa el texto (solo palabras, sin símbolos raros) o elige otra voz." : error.userMessage,
      );
    }
    throw error;
  }
  const span = speechSpan(speech.duration, speech.word_timestamps);
  const fit = fitSpeech(span.end - span.start, window);
  if (!fit.ok) {
    const slot = window.end - window.start;
    throw new PhraseFixError(
      `La frase nueva dura ${(span.end - span.start).toFixed(1)} s y en el lugar de la vieja entran ${(slot * MAX_TEMPO).toFixed(1)} s como mucho. Acórtala o marca también las palabras de al lado.`,
    );
  }

  const db = getDb();
  // Las anteriores sobre las mismas palabras se reemplazan (con sus archivos).
  const existing = await db.select().from(schema.videoPhraseFixes).where(eq(schema.videoPhraseFixes.projectId, project.id));
  const replaced = existing.filter((f) => overlaps(f, { fromWord: from, toWord: to }));

  const [row] = await db
    .insert(schema.videoPhraseFixes)
    .values({
      projectId: project.id,
      fromWord: from,
      toWord: to,
      // Lo que se dijo de verdad (sin las correcciones de subtítulos, que pueden ser de una corrección anterior).
      originalText: spokenRange(words, from, to).slice(0, 2000),
      newText: input.newText,
      voiceId: input.voiceId,
      voiceName: input.voiceName,
      status: "VOICE",
      windowStart: window.start,
      windowEnd: window.end,
      audioSeconds: speech.duration,
      speechStart: span.start,
      speechEnd: span.end,
      tempo: fit.tempo,
      cover: input.cover,
      estimatedCostUsd: phraseFixEstimate(window.end - window.start, input.cover, input.lipsyncMode).totalUsd,
      createdBy: input.userId,
    })
    .returning();

  try {
    const ext = /\.wav(\?|$)/i.test(speech.audio_url) ? "wav" : "mp3";
    const audioKey = `${keyPrefix(project.id, row!.id)}voz.${ext}`;
    await saveToKey(speech.audio_url, audioKey, { contentType: AUDIO_TYPES[ext]!, maxBytes: 30 * 1024 ** 2 });
    const [saved] = await db
      .update(schema.videoPhraseFixes)
      .set({ audioKey, status: input.cover === "lipsync" ? "LIPSYNC" : "READY" })
      .where(eq(schema.videoPhraseFixes.id, row!.id))
      .returning();
    for (const old of replaced) await removePhraseFix(old);
    if (input.cover === "lipsync") return await startLipsync(saved!, input.lipsyncMode, input.userId, duration);
    return saved!;
  } catch (error) {
    await db.delete(schema.videoPhraseFixes).where(eq(schema.videoPhraseFixes.id, row!.id));
    if (error instanceof PhraseFixError) throw error;
    console.error("[editor] guardar voz nueva:", error instanceof Error ? error.message : "error");
    throw new PhraseFixError(error instanceof TransferError ? error.userMessage : "No pudimos guardar la voz nueva. Vuelve a intentarlo.");
  }
}

/** Paso 1 de los labios: el worker recorta el tramo (video + voz nueva) y lo deja en el almacenamiento. */
async function startLipsync(row: PhraseFixRow, mode: "speed" | "precision", userId: string, duration: number): Promise<PhraseFixRow> {
  const clip = lipsyncClip({ start: row.windowStart, end: row.windowEnd }, duration);
  const prefix = keyPrefix(row.projectId, row.id);
  const clipKey = `${prefix}tramo.mp4`;
  const clipAudioKey = `${prefix}tramo-voz.wav`;
  const jobId = await enqueueJob({
    type: "VIDEO_PHRASE_CLIP",
    createdBy: userId,
    stage: "En cola",
    input: {
      projectId: row.projectId,
      fixId: row.id,
      fix: renderFix(row),
      clipStart: clip.start,
      clipEnd: clip.end,
      clipKey,
      clipAudioKey,
    },
  });
  const [updated] = await getDb()
    .update(schema.videoPhraseFixes)
    .set({
      status: "LIPSYNC",
      cover: "lipsync",
      errorMessage: null,
      lipsync: { mode, stage: "clip", jobId, clipKey, clipAudioKey, clipStart: clip.start, clipEnd: clip.end, estimatedUsd: estimateLipsync(clip.end - clip.start, mode).usd },
    })
    .where(eq(schema.videoPhraseFixes.id, row.id))
    .returning();
  return updated ?? row;
}

/** Cambiar qué se ve durante la frase. Pasar a "lipsync" arranca la sincronía de labios (cobra en HeyGen). */
export async function setPhraseFixCover(projectId: string, fixId: string, cover: PhraseFixItem["cover"], mode: "speed" | "precision", userId: string): Promise<PhraseFixRow> {
  const { duration } = await projectForFix(projectId);
  const row = await getPhraseFix(projectId, fixId);
  if (!row) throw new PhraseFixError("Esa corrección ya no existe.");
  if (!row.audioKey) throw new PhraseFixError("Esa corrección no tiene la voz nueva. Bórrala y vuelve a crearla.");
  if (cover === "lipsync") {
    if (row.lipsync?.stage === "done" && row.lipsync.resultKey && row.lipsync.mode === mode) {
      const [u] = await getDb().update(schema.videoPhraseFixes).set({ cover, status: "READY", errorMessage: null }).where(eq(schema.videoPhraseFixes.id, row.id)).returning();
      return u ?? row;
    }
    if (row.status === "LIPSYNC") throw new PhraseFixError("Ya estamos sincronizando los labios de esta frase.");
    if (!(await loadHeyGen())) throw new PhraseFixError("Conecta tu cuenta de HeyGen en Ajustes para sincronizar los labios.");
    return startLipsync(row, mode, userId, duration);
  }
  const [u] = await getDb().update(schema.videoPhraseFixes).set({ cover, status: "READY", errorMessage: null }).where(eq(schema.videoPhraseFixes.id, row.id)).returning();
  return u ?? row;
}

const VIDEO_MAX = 200 * 1024 ** 2;

/**
 * Avanza la sincronía de labios (lo llama la revisión cada pocos segundos mientras hay una en curso):
 * clip listo → se sube a HeyGen y se pide la sincronía → al terminar se guarda el video y queda lista.
 */
export async function advanceLipsync(row: PhraseFixRow): Promise<PhraseFixRow> {
  const db = getDb();
  const ls = row.lipsync;
  if (row.status !== "LIPSYNC" || !ls) return row;
  const fail = async (message: string) => {
    const [u] = await db.update(schema.videoPhraseFixes).set({ status: "FAILED", errorMessage: message }).where(eq(schema.videoPhraseFixes.id, row.id)).returning();
    await notify({
      key: `phrase-fix:${row.id}:${ls.heygenId ?? ls.jobId ?? "x"}`,
      userId: row.createdBy,
      tone: "error",
      title: "No pudimos sincronizar los labios de tu frase",
      body: message,
      href: `/editor/${row.projectId}`,
      email: false,
    });
    return u ?? row;
  };

  if (ls.stage === "clip") {
    if (!ls.jobId) return fail("No encontramos el recorte del tramo. Vuelve a pedir los labios.");
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, ls.jobId)).limit(1);
    if (!job || job.status === "CANCELED") return fail("Se canceló el recorte del tramo. Vuelve a pedir los labios.");
    if (job.status === "FAILED") return fail(job.errorMessage ?? "El worker no pudo recortar el tramo. Vuelve a intentarlo.");
    if (job.status !== "SUCCEEDED") return row;
    const conn = await loadHeyGen();
    if (!conn) return fail("Conecta tu cuenta de HeyGen en Ajustes para sincronizar los labios.");
    // Candado: solo un pedido sube el tramo (dos pestañas no crean dos sincronías).
    const [claimed] = await db
      .update(schema.videoPhraseFixes)
      .set({ lipsync: { ...ls, stage: "sent", heygenId: null } })
      .where(and(eq(schema.videoPhraseFixes.id, row.id), eq(schema.videoPhraseFixes.status, "LIPSYNC"), sql`${schema.videoPhraseFixes.lipsync}->>'stage' = 'clip'`))
      .returning();
    if (!claimed) return row;
    try {
      const video = await uploadToHeyGen(conn.client, await openKey(ls.clipKey!), { filename: `tramo-${row.id}.mp4`, contentType: "video/mp4", idempotencyKey: `phrase-clip-${row.id}-${ls.jobId}` });
      const audio = await uploadToHeyGen(conn.client, await openKey(ls.clipAudioKey!), { filename: `voz-${row.id}.wav`, contentType: "audio/wav", idempotencyKey: `phrase-audio-${row.id}-${ls.jobId}` });
      const heygenId = await conn.client.createLipsync(
        {
          video: { type: "asset_id", asset_id: video },
          audio: { type: "asset_id", asset_id: audio },
          title: `Frase corregida ${row.id.slice(0, 8)}`,
          mode: ls.mode,
          keep_the_same_format: true,
          // El tramo tiene que durar lo mismo para encajar en el video.
          enable_dynamic_duration: false,
          callback_id: row.id,
        },
        `phrase-lipsync-${row.id}-${ls.jobId}`,
      );
      const [u] = await db
        .update(schema.videoPhraseFixes)
        .set({ lipsync: { ...ls, stage: "sent", heygenId, checkedAt: new Date().toISOString() } })
        .where(eq(schema.videoPhraseFixes.id, row.id))
        .returning();
      return u ?? row;
    } catch (error) {
      if (error instanceof HeyGenError) console.error("[editor] labios:", error.detail);
      return fail(error instanceof HeyGenError || error instanceof TransferError ? error.userMessage : "No pudimos mandar el tramo a HeyGen. Vuelve a intentarlo.");
    }
  }

  if (ls.stage === "sent" && ls.heygenId) {
    // Como mucho una consulta cada 6 s.
    if (ls.checkedAt && Date.now() - new Date(ls.checkedAt).getTime() < 6000) return row;
    const conn = await loadHeyGen();
    if (!conn) return fail("Conecta tu cuenta de HeyGen en Ajustes para sincronizar los labios.");
    let remote;
    try {
      remote = await conn.client.getLipsync(ls.heygenId);
    } catch (error) {
      if (error instanceof HeyGenError && error.kind === "NOT_FOUND") return fail("La sincronía ya no existe en tu cuenta de HeyGen. Vuelve a pedirla.");
      return row;
    }
    if (remote.status === "failed") {
      const reason = remote.failure_message?.trim();
      return fail(`HeyGen no pudo sincronizar los labios${reason ? ` (motivo en inglés: «${reason.slice(0, 200)}»)` : ""}. Puedes taparla con b-roll o dejarla como está.`);
    }
    if (remote.status !== "completed" || !remote.video_url) {
      const [u] = await db.update(schema.videoPhraseFixes).set({ lipsync: { ...ls, checkedAt: new Date().toISOString() } }).where(eq(schema.videoPhraseFixes.id, row.id)).returning();
      return u ?? row;
    }
    try {
      const resultKey = `${keyPrefix(row.projectId, row.id)}labios.mp4`;
      await saveToKey(remote.video_url, resultKey, { contentType: "video/mp4", maxBytes: VIDEO_MAX });
      const [u] = await db
        .update(schema.videoPhraseFixes)
        .set({ status: "READY", cover: "lipsync", errorMessage: null, lipsync: { ...ls, stage: "done", resultKey, checkedAt: new Date().toISOString() } })
        .where(eq(schema.videoPhraseFixes.id, row.id))
        .returning();
      await notify({
        key: `phrase-fix:${row.id}:${ls.heygenId}`,
        userId: row.createdBy,
        tone: "success",
        title: "Tu frase corregida ya tiene los labios sincronizados",
        body: `«${row.newText.slice(0, 120)}» ya está lista para el render.`,
        href: `/editor/${row.projectId}`,
        email: false,
      });
      return u ?? row;
    } catch (error) {
      console.error("[editor] guardar labios:", error instanceof Error ? error.message : "error");
      return row;
    }
  }
  return row;
}

export async function removePhraseFix(row: PhraseFixRow): Promise<void> {
  const keys = [row.audioKey, row.lipsync?.clipKey, row.lipsync?.clipAudioKey, row.lipsync?.resultKey].filter((k): k is string => Boolean(k));
  await getDb().delete(schema.videoPhraseFixes).where(eq(schema.videoPhraseFixes.id, row.id));
  await deleteKeys(keys).catch(() => undefined);
}

/** Lo que necesita el worker de una corrección (claves del almacenamiento y tiempos en segundos del original). */
function renderFix(row: PhraseFixRow) {
  return {
    id: row.id,
    start: row.windowStart,
    end: row.windowEnd,
    audioKey: row.audioKey,
    speechStart: row.speechStart ?? 0,
    speechEnd: row.speechEnd ?? row.audioSeconds ?? 0,
    tempo: row.tempo,
  };
}

/**
 * Correcciones listas para el render (VIDEO_RENDER → input.phraseFixes). Las que todavía generan los labios o fallaron
 * no van: el video sale con la frase original en ese tramo (la revisión lo avisa antes de renderizar).
 */
export async function phraseFixesForRender(projectId: string) {
  const rows = await getDb()
    .select()
    .from(schema.videoPhraseFixes)
    .where(and(eq(schema.videoPhraseFixes.projectId, projectId), eq(schema.videoPhraseFixes.status, "READY"), ne(schema.videoPhraseFixes.audioKey, "")))
    .orderBy(asc(schema.videoPhraseFixes.windowStart));
  return rows
    .filter((r) => r.audioKey)
    .map((r) => ({
      ...renderFix(r),
      ...(r.cover === "lipsync" && r.lipsync?.stage === "done" && r.lipsync.resultKey
        ? { lipsync: { key: r.lipsync.resultKey, start: r.lipsync.clipStart ?? r.windowStart, end: r.lipsync.clipEnd ?? r.windowEnd } }
        : {}),
    }));
}
