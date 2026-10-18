"use server";

import { refresh } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { brandContext, getBrand, topOwnPieces } from "@/lib/ai/brand-context";
import { AiError, generateStructured } from "@/lib/ai/client";
import { LANGUAGES } from "@/lib/ai/language";
import { brandDraftContext, brandDraftSchema, brandDraftTask, VOICE_TEST_TASK, voiceTestSchema, type BrandDraft, type VoiceTest } from "@/lib/ai/prompts/marca";
import { WRITING_RULES } from "@/lib/ai/prompts/guiones";
import { allowAttempt } from "@/lib/rate-limit";
import { getDb, schema } from "@/lib/db";

const text = (max: number) => z.string().trim().max(max);
const list = (maxItems: number, maxLen = 300) => z.array(z.string().trim().max(maxLen)).max(maxItems).transform((a) => a.filter(Boolean));

const brandInput = z.object({
  name: text(120),
  handle: text(80),
  niche: text(300),
  whatYouSell: text(600),
  differentiator: text(600),
  audience: text(1200),
  audiencePains: list(15),
  audienceDesires: list(15),
  objections: list(15),
  beliefs: list(10),
  tone: text(600),
  signaturePhrases: list(15, 200),
  bannedWords: list(40, 60),
  emojiPolicy: z.enum(["ninguno", "pocos", "libres"]),
  language: z.enum(Object.keys(LANGUAGES) as [keyof typeof LANGUAGES, ...(keyof typeof LANGUAGES)[]]),
  voiceSamples: z.array(z.object({ source: text(120), text: text(4000) })).max(8).transform((a) => a.filter((s) => s.text)),
  offers: z
    .array(z.object({ name: text(120), promise: text(400), cta: text(400), keyword: text(40).optional(), link: text(300).optional(), when: text(300).optional() }))
    .max(6)
    .transform((a) => a.filter((o) => o.name)),
  pillars: z.array(z.object({ name: text(80), description: text(400), share: z.number().min(0).max(100) })).max(8).transform((a) => a.filter((p) => p.name)),
  extraContext: text(3000),
});
export type BrandInput = z.input<typeof brandInput>;

export async function saveBrandAction(input: BrandInput): Promise<{ ok: boolean; error?: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = brandInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Revisa el campo "${parsed.error.issues[0]?.path.join(".")}": ${parsed.error.issues[0]?.message}` };
  const d = parsed.data;
  const values = { ...d, name: d.name || null, handle: d.handle || null, niche: d.niche || null, whatYouSell: d.whatYouSell || null, differentiator: d.differentiator || null, audience: d.audience || null, tone: d.tone || null, extraContext: d.extraContext || null };
  await getDb()
    .insert(schema.brandProfile)
    .values({ id: "brand", ...values })
    .onConflictDoUpdate({ target: schema.brandProfile.id, set: { ...values, version: sql`${schema.brandProfile.version} + 1` } });
  refresh();
  return { ok: true };
}

const draftInput = z.object({
  name: text(120),
  whatYouSell: text(600),
  audience: text(1200),
  differentiator: text(600),
  neverSay: text(600),
  language: z.string().max(10),
  samples: z.array(z.object({ source: text(120), text: text(4000) })).max(6),
});

export async function draftBrandAction(input: z.input<typeof draftInput>): Promise<{ ok: true; draft: BrandDraft } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = draftInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Alguna respuesta es demasiado larga." };
  const d = parsed.data;
  if (!d.whatYouSell && !d.audience && d.samples.length === 0) return { ok: false, error: "Cuéntanos al menos qué vendes y a quién, o pega una muestra de cómo hablas." };
  try {
    const top = await topOwnPieces(6);
    const draft = await generateStructured({
      feature: "marca.borrador",
      model: "main",
      context: brandDraftContext(d.language),
      task: brandDraftTask({ ...d, topPieces: top.map((t) => t.text) }),
      schema: brandDraftSchema,
      maxTokens: 4000,
      userId: user.id,
    });
    return { ok: true, draft };
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[ia]", error.detail);
      return { ok: false, error: error.userMessage };
    }
    console.error("[marca]", error);
    return { ok: false, error: "No pudimos armar el perfil. Prueba de nuevo." };
  }
}

export async function voiceTestAction(): Promise<{ ok: true; test: VoiceTest } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!(await allowAttempt(`prueba-voz:${user.id}`, 20, 3600))) return { ok: false, error: "Hiciste muchas pruebas seguidas. Espera un rato." };
  try {
    const brand = await getBrand();
    const test = await generateStructured({
      feature: "marca.prueba",
      model: "main",
      context: `${WRITING_RULES}\n\n${await brandContext(brand)}`,
      task: VOICE_TEST_TASK,
      schema: voiceTestSchema,
      maxTokens: 1500,
      userId: user.id,
    });
    return { ok: true, test };
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[ia]", error.detail);
      return { ok: false, error: error.userMessage };
    }
    console.error("[marca] prueba", error);
    return { ok: false, error: "No pudimos escribir la prueba. Prueba de nuevo." };
  }
}
