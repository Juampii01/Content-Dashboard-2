/**
 * Marcadores de la línea de tiempo (tecla M): un punto con una nota, anclado a una palabra (como los sonidos: sobrevive
 * a los cortes). Se numeran por su orden en el video final («Marcador 1», «Marcador 2»…) y Claude los lee: el chat del
 * video y el director reciben la lista, así «en el marcador 2 pon un gráfico» sabe dónde es.
 *
 * Opcional en el plan (`markers`): sin el campo, ninguno. No cambian el render. Sin servidor.
 */
import { z } from "zod";
import { outputRange, type Timeline } from "./timeline";

export const MAX_MARKERS = 60;
export const MARKER_NOTE_MAX = 300;

export const markerSchema = z.object({
  id: z.string().min(1).max(40),
  at_word: z.number().int().min(0),
  /** Segundos desde el inicio de la palabra (el cabezal no siempre cae justo en una). */
  offset: z.number().min(-2).max(2).default(0),
  note: z.string().max(MARKER_NOTE_MAX).default(""),
});
export type Marker = z.infer<typeof markerSchema>;
export const markerListSchema = z.array(markerSchema).max(MAX_MARKERS);

let counter = 0;
export const newMarkerId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Marcadores válidos que manda el navegador (forma, palabra existente, sin repetir id, nota sin saltos raros). */
export function cleanMarkers(raw: unknown[], wordCount: number): Marker[] {
  const out: Marker[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const p = markerSchema.safeParse(r);
    if (!p.success || p.data.at_word >= wordCount || ids.has(p.data.id)) continue;
    ids.add(p.data.id);
    out.push({ ...p.data, offset: Math.round(p.data.offset * 1000) / 1000, note: cleanNote(p.data.note) });
    if (out.length >= MAX_MARKERS) break;
  }
  return out;
}

export const cleanNote = (note: string) =>
  note
    // Sin caracteres de control (salvo el salto de línea).
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MARKER_NOTE_MAX);

export type PlacedMarker = { marker: Marker; /** 1, 2, 3… por su orden en el video final. */ number: number; at: number };

/** Dónde cae cada marcador en el video final, numerados por tiempo. Los de palabras cortadas no aparecen. */
export function placeMarkers(timeline: Pick<Timeline, "words">, markers: Marker[], duration?: number): PlacedMarker[] {
  const out: { marker: Marker; at: number }[] = [];
  for (const marker of markers) {
    const r = outputRange(timeline as Timeline, marker.at_word, marker.at_word);
    if (!r) continue;
    const at = Math.max(0, r.start + marker.offset);
    out.push({ marker, at: duration != null ? Math.min(duration, at) : at });
  }
  return out.sort((a, b) => a.at - b.at || (a.marker.id < b.marker.id ? -1 : 1)).map((m, i) => ({ ...m, number: i + 1 }));
}

/** La palabra más cercana a `t` (segundos del video final) y cuánto está corrido el punto desde su inicio. */
export function anchorAt(timeline: Pick<Timeline, "words">, t: number): { at_word: number; offset: number } | null {
  let best: Timeline["words"][number] | null = null;
  for (const w of timeline.words) if (!best || Math.abs(w.start - t) < Math.abs(best.start - t)) best = w;
  if (!best) return null;
  return { at_word: best.id, offset: Math.max(-2, Math.min(2, Math.round((t - best.start) * 1000) / 1000)) };
}

/**
 * Los marcadores para Claude (chat del video y director): número, minuto, la palabra donde caen, lo que se dice
 * alrededor (en el orden del video final) y la nota. `say(ids)` devuelve el texto de esas palabras (con las
 * correcciones); sin `say`, el texto de la transcripción.
 */
export function markersForPrompt(timeline: Pick<Timeline, "words">, markers: Marker[], say?: (ids: number[]) => string): string {
  const placed = placeMarkers(timeline, markers);
  if (!placed.length) return "";
  const words = timeline.words;
  return placed
    .map(({ marker, number, at }) => {
      const i = words.findIndex((w) => w.id === marker.at_word);
      const near = words.slice(Math.max(0, i - 4), i + 7);
      const text = (say ? say(near.map((w) => w.id)) : near.map((w) => w.text).join(" ")).replace(/\s+/g, " ").slice(0, 200);
      const note = marker.note ? ` Nota: «${marker.note.replace(/\s+/g, " ")}».` : " Sin nota.";
      return `- Marcador ${number} (${clock(at)}, palabra ${marker.at_word}, palabras ${near[0]?.id ?? marker.at_word}–${near[near.length - 1]?.id ?? marker.at_word}: «${text}»).${note}`;
    })
    .join("\n");
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
