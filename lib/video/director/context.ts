/**
 * Textos que lee el director (y utilidades de tiempos): tabla de lo que midió el worker, frases, mapa, brief y plan,
 * escritos de forma compacta y estable. Sin nada de servidor (pruebas y simulador).
 */
import { sentences } from "@/lib/ai/prompts/editor";
import { BEAT_LABELS, BRIEF_GOAL_LABELS, SHOT_KIND_LABELS, BAD_TAKE_LABELS, VIDEO_KIND_LABELS, type Brief, type Eyes, type EyesTramo, type VideoMap } from "./types";
import type { EditPlan, Word } from "../types";

const s1 = (n: number) => n.toFixed(1);

/** Palabras que caen (en su mayor parte) dentro de [start, end] del original. null si ninguna. */
export function wordsInSpan(words: Word[], start: number, end: number): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (mid >= start && mid <= end) {
      if (from < 0) from = w.id;
      to = w.id;
    }
  }
  return from < 0 ? null : { from, to };
}

/** Texto de un rango de palabras (con las correcciones de los subtítulos, si hay). */
export function textOf(words: Word[], from: number, to: number, corrections: Record<string, string> = {}, max = 140): string {
  const t = words
    .slice(Math.max(0, from), Math.min(words.length, to + 1))
    .map((w) => corrections[String(w.id)] ?? w.text)
    .join(" ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function faceText(t: EyesTramo): string {
  if (t.faceRatio < 0.15) return "sin cara";
  const f = t.face;
  const where = f ? (f.x + f.w / 2 < 0.36 ? "a la izquierda" : f.x + f.w / 2 > 0.64 ? "a la derecha" : "al centro") : "";
  const size = f ? `${Math.round(f.h * 100)} % del alto` : "";
  const ratio = t.faceRatio < 0.85 ? ` (${Math.round(t.faceRatio * 100)} % del tramo)` : "";
  return `cara ${where}${size ? `, ${size}` : ""}${ratio}, ${t.frontalRatio >= 0.7 ? "mira a cámara" : t.frontalRatio >= 0.3 ? "a veces mira a cámara" : "mira a otro lado"}`;
}

/** Una línea por tramo: lo que midió la máquina, para que Claude lo cruce con lo que ve. */
export function tramosText(eyes: Eyes | null, words: Word[]): string {
  if (!eyes?.tramos.length) return "(sin medidas de imagen)";
  return eyes.tramos
    .map((t) => {
      const span = wordsInSpan(words, t.start, t.end);
      const flags = [
        faceText(t),
        t.blurry ? "BORROSO" : "nítido",
        t.dark ? "MUY OSCURO" : t.bright ? "QUEMADO" : t.backlit ? "CONTRALUZ" : "luz ok",
        t.shaky ? "CÁMARA MOVIDA" : t.motion > 0.01 ? "algo de movimiento" : "cámara fija",
        t.text ? `texto en pantalla "${t.text.slice(0, 50)}" (franja ${band(t.textBand)})` : "",
        t.energy != null ? `voz ${t.energy.toFixed(0)} dB` : "",
      ].filter(Boolean);
      const cuadros = t.samples.length ? `cuadros #${t.samples[0]}–#${t.samples[t.samples.length - 1]}` : "sin cuadros";
      return `${t.id} ${s1(t.start)}–${s1(t.end)} s${t.sceneStart ? " (escena nueva)" : ""} · ${cuadros} · palabras ${span ? `[${span.from}–${span.to}]` : "(silencio)"} · ${flags.join(" · ")}`;
    })
    .join("\n");
}

export function band(b: [number, number] | null | undefined): "arriba" | "centro" | "abajo" {
  if (!b) return "centro";
  const mid = (b[0] + b[1]) / 2;
  return mid < 0.36 ? "arriba" : mid > 0.62 ? "abajo" : "centro";
}

export function sentencesText(words: Word[]): string {
  return sentences(words)
    .map((f) => `F${f.index} [${f.from}–${f.to}] ${s1(f.end - f.start)} s (${s1(f.start)}–${s1(f.end)}): ${f.text}`)
    .join("\n");
}

export function transcriptText(words: Word[]): string {
  return words
    .map((w, i) => {
      const prev = words[i - 1];
      const pause = prev && w.start - prev.end >= 0.6 ? `(pausa ${s1(w.start - prev.end)} s) ` : "";
      return `${pause}${w.id}:${w.text}`;
    })
    .join(" ");
}

export function briefText(b: Brief & { inferred?: (keyof Brief)[] }): string {
  const mark = (k: keyof Brief) => (b.inferred?.includes(k) ? " (inferido)" : "");
  return [
    `- Objetivo: ${b.goal ? BRIEF_GOAL_LABELS[b.goal] : "(sin definir)"}${mark("goal")}`,
    `- Para quién: ${b.audience || "(sin definir)"}${mark("audience")}`,
    `- Llamada a la acción: ${b.cta || "(sin definir)"}${mark("cta")}`,
    `- DEBE QUEDAR (no se corta): ${b.mustKeep || "(nada en especial)"}${mark("mustKeep")}`,
    b.notes ? `- Notas: ${b.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function mapText(map: VideoMap | null, words: Word[]): string {
  if (!map) return "(sin mapa: no se pudo mirar el video)";
  const rng = (a: number, b: number, from: number, to: number) => `${s1(a)}–${s1(b)} s [${from}–${to}]`;
  return [
    `- Tipo: ${VIDEO_KIND_LABELS[map.kind]}. ${map.summary}`,
    map.setting ? `- Se ve: ${map.setting}` : "",
    map.shots.length
      ? `- Tramos visuales:\n${map.shots.map((s, i) => `  S${i + 1} ${rng(s.start, s.end, s.from, s.to)} ${SHOT_KIND_LABELS[s.kind]}${s.important ? " · IMPORTANTE (no tapar)" : ""}: ${s.shows}`).join("\n")}`
      : "",
    map.badTakes.length ? `- Tomas malas:\n${map.badTakes.map((b) => `  ${rng(b.start, b.end, b.from, b.to)} ${BAD_TAKE_LABELS[b.kind]}: ${b.note}`).join("\n")}` : "- Tomas malas: ninguna",
    map.onScreenText.length ? `- Texto en pantalla:\n${map.onScreenText.map((t) => `  ${s1(t.start)}–${s1(t.end)} s (franja ${t.band}): "${t.text}"`).join("\n")}` : "",
    map.beats.length ? `- Historia:\n${map.beats.map((b) => `  [${b.from}–${b.to}] ${BEAT_LABELS[b.role]}: ${b.summary || textOf(words, b.from, b.to, {}, 80)}`).join("\n")}` : "",
    map.figures.length ? `- Cifras dichas: ${map.figures.join(" · ")}` : "",
    map.promise ? `- Promesa: ${map.promise}` : "",
    map.objection ? `- Objeción: ${map.objection}` : "",
    map.cta ? `- CTA: ${map.cta}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** El plan en palabras, para el crítico y para corregir. Los b-roll se numeran B1, B2… en orden. */
export function planText(plan: EditPlan, words: Word[]): string {
  const c = plan.corrections;
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : null;
  const lines = [
    `- Ritmo: ${plan.director?.pace ?? "normal"} · pausas de hasta ${s1(plan.pacing?.long_pause ?? 0.5)} s`,
    hook ? `- Gancho [${hook.from_word}–${hook.to_word}]: "${textOf(words, hook.from_word, hook.to_word, c)}" (${hook.why})` : "- Sin gancho: empieza como se grabó.",
    plan.removals.length
      ? `- Cortes:\n${plan.removals.map((r) => `  [${r.from_word}–${r.to_word}] ${r.reason}: "${textOf(words, r.from_word, r.to_word, c, 70)}"${r.note ? ` (${r.note})` : ""}`).join("\n")}`
      : "- Cortes: ninguno",
    plan.moves?.length ? `- Bloques movidos:\n${plan.moves.map((m) => `  [${m.from_word}–${m.to_word}] va después de ${m.after_word < 0 ? "el gancho (al principio)" : `la palabra ${m.after_word}`} (${m.why})`).join("\n")}` : "",
    plan.broll.length
      ? `- B-roll y gráficos:\n${[...plan.broll]
          .sort((a, b) => a.from_word - b.from_word)
          .map((b, i) => {
            const what = b.choice?.source === "graphic" ? `gráfico "${(b.choice.graphic as { title?: string } | null)?.title ?? "gráfico"}"` : b.choice ? `toma de ${b.choice.source} ("${b.query_en}")` : `sin clip ("${b.query_en}")`;
            return `  B${i + 1} [${b.from_word}–${b.to_word}] ${what} sobre "${textOf(words, b.from_word, b.to_word, c, 70)}"${b.why ? ` (${b.why})` : ""}`;
          })
          .join("\n")}`
      : "- B-roll: ninguno",
    plan.zoom_moments?.length ? `- Zooms: ${plan.zoom_moments.map((z) => `[${z.from_word}–${z.to_word}] ×${z.scale.toFixed(2)}`).join(", ")}` : "",
    plan.captions.hide?.length ? `- Subtítulos ocultos: ${plan.captions.hide.map((h) => `[${h.from_word}–${h.to_word}]`).join(", ")}` : "",
    plan.captions.emphasis_words.length ? `- Palabras resaltadas: ${plan.captions.emphasis_words.map((id) => `${id}:${words[id]?.text ?? "?"}`).join(", ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
