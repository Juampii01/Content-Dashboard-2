import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { generateStructured, type ModelKey } from "@/lib/ai/client";
import {
  adaptTask,
  beatSchemaOnly,
  beatsSchema,
  beatTask,
  ctaSchema,
  ctaTask,
  generateTask,
  hooksSchema,
  hooksTask,
  rewriteBeatsTask,
  scriptAsText,
  scriptSchema,
  WRITING_RULES,
  type FormatKey,
  type GeneratedScript,
  type ObjectiveKey,
} from "@/lib/ai/prompts/guiones";
import { getDb, schema } from "@/lib/db";
import type { ScriptContent } from "@/lib/db/schema";
import { scriptStats } from "./stats";

/**
 * Lógica de Guiones: generar, reescribir partes, adaptar y versionar.
 * Toda acción de IA guarda una versión nueva: siempre se puede volver atrás.
 */
async function context(): Promise<string> {
  return `${WRITING_RULES}\n\n${await brandContext(await getBrand())}`;
}

function toContent(g: GeneratedScript): ScriptContent {
  return {
    title: g.title,
    angle: g.angle,
    hooks: g.hooks.slice(0, 5).map((h) => ({ ...h, score: Math.max(1, Math.min(10, Math.round(h.score))) })),
    selectedHook: 0,
    beats: g.beats.map((b) => ({ ...b, id: randomUUID().slice(0, 8), seconds: Math.max(1, Math.round(b.seconds)) })),
    cta: { spoken: g.cta.spoken, onScreenText: g.cta.onScreenText, offer: g.cta.offer || null },
    caption: g.caption,
  };
}

async function saveVersion(scriptId: string, content: ScriptContent, action: string, userId: string) {
  const db = getDb();
  const stats = scriptStats(content);
  await db.update(schema.scripts).set({ content, title: content.title, ...stats }).where(eq(schema.scripts.id, scriptId));
  await db.insert(schema.scriptVersions).values({ scriptId, content, action, createdBy: userId });
}

export async function createScript(input: {
  idea: string;
  format: FormatKey;
  objective: ObjectiveKey;
  pillar: string | null;
  offer: string | null;
  reference: string | null;
  referenceLabel: string | null;
  sourceContentItemId: string | null;
  sourceUrl: string | null;
  userId: string | null;
  /** Nombre del consumo en ai_usage (por defecto "guiones.generar"; el autopiloto usa el suyo). */
  feature?: string;
}): Promise<string> {
  const generated = await generateStructured({
    feature: input.feature ?? "guiones.generar",
    model: input.format === "YT_LONG" ? "deep" : "main",
    context: await context(),
    task: generateTask(input),
    schema: scriptSchema,
    maxTokens: input.format === "YT_LONG" ? 12_000 : 4_000,
    userId: input.userId,
  });
  return insertGeneratedScript(generated, {
    idea: input.idea,
    format: input.format,
    objective: input.objective,
    pillar: input.pillar,
    sourceText: input.reference,
    sourceUrl: input.sourceUrl,
    sourceContentItemId: input.sourceContentItemId,
    parentId: null,
    userId: input.userId,
  });
}

/**
 * Guarda como guion nuevo (en borrador, con su primera versión) un guion que ya generó la IA.
 * Lo usan createScript y otros módulos que generan varios guiones en una sola llamada ("Sacarle todo el jugo").
 */
export async function insertGeneratedScript(
  generated: GeneratedScript,
  meta: {
    idea: string | null;
    format: FormatKey;
    objective: ObjectiveKey | null;
    pillar: string | null;
    sourceText?: string | null;
    sourceUrl?: string | null;
    sourceContentItemId?: string | null;
    parentId?: string | null;
    action?: string;
    userId: string | null;
  },
): Promise<string> {
  const content = toContent(generated);
  const [row] = await getDb()
    .insert(schema.scripts)
    .values({
      title: content.title,
      idea: meta.idea,
      format: meta.format,
      objective: meta.objective,
      pillar: meta.pillar,
      status: "DRAFT",
      content,
      ...scriptStats(content),
      sourceText: meta.sourceText ?? null,
      sourceUrl: meta.sourceUrl ?? null,
      sourceContentItemId: meta.sourceContentItemId ?? null,
      parentId: meta.parentId ?? null,
      createdBy: meta.userId,
    })
    .returning({ id: schema.scripts.id });
  await getDb().insert(schema.scriptVersions).values({ scriptId: row!.id, content, action: meta.action ?? "generar", createdBy: meta.userId });
  return row!.id;
}

async function load(scriptId: string) {
  const [script] = await getDb().select().from(schema.scripts).where(eq(schema.scripts.id, scriptId)).limit(1);
  if (!script?.content) throw new Error("No encontramos ese guion.");
  return script as typeof script & { content: ScriptContent };
}

