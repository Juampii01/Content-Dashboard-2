"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, generateStructured } from "@/lib/ai/client";
import { TRANSLATE_RULES, translateSchema, translateTask } from "@/lib/ai/prompts/clon";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { getTranslationSource } from "@/lib/dal/clone";
import { balanceFromUser, HeyGenError } from "@/lib/heygen/client";
import { cloneLanguage, sortLanguages } from "@/lib/heygen/languages";
import { balanceShortfall, estimateSpeech, estimateTranslation } from "@/lib/heygen/pricing";
import { loadHeyGen } from "@/lib/heygen/service";
import { runTranslation } from "@/lib/heygen/translation";
import { fileDriver, fileInfo } from "@/lib/storage/files";

/**
 * Acciones de "Traducir con tu clon" (Videos con clon → Traducir).
 * Lectura con getCurrentUser; escritura con requireEditor. Todo lo que cuesta saldo se vuelve a calcular aquí.
 */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const NO_KEY = "Todavía no hay una API key de HeyGen guardada. El dueño de la cuenta la agrega en Ajustes → Claves de servicios.";

function fail(error: unknown, scope: string): { ok: false; error: string } {
  if (error instanceof HeyGenError) {
    console.error(`[clon] ${scope}:`, error.detail);
    return { ok: false, error: error.userMessage };
  }
  if (error instanceof AiError) return { ok: false, error: error.message };
  console.error(`[clon] ${scope}:`, error instanceof Error ? error.message : "error");
  return { ok: false, error: "Algo salió mal al hablar con HeyGen. Vuelve a intentarlo en unos minutos." };
}

// ─── Idiomas ──────────────────────────────────────────────────────────────

export async function listTranslationLanguagesAction(): Promise<ActionResult<string[]>> {
  await getCurrentUser();
  const conn = await loadHeyGen();
  if (!conn) return { ok: false, error: NO_KEY };
  try {
    return { ok: true, data: sortLanguages(await conn.client.listTranslationLanguages()) };
  } catch (error) {
    return fail(error, "idiomas");
  }
}

// ─── Subir un video para traducir ─────────────────────────────────────────

const UPLOAD_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" };
const MAX_UPLOAD = 209_715_200; // lo que acepta la subida directa de HeyGen

/** Reserva la ruta donde el navegador sube el video (directo al almacenamiento, sin pasar por la app). */
export async function prepareTranslationUploadAction(input: { name: string; size: number; type: string }): Promise<ActionResult<{ key: string; mode: "blob" | "local" }>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = z.object({ name: z.string().max(300), size: z.number().int().min(1), type: z.string().max(100) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Elige un archivo de video." };
  const ext = UPLOAD_TYPES[parsed.data.type];
  if (!ext) return { ok: false, error: "HeyGen traduce videos MP4 o WebM. Exporta tu video en MP4 y vuelve a intentarlo." };
  if (parsed.data.size > MAX_UPLOAD) return { ok: false, error: `El video pesa ${Math.round(parsed.data.size / 1024 ** 2)} MB y HeyGen acepta hasta 200 MB. Exporta una versión más liviana.` };
  const driver = fileDriver();
  if (!driver) return { ok: false, error: "Esta instalación no tiene almacenamiento de archivos para subir videos." };
  return { ok: true, data: { key: `clon/subidas/${randomUUID()}/original.${ext}`, mode: driver } };
}

// ─── Traducir el video (HeyGen Video Translation) ─────────────────────────

const sourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("editor"), id: z.uuid() }),
  z.object({ type: z.literal("clone"), id: z.uuid() }),
  z.object({
    type: z.literal("upload"),
    key: z.string().regex(/^clon\/subidas\/[0-9a-f-]{36}\/original\.(mp4|webm)$/),
    title: z.string().trim().min(1).max(120),
    seconds: z.number().min(1).max(4 * 3600),
    aspectRatio: z.enum(["9:16", "1:1", "16:9"]),
  }),
]);

const translationSchema = z.object({
  source: sourceSchema,
  title: z.string().trim().min(1, "Ponle un título.").max(120),
  language: z.string().trim().min(1, "Elige un idioma.").max(80),
  mode: z.enum(["speed", "precision", "audio_only"]),
  confirmedCostUsd: z.number().min(0),
});

export type CreateTranslationInput = z.input<typeof translationSchema>;

