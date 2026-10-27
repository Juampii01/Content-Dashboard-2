import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, generateStructured } from "@/lib/ai/client";
import { COPY_RULES, copySchema, copyTask, SHORTS_RULES, shortsSchema, shortsTask } from "@/lib/ai/prompts/jugo";
import { addDays, todayIn } from "@/lib/calendar/dates";
import { busyDays } from "@/lib/calendar/busy";
import { pickFreeDays } from "@/lib/calendar/free-days";
import { createEntry, entriesForSource, sourcePrefill, type SourceKind } from "@/lib/calendar/service";
import { createCarousel } from "@/lib/carousels/service";
import { isTemplate, type TemplateKey } from "@/lib/carousels/theme";
import { getDb, schema } from "@/lib/db";
import type { RepurposeCopy, RepurposeParts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { insertGeneratedScript } from "@/lib/scripts/service";
import type { RepurposeSource } from "./source";
import { cleanHashtags, rankHashtags } from "./text";

/**
 * "Sacarle todo el jugo": de un contenido salen un carrusel (borrador en Carruseles, con la ficha de textos lista),
 * los textos para cada red y 2 o 3 guiones de shorts (en Guiones). Las tres partes se generan en paralelo después
 * de responder (`after()` en la acción): la pantalla muestra cada una cuando llega y la persona puede irse y volver.
 */
export type PartKey = keyof RepurposeParts;
export const PART_KEYS: PartKey[] = ["carousel", "copy", "shorts"];
/** Si una parte sigue "en curso" después de esto, la generación se cortó (por ejemplo, se reinició el servidor). */
export const STALE_AFTER_MS = 10 * 60_000;

export class RepurposeError extends Error {}

const pending = (): RepurposeParts => ({ carousel: { status: "pending" }, copy: { status: "pending" }, shorts: { status: "pending" } });

export async function startPack(source: RepurposeSource, userId: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.repurposePacks)
    .values({
      sourceKind: source.kind,
      videoProjectId: source.videoProjectId,
      scriptId: source.kind === "guion" ? source.id : source.scriptId,
      contentItemId: source.contentItemId,
      title: source.title.slice(0, 200),
      sourceText: source.text.slice(0, 20_000),
      parts: pending(),
      createdBy: userId,
    })
    .returning({ id: schema.repurposePacks.id });
  return row!.id;
}

async function setPart<K extends PartKey>(packId: string, key: K, value: RepurposeParts[K]): Promise<void> {
  // jsonb_set por parte: las tres terminan en paralelo y ninguna pisa a las otras.
  await getDb().execute(sql`
    update repurpose_packs set parts = jsonb_set(parts, ${`{${key}}`}::text[], ${JSON.stringify(value)}::jsonb), updated_at = now()
    where id = ${packId}
  `);
}

async function loadPack(packId: string) {
  const [pack] = await getDb().select().from(schema.repurposePacks).where(eq(schema.repurposePacks.id, packId)).limit(1);
  if (!pack) throw new RepurposeError("No encontramos ese paquete. Puede que se haya borrado.");
  return pack;
}

const userMessage = (error: unknown, fallback: string) => {
  if (error instanceof AiError) {
    console.error("[jugo] ia", error.detail);
    return error.userMessage;
  }
  console.error("[jugo]", error instanceof Error ? error.message : error);
  return fallback;
};

/** Hashtags que la persona ya usó en sus piezas medidas (últimos 180 días), con su rendimiento. */
export async function measuredHashtags() {
  const rows = await getDb().execute<{ caption: string | null; perf_score: number | null }>(sql`
    select caption, perf_score from content_items
    where available and perf_score is not null and caption like '%#%' and published_at > now() - interval '180 days'
    order by published_at desc limit 400
  `);
  return rankHashtags(rows.rows.map((r) => ({ caption: r.caption, perfScore: r.perf_score == null ? null : Number(r.perf_score) })));
}

/** La plantilla de fábrica que la persona usó por última vez (o Editorial). */
async function preferredTemplate(): Promise<TemplateKey> {
  const rows = await getDb()
    .select({ template: schema.carousels.template })
    .from(schema.carousels)
    .where(eq(schema.carousels.demo, false))
    .orderBy(desc(schema.carousels.updatedAt))
    .limit(10);
  return (rows.map((r) => r.template).find(isTemplate) as TemplateKey | undefined) ?? "editorial";
}