export type ScriptAction =
  | { kind: "ganchos" }
  | { kind: "acortar" }
  | { kind: "directo" }
  | { kind: "beat"; beatId: string; instruction: string }
  | { kind: "cta" };

export async function applyAction(scriptId: string, action: ScriptAction, userId: string): Promise<ScriptContent> {
  const script = await load(scriptId);
  const content = structuredClone(script.content);
  const text = scriptAsText(content);
  const ctx = await context();
  const call = <S extends Parameters<typeof generateStructured>[0]["schema"]>(feature: string, task: string, s: S, model: ModelKey = "fast") =>
    generateStructured({ feature, model, context: ctx, task, schema: s, userId });

  if (action.kind === "ganchos") {
    const res = await call("guiones.ganchos", hooksTask(text, script.idea ?? content.title, content.hooks.map((h) => h.text)), hooksSchema, "main");
    content.hooks = res.hooks.slice(0, 5).map((h) => ({ ...h, score: Math.max(1, Math.min(10, Math.round(h.score))) }));
    content.selectedHook = 0;
  } else if (action.kind === "acortar" || action.kind === "directo") {
    const beatsJson = JSON.stringify(content.beats.map(({ purpose, spoken, onScreenText, broll, seconds }) => ({ purpose, spoken, onScreenText, broll, seconds })));
    const res = await call(`guiones.${action.kind}`, rewriteBeatsTask(action.kind, text, beatsJson, script.format), beatsSchema);
    content.beats = res.beats.map((b) => ({ ...b, id: randomUUID().slice(0, 8), seconds: Math.max(1, Math.round(b.seconds)) }));
  } else if (action.kind === "beat") {
    const index = content.beats.findIndex((b) => b.id === action.beatId);
    if (index < 0) throw new Error("Ese bloque ya no existe.");
    const { purpose, spoken, onScreenText, broll, seconds } = content.beats[index]!;
    const res = await call("guiones.bloque", beatTask(text, JSON.stringify({ purpose, spoken, onScreenText, broll, seconds }), action.instruction.slice(0, 300)), beatSchemaOnly);
    content.beats[index] = { ...res.beat, id: action.beatId, seconds: Math.max(1, Math.round(res.beat.seconds)) };
  } else if (action.kind === "cta") {
    const brand = await getBrand();
    const offer = brand?.offers.find((o) => o.name === content.cta.offer) ?? brand?.offers[0] ?? null;
    const res = await call("guiones.cta", ctaTask(text, (script.objective as ObjectiveKey) ?? "seguidores", offer ? `${offer.name}: ${offer.promise}. CTA: ${offer.cta}` : null), ctaSchema);
    content.cta = { spoken: res.cta.spoken, onScreenText: res.cta.onScreenText, offer: res.cta.offer || null };
    content.caption = res.caption;
  }

  await saveVersion(scriptId, content, action.kind, userId);
  return content;
}

/** Guarda lo que la persona editó a mano. */
export async function saveEdits(scriptId: string, content: ScriptContent, userId: string): Promise<void> {
  await load(scriptId);
  await saveVersion(scriptId, content, "editar", userId);
}

/** Adapta el guion a otro formato: crea un guion nuevo vinculado al original. */
export async function adaptScript(scriptId: string, to: FormatKey, userId: string): Promise<string> {
  const script = await load(scriptId);
  const generated = await generateStructured({
    feature: "guiones.adaptar",
    model: "deep",
    context: await context(),
    task: adaptTask(scriptAsText(script.content), script.format, to),
    schema: scriptSchema,
    maxTokens: to === "YT_LONG" ? 12_000 : 4_000,
    userId,
  });
  const content = toContent(generated);
  const [row] = await getDb()
    .insert(schema.scripts)
    .values({
      title: content.title,
      idea: script.idea,
      format: to,
      objective: script.objective,
      pillar: script.pillar,
      status: "DRAFT",
      content,
      ...scriptStats(content),
      parentId: script.id,
      createdBy: userId,
    })
    .returning({ id: schema.scripts.id });
  await getDb().insert(schema.scriptVersions).values({ scriptId: row!.id, content, action: "adaptar", createdBy: userId });
  return row!.id;
}

export async function restoreVersion(scriptId: string, versionId: string, userId: string): Promise<ScriptContent> {
  const [version] = await getDb().select().from(schema.scriptVersions).where(eq(schema.scriptVersions.id, versionId)).limit(1);
  if (!version || version.scriptId !== scriptId) throw new Error("Esa versión no existe.");
  await saveVersion(scriptId, version.content, "restaurar", userId);
  return version.content;
}

export async function listVersions(scriptId: string) {
  return getDb()
    .select({ id: schema.scriptVersions.id, action: schema.scriptVersions.action, createdAt: schema.scriptVersions.createdAt })
    .from(schema.scriptVersions)
    .where(eq(schema.scriptVersions.scriptId, scriptId))
    .orderBy(desc(schema.scriptVersions.createdAt))
    .limit(30);
}
