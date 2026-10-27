import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { AiError, generateStructured } from "@/lib/ai/client";
import { effectParamsTask, effectParamsWireSchema, EFFECT_PARAMS_RULES } from "@/lib/ai/prompts/compos";
import { getDb, schema } from "@/lib/db";
import { copyKey, readUrl } from "@/lib/storage";
import type { EditPlan, VideoFormat } from "../types";
import type { Timeline } from "../timeline";
import type { FxBrand, Box } from "../fx/compile";
import { readDirector } from "../director/types";
import { compileComposition, composSegments, needsMask, newComposId, type ComposImage, type Composition } from "./schema";
import { codeHash, validateComposition } from "./validate";
import { categoryOf, describeEffect, fillParams, rankCandidates, type LibraryCandidate } from "./library";
import { normalizedHash } from "./library-hash";

/**
 * Mis efectos en el servidor: guardar las animaciones creadas (solas al renderizar o a mano), listarlas para la
 * Biblioteca del Estudio, ponerlas en otro video (con sus textos adaptados al tramo y el código validado otra vez en
 * el sandbox) y ofrecérselas al taller de animaciones para reusarlas en lugar de escribir una nueva.
 *
 * Seguridad: el código guardado viene siempre de un plan del servidor (nunca del navegador) y se vuelve a validar
 * cada vez que se usa. Las imágenes se copian a `editor/efectos/<id>/` al guardar y a `editor/<proyecto>/compos/` al
 * usarlas, así cada video solo lee archivos propios.
 */

type Row = typeof schema.createdEffects.$inferSelect;

export type MyEffect = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  duration: number;
  params: Composition["params"];
  usesMask: boolean;
  usesImages: boolean;
  favorite: boolean;
  usedCount: number;
  lastUsedAt: string | null;
  version: number;
  rootId: string | null;
  sourceKind: string;
  sourceTitle: string | null;
  referenceUrl: string | null;
  savedBy: string;
  createdAt: string;
  posterUrl: string | null;
  sampleUrl: string | null;
};

const ext = (key: string) => (key.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";

async function signed(key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return await readUrl(key, { ttlSec: 6 * 3600 });
  } catch {
    return null;
  }
}

async function view(r: Row): Promise<MyEffect> {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    tags: r.tags,
    duration: r.duration,
    params: r.params,
    usesMask: r.usesMask,
    usesImages: r.images.length > 0,
    favorite: r.favorite,
    usedCount: r.usedCount,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    version: r.version,
    rootId: r.rootId,
    sourceKind: r.sourceKind,
    sourceTitle: r.sourceTitle,
    referenceUrl: r.referenceUrl,
    savedBy: r.savedBy,
    createdAt: r.createdAt.toISOString(),
    posterUrl: await signed(r.posterKey),
    sampleUrl: await signed(r.sampleKey),
  };
}

/** Los efectos guardados (sin los quitados), los favoritos y los más nuevos primero. */
export async function listMyEffects(): Promise<MyEffect[]> {
  const rows = await getDb().select().from(schema.createdEffects).where(isNull(schema.createdEffects.removedAt)).orderBy(desc(schema.createdEffects.favorite), desc(schema.createdEffects.createdAt)).limit(300);
  return Promise.all(rows.map(view));
}

export async function loadEffect(id: string): Promise<Row | null> {
  const [row] = await getDb().select().from(schema.createdEffects).where(eq(schema.createdEffects.id, id)).limit(1);
  return row ?? null;
}

// ─── Guardar ─────────────────────────────────────────────────────────────

export type SaveResult = { id: string; status: "created" | "version" | "exists" | "restored" | "skipped"; name: string; version: number };

type ProjectInfo = { id: string; title: string; director: unknown };

/**
 * Guarda una composición del plan de un proyecto (el plan del servidor: su código ya pasó la validación). Sin
 * duplicados por la huella normalizada; si viene de un efecto guardado (o de otra versión de la misma animación del
 * mismo video) y el código cambió, queda como versión nueva de esa familia.
 * `by: "auto"` (render) no vuelve a guardar lo que la persona quitó de Mis efectos; `"manual"` lo recupera.
 */
