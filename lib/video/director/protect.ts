/**
 * Qué no se puede tapar, con medida.
 *
 * Antes, cualquier tramo "importante" del mapa (un gesto de 20 s, toda la parte de la CTA) quedaba prohibido y más
 * de la mitad del video se quedaba sin nada en pantalla. Ahora:
 * - "A cámara" nunca se protege (tapar por momentos a quien habla es para lo que sirve el b-roll).
 * - Un gesto protege solo su segundo exacto (la palabra del medio y sus vecinas), no todo el tramo.
 * - Lo que tapa la cara (b-roll y gráficos a pantalla completa) no va en el gancho, la apertura ni en la ÚLTIMA frase
 *   de llamado a la acción. Los gráficos sobre el video y los efectos (que dejan ver a la persona) sí pueden ir en el
 *   gancho y en la CTA: la refuerzan.
 * - Tope: lo prohibido nunca pasa del 25 % del video. Si pasa, quedan los tramos más importantes (producto y pantalla
 *   antes que un gesto) y se avisa.
 *
 * Sin servidor: lo usan el armado del plan, las verificaciones, el relleno de ritmo y el simulador.
 */
import { sentences } from "@/lib/ai/prompts/editor";
import type { HookCandidate, Word } from "../types";
import type { ShotKind, VideoMap } from "./types";

export type Zone = { from: number; to: number; label: string };

/** Parte máxima del video que puede quedar prohibida. */
export const FORBIDDEN_CAP = 0.25;

const PRIORITY: Record<ShotKind, number> = { producto: 0, pantalla: 1, texto: 2, b_roll_propio: 3, otro: 4, gesto: 5, a_camara: 9 };

const secs = (words: Word[], z: { from: number; to: number }) => Math.max(0, (words[z.to]?.end ?? 0) - (words[z.from]?.start ?? 0));

/** Lo que se muestra y no se puede tapar (sin "a cámara", gestos a su segundo, con tope). */
export function protectedZones(map: VideoMap | null, words: Word[]): { zones: Zone[]; trimmed: string[] } {
  const total = Math.max(1, (words.at(-1)?.end ?? 0) - (words[0]?.start ?? 0));
  const candidates = (map?.shots ?? [])
    .filter((s) => s.important && s.kind !== "a_camara")
    .map((s) => {
      let { from, to } = s;
      if (s.kind === "gesto" && to - from > 2) {
        // El gesto ocurre en un instante: su palabra del medio y las vecinas (alrededor de un segundo).
        const mid = Math.round((from + to) / 2);
        from = Math.max(s.from, mid - 1);
        to = Math.min(s.to, mid + 1);
      }
      return { from, to, label: `lo que se ve (${s.shows.slice(0, 40)})`, priority: PRIORITY[s.kind] ?? 4 };
    })
    .sort((a, b) => a.priority - b.priority || secs(words, a) - secs(words, b));
  const zones: Zone[] = [];
  const trimmed: string[] = [];
  let used = 0;
  for (const c of candidates) {
    const s = secs(words, c);
    if (used + s > total * FORBIDDEN_CAP) {
      trimmed.push(c.label);
      continue;
    }
    used += s;
    zones.push({ from: c.from, to: c.to, label: c.label });
  }
  return { zones: zones.sort((a, b) => a.from - b.from), trimmed };
}

/** La última frase de llamado a la acción (no todo el cierre): la última frase que queda, o la del final del beat CTA. */
export function ctaSentence(words: Word[], removed: Set<number>, map: VideoMap | null): Zone | null {
  const kept = words.filter((w) => !removed.has(w.id));
  const phrases = sentences(kept);
  const beat = map?.beats.filter((b) => b.role === "cta").at(-1);
  if (beat) {
    const inBeat = phrases.filter((f) => f.from <= beat.to && beat.from <= f.to);
    const last = inBeat.at(-1);
    if (last) return { from: Math.max(last.from, beat.from), to: Math.min(last.to, beat.to), label: "llamado a la acción" };
  }
  const last = phrases.at(-1);
  return last ? { from: last.from, to: last.to, label: "llamado a la acción" } : null;
}

/**
 * Donde no puede ir lo que tapa a la persona (b-roll de video y gráficos a pantalla completa): el gancho, la apertura,
 * la última frase de la CTA y lo que se muestra. `overlay`: gráficos sobre el video, que dejan ver a la persona: solo
 * lo que se muestra.
 */
export function coverForbidden(words: Word[], removed: Set<number>, hook: HookCandidate | null, map: VideoMap | null, overlay = false): Zone[] {
  const out: Zone[] = [...protectedZones(map, words).zones];
  if (overlay) return out;
  if (hook) out.push({ from: hook.from_word, to: hook.to_word, label: "gancho" });
  const kept = words.filter((w) => !removed.has(w.id));
  const first = kept[0];
  if (first) {
    const opening = kept.filter((w) => w.start - first.start < 2.5).at(-1);
    out.push({ from: first.id, to: opening?.id ?? first.id, label: "apertura" });
  }
  const cta = ctaSentence(words, removed, map);
  if (cta) out.push(cta);
  return out;
}

/** Donde no van efectos: lo que se muestra y las tomas malas (el gancho y la CTA sí admiten efectos). */
export function effectsForbidden(words: Word[], map: VideoMap | null): Zone[] {
  return [...protectedZones(map, words).zones, ...(map?.badTakes ?? []).map((b) => ({ from: b.from, to: b.to, label: "una toma mala" }))];
}