async function runCarousel(pack: typeof schema.repurposePacks.$inferSelect, userId: string | null) {
  try {
    const fromScript = pack.sourceKind === "guion" && pack.scriptId;
    const carouselId = await createCarousel({
      origin: fromScript ? "guion" : "texto",
      topic: pack.title,
      pastedText: fromScript ? null : pack.sourceText,
      scriptId: fromScript ? pack.scriptId : null,
      objective: "guardar",
      slides: 7,
      keyword: null,
      template: await preferredTemplate(),
      userId,
      feature: "jugo.carrusel",
    });
    await setPart(pack.id, "carousel", { status: "ready", carouselId });
  } catch (error) {
    await setPart(pack.id, "carousel", { status: "failed", error: userMessage(error, "No pudimos armar el carrusel. Prueba de nuevo.") });
  }
}

async function runCopy(pack: typeof schema.repurposePacks.$inferSelect, userId: string | null) {
  try {
    const res = await generateStructured({
      feature: "jugo.textos",
      model: "main",
      context: `${COPY_RULES}\n\n${await brandContext(await getBrand())}`,
      task: copyTask({ kind: pack.sourceKind, title: pack.title, text: pack.sourceText, measuredTags: await measuredHashtags() }),
      schema: copySchema,
      maxTokens: 3_000,
      userId,
    });
    const data: RepurposeCopy = {
      instagram: { caption: res.instagram.caption.trim().slice(0, 2200), hashtags: cleanHashtags(res.instagram.hashtags, 5) },
      tiktok: { caption: res.tiktok.caption.trim().slice(0, 2200), hashtags: cleanHashtags(res.tiktok.hashtags, 5) },
      youtube: { title: res.youtube.title.trim().slice(0, 100), description: res.youtube.description.trim().slice(0, 5000), hashtags: cleanHashtags(res.youtube.hashtags, 3) },
    };
    await setPart(pack.id, "copy", { status: "ready", data });
  } catch (error) {
    await setPart(pack.id, "copy", { status: "failed", error: userMessage(error, "No pudimos escribir los textos. Prueba de nuevo.") });
  }
}

async function runShorts(pack: typeof schema.repurposePacks.$inferSelect, userId: string | null) {
  try {
    const words = pack.sourceText.split(/\s+/).length;
    const count = words >= 250 ? 3 : 2;
    const res = await generateStructured({
      feature: "jugo.shorts",
      model: "main",
      context: `${SHORTS_RULES}\n\n${await brandContext(await getBrand())}`,
      task: shortsTask({ kind: pack.sourceKind, title: pack.title, text: pack.sourceText, count }),
      schema: shortsSchema,
      maxTokens: 9_000,
      userId,
    });
    const [parent] = pack.scriptId ? await getDb().select({ pillar: schema.scripts.pillar }).from(schema.scripts).where(eq(schema.scripts.id, pack.scriptId)).limit(1) : [];
    const scriptIds: string[] = [];
    for (const short of res.shorts.slice(0, 3)) {
      if (!short.hooks.length || !short.beats.length) continue;
      scriptIds.push(
        await insertGeneratedScript(short, {
          idea: `Derivado de “${pack.title}”: ${short.from}`.slice(0, 600),
          format: short.format,
          objective: "seguidores",
          pillar: parent?.pillar ?? null,
          sourceContentItemId: pack.contentItemId,
          parentId: pack.scriptId,
          action: "jugo",
          userId,
        }),
      );
    }
    if (!scriptIds.length) throw new RepurposeError("La IA no devolvió guiones utilizables.");
    await setPart(pack.id, "shorts", { status: "ready", scriptIds });
  } catch (error) {
    await setPart(pack.id, "shorts", { status: "failed", error: error instanceof RepurposeError ? "No salieron guiones utilizables. Prueba de nuevo." : userMessage(error, "No pudimos escribir los guiones. Prueba de nuevo.") });
  }
}

const runners = { carousel: runCarousel, copy: runCopy, shorts: runShorts } as const;

/** Genera las partes pendientes (o las indicadas) en paralelo. Nunca tira error: cada parte guarda el suyo. */
export async function runPack(packId: string, userId: string | null, only?: PartKey[]): Promise<void> {
  const pack = await loadPack(packId);
  const keys = (only ?? PART_KEYS).filter((k) => pack.parts[k].status === "pending");
  await Promise.all(keys.map((k) => runners[k](pack, userId)));
  await getDb().execute(sql`update repurpose_packs set finished_at = now() where id = ${packId}
    and parts->'carousel'->>'status' <> 'pending' and parts->'copy'->>'status' <> 'pending' and parts->'shorts'->>'status' <> 'pending'`);
}

/** Vuelve a dejar en pendiente una parte (fallida o cortada) para generarla de nuevo. */
export async function resetPart(packId: string, key: PartKey): Promise<void> {
  const pack = await loadPack(packId);
  const part = pack.parts[key];
  const stale = part.status === "pending" && Date.now() - pack.updatedAt.getTime() > STALE_AFTER_MS;
  if (part.status !== "failed" && !stale) throw new RepurposeError(part.status === "pending" ? "Esa parte todavía se está generando." : "Esa parte ya está lista.");
  await setPart(packId, key, { status: "pending" });
  await getDb().update(schema.repurposePacks).set({ finishedAt: null }).where(eq(schema.repurposePacks.id, packId));
}

