import "server-only";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { scriptAsText } from "@/lib/ai/prompts/guiones";
import type { RepurposeSourceKind } from "@/lib/ai/prompts/jugo";
import { getDb, schema } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { typeLabel } from "@/lib/metrics/labels";
import { platformLabel } from "@/lib/social/types";
import type { EditPlan, Transcript } from "@/lib/video/types";
import { editedTranscriptText, wordCount } from "./text";

/**
 * De dónde sale el contenido de "Sacarle todo el jugo": un video del Editor (su transcripción sin los cortes),
 * un guion (completo) o una pieza publicada (su caption; o, si está vinculada en el calendario con un video
 * editado o un guion, ese texto completo). Sin sesión: lo llaman la capa de datos y las acciones, que ya la validan.
 */
export type RepurposeSource = {
  kind: RepurposeSourceKind;
  id: string;
  title: string;
  text: string;
  words: number;
  /** De dónde salió el texto, para mostrarlo ("Transcripción del video editado"). */
  textOrigin: string;
  detail: string;
  href: string;
  /** Guion relacionado (el propio, o el del video): los shorts derivados quedan vinculados a él. */
  scriptId: string | null;
  videoProjectId: string | null;
  contentItemId: string | null;
  pillar: string | null;
  /** null = se puede usar; si no, por qué todavía no. */
  blocked: string | null;
};

/** Palabras mínimas para que la IA tenga de dónde sacar algo concreto. */
export const MIN_WORDS = 12;

const UUID = /^[0-9a-f-]{36}$/i;

async function scriptRow(id: string) {
  const [s] = await getDb()
    .select({ id: schema.scripts.id, title: schema.scripts.title, format: schema.scripts.format, pillar: schema.scripts.pillar, content: schema.scripts.content })
    .from(schema.scripts)
    .where(eq(schema.scripts.id, id))
    .limit(1);
  return s ?? null;
}

function scriptText(content: NonNullable<typeof schema.scripts.$inferSelect.content>): string {
  return [scriptAsText(content), content.beats.map((b) => b.onScreenText).filter(Boolean).join(" · "), content.caption ? `Caption: ${content.caption}` : ""].filter(Boolean).join("\n\n");
}

function blockedFor(words: number): string | null {
  return words < MIN_WORDS ? "Tiene muy poco texto para sacarle contenido. Prueba con un video editado o un guion completo." : null;
}

async function fromVideo(id: string): Promise<RepurposeSource | null> {
  const [p] = await getDb()
    .select({ id: schema.videoProjects.id, title: schema.videoProjects.title, status: schema.videoProjects.status, format: schema.videoProjects.format, transcript: schema.videoProjects.transcript, plan: schema.videoProjects.plan, scriptId: schema.videoProjects.scriptId })
    .from(schema.videoProjects)
    .where(eq(schema.videoProjects.id, id))
    .limit(1);
  if (!p) return null;
  const script = p.scriptId ? await scriptRow(p.scriptId) : null;
  const text = editedTranscriptText(p.transcript as Transcript | null, p.plan as EditPlan | null);
  const words = wordCount(text);
  const ready = p.status === "DONE" || p.status === "AWAITING_REVIEW" || p.status === "RENDERING";
  return {
    kind: "video",
    id: p.id,
    title: script?.title ?? p.title,
    text,
    words,
    textOrigin: "Transcripción del video editado (sin los tramos cortados)",
    detail: `Video del Editor · ${p.format}`,
    href: `/editor/${p.id}`,
    scriptId: script?.id ?? null,
    videoProjectId: p.id,
    contentItemId: null,
    pillar: script?.pillar ?? null,
    blocked: !ready || !text ? "Este video todavía no tiene transcripción. Espera a que termine de procesarse." : blockedFor(words),
  };
}

async function fromScript(id: string): Promise<RepurposeSource | null> {
  const s = await scriptRow(id);
  if (!s?.content) return null;
  const text = scriptText(s.content);
  const words = wordCount(scriptAsText(s.content));
  return {
    kind: "guion",
    id: s.id,
    title: s.title,
    text,
    words,
    textOrigin: "Guion completo (gancho, bloques, CTA y caption)",
    detail: `Guion · ${s.format === "YT_LONG" ? "YouTube largo" : s.format === "SHORT" ? "Short" : s.format === "STORY" ? "Historias" : "Reel"}`,
    href: `/guiones/${s.id}`,
    scriptId: s.id,
    videoProjectId: null,
    contentItemId: null,
    pillar: s.pillar,
    blocked: blockedFor(words),
  };
}

async function fromPiece(id: string): Promise<RepurposeSource | null> {
  const db = getDb();
  const [item] = await db
    .select({ id: schema.contentItems.id, platform: schema.contentItems.platform, type: schema.contentItems.type, title: schema.contentItems.title, caption: schema.contentItems.caption, publishedAt: schema.contentItems.publishedAt })
    .from(schema.contentItems)
    .where(eq(schema.contentItems.id, id))
    .limit(1);
  if (!item) return null;
  const title = (item.title || item.caption?.split("\n").find((l) => l.trim()) || "Pieza publicada").trim().slice(0, 140);
  const detail = `${typeLabel[item.type]} de ${platformLabel[item.platform]} · ${formatDate(item.publishedAt)}`;

  // Si la pieza está vinculada en el calendario con un video editado o un guion, ese texto es mucho más rico.
  const [linked] = await db
    .select({ videoProjectId: schema.calendarEntries.videoProjectId, scriptId: schema.calendarEntries.scriptId })
    .from(schema.calendarTargets)
    .innerJoin(schema.calendarEntries, eq(schema.calendarEntries.id, schema.calendarTargets.entryId))
    .where(and(eq(schema.calendarTargets.contentItemId, id), eq(schema.calendarTargets.linkStatus, "LINKED"), or(isNotNull(schema.calendarEntries.videoProjectId), isNotNull(schema.calendarEntries.scriptId))))
    .orderBy(desc(schema.calendarEntries.updatedAt))
    .limit(1);
  const base = { kind: "pieza" as const, id: item.id, title, detail, href: `/metricas/${item.id}`, contentItemId: item.id };
  if (linked?.videoProjectId) {
    const video = await fromVideo(linked.videoProjectId);
    if (video && !video.blocked) return { ...video, ...base, textOrigin: "Transcripción del video editado que vinculaste en el calendario", videoProjectId: video.videoProjectId };
  }
  if (linked?.scriptId) {
    const script = await fromScript(linked.scriptId);
    if (script && !script.blocked) return { ...script, ...base, textOrigin: "Guion que vinculaste en el calendario" };
  }
  const text = [item.title, item.caption].filter(Boolean).join("\n\n").trim();
  const words = wordCount(text);
  return {
    ...base,
    text,
    words,
    textOrigin: item.platform === "INSTAGRAM" ? "Caption de la publicación (la red no da la transcripción)" : "Título y descripción de la publicación (la red no da la transcripción)",
    scriptId: null,
    videoProjectId: null,
    pillar: null,
    blocked: blockedFor(words),
  };
}

export async function loadSource(kind: RepurposeSourceKind, id: string): Promise<RepurposeSource | null> {
  if (!UUID.test(id)) return null;
  if (kind === "video") return fromVideo(id);
  if (kind === "guion") return fromScript(id);
  if (kind === "pieza") return fromPiece(id);
  return null;
}
