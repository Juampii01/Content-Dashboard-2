/**
 * Verificaciones automáticas de una edición (sin IA): lo medible que un crítico también buscaría. Se le pasan al
 * crítico con visión para que las confirme o las descarte, y se usan solas cuando no hay IA o se acabó el tope.
 *
 * También trae los arreglos seguros (`safeFixes`): quitar un b-roll que tapa algo importante, ocultar subtítulos sobre
 * un texto quemado y cortar una toma mala que quedó. Sin servidor.
 */
import { sentences } from "@/lib/ai/prompts/editor";
import { CAPTION_STYLES, isCaptionStyle } from "../caption-styles";
import { brollSegments, directorZooms } from "../effects";
import { normalizeRemovals, withDerived } from "../plan";
import { endsSentence } from "../text";
import { buildTimeline, outputRange, removedIds, type Timeline } from "../timeline";
import { FPS, type EditPlan, type VideoFormat, type Word } from "../types";
import { textOf, wordsInSpan } from "./context";
import type { CriticIssue, Eyes, VideoMap } from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Franja vertical (0 a 1) que ocupan los subtítulos del estilo elegido. */
export function captionBand(preset: string, format: VideoFormat): [number, number] | null {
  if (preset === "ninguno") return null;
  const y = isCaptionStyle(preset) ? CAPTION_STYLES[preset].y[format] : format === "9:16" ? 0.665 : 0.82;
  return [y - 0.06, y + 0.09];
}

function hiddenSpans(timeline: Timeline, plan: EditPlan): { start: number; end: number }[] {
  const spans = (plan.captions.hide ?? []).map((h) => outputRange(timeline, h.from_word, h.to_word)).filter((r): r is { start: number; end: number } => Boolean(r));
  for (const s of brollSegments(timeline, plan.broll)) if (s.option.source === "graphic") spans.push({ start: s.start, end: s.end });
  return spans;
}