export async function saveCopy(packId: string, copy: RepurposeCopy): Promise<void> {
  const pack = await loadPack(packId);
  if (pack.parts.copy.status !== "ready") throw new RepurposeError("Los textos todavía no están listos.");
  await setPart(packId, "copy", {
    status: "ready",
    data: {
      instagram: { caption: copy.instagram.caption, hashtags: cleanHashtags(copy.instagram.hashtags, 30) },
      tiktok: { caption: copy.tiktok.caption, hashtags: cleanHashtags(copy.tiktok.hashtags, 30) },
      youtube: { title: copy.youtube.title, description: copy.youtube.description, hashtags: cleanHashtags(copy.youtube.hashtags, 15) },
    },
  });
}

// ─── Calendario ────────────────────────────────────────────────────────────

/** Una pieza del paquete que se puede programar. */
export type PackPiece = { kind: SourceKind; id: string };

/** Piezas del paquete en el orden en que se reparten: el contenido de origen, el carrusel y los shorts. */
export function packPieces(pack: Pick<typeof schema.repurposePacks.$inferSelect, "sourceKind" | "videoProjectId" | "scriptId" | "parts">): PackPiece[] {
  const out: PackPiece[] = [];
  if (pack.sourceKind === "video" && pack.videoProjectId) out.push({ kind: "editor", id: pack.videoProjectId });
  if (pack.sourceKind === "guion" && pack.scriptId) out.push({ kind: "guion", id: pack.scriptId });
  if (pack.parts.carousel.status === "ready" && pack.parts.carousel.carouselId) out.push({ kind: "carrusel", id: pack.parts.carousel.carouselId });
  for (const id of pack.parts.shorts.status === "ready" ? (pack.parts.shorts.scriptIds ?? []) : []) out.push({ kind: "guion", id });
  return out;
}

function copyNotes(copy: RepurposeCopy | null | undefined, kind: SourceKind): string | null {
  if (!copy) return null;
  if (kind === "carrusel") return null; // el carrusel ya tiene su propio caption
  return [`Caption para Instagram:\n${copy.instagram.caption}\n${copy.instagram.hashtags.join(" ")}`, `TikTok:\n${copy.tiktok.caption}\n${copy.tiktok.hashtags.join(" ")}`, `YouTube: ${copy.youtube.title}`]
    .join("\n\n")
    .slice(0, 4000);
}

/**
 * Agrega al calendario las piezas indicadas (o todas) en los próximos días libres, desde mañana.
 * Las que ya estaban en el calendario no se duplican. Devuelve cuántas creó y en qué días.
 */
export async function schedulePack(packId: string, userId: string, only?: PackPiece): Promise<{ created: { kind: SourceKind; id: string; date: string }[]; skipped: number }> {
  const pack = await loadPack(packId);
  const all = packPieces(pack);
  const pieces = only ? all.filter((p) => p.kind === only.kind && p.id === only.id) : all;
  if (!pieces.length) throw new RepurposeError(only ? "Esa pieza no es de este paquete." : "Todavía no hay piezas listas para programar.");

  const todo: PackPiece[] = [];
  for (const piece of pieces) if (!(await entriesForSource(piece.kind, piece.id)).length) todo.push(piece);
  if (!todo.length) return { created: [], skipped: pieces.length };

  const from = addDays(todayIn(env().APP_TIMEZONE), 1);
  const until = addDays(from, 27);
  const days = pickFreeDays({ from, count: todo.length, busy: await busyDays(from, until), until });
  const created: { kind: SourceKind; id: string; date: string }[] = [];
  for (const [i, piece] of todo.entries()) {
    const prefill = await sourcePrefill(piece.kind, piece.id);
    if (!prefill) continue;
    const date = days[i] ?? null;
    await createEntry(
      {
        title: prefill.title.slice(0, 160),
        notes: copyNotes(pack.parts.copy.data, piece.kind),
        hook: prefill.hook,
        pillar: prefill.pillar,
        format: prefill.format,
        status: prefill.status,
        platforms: prefill.platforms,
        scheduledDate: date,
        scheduledTime: null,
        scriptId: prefill.scriptId,
        carouselId: prefill.carouselId,
        cloneVideoId: prefill.cloneVideoId,
        videoProjectId: prefill.videoProjectId,
        source: "jugo",
      },
      userId,
    );
    if (date) created.push({ kind: piece.kind, id: piece.id, date });
  }
  return { created, skipped: pieces.length - todo.length };
}
