/**
 * Chat del video y biblioteca: valida las acciones que propone la IA (tramos que existen, adjuntos usados como se
 * puede y, en un b-roll de la biblioteca, una pieza que existe con su segundo dentro del clip). Sin servidor: lo usan
 * la acción del chat y las pruebas.
 */
import type { VideoChatOutput } from "@/lib/ai/prompts/chat-video";
import type { LibraryPrompt } from "./broll";
import { matchLibrary } from "./library-ficha";

/** clipId y clipStart: la pieza de la biblioteca que eligió la IA para una acción "video" (validada aquí). */
/** styleClips: videos de la biblioteca cuyas hojas de cuadros van como referencia de estilo de una animación. */
export type VideoChatItem = VideoChatOutput["items"][number] & { clipId?: string; clipStart?: number | null; styleClips?: string[] };
export type ChatAttachment = { ref: string; kind: "video" | "image"; libraryId?: string };

/**
 * Las acciones que propuso la IA, validadas: tramos que existen, adjuntos que se pueden usar así y, en un b-roll de la
 * biblioteca, una pieza que existe (con su segundo dentro del clip).
 */
export function chatItems(raw: VideoChatOutput["items"], attachments: ChatAttachment[], max: number, ids: Set<number>, library: LibraryPrompt): VideoChatItem[] {
  const kinds = new Map(attachments.map((a) => [a.ref, a.kind]));
  const fromLibrary = new Set(attachments.filter((a) => a.libraryId).map((a) => a.ref));
  /**
   * Cómo se puede usar cada adjunto: un video, de b-roll, dentro de una animación (se reproduce en ella) y, si es de la
   * biblioteca, también de referencia de estilo; una imagen, de estilo o dentro, y si es de la biblioteca también de
   * b-roll fijo.
   */
  const usable = (a: { ref: string; use: "broll" | "style" | "inside" }, kind: VideoChatItem["kind"]) => {
    const k = kinds.get(a.ref);
    if (!k) return false;
    if (a.use === "broll") return k === "video" || fromLibrary.has(a.ref);
    if (kind !== "animacion") return false;
    return k === "image" || a.use === "inside" || (a.use === "style" && fromLibrary.has(a.ref));
  };
  return raw
    .map((r): VideoChatItem | null => {
      const it: VideoChatItem = { ...r, attachments: r.attachments.filter((a) => usable(a, r.kind)) };
      if (it.kind === "color") return it.look ? { ...it, scope: "todo" as const, from_word: -1, to_word: -1, library: null, clip_start: null, text_style: null } : null;
      if (it.kind === "texto") {
        const text = it.prompt.replace(/\s+/g, " ").trim().slice(0, 80);
        if (!text || it.scope === "todo") return null;
        Object.assign(it, { prompt: text, text_style: it.text_style ?? "title", look: null });
      }
      if (it.kind === "subtitulos" || it.kind === "recortar" || it.kind === "editar") return { ...it, scope: "todo" as const, from_word: -1, to_word: -1, library: null, clip_start: null };
      if (it.kind === "video" && !it.attachments.some((a) => a.use === "broll")) {
        // Un b-roll de la biblioteca sin adjunto: la pieza que nombró la IA por su código.
        const piece = it.library ? library.codes.get(it.library.trim().toUpperCase()) : undefined;
        if (!piece) return null;
        const start = piece.kind === "video" && it.clip_start != null && Number.isFinite(it.clip_start) ? Math.max(0, Math.min(it.clip_start, Math.max(0, piece.duration - 0.5))) : null;
        Object.assign(it, { clipId: piece.id, clipStart: start, attachments: [] });
      }
      if (it.scope === "todo") return it.kind === "video" ? null : { ...it, from_word: -1, to_word: -1 };
      const from = Math.max(0, Math.min(it.from_word, it.to_word));
      const to = Math.min(max, Math.max(it.from_word, it.to_word));
      if (!ids.has(from) && !ids.has(to)) return null;
      return { ...it, from_word: from, to_word: to, prompt: it.prompt.slice(0, 1500), title: it.title.slice(0, 80) };
    })
    .filter((it): it is VideoChatItem => Boolean(it));
}

/** AI_FAKE=1: «pon b-roll de lo que hablo» con la biblioteca, eligiendo por la ficha (para probar sin gastar). */
export function fakeLibraryBroll(sentences: { from: number; to: number; text: string }[], library: LibraryPrompt): VideoChatOutput {
  const items: VideoChatOutput["items"] = [];
  for (const f of sentences) {
    let best: { code: string; score: number; start: number | null } | null = null;
    for (const [code, piece] of library.codes) {
      const m = matchLibrary(piece, f.text.split(/\s+/));
      if (m.score >= 2 && (!best || m.score > best.score)) best = { code, score: m.score, start: m.moment?.start ?? null };
    }
    if (best && items.length < 6) items.push({ kind: "video", scope: "momento", from_word: f.from, to_word: f.to, title: "B-roll de tu biblioteca", prompt: "Se ve lo que dices.", attachments: [], layout: null, library: best.code, clip_start: best.start, text_style: null, look: null });
  }
  return { reply: items.length ? `Encontré ${items.length === 1 ? "un momento" : `${items.length} momentos`} donde tus clips muestran lo que dices.` : "No encontré clips de tu biblioteca que muestren lo que dices.", go: false, items };
}

