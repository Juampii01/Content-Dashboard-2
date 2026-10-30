/**
 * Chat del video y biblioteca: valida las acciones que propone la IA (tramos que existen, adjuntos usados como se
 * puede y, en un b-roll de la biblioteca, una pieza que existe con su segundo dentro del clip). Sin servidor: lo usan
 * la acción del chat y las pruebas.
 */
import { NO_EXTRA, type VideoChatOutput } from "@/lib/ai/prompts/chat-video";
import type { LibraryPrompt } from "./broll";
import { matchLibrary } from "./library-ficha";

/** clipId y clipStart: la pieza de la biblioteca que eligió la IA para una acción "video" (validada aquí). */
/** styleClips: videos de la biblioteca cuyas hojas de cuadros van como referencia de estilo de una animación. */
/**
 * insideClips: videos de la biblioteca que se reproducen DENTRO de una animación. Se guardan con la acción (ids de la
 * biblioteca), así el botón los encuentra siempre: aunque la página se haya recargado o el video se haya mandado en
 * otro mensaje.
 */
/** wordIds: en una corrección, las palabras de la transcripción que se corrigen. */
export type VideoChatItem = VideoChatOutput["items"][number] & { clipId?: string; clipStart?: number | null; styleClips?: string[]; insideClips?: string[]; wordIds?: number[] };
export type ChatAttachment = { ref: string; kind: "video" | "image"; libraryId?: string };

/**
 * Las acciones que propuso la IA, validadas: tramos que existen, adjuntos que se pueden usar así y, en un b-roll de la
 * biblioteca, una pieza que existe (con su segundo dentro del clip).
 */
/** Para comparar palabras: minúsculas, sin tildes ni signos. */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ]+/g, "");
}

/**
 * La palabra (o la secuencia) `text` dentro de [from, to] (con un margen de 6 palabras a cada lado, por si la IA se
 * corrió de frase). Devuelve los ids de la primera y la última palabra, o null.
 */
export function findWords(words: string[] | undefined, text: string | null | undefined, from: number, to: number, after = -1): { first: number; last: number } | null {
  if (!words?.length || !text) return null;
  const want = text.split(/\s+/).map(normWord).filter(Boolean);
  if (!want.length) return null;
  const lo = Math.max(0, Math.max(from - 6, after)), hi = Math.min(words.length - 1, to + 6);
  const tryAt = (i: number) => {
    let k = i, j = 0;
    while (j < want.length && k <= hi) {
      const w = normWord(words[k] ?? "");
      if (!w) {
        k++;
        continue;
      }
      if (w !== want[j]) return null;
      j++;
      k++;
    }
    return j === want.length ? { first: i, last: k - 1 } : null;
  };
  // Primero dentro del tramo, después en el margen.
  for (const [a, b] of [[Math.max(from, lo), Math.min(to, hi)], [lo, hi]] as const) for (let i = a; i <= b; i++) {
    const m = tryAt(i);
    if (m) return m;
  }
  return null;
}

const clampNum = (v: number | null | undefined, a: number, b: number): number | null => (v == null || !Number.isFinite(v) ? null : Math.max(a, Math.min(b, v)));

export function chatItems(raw: VideoChatOutput["items"], attachments: ChatAttachment[], max: number, ids: Set<number>, library: LibraryPrompt, words?: string[]): VideoChatItem[] {
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
        Object.assign(it, { prompt: text, text_style: it.text_style ?? "title", look: null, ...NO_EXTRA });
      }
      if (it.kind === "subtitulos" || it.kind === "recortar" || it.kind === "editar") return { ...it, scope: "todo" as const, from_word: -1, to_word: -1, library: null, clip_start: null };
      if (it.kind === "deshacer") return { ...it, scope: "todo" as const, from_word: -1, to_word: -1 };
      if (it.kind === "corregir") {
        const want = normWord(it.hit_text ?? "");
        const fixed = it.prompt.replace(/\s+/g, " ").trim().slice(0, 40);
        if (!want || !fixed || !words?.length) return null;
        const wordIds = words.flatMap((w, i) => (normWord(w) === want ? [i] : [])).slice(0, 80);
        return wordIds.length ? { ...it, scope: "todo" as const, from_word: -1, to_word: -1, prompt: fixed, wordIds } : null;
      }
      if (it.kind === "voz") {
        const level = clampNum(it.level, -12, 6);
        return level == null ? null : { ...it, scope: "todo" as const, from_word: -1, to_word: -1, level };
      }
      if (it.kind === "musica") {
        const level = clampNum(it.level, -40, -6);
        if (!it.music && level == null) return null;
        return { ...it, scope: "todo" as const, from_word: -1, to_word: -1, level };
      }
      if (it.kind === "quitar") {
        if (!it.remove) return null;
        if (it.scope === "todo") return { ...it, from_word: -1, to_word: -1 };
      }
      if (it.kind === "transicion" || it.kind === "sonido") {
        if ((it.kind === "transicion" && !it.transition) || (it.kind === "sonido" && !it.sound)) return null;
        const level = it.kind === "sonido" ? clampNum(it.level, -30, 0) : null;
        const at = clampNum(it.at_second, 0, 36000);
        const rangeOk = ids.has(Math.max(0, Math.min(it.from_word, it.to_word))) || ids.has(Math.min(max, Math.max(it.from_word, it.to_word)));
        const hit = rangeOk ? findWords(words, it.hit_text, Math.min(it.from_word, it.to_word), Math.max(it.from_word, it.to_word)) : null;
        if (hit) return { ...it, scope: "momento" as const, from_word: hit.first, to_word: hit.first, level, at_second: null };
        // Con el segundo que dio la persona, el Estudio lo ubica en el video final.
        if (at != null) return { ...it, scope: "momento" as const, from_word: rangeOk ? Math.max(0, Math.min(it.from_word, it.to_word)) : 0, to_word: rangeOk ? Math.max(0, Math.min(it.from_word, it.to_word)) : 0, level, at_second: at };
        if (!rangeOk) return null;
        const w = Math.max(0, Math.min(it.from_word, it.to_word));
        return { ...it, scope: "momento" as const, from_word: w, to_word: w, level, at_second: null };
      }
      // Un zoom remarca algo corto: como mucho 8 palabras desde donde empieza.
      if (it.kind === "zoom" && it.scope !== "todo") {
        const from = Math.max(0, Math.min(it.from_word, it.to_word));
        if (!ids.has(from)) return null;
        return { ...it, from_word: from, to_word: Math.min(max, Math.max(it.from_word, it.to_word), from + 7) };
      }
      if (it.kind === "cortar") {
        if (it.scope === "todo") return null;
        const from = Math.max(0, Math.min(it.from_word, it.to_word)), to = Math.min(max, Math.max(it.from_word, it.to_word));
        if (!ids.has(from) && !ids.has(to)) return null;
        if (it.hit_text) {
          const a = findWords(words, it.hit_text, from, to);
          // Si no está lo que dijo, no se corta nada a ciegas.
          if (!a) return null;
          const b = it.end_text ? findWords(words, it.end_text, a.first, to, a.first) : null;
          if (it.end_text && !b) return null;
          return { ...it, from_word: a.first, to_word: b ? b.last : a.last, prompt: it.prompt.slice(0, 300), title: it.title.slice(0, 80) };
        }
      }
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
    if (best && items.length < 6) items.push({ kind: "video", scope: "momento", from_word: f.from, to_word: f.to, title: "B-roll de tu biblioteca", prompt: "Se ve lo que dices.", attachments: [], layout: null, library: best.code, clip_start: best.start, text_style: null, look: null, ...NO_EXTRA });
  }
  return { reply: items.length ? `Encontré ${items.length === 1 ? "un momento" : `${items.length} momentos`} donde tus clips muestran lo que dices.` : "No encontré clips de tu biblioteca que muestren lo que dices.", go: false, items };
}