export async function saveComposition(project: ProjectInfo, comp: Composition, duration: number, by: "auto" | "manual", userId: string | null = null): Promise<SaveResult> {
  const db = getDb();
  const hash = normalizedHash(comp.code);
  const [same] = await db.select().from(schema.createdEffects).where(eq(schema.createdEffects.codeHash, hash)).limit(1);
  if (same) {
    if (same.removedAt && by === "manual") {
      await db.update(schema.createdEffects).set({ removedAt: null, savedBy: "manual" }).where(eq(schema.createdEffects.id, same.id));
      return { id: same.id, status: "restored", name: same.name, version: same.version };
    }
    return { id: same.id, status: same.removedAt ? "skipped" : "exists", name: same.name, version: same.version };
  }
  // ¿Variante de algo guardado? El efecto del que salió, o una versión anterior de esta misma animación.
  let origin: Row | null = comp.lib_id ? await loadEffect(comp.lib_id) : null;
  if (!origin) {
    const [prev] = await db
      .select()
      .from(schema.createdEffects)
      .where(and(eq(schema.createdEffects.sourceProjectId, project.id), eq(schema.createdEffects.sourceCompId, comp.id)))
      .orderBy(desc(schema.createdEffects.version))
      .limit(1);
    origin = prev ?? null;
  }
  const id = randomUUID();
  const rootId = origin ? (origin.rootId ?? origin.id) : id;
  let version = 1;
  if (origin) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schema.createdEffects.version}), 1)` }).from(schema.createdEffects).where(sql`coalesce(${schema.createdEffects.rootId}, ${schema.createdEffects.id}) = ${rootId}`);
    version = Number(max) + 1;
  }
  // Imágenes: una copia propia del efecto (el video de origen se puede borrar).
  const images: Row["images"] = [];
  for (const g of comp.images ?? []) {
    const key = `editor/efectos/${id}/${g.id}.${ext(g.key)}`;
    try {
      await copyKey(g.key, key);
      images.push({ ...g, key });
    } catch (error) {
      console.error("[mis-efectos] no se pudo copiar una imagen:", error instanceof Error ? error.message : error);
    }
  }
  const reference = readDirector(project.director).reference;
  const name = (origin?.name ?? comp.name).slice(0, 60);
  const tags = (comp.tags ?? []).slice(0, 6);
  const inserted = await db
    .insert(schema.createdEffects)
    .values({
      id,
      name,
      description: describeEffect(comp),
      category: categoryOf(comp),
      code: comp.code,
      codeHash: hash,
      params: comp.params,
      sounds: (comp.sounds ?? []).map((s) => ({ at: s.at, name: s.name, gain: s.gain })),
      hideCaptions: Boolean(comp.hide_captions),
      tags,
      duration: Math.round(duration * 100) / 100,
      usesMask: needsMask(comp.code),
      images,
      sourceProjectId: project.id,
      sourceCompId: comp.id,
      sourceKind: comp.source,
      sourceTitle: project.title.slice(0, 120),
      referenceUrl: comp.source === "copy" && reference?.source.kind === "link" ? reference.source.url.slice(0, 500) : null,
      rootId,
      version,
      savedBy: by,
      createdBy: userId,
    })
    .onConflictDoNothing({ target: schema.createdEffects.codeHash })
    .returning({ id: schema.createdEffects.id });
  if (!inserted.length) {
    // Otro guardado ganó la carrera con el mismo código.
    const [row] = await db.select().from(schema.createdEffects).where(eq(schema.createdEffects.codeHash, hash)).limit(1);
    return { id: row!.id, status: "exists", name: row!.name, version: row!.version };
  }
  return { id, status: origin ? "version" : "created", name, version };
}

/** Cuenta un uso por video (aunque se renderice varias veces). */
async function recordUse(effectId: string, projectId: string): Promise<void> {
  const db = getDb();
  const added = await db.insert(schema.createdEffectUses).values({ effectId, projectId }).onConflictDoNothing().returning({ effectId: schema.createdEffectUses.effectId });
  if (added.length) await db.update(schema.createdEffects).set({ usedCount: sql`${schema.createdEffects.usedCount} + 1`, lastUsedAt: new Date() }).where(eq(schema.createdEffects.id, effectId));
}

/**
 * Al renderizar: guarda solas las animaciones validadas que siguen en el video, cuenta el uso y deja anotado en cada
 * animación de qué efecto es (`lib_id`). Devuelve el plan con esa marca y los efectos a los que les falta su muestra
 * (el worker la saca del mismo render). Si algo falla, el render sigue igual.
 */
export async function saveFromRender(project: ProjectInfo, plan: EditPlan, timeline: Pick<Timeline, "words" | "duration">): Promise<{ plan: EditPlan; samples: { effectId: string; compId: string }[] }> {
  const comps = plan.compositions ?? [];
  if (!comps.length) return { plan, samples: [] };
  const segs = composSegments(timeline, comps);
  const samples: { effectId: string; compId: string }[] = [];
  const marked: Composition[] = [];
  for (const c of comps) {
    const seg = segs.find((s) => s.id === c.id);
    if (!seg || !c.checked || c.checked !== codeHash(c.code)) {
      marked.push(c);
      continue;
    }
    try {
      const saved = await saveComposition(project, c, seg.end - seg.start, "auto");
      if (saved.status === "skipped") {
        marked.push(c);
        continue;
      }
      await recordUse(saved.id, project.id);
      const row = await loadEffect(saved.id);
      if (row && !row.sampleKey && !samples.some((s) => s.effectId === row.id)) samples.push({ effectId: row.id, compId: c.id });
      marked.push({ ...c, lib_id: saved.id });
    } catch (error) {
      console.error("[mis-efectos] no se pudo guardar una animación:", error instanceof Error ? error.message : error);
      marked.push(c);
    }
  }
  return { plan: { ...plan, compositions: marked }, samples: samples.slice(0, 8) };
}

// ─── Editar desde la Biblioteca ──────────────────────────────────────────

export async function renameEffect(id: string, name: string): Promise<boolean> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return false;
  const res = await getDb().update(schema.createdEffects).set({ name: clean }).where(eq(schema.createdEffects.id, id)).returning({ id: schema.createdEffects.id });
  return res.length > 0;
}

export async function setFavorite(id: string, favorite: boolean): Promise<boolean> {
  const res = await getDb().update(schema.createdEffects).set({ favorite }).where(eq(schema.createdEffects.id, id)).returning({ id: schema.createdEffects.id });
  return res.length > 0;
}

/** Quita de Mis efectos (queda oculto para no volver a guardarse solo; los videos que lo usan no cambian). */
export async function removeEffect(id: string): Promise<boolean> {
  const res = await getDb().update(schema.createdEffects).set({ removedAt: new Date() }).where(eq(schema.createdEffects.id, id)).returning({ id: schema.createdEffects.id });
  return res.length > 0;
}

/** Muestra que dejó el worker (claves fijas del efecto). */
export async function setSample(id: string, keys: { posterKey: string | null; sampleKey: string | null }): Promise<void> {
  await getDb().update(schema.createdEffects).set(keys).where(eq(schema.createdEffects.id, id));
}

// ─── Usar un efecto en un video ──────────────────────────────────────────

/** Lo que hace falta del video para armar y validar una composición. */
export type PlaceCtx = {
  projectId: string;
  timeline: Timeline;
  format: VideoFormat;
  brand: FxBrand;
  captionsVisible: boolean;
  face: (span: { start: number; end: number }) => Box;
  /** Palabras del tramo (con las correcciones de la revisión). */
  spoken: (from: number, to: number) => { text: string; emphasis: boolean }[];
};

export class EffectUseError extends Error {}

/**
 * Arma la composición de un efecto guardado para el tramo [from, to] de otro video: copia sus imágenes al proyecto,
 * pone los textos (los que se pasan, o los de por defecto) y vuelve a validar el código con los datos del video.
 */
export async function buildFromEffect(ctx: PlaceCtx, effect: Row, input: { from: number; to: number; params: Composition["params"]; source: Composition["source"]; compId?: string; layer?: number }): Promise<Composition> {
  const images: ComposImage[] = [];
  for (const g of effect.images) {
    const key = `editor/${ctx.projectId}/compos/${g.id}.${ext(g.key)}`;
    try {
      await copyKey(g.key, key);
      images.push({ ...g, key });
    } catch (error) {
      console.error("[mis-efectos] no se pudo copiar una imagen al video:", error instanceof Error ? error.message : error);
    }
  }
  const item: Composition = {
    id: input.compId ?? newComposId(),
    from_word: input.from,
    to_word: input.to,
    name: effect.name,
    code: effect.code,
    params: input.params,
    ...(effect.sounds.length ? { sounds: effect.sounds as Composition["sounds"] } : {}),
    ...(effect.hideCaptions ? { hide_captions: true } : {}),
    why: `De Mis efectos (v${effect.version}).`,
    source: input.source,
    ...(effect.tags.length ? { tags: effect.tags } : {}),
    ...(images.length ? { images } : {}),
    ...(input.layer != null ? { layer: input.layer } : {}),
    lib_id: effect.id,
  };
  const seg = composSegments(ctx.timeline, [item])[0];
  if (!seg) throw new EffectUseError("Ese tramo ya no está en el video.");
  const spec = compileComposition({ item, start: seg.start, end: seg.end, timeline: ctx.timeline, format: ctx.format, brand: ctx.brand, face: ctx.face(seg), captionsVisible: ctx.captionsVisible });
  const check = await validateComposition(item.code, spec.compos!.env);
  if (!check.ok) throw new EffectUseError(`Este efecto no funciona en este tramo: ${check.error}`);
  return { ...item, checked: check.hash };
}

/** Textos del efecto adaptados a lo que se dice en el tramo: con una llamada chica a Claude, o sin IA si falla. */
export async function adaptParams(ctx: PlaceCtx, effect: Row, from: number, to: number, ai: boolean): Promise<Composition["params"]> {
  const spoken = ctx.spoken(from, to);
  const fallback = fillParams(effect.params, spoken);
  if (!ai || !effect.params.length) return fallback;
  try {
    const wire = await generateStructured({
      feature: "video.efectos.textos",
      model: "fast",
      context: EFFECT_PARAMS_RULES,
      task: effectParamsTask({ name: effect.name, description: effect.description, params: effect.params, said: spoken.map((w) => w.text).join(" ") }),
      schema: effectParamsWireSchema,
      maxTokens: 800,
      videoProjectId: ctx.projectId,
      fake: () => ({ params: fallback.map((p) => ({ key: p.key, value: p.value })) }),
    });
    return effect.params.map((p) => {
      const v = wire.params.find((x) => x.key === p.key)?.value;
      return typeof v === "string" && v.trim() ? { ...p, value: v.trim().slice(0, 160) } : (fallback.find((f) => f.key === p.key) ?? p);
    });
  } catch (error) {
    console.warn("[mis-efectos] textos sin IA:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    return fallback;
  }
}

/** Candidatos de Mis efectos para el plan de una animación (rotación incluida). */
export async function effectCandidates(input: { brief: string; said: string; exclude: string[]; duration: number; limit?: number }): Promise<(LibraryCandidate & { row: Row })[]> {
  const rows = await getDb().select().from(schema.createdEffects).where(isNull(schema.createdEffects.removedAt)).orderBy(desc(schema.createdEffects.createdAt)).limit(200);
  // Solo lo que entra en el tramo sin estirarse demasiado (de la mitad al doble de su duración típica).
  const fits = rows.filter((r) => input.duration >= r.duration * 0.5 && input.duration <= r.duration * 2.2);
  const list = fits.map((r) => ({ id: r.id, name: r.name, description: r.description, category: r.category, tags: r.tags, duration: r.duration, params: r.params, usedCount: r.usedCount, lastUsedAt: r.lastUsedAt, favorite: r.favorite, row: r }));
  return rankCandidates(list, { brief: input.brief, said: input.said, exclude: input.exclude, limit: input.limit ?? 6 });
}

/** Contexto para poner efectos en un video (el mismo que usa el taller de animaciones). */
export async function placeCtxFor(projectId: string): Promise<PlaceCtx | null> {
  const { loadWorkCtx, placeCtxOf } = await import("./work");
  const ctx = await loadWorkCtx(projectId);
  return ctx ? placeCtxOf(ctx) : null;
}

/** Pone un efecto guardado en un tramo de un video (Estudio: arrastrarlo desde la Biblioteca). */
export async function placeEffect(projectId: string, effectId: string, from: number, to: number): Promise<Composition> {
  const effect = await loadEffect(effectId);
  if (!effect || effect.removedAt) throw new EffectUseError("Ese efecto ya no está en Mis efectos.");
  const ctx = await placeCtxFor(projectId);
  if (!ctx) throw new EffectUseError("Este video todavía no está listo para editar.");
  const params = await adaptParams(ctx, effect, from, to, true);
  return buildFromEffect(ctx, effect, { from, to, params, source: "user" });
}
