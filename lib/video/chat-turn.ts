import "server-only";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { generateStructured, withAiScope } from "@/lib/ai/client";
import { VIDEO_CHAT_RULES, videoChatSchema, videoChatTask, type VideoChatOutput } from "@/lib/ai/prompts/chat-video";
import { getDb, schema } from "@/lib/db";
import { readBytes } from "@/lib/storage";
import { libraryForPrompt } from "./broll";
import { chatItems, fakeLibraryBroll, type ChatAttachment, type VideoChatItem } from "./chat-library";
import type { ChatClip, ChatMessage } from "./compos/chat";
import type { RefImage } from "./compos/schema";
import { pieceOf } from "./library";
import { fichaText } from "./library-ficha";
import { loadProject } from "./service";
import { markersForPrompt } from "./markers";
import { buildTimeline } from "./timeline";
import type { EditPlan, MediaInfo, Transcript } from "./types";

/**
 * Un turno del chat del video (lo usan las acciones del Estudio y las pruebas). Claude recibe la transcripción, lo que
 * ya tiene el video, la biblioteca, las imágenes adjuntas y, de cada video que la persona adjuntó en la charla, su ficha
 * y sus hojas de cuadros: así describe lo que ve (personajes, estilo de animación, colores) en lugar de un nombre de
 * archivo. Los videos adjuntos quedan en la biblioteca (VIDEO_CLIP saca las hojas y Claude escribe la ficha); mientras
 * eso pasa, el chat espera y contesta cuando terminan.
 */
export const chatInputSchema = z.object({
  projectId: z.uuid(),
  text: z.string().trim().min(2, "Escribe tu mensaje.").max(2000, "Es demasiado largo: resúmelo un poco."),
  sentences: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0), start: z.number().min(0), end: z.number().min(0), text: z.string().max(600) })).max(800),
  duration: z.number().min(0).max(3600),
  format: z.enum(["9:16", "16:9"]),
  playhead: z.number().min(0).max(3600).nullable(),
  selection: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).nullable(),
  state: z.string().max(6000),
  /** libraryId: la pieza de la biblioteca (un video subido aquí también queda en la biblioteca). */
  attachments: z
    .array(z.object({ ref: z.string().regex(/^A[1-9]$/), kind: z.enum(["video", "image"]), name: z.string().max(120), duration: z.number().min(0).max(3600).nullable(), libraryId: z.uuid().optional() }))
    .max(8)
    .default([]),
  /** Imágenes adjuntas a este mensaje (capturas, referencias): Claude las mira. Se vuelven a validar contra el proyecto. */
  images: z.array(z.unknown()).max(4).optional(),
});
export type ChatInput = z.output<typeof chatInputSchema>;
export type ChatContext = Omit<ChatInput, "text">;

/** Cuántos videos de la charla mira Claude en cada turno (los últimos) y cuántas hojas de cada uno. */
const MAX_CLIPS = 2;
const SHEETS_PER_CLIP = 2;
/** Más que esto esperando a que el worker mire un video: se contesta igual, avisando. */
export const CLIP_WAIT_MAX_MS = 12 * 60_000;
/** Lo que dice la persona cuando un video es una referencia de estilo (no material para poner). */
const REFERENCE_RE = /referenc|estilo|como (este|esta|ese|esa|en el)|insp[ií]r|que se vea as[ií]|mira c[oó]mo/i;

/** Los videos adjuntos en la charla, del más viejo al más nuevo (sin repetir), con su código V1, V2… */
export function conversationClips(messages: ChatMessage[]): (ChatClip & { code: string; reference: boolean })[] {
  const seen = new Map<string, ChatClip & { reference: boolean }>();
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const c of m.clips ?? []) {
      const prev = seen.get(c.id);
      seen.delete(c.id);
      seen.set(c.id, { ...c, reference: Boolean(prev?.reference) || REFERENCE_RE.test(m.text) });
    }
  }
  return [...seen.values()].map((c, i) => ({ ...c, code: `V${i + 1}` }));
}

/** La espera del último mensaje que todavía no tuvo respuesta. */
export function pendingClipWait(messages: ChatMessage[]): { id: string; clips: string[]; at: string } | null {
  const done = new Set(messages.map((m) => m.clipDone).filter(Boolean));
  for (let i = messages.length - 1; i >= 0; i--) {
    const w = messages[i]!.clipWait;
    if (w) return done.has(w.id) ? null : { ...w, at: messages[i]!.at };
  }
  return null;
}