export function checkPlan(input: { plan: EditPlan; words: Word[]; duration: number; map: VideoMap | null; eyes: Eyes | null }): CriticIssue[] {
  const { plan, words, map, eyes } = input;
  const timeline = buildTimeline(words, plan, input.duration);
  const issues: CriticIssue[] = [];
  const add = (i: Omit<CriticIssue, "by">) => issues.push({ ...i, at: round1(i.at), by: "reglas" });
  const removed = removedIds(plan, words.length);
  const segments = brollSegments(timeline, plan.broll);
  const ordered = [...plan.broll].sort((a, b) => a.from_word - b.from_word);
  const label = (id: string) => `B${ordered.findIndex((b) => b.id === id) + 1}`;

  // B-roll o gráfico encima de algo que se tiene que ver.
  for (const seg of segments) {
    const item = plan.broll.find((b) => b.id === seg.id)!;
    const shot = map?.shots.find((s) => s.important && s.from <= item.to_word && item.from_word <= s.to);
    if (shot) {
      add({ kind: "tapa_importante", severity: "alta", at: seg.start, note: `El ${seg.option.source === "graphic" ? "gráfico" : "b-roll"} ${label(item.id)} tapa ${shot.shows.toLowerCase()}.`, fix: `Quita el ${seg.option.source === "graphic" ? "gráfico" : "b-roll"} ${label(item.id)} (palabras ${item.from_word}–${item.to_word}): tapa ${shot.shows.toLowerCase()}.` });
    }
  }

  // Frases cortadas por un corte (se cortó el final de una frase que sigue después).
  const sentenceEnds = new Set(sentences(words).map((f) => f.to));
  let out = 0;
  for (const [i, clip] of timeline.clips.entries()) {
    out += (clip.endFrame - clip.startFrame) / FPS;
    const next = timeline.clips[i + 1];
    if (!next) break;
    const last = words[clip.lastWord];
    if (!last || endsSentence(last.text) || sentenceEnds.has(clip.lastWord)) continue;
    // ¿Se cortó el final de su frase? (las palabras que siguen hasta el fin de la frase están cortadas)
    let k = clip.lastWord + 1;
    let cutEnd = false;
    while (k < words.length && removed.has(k)) {
      if (sentenceEnds.has(k) || endsSentence(words[k]!.text)) cutEnd = true;
      k++;
    }
    const reason = plan.removals.find((r) => r.from_word <= clip.lastWord + 1 && r.to_word >= clip.lastWord + 1)?.reason;
    if (cutEnd && reason !== "filler" && reason !== "false_start" && reason !== "retake") {
      add({ kind: "frase_cortada", severity: "media", at: out - 0.3, note: `La frase "${textOf(words, Math.max(0, clip.lastWord - 6), clip.lastWord, plan.corrections, 60)}" queda a la mitad.`, fix: `Restaura el final de la frase (palabras ${clip.lastWord + 1}–${k - 1}) o corta la frase entera.` });
    }
  }

  // Subtítulos encima de un texto que ya está en el video.
  const cap = captionBand(plan.captions.preset, plan.format);
  if (cap && eyes) {
    const hidden = hiddenSpans(timeline, plan);
    for (const t of eyes.tramos) {
      if (!t.text || !t.textBand || t.textBand[1] < cap[0] || t.textBand[0] > cap[1]) continue;
      const span = wordsInSpan(words, t.start, t.end);
      if (!span) continue;
      const r = outputRange(timeline, span.from, span.to);
      if (!r || hidden.some((h) => h.start <= r.start + 0.1 && h.end >= r.end - 0.1)) continue;
      add({ kind: "subtitulo_sobre_texto", severity: "media", at: r.start, note: `Los subtítulos quedan encima del texto "${t.text.slice(0, 40)}".`, fix: `Oculta los subtítulos en las palabras ${span.from}–${span.to}: ya hay texto en esa franja.` });
    }
  }

  // Gancho: tiene que empezar y terminar en un límite de frase para entenderse solo.
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : null;
  if (hook) {
    const starts = new Set(sentences(words).map((f) => f.from));
    const prevEnds = hook.from_word === 0 || endsSentence(words[hook.from_word - 1]?.text ?? ".");
    if (!starts.has(hook.from_word) && !prevEnds) add({ kind: "gancho_confuso", severity: "media", at: 0.5, note: "El gancho empieza a mitad de una frase.", fix: `Elige un gancho que empiece al principio de una frase (ahora empieza en la palabra ${hook.from_word}).` });
    else if (!endsSentence(words[hook.to_word]?.text ?? "") && !sentenceEnds.has(hook.to_word)) add({ kind: "gancho_confuso", severity: "baja", at: 1, note: "El gancho termina a mitad de una frase.", fix: "Alarga el gancho hasta el final de la frase o elige otro." });
  }

  // Final: la última palabra que se escucha tiene que cerrar una idea; la CTA no puede quedar cortada.
  const lastWord = timeline.words.at(-1);
  if (lastWord && !lastWord.stop && !sentenceEnds.has(lastWord.id)) {
    add({ kind: "final_abrupto", severity: "alta", at: Math.max(0, timeline.duration - 0.5), note: "El video termina a mitad de una frase.", fix: `Termina el video en una frase completa (la última palabra es "${lastWord.text}").` });
  }
  const ctaBeat = map?.beats.filter((b) => b.role === "cta").at(-1);
  if (ctaBeat) {
    let kept = 0;
    for (let id = ctaBeat.from; id <= ctaBeat.to; id++) if (!removed.has(id)) kept++;
    if (kept < (ctaBeat.to - ctaBeat.from + 1) * 0.6) add({ kind: "final_abrupto", severity: "alta", at: Math.max(0, timeline.duration - 0.5), note: "La llamada a la acción quedó cortada.", fix: `Restaura la llamada a la acción (palabras ${ctaBeat.from}–${ctaBeat.to}).` });
  }

  // Tomas malas que quedaron a la vista.
  for (const b of map?.badTakes ?? []) {
    let kept = 0;
    for (let id = b.from; id <= b.to; id++) if (!removed.has(id)) kept++;
    if (kept < (b.to - b.from + 1) * 0.5) continue;
    const r = outputRange(timeline, b.from, b.to);
    if (!r) continue;
    const covered = segments.some((s) => s.start <= r.start + 0.2 && s.end >= r.end - 0.2);
    if (covered) continue;
    add({ kind: "toma_mala", severity: "alta", at: r.start, note: `Quedó una toma mala (${b.note.replace(/\.$/, "").toLowerCase()}).`, fix: `Corta la toma mala (palabras ${b.from}–${b.to}) o tápala con un b-roll si lo que dices hace falta.` });
  }

  // Saltos: la cara cambia mucho de lugar o de tamaño en un corte, sin zoom ni b-roll que lo disimule.
  if (eyes?.samples.length) {
    const zooms = directorZooms(timeline, plan.zoom_moments, segments);
    let acc = 0;
    for (const [i, clip] of timeline.clips.entries()) {
      acc += (clip.endFrame - clip.startFrame) / FPS;
      const next = timeline.clips[i + 1];
      if (!next) break;
      const a = nearestFace(eyes, clip.endFrame / FPS - 0.2);
      const b = nearestFace(eyes, next.startFrame / FPS + 0.2);
      if (!a || !b) continue;
      const shift = Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
      const size = Math.abs(a.h - b.h) / Math.max(a.h, b.h);
      const hidden = segments.some((s) => s.start <= acc + 0.1 && s.end >= acc - 0.1) || zooms.some((z) => Math.abs(z.start - acc) < 0.3);
      if ((shift > 0.12 || size > 0.3) && !hidden) add({ kind: "salto", severity: "baja", at: acc, note: "En este corte tu cara salta de lugar.", fix: `Disimula el corte del segundo ${acc.toFixed(1)} con un zoom o un b-roll corto.` });
    }
  }

  // Sin repetidos (mismo tipo en el mismo segundo).
  const seen = new Set<string>();
  return issues
    .sort((a, b) => a.at - b.at)
    .filter((i) => {
      const k = `${i.kind}:${Math.round(i.at)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function nearestFace(eyes: Eyes, t: number) {
  const s = eyes.samples.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best), eyes.samples[0]!);
  return Math.abs(s.t - t) <= 1.5 ? s.face : null;
}

/**
 * Arreglos seguros, sin IA: quitar el b-roll que tapa algo importante, ocultar subtítulos sobre un texto quemado,
 * cortar una toma mala que quedó y devolver una CTA cortada. Devuelve el plan y lo que cambió (en palabras).
 */
export function safeFixes(input: { plan: EditPlan; words: Word[]; duration: number; map: VideoMap | null; eyes: Eyes | null; issues?: CriticIssue[] }): { plan: EditPlan; changes: string[] } {
  const { words, map } = input;
  let plan = input.plan;
  const changes: string[] = [];
  const issues = input.issues ?? checkPlan(input);
  const kinds = new Set(issues.map((i) => i.kind));

  if (kinds.has("tapa_importante") && map) {
    const before = plan.broll.length;
    plan = { ...plan, broll: plan.broll.filter((b) => !map.shots.some((s) => s.important && s.from <= b.to_word && b.from_word <= s.to)) };
    const n = before - plan.broll.length;
    if (n) changes.push(n === 1 ? "Quité un b-roll que tapaba lo que muestras." : `Quité ${n} b-roll que tapaban lo que muestras.`);
  }
  if (kinds.has("toma_mala") && map) {
    const removed = removedIds(plan, words.length);
    const phrases = sentences(words);
    const add: EditPlan["removals"] = [];
    for (const b of map.badTakes) {
      let kept = 0;
      for (let id = b.from; id <= b.to; id++) if (!removed.has(id)) kept++;
      if (kept < (b.to - b.from + 1) * 0.5) continue;
      // Se corta la toma mala hasta los bordes de sus frases (así no queda una frase a la mitad).
      const from = phrases.find((f) => f.from <= b.from && f.to >= b.from)?.from ?? b.from;
      const to = phrases.find((f) => f.from <= b.to && f.to >= b.to)?.to ?? b.to;
      const isCta = map.beats.some((x) => x.role === "cta" && x.from <= to && from <= x.to);
      if (isCta) continue;
      add.push({ from_word: from, to_word: to, reason: "bad_take", confidence: 0.9, source: "ai", note: b.note });
    }
    if (add.length) {
      const removals = [...plan.removals, ...add];
      plan = { ...plan, removals, proposed_removals: [...plan.proposed_removals, ...add] };
      changes.push(add.length === 1 ? "Corté una toma mala que había quedado." : `Corté ${add.length} tomas malas que habían quedado.`);
    }
  }
  if (kinds.has("final_abrupto") && map) {
    const cta = map.beats.filter((b) => b.role === "cta").at(-1);
    if (cta) {
      const before = plan.removals.length;
      plan = { ...plan, removals: plan.removals.filter((r) => r.to_word < cta.from || r.from_word > cta.to || r.reason === "filler") };
      if (plan.removals.length !== before) changes.push("Devolví la llamada a la acción del final.");
    }
  }
  if (kinds.has("subtitulo_sobre_texto")) {
    const hide = [...(plan.captions.hide ?? [])];
    for (const i of issues.filter((x) => x.kind === "subtitulo_sobre_texto")) {
      const m = i.fix.match(/palabras (\d+)–(\d+)/);
      if (!m) continue;
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (!hide.some((h) => h.from_word <= from && h.to_word >= to)) hide.push({ from_word: from, to_word: to, why: "Ya hay texto en pantalla en esa franja." });
    }
    if (hide.length !== (plan.captions.hide ?? []).length) {
      plan = { ...plan, captions: { ...plan.captions, hide } };
      changes.push("Oculté los subtítulos donde ya hay texto en pantalla.");
    }
  }
  return { plan: withDerived({ ...plan, removals: normalizeRemovals(plan.removals, words.length) }, words, input.duration), changes };
}