/** Un video o imagen de la charla con su pieza de la biblioteca: V1, V2… (los que ya miró) o A1, A2… (de este mensaje). */
export type ChatPiece = { code: string; id: string; kind: "video" | "image"; reference: boolean };

/** Cuando la persona pide que su video se vea adentro de la animación (en la pantalla, en el teléfono…). */
const INSIDE_RE = /\b(dentro|adentro)\b|en (la|una|el|un) (pantalla|tel[eé]fono|celular|monitor|notebook|laptop|computadora|navegador|tablet|tarjeta|ventana|tv|televisor)|(se vea|aparezca|se reproduzca|que salga) (mi|el|la|este|esta|ese|esa) (video|grabaci[oó]n|web|p[aá]gina|app)|\bmi (web|p[aá]gina|app|grabaci[oó]n)\b/i;

/**
 * Pasa los adjuntos que nombró la IA (V1, A1…) a piezas de la biblioteca guardadas en la acción, para que el botón no
 * dependa de lo que tiene abierto el navegador:
 * - "inside" en una animación → insideClips (el video se reproduce dentro).
 * - "broll" en una acción video → clipId.
 * - "style" (o un video que la persona mandó como referencia) → styleClips, salvo que ya vaya adentro.
 * Si la IA no marcó ningún video para adentro pero la persona lo pidió con palabras («que se vea mi web en la
 * pantalla») o el pedido de la animación nombra el video por su código, se pone adentro el video de la charla.
 */
export function withClipReferences(items: VideoChatItem[], pieces: ChatPiece[], lastText = ""): VideoChatItem[] {
  const byCode = new Map(pieces.map((c) => [c.code, c]));
  const videos = pieces.filter((c) => c.kind === "video");
  const wantsInside = INSIDE_RE.test(lastText);
  return items.map((it) => {
    const named = it.attachments.flatMap((a) => (byCode.has(a.ref) ? [{ ...a, clip: byCode.get(a.ref)! }] : []));
    // Las imágenes sueltas de este mensaje (sin pieza de la biblioteca) siguen yendo por el navegador.
    const rest = it.attachments.filter((a) => !byCode.has(a.ref) || byCode.get(a.ref)!.kind === "image");
    const next: VideoChatItem = { ...it, attachments: rest };
    const broll = named.find((a) => a.use === "broll");
    if (it.kind === "video" && broll && !next.clipId) next.clipId = broll.clip.id;
    if (it.kind === "animacion") {
      const inside = new Set(named.filter((a) => a.use === "inside" && a.clip.kind === "video").map((a) => a.clip.id));
      if (!inside.size) {
        // El pedido nombra un video por su código («el video V1 en la pantalla»): va adentro.
        for (const c of videos) if (!c.reference && new RegExp(`\\b${c.code}\\b`).test(it.prompt)) inside.add(c.id);
        // La persona lo pidió con palabras y hay un solo video de la charla que no es referencia.
        const own = videos.filter((c) => !c.reference && broll?.clip.id !== c.id);
        if (!inside.size && wantsInside && own.length === 1) inside.add(own[0]!.id);
      }
      if (inside.size) next.insideClips = [...inside].slice(0, 2);
      const style = new Set(named.filter((a) => a.use === "style" && a.clip.kind === "video").map((a) => a.clip.id));
      for (const c of videos) if (c.reference && broll?.clip.id !== c.id) style.add(c.id);
      for (const id of inside) style.delete(id);
      if (style.size) next.styleClips = [...style].slice(0, 2);
    }
    return next;
  });
}