export type ClipState = { id: string; title: string; state: "waiting" | "ready" | "failed"; error: string | null };

/** Si la app ya miró cada video: listo (hojas y ficha, o al menos hojas), todavía mirando, o falló. */
export async function clipStates(ids: string[]): Promise<ClipState[]> {
  if (!ids.length) return [];
  const rows = await getDb().select().from(schema.brollClips).where(inArray(schema.brollClips.id, ids));
  return ids.map((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return { id, title: "video", state: "failed" as const, error: "Ese video ya no está en tu biblioteca." };
    if (r.status === "FAILED") return { id, title: r.title, state: "failed" as const, error: r.errorMessage ?? "No pudimos preparar el video." };
    // "none": una pieza de antes de que hubiera fichas; la charla la manda a analizar (video-chat-actions.ts).
    if (r.status !== "READY" || r.fichaStatus === "pending" || r.fichaStatus === "thinking" || r.fichaStatus === "none") return { id, title: r.title, state: "waiting" as const, error: null };
    if (r.kind === "video" && !r.fichaSheets?.length) return { id, title: r.title, state: "failed" as const, error: r.fichaError ?? "No pudimos sacar los cuadros del video." };
    return { id, title: r.title, state: "ready" as const, error: null };
  });
}

type Vision = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };

/** Lee las imágenes adjuntas (ya validadas contra el proyecto) para mandarlas a Claude. */
async function imagesFor(refs: RefImage[]): Promise<{ images: Vision[]; sizes: { width: number; height: number }[] }> {
  const images: Vision[] = [];
  const sizes: { width: number; height: number }[] = [];
  for (const r of refs) {
    try {
      const buf = await readBytes(r.key, 8 * 1024 * 1024);
      images.push({ mediaType: r.key.endsWith(".png") ? "image/png" : r.key.endsWith(".webp") ? "image/webp" : "image/jpeg", data: buf.toString("base64") });
      sizes.push({ width: r.width, height: r.height });
    } catch (error) {
      console.error("[chat del video] no se pudo leer una imagen:", error instanceof Error ? error.message : error);
    }
  }
  return { images, sizes };
}