export async function createTranslationAction(input: CreateTranslationInput): Promise<ActionResult<{ id: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = translationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos de la traducción." };
  const d = parsed.data;
  const conn = await loadHeyGen();
  if (!conn) return { ok: false, error: NO_KEY };

  // El idioma tiene que estar en la lista de HeyGen (se manda tal cual la nombra su API).
  try {
    const languages = await conn.client.listTranslationLanguages();
    if (!languages.includes(d.language)) return { ok: false, error: "HeyGen no ofrece ese idioma. Elige otro de la lista." };
  } catch (error) {
    return fail(error, "idiomas antes de traducir");
  }

  // Origen y duración: del servidor (salvo en un archivo subido, donde la duración la mide el navegador).
  let source: NonNullable<typeof schema.cloneVideos.$inferInsert.source>;
  let seconds: number;
  let aspectRatio: string;
  if (d.source.type === "upload") {
    const info = await fileInfo(d.source.key);
    if (!info) return { ok: false, error: "No encontramos el video subido. Súbelo de nuevo." };
    if (info.size > MAX_UPLOAD) return { ok: false, error: "El video supera los 200 MB que acepta HeyGen." };
    source = { type: "upload", id: null, title: d.source.title, mode: d.mode, key: d.source.key };
    seconds = d.source.seconds;
    aspectRatio = d.source.aspectRatio;
  } else {
    const origin = await getTranslationSource(d.source.type, d.source.id);
    if (!origin) return { ok: false, error: "Ese video ya no está listo para traducir." };
    if (!origin.seconds) return { ok: false, error: "No sabemos cuánto dura ese video, así que no podemos estimar el costo. Vuelve a renderizarlo." };
    if (origin.key) {
      const info = await fileInfo(origin.key);
      if (!info) return { ok: false, error: "No encontramos el archivo de ese video. Vuelve a renderizarlo." };
      if (info.size > MAX_UPLOAD) return { ok: false, error: `El video pesa ${Math.round(info.size / 1024 ** 2)} MB y HeyGen acepta hasta 200 MB.` };
    }
    source = { type: origin.type, id: origin.id, title: origin.title, mode: d.mode, key: origin.key };
    seconds = origin.seconds;
    aspectRatio = origin.aspectRatio;
  }

  const estimate = estimateTranslation(seconds, d.mode);
  if (Math.abs(estimate.usd - d.confirmedCostUsd) > 0.01) return { ok: false, error: "La estimación cambió desde que la confirmaste. Revisa el monto y confirma de nuevo." };
  try {
    const blocked = balanceShortfall(balanceFromUser(await conn.client.getMe()), estimate);
    if (blocked) return { ok: false, error: `${blocked} Carga saldo en HeyGen o elige el modo «Solo audio».` };
  } catch (error) {
    return fail(error, "saldo antes de traducir");
  }

  const [row] = await getDb()
    .insert(schema.cloneVideos)
    .values({
      kind: "translation",
      title: d.title,
      scriptText: "",
      engine: "translation",
      aspectRatio,
      resolution: "original",
      language: d.language,
      source,
      sourceSeconds: seconds,
      estimatedSeconds: Math.round(seconds),
      estimatedCostUsd: estimate.usd,
      createdBy: user.id,
    })
    .returning({ id: schema.cloneVideos.id });

  // Subir el video a HeyGen puede tardar unos minutos: se hace después de responder.
  after(() => runTranslation(row!.id, conn.client));
  refresh();
  return { ok: true, data: { id: row!.id } };
}

// ─── Video nuevo con tu clon en otro idioma ───────────────────────────────

/** Claude adapta el texto (no lo traduce literal) al idioma y al mercado elegidos, con la marca. */
export async function translateScriptAction(input: { source: { type: "editor" | "clone"; id: string }; languageKey: string }): Promise<ActionResult<{ title: string; text: string; notes: string[] }>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = z.object({ source: z.object({ type: z.enum(["editor", "clone"]), id: z.uuid() }), languageKey: z.string().max(10) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pedido no válido." };
  const lang = cloneLanguage(parsed.data.languageKey);
  if (!lang) return { ok: false, error: "Ese idioma no está disponible." };
  const origin = await getTranslationSource(parsed.data.source.type, parsed.data.source.id);
  if (!origin?.text) return { ok: false, error: "Ese video no tiene texto para adaptar." };
  try {
    const brand = await getBrand();
    const result = await generateStructured({
      feature: "clon.traducir",
      context: `${TRANSLATE_RULES}\n\n${await brandContext(brand)}`,
      task: translateTask({ title: origin.title, text: origin.text.slice(0, 12_000), languageName: lang.label.toLowerCase(), market: lang.market }),
      schema: translateSchema,
      maxTokens: 6000,
      userId: user.id,
    });
    return { ok: true, data: { title: result.title.slice(0, 120), text: result.text.trim(), notes: result.notes.slice(0, 5) } };
  } catch (error) {
    return fail(error, "adaptar texto");
  }
}

/**
 * Prueba de voz: unos segundos del texto con la voz elegida en el otro idioma (POST /v3/voices/speech), para escuchar
 * cómo suena la voz clonada en inglés antes de pagar el video. Cuesta centavos (Starfish: US$ 0.12 por minuto).
 */
export async function previewVoiceAction(input: { voiceId: string; text: string; languageKey: string }): Promise<ActionResult<{ audioUrl: string; seconds: number; costUsd: number }>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = z.object({ voiceId: z.string().min(1).max(200), text: z.string().trim().min(3).max(5000), languageKey: z.string().max(10) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Escribe el texto antes de probar la voz." };
  const lang = cloneLanguage(parsed.data.languageKey);
  if (!lang) return { ok: false, error: "Ese idioma no está disponible." };
  const conn = await loadHeyGen();
  if (!conn) return { ok: false, error: NO_KEY };
  // Solo el primer párrafo (o 300 caracteres): alcanza para escuchar el acento.
  const sample = (parsed.data.text.split(/\n\s*\n/)[0] ?? parsed.data.text).slice(0, 300);
  try {
    const speech = await conn.client.generateSpeech({ text: sample, voice_id: parsed.data.voiceId, language: lang.language, locale: lang.locale });
    return { ok: true, data: { audioUrl: speech.audio_url, seconds: speech.duration, costUsd: estimateSpeech(speech.duration).usd } };
  } catch (error) {
    if (error instanceof HeyGenError && error.kind === "INVALID") {
      return { ok: false, error: "HeyGen no pudo hablar en ese idioma con esta voz. Prueba con otra voz o con «Traducir este video», que clona tu voz del video." };
    }
    return fail(error, "prueba de voz");
  }
}