/** Ficha y hojas de cuadros de los videos de la charla (los últimos), leídas de la base: nunca del navegador. */
async function clipVision(clips: ReturnType<typeof conversationClips>): Promise<{ text: string; images: Vision[]; sizes: { width: number; height: number }[]; clips: (ChatClip & { code: string; kind: "video" | "image"; reference: boolean })[] }> {
  const recent = clips.slice(-MAX_CLIPS);
  if (!recent.length) return { text: "", images: [], sizes: [], clips: [] };
  const rows = await getDb().select().from(schema.brollClips).where(inArray(schema.brollClips.id, recent.map((c) => c.id)));
  const images: Vision[] = [];
  const sizes: { width: number; height: number }[] = [];
  const lines: string[] = [];
  const out: (ChatClip & { code: string; kind: "video" | "image"; reference: boolean })[] = [];
  for (const c of recent) {
    const r = rows.find((x) => x.id === c.id);
    if (!r || r.status !== "READY") continue;
    const piece = pieceOf(r);
    const sheets = (r.fichaSheets ?? []).slice(0, SHEETS_PER_CLIP);
    const first = images.length + 1;
    for (const s of sheets) {
      try {
        images.push({ mediaType: "image/jpeg", data: (await readBytes(s.key, 6 * 1024 * 1024)).toString("base64") });
        sizes.push({ width: s.width, height: s.height });
      } catch (error) {
        console.error("[chat del video] hoja ilegible:", error instanceof Error ? error.message : error);
      }
    }
    const got = images.length - first + 1;
    const frames = sheets.flatMap((s) => s.frames.map((n, i) => `#${n} ${(s.times[i] ?? 0).toFixed(1)} s`)).join(" · ");
    lines.push(
      `${c.code}${c.ref ? ` (${c.ref} cuando lo adjuntó)` : ""}: ${fichaText(piece)}${c.reference ? "\n   La persona lo mandó como REFERENCIA de estilo." : ""}${got ? `\n   Sus hojas de cuadros son las imágenes ${got === 1 ? first : `${first} a ${first + got - 1}`} adjuntas (cada cuadro marcado #n con su segundo: ${frames}).` : ""}`,
    );
    out.push({ ...c, kind: piece.kind, reference: c.reference });
  }
  return { text: lines.join("\n"), images, sizes, clips: out };
}

/** Valida el pedido contra el proyecto y arma lo que la IA necesita ver. */
async function prepare(d: ChatContext) {
  const project = await loadProject(d.projectId);
  const words = (project?.transcript as Transcript | null)?.words;
  if (!project || !words?.length) return null;
  const max = words.length - 1;
  const ids = new Set<number>();
  for (const f of d.sentences) for (let id = f.from; id <= Math.min(f.to, max); id++) ids.add(id);
  const sel = d.selection && d.selection.from <= max ? `[${d.selection.from}–${Math.min(d.selection.to, max)}] «${words.slice(d.selection.from, Math.min(d.selection.to, max) + 1).map((w) => w.text).join(" ").slice(0, 400)}»` : null;
  const sentencesText = d.sentences
    .filter((f) => f.from <= max)
    .map((f) => `[${f.from}–${Math.min(f.to, max)}] ${f.start.toFixed(1)}–${f.end.toFixed(1)} s: ${f.text}`)
    .join("\n");
  // Marcadores del plan guardado (la persona dice «en el marcador 2…»).
  const plan = project.plan as EditPlan | null;
  const markers = plan?.markers?.length ? markersForPrompt(buildTimeline(words, plan, (project.media as MediaInfo | null)?.duration || (project.transcript as Transcript).duration), plan.markers) : "";
  return { max, ids, sel, sentencesText, markers };
}

export type TurnResult = { message: ChatMessage; go: boolean } | { ok: false; error: string };

/** Un turno de la IA sobre la charla guardada; devuelve el mensaje de respuesta (sin guardarlo). */
export async function chatTurn(d: ChatContext, messages: ChatMessage[], userId: string, reference: { source: string; text: string } | null, lastText: string, refs: RefImage[] = []): Promise<TurnResult> {
  const prep = await prepare(d);
  if (!prep) return { ok: false, error: "Este video todavía no tiene transcripción." };
  const { max, ids, sel, sentencesText } = prep;
  const brandCtx = await brandContext(await getBrand());
  const pics = refs.length ? await imagesFor(refs) : { images: [], sizes: [] };
  const seen = await clipVision(conversationClips(messages));
  const history = messages.slice(-30).map((m) => (m.role === "applied" ? { role: "assistant" as const, text: `[HECHO] ${m.text}` } : { role: m.role, text: m.text }));
  const library = await libraryForPrompt(3500);
  const thisMessage = new Map(seen.clips.map((c) => [c.id, c]));
  // Lo que la persona nombró con @ o adjuntó: imágenes primero, después las hojas de los videos (en ese orden van).
  const attachmentsText = d.attachments.length
    ? d.attachments
        .map((a) => {
          const clip = a.libraryId ? thisMessage.get(a.libraryId) : undefined;
          if (clip) return `${a.ref}: el video ${clip.code} de abajo (ya lo miraste cuadro a cuadro).`;
          return `${a.ref}: ${a.kind === "video" ? `video «${a.name}»${a.duration ? `, dura ${a.duration.toFixed(1)} s` : ""}` : `imagen «${a.name}»${a.libraryId ? " de tu biblioteca" : ""}`}`;
        })
        .join("\n") + (pics.images.length ? `\nLas imágenes de este mensaje van adjuntas primero, en ese mismo orden: míralas y responde sobre lo que se ve en ellas (si es una captura del editor o del video, di qué ves y qué harías).` : "")
    : null;
  const clipsText = seen.text
    ? `VIDEOS QUE ADJUNTÓ LA PERSONA EN ESTA CHARLA (ya los miraste: su ficha y sus hojas de cuadros, que van en las imágenes adjuntas${pics.images.length ? " después de las imágenes del mensaje" : ""}). Nómbralos con su código (V1, V2…) en attachments. Describe lo que ves en los cuadros; nunca digas que solo tienes el nombre del archivo ni pidas capturas.\n${seen.text}`
    : null;
  const attachments = [attachmentsText, clipsText].filter(Boolean).join("\n\n") || null;
  const allAttachments: ChatAttachment[] = [...d.attachments, ...seen.clips.map((c) => ({ ref: c.code, kind: c.kind, libraryId: c.id }))];
  const images = [...pics.images, ...seen.images];
  const sizes = [...pics.sizes, ...seen.sizes];
  const out = await withAiScope(d.projectId, () =>
    generateStructured({
      feature: "video.chat",
      model: "main",
      context: `${VIDEO_CHAT_RULES}\n\n${brandCtx}`,
      task: videoChatTask({
        sentences: sentencesText.slice(0, 40000),
        duration: d.duration,
        format: d.format,
        playhead: d.playhead,
        selection: sel,
        state: d.state || "(nada todavía)",
        attachments,
        reference,
        library: library.text,
        messages: history,
        markers: prep.markers || null,
      }),
      schema: videoChatSchema,
      ...(images.length ? { images, imageSizes: sizes } : {}),
      maxTokens: 5000,
      userId,
      fake: () => fakeTurn(d, lastText, reference, library, seen.clips),
    }),
  );
  const items = withClipReferences(chatItems(out.items, allAttachments, max, ids, library), seen.clips);
  return { message: { role: "assistant", text: out.reply.slice(0, 4000), at: new Date().toISOString(), ...(items.length ? { items } : {}) }, go: out.go && items.length > 0 };
}

/**
 * Las animaciones que salen de una charla con un video de referencia llevan sus hojas de cuadros como referencia de
 * estilo (styleClips: el cliente las copia a las referencias del pedido). Si la persona lo mandó como referencia, va en
 * todas las animaciones aunque la IA no lo haya nombrado; un video usado como b-roll en esa acción, no.
 */
export function withClipReferences(items: VideoChatItem[], clips: { code: string; id: string; kind: "video" | "image"; reference: boolean }[]): VideoChatItem[] {
  const byCode = new Map(clips.map((c) => [c.code, c]));
  return items.map((it) => {
    const named = it.attachments.flatMap((a) => (byCode.has(a.ref) ? [{ ...a, clip: byCode.get(a.ref)! }] : []));
    const rest = it.attachments.filter((a) => !byCode.has(a.ref));
    const next: VideoChatItem = { ...it, attachments: rest };
    const broll = named.find((a) => a.use === "broll");
    if (it.kind === "video" && broll && !next.clipId) next.clipId = broll.clip.id;
    if (it.kind === "animacion") {
      const style = new Set(named.filter((a) => a.use === "style" && a.clip.kind === "video").map((a) => a.clip.id));
      for (const c of clips) if (c.reference && c.kind === "video" && broll?.clip.id !== c.id) style.add(c.id);
      if (style.size) next.styleClips = [...style].slice(0, 2);
    }
    return next;
  });
}

/** AI_FAKE=1: respuestas armadas con los datos reales (para probar la interfaz sin gastar). */
function fakeTurn(d: ChatContext, lastText: string, reference: { source: string; text: string } | null, library: Awaited<ReturnType<typeof libraryForPrompt>>, clips: { code: string; reference: boolean }[]): VideoChatOutput {
  const f = d.sentences[Math.floor(d.sentences.length / 3)] ?? d.sentences[0];
  const wantsSubs = /subt[ií]tul/i.test(lastText);
  if (/b-?roll|mis clips|mis tomas/i.test(lastText) && library.codes.size) return fakeLibraryBroll(d.sentences, library);
  const clip = clips.at(-1);
  return {
    go: /^(dale|hazlo|ed[ií]talo|cr[eé]ala)/i.test(lastText.trim()),
    reply: clip
      ? `Miré los cuadros de ${clip.code}: lo que más se puede copiar es su estilo de animación y sus colores; lo pondría en «${f?.text.slice(0, 80) ?? ""}».`
      : reference
        ? `Ya miré la referencia. Lo que más se puede copiar es el ritmo de sus animaciones; lo pondría en «${f?.text.slice(0, 80) ?? ""}».`
        : wantsSubs
          ? "Te propongo ponerle los subtítulos con el estilo de tu marca."
          : `Buena idea. Lo pondría en «${f?.text.slice(0, 80) ?? ""}».`,
    items: wantsSubs
      ? [{ kind: "subtitulos", scope: "todo", from_word: -1, to_word: -1, title: "Poner subtítulos", prompt: "Subtítulos con el estilo de tu marca.", attachments: [], layout: null, library: null, clip_start: null }]
      : f
        ? [
            {
              kind: "animacion",
              scope: "momento",
              from_word: f.from,
              to_word: f.to,
              title: clip || reference ? "Como en la referencia" : "Lo que pediste",
              prompt: `Sobre «${f.text.slice(0, 120)}»: ${lastText}. Fondo blanco y la frase clave entrando palabra por palabra, con un whoosh suave.`,
              attachments: clip ? [{ ref: clip.code, use: "style" }] : d.attachments.filter((a) => a.libraryId).slice(0, 1).map((a) => ({ ref: a.ref, use: "style" as const })),
              layout: null,
              library: null,
              clip_start: null,
            },
          ]
        : [],
  };
}
