/**
 * Simulador del director para AI_FAKE=1 (solo desarrollo y pruebas): responde como lo haría Claude, pero con reglas
 * claras sobre los datos REALES del video (medidas del worker, transcripción, candidatos del detector y el plan), así
 * la cadena completa (ojos → mapa → director → segunda mirada → render → revisión final) se prueba de punta a punta.
 * Nunca se usa en producción (lib/ai/client.ts lo descarta). Sin nada de servidor.
 */
import { sentences, type Sentence } from "@/lib/ai/prompts/editor";
import type { CriticWire, DirectorWire, MapWire } from "@/lib/ai/prompts/director";
import { sceneToWire, type MotionSceneAi } from "@/lib/ai/prompts/motion";
import type { Candidate } from "../candidates";
import { spokenNumbers } from "../graphics";
import { removedIds } from "../timeline";
import type { EditPlan, Word } from "../types";
import { brollForbidden, type BrollLimits } from "./assemble";
import { captionBand } from "./checks";
import { wordsInSpan } from "./context";
import type { KeyFrame } from "./keyframes";
import type { Brief, CriticIssue, VideoMap } from "./types";
import { simulateEffects, type FxLimits } from "../fx/director";

const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from <= b.to && b.from <= a.to;

/** VideoMap → formato de cable (la respuesta simulada del mapa pasa por la misma validación que la real). */
export function mapToWire(map: VideoMap): MapWire {
  return {
    kind: map.kind,
    summary: map.summary,
    setting: map.setting,
    shots: map.shots.map((s) => ({ from_s: s.start, to_s: s.end, kind: s.kind, shows: s.shows, important: s.important, why: s.why, frame: s.frame ?? 0 })),
    bad_takes: map.badTakes.map((b) => ({ from_s: b.start, to_s: b.end, kind: b.kind, note: b.note, frame: b.frame ?? 0 })),
    on_screen_text: map.onScreenText.map((t) => ({ from_s: t.start, to_s: t.end, text: t.text, band: t.band })),
    beats: map.beats.map((b) => ({ from_word: b.from, to_word: b.to, role: b.role, summary: b.summary })),
    figures: map.figures,
    promise: map.promise,
    objection: map.objection,
    cta: map.cta,
    brief: { goal: map.inferredBrief.goal ?? "", audience: map.inferredBrief.audience, cta: map.inferredBrief.cta, must_keep: map.inferredBrief.mustKeep },
  };
}

const NUMBER_WORD = /\d|ochenta|cuarenta|doce|diez|veinte|treinta|cincuenta|cien|mil|doble|triple|mitad/i;

function figureLabel(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`.replace(".0K", "K");
  return String(n);
}

const SIM_STOP = new Set("el la los las un una de del al a en y o que con por para tu tus mi su lo le se no es son".split(" "));

/** Partes de una enumeración ("creando contenido que no vende, invirtiendo en anuncios… y llenando tu agenda…"). */
export function enumeration(text: string): string[] | null {
  const parts = text
    .replace(/[¿?¡!.]/g, "")
    .split(/,\s*(?:y\s+)?|\s+y\s+(?=\p{L}+(?:ando|endo|iendo)\b)/u)
    .map((p) => p.trim())
    .filter((p) => p.split(/\s+/).length >= 2);
  if (parts.length < 3) return null;
  const items = parts.slice(-4).map((p) => {
    // Desde el verbo ("creando…") si lo hay, hasta 3 palabras, sin cortar en una palabra vacía.
    let words = p.split(/\s+/);
    const g = words.findIndex((w) => /(ando|endo|iendo)$/i.test(w));
    if (g > 0) words = words.slice(g);
    words = words.slice(0, 3);
    while (words.length > 1 && SIM_STOP.has(words[words.length - 1]!.toLowerCase())) words.pop();
    const short = words.join(" ");
    return short.charAt(0).toUpperCase() + short.slice(1);
  });
  return items.every((i) => i.length >= 3) ? items : null;
}

/** "No es X, es Y": contraste para una comparación. */
export function contrast(text: string): { left: string; right: string } | null {
  const m = text.replace(/[¿?¡!.]/g, "").match(/no es\s+(.{3,40}?),\s*es\s+(.{3,40})/i);
  return m ? { left: m[1]!.trim(), right: m[2]!.trim() } : null;
}

/** Gráfico simulado para una frase: una lista, un contraste, una cifra (o "de X a Y") o una palabra clave. */
function sceneFor(f: Sentence): MotionSceneAi {
  const steps = f.text.match(/:\s*([^.]+)/)?.[1]?.split(/,\s*|\s+y\s+/).map((x) => x.trim()).filter(Boolean);
  if (steps && steps.length >= 2 && steps.length <= 4 && steps.every((x) => x.split(/\s+/).length <= 3))
    return { title: f.text.split(":")[0]!.replace(/^(el|la|los|las)\s+/i, "").slice(0, 40).replace(/^./, (c) => c.toUpperCase()), mode: "full", position: "top", layers: [{ kind: "component", component: "steps", at: 0, scale: 1, place: "auto", props: { title: "", steps: steps.map((x) => x.charAt(0).toUpperCase() + x.slice(1)), icons: [] } }] };
  const items = enumeration(f.text);
  if (items) return { title: "Los errores", mode: "full", position: "top", layers: [{ kind: "component", component: "list", at: 0, scale: 1, place: "auto", props: { title: "", items, marker: "number", icons: [] } }] };
  const vs = contrast(f.text);
  if (vs) return { title: "No es esto, es esto", mode: "full", position: "top", layers: [{ kind: "component", component: "comparison", at: 0, scale: 1, place: "auto", props: { left: { label: "No es", text: vs.left.charAt(0).toUpperCase() + vs.left.slice(1) }, right: { label: "Es", text: vs.right.charAt(0).toUpperCase() + vs.right.slice(1) } } }] };
  // "un video", "una pregunta" no son cifras.
  const nums = spokenNumbers(f.text).filter((n) => n !== 1 || /\b1\b/.test(f.text));
  const pct = /por ciento|%/i.test(f.text);
  const money = /d[oó]lares|\$/i.test(f.text);
  if (nums.length >= 2 && /\bde\b.+\ba\b/i.test(f.text)) {
    const [a, b] = nums.slice(-2) as [number, number];
    const unit = money ? "$" : "";
    return { title: `De ${a} a ${b}`, mode: "full", position: "top", layers: [{ kind: "component", component: "beforeAfter", at: 0, scale: 1, place: "auto", props: { from: `${unit}${figureLabel(a)}`, to: `${unit}${figureLabel(b)}`, fromLabel: "Antes", toLabel: "Ahora", label: money ? "costo por cliente" : "resultado" } }] };
  }
  if (nums.length) {
    const n = nums[0]!;
    const value = pct ? `${n}%` : money ? `$${figureLabel(n)}` : figureLabel(n);
    const label = f.text.replace(/[¿?¡!.,]/g, "").split(/\s+/).filter((w) => w.length > 4 && !NUMBER_WORD.test(w)).slice(0, 4).join(" ");
    return { title: value, mode: "full", position: "top", layers: [{ kind: "component", component: "statCard", at: 0, scale: 1, place: "auto", props: { value, label: label || "lo que dices", eyebrow: "", icon: "" } }] };
  }
  const word = f.text.replace(/[¿?¡!.,:]/g, "").split(/\s+/).filter((w) => w.length > 5).slice(0, 2).join(" ") || "Clave";
  return { title: word, mode: "overlay", position: "top", layers: [{ kind: "component", component: "keyword", at: 0, scale: 1, place: "auto", props: { text: word.charAt(0).toUpperCase() + word.slice(1), label: "", emphasis: "marker" } }] };
}

export type SimDirectorInput = {
  words: Word[];
  duration: number;
  format: "9:16" | "16:9";
  candidates: Candidate[];
  map: VideoMap | null;
  brief: Brief;
  broll: BrollLimits;
  mustKeep: { from: number; to: number }[];
  preset: string;
  base?: EditPlan | null;
  issues?: CriticIssue[];
  instruction?: string | null;
  /** Efectos permitidos (Mi marca). Sin el campo, sin efectos. */
  fx?: FxLimits | null;
};

export function simulateDirector(input: SimDirectorInput): DirectorWire {
  const { words, map, brief } = input;
  const phrases = sentences(words);
  const instruction = (input.instruction ?? "").toLowerCase();
  const changes: string[] = [];
  let pace: DirectorWire["pace"] = brief.goal === "anuncio" ? "fast" : brief.goal === "historia" ? "calm" : "normal";
  const keep = [...input.mustKeep];
  // "No cortes la parte del precio": se protege la frase que lo dice.
  const noCut = instruction.match(/no (?:cortes|quites|saques)(?: la parte)?(?: de| del| de la| el| la| lo)? ([a-záéíóúñ ]{3,40})/);
  if (noCut) {
    const terms = noCut[1]!.split(/\s+/).filter((t) => t.length >= 4);
    const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const f of phrases) if (terms.some((t) => plain(f.text).includes(plain(t)))) keep.push({ from: f.from, to: f.to });
    changes.push(`No corto la parte de ${noCut[1]!.trim()}.`);
  }
  if (/din[aá]mic|r[aá]pid|m[aá]s ritmo|agil|ágil/.test(instruction)) {
    pace = "fast";
    changes.push("Ritmo más rápido: menos pausas y fuera las muletillas.");
  }
  if (/tranquil|m[aá]s lento|calma/.test(instruction)) {
    pace = "calm";
    changes.push("Ritmo más tranquilo.");
  }

  // Cortes: candidatos del detector + tomas malas del mapa (hasta los bordes de su frase), salvo lo protegido.
  const cuts: DirectorWire["cuts"] = [];
  const reasonOf = { retake: "retake", false_start: "false_start", filler: "filler", silence: null } as const;
  for (const c of input.candidates) {
    const reason = reasonOf[c.kind];
    if (!reason) continue;
    if (c.confidence < (pace === "fast" ? 0.45 : 0.6)) continue;
    cuts.push({ from_word: c.from_word, to_word: c.to_word, reason, why: c.kind === "retake" ? "Gana la última toma completa." : c.kind === "false_start" ? "Arranque en falso: se repite bien enseguida." : "Muletilla que no cambia el sentido." });
  }
  for (const b of map?.badTakes ?? []) {
    const from = phrases.find((f) => f.from <= b.from && f.to >= b.from)?.from ?? b.from;
    const to = phrases.find((f) => f.from <= b.to && f.to >= b.to)?.to ?? b.to;
    if (map?.beats.some((x) => x.role === "cta" && overlaps({ from: x.from, to: x.to }, { from, to }))) continue;
    cuts.push({ from_word: from, to_word: to, reason: "bad_take", why: `${b.note} Se dice mejor en otra toma.` });
  }
  const safeCuts = cuts.filter((c) => !keep.some((k) => overlaps(k, { from: c.from_word, to: c.to_word })));
  const removed = removedIds({ removals: safeCuts.map((c) => ({ ...c, confidence: 1, source: "ai" as const })) }, words.length);

  // Ganchos: frases de 3 a 8 s que no se cortan; primero preguntas y cifras.
  const hooks = phrases
    .filter((f) => f.end - f.start >= 3 && f.end - f.start <= 8.4)
    .filter((f) => !Array.from({ length: f.to - f.from + 1 }, (_, k) => f.from + k).some((id) => removed.has(id)))
    .map((f) => ({ f, score: 0.5 + (/[?¿]/.test(f.text) ? 0.2 : 0) + (NUMBER_WORD.test(f.text) ? 0.2 : 0) - f.index * 0.01 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ f, score }) => ({ from_word: f.from, to_word: f.to, score: Math.min(0.95, score), why: /[?¿]/.test(f.text) ? "Abre con una pregunta y un dato que frena el scroll." : "Plantea el tema de entrada y se entiende sin contexto." }));
  if (/otro gancho/.test(instruction) && hooks.length > 1) {
    hooks.push(hooks.shift()!);
    changes.push("Cambié el gancho.");
  }

  // B-roll y gráficos: cifras dichas → gráfico; frases de contenido en videos largos → palabra clave.
  const hook = hooks[0] ?? null;
  const forbidden = brollForbidden(words, removed, hook ? { ...hook } : null, map);
  const wantsMore = /m[aá]s gr[aá]fic/.test(instruction);
  const secondHalf = /segunda mitad|final/.test(instruction);
  const noBroll = /sin b-?roll|sin gr[aá]fic|menos b-?roll|menos gr[aá]fic/.test(instruction);
  const limit = noBroll ? 0 : wantsMore ? input.broll.count + 2 : input.broll.count;
  const broll: DirectorWire["broll"] = [];
  const half = input.duration / 2;
  for (const f of phrases) {
    if (broll.length >= limit) break;
    if (secondHalf && f.start < half) continue;
    // El tramo más largo de la frase que queda (una toma repetida cortada adentro no impide el gráfico).
    let best: { from: number; to: number } | null = null;
    for (let id = f.from; id <= f.to; id++) {
      if (removed.has(id)) continue;
      let end = id;
      while (end < f.to && !removed.has(end + 1)) end++;
      if (!best || end - id > best.to - best.from) best = { from: id, to: end };
      id = end;
    }
    if (!best) continue;
    const range = best;
    if (forbidden.some((x) => overlaps(x, range))) continue;
    const span = f.end - f.start;
    const figure = NUMBER_WORD.test(f.text) && spokenNumbers(f.text).some((n) => n !== 1);
    const structured = Boolean(enumeration(f.text) || contrast(f.text) || /:\s*\S+,/.test(f.text));
    if (!figure && !structured && !wantsMore && !(input.duration > 45 && span >= 2.5)) continue;
    // El gráfico cubre de 1,5 a 5 s del tramo (desde su inicio); una lista o un contraste, todo lo que se dice.
    let to = range.from;
    const cap = structured ? 11 : Math.min(input.broll.maxSeconds, 5);
    while (to < range.to && words[to + 1]!.end - words[range.from]!.start <= cap) to++;
    if (words[to]!.end - words[range.from]!.start < 1.4) continue;
    broll.push({ from_word: range.from, to_word: to, kind: "graphic", query_en: "business growth chart", keywords: ["negocio", "resultados"], graphic: input.broll.graphics ? sceneToWire(sceneFor(f)) : null, why: figure ? "Dices una cifra: el gráfico la fija en la cabeza." : enumeration(f.text) ? "Enumeras: cada punto entra cuando lo dices." : contrast(f.text) ? "Contraste: lo de antes se tacha y entra lo nuevo cuando lo dices." : "Refuerza la idea central de esta parte." });
  }
  if (wantsMore) changes.push(secondHalf ? "Más gráficos en la segunda mitad." : "Más gráficos.");
  if (noBroll) changes.push("Sin b-roll.");

  // Subtítulos ocultos donde ya hay texto quemado en la misma franja.
  const cap = captionBand(input.preset, input.format);
  const caption_hide: DirectorWire["caption_hide"] = [];
  for (const t of map?.onScreenText ?? []) {
    const bandRange = t.band === "abajo" ? [0.62, 1] : t.band === "centro" ? [0.36, 0.62] : [0, 0.36];
    if (!cap || bandRange[1]! < cap[0] || bandRange[0]! > cap[1]) continue;
    const span = wordsInSpan(words, t.start, t.end);
    if (span) caption_hide.push({ from_word: span.from, to_word: span.to, why: `Ya se lee "${t.text.slice(0, 30)}" en pantalla.` });
  }

  // Zooms: en las cifras (fuera de los b-roll).
  const zooms: DirectorWire["zooms"] = phrases
    .filter((f) => NUMBER_WORD.test(f.text) && !broll.some((b) => overlaps({ from: b.from_word, to: b.to_word }, { from: f.from, to: f.to })) && !removed.has(f.from))
    .slice(0, 4)
    .map((f) => ({ from_word: f.from, to_word: Math.min(f.to, f.from + 3), strength: pace === "fast" ? "marcado" : "suave", why: "Énfasis en el dato." }));
  if (/sin zoom|quita el zoom|menos zoom|saca el zoom/.test(instruction)) {
    zooms.length = 0;
    changes.push("Sin zooms.");
  }
  const emphasis = words.filter((w) => NUMBER_WORD.test(w.text) && !removed.has(w.id)).map((w) => w.id).slice(0, 8);

  // Versión corta: quita frases de la mitad (puntos, no cifras ni CTA) hasta unos 30 s.
  const variants: DirectorWire["variants"] = [];
  const target = Number(instruction.match(/(\d{2})\s*(?:s|seg)/)?.[1] ?? 0) || null;
  const keptSecs = phrases.filter((f) => !removed.has(f.from)).reduce((a, f) => a + (f.end - f.start), 0);
  const shortTarget = target ?? 30;
  if (keptSecs > shortTarget + 8) {
    const removable = phrases.filter((f) => f.index > 1 && !removed.has(f.from) && !NUMBER_WORD.test(f.text) && !map?.beats.some((b) => b.role === "cta" && b.from <= f.to && f.from <= b.to) && !keep.some((k) => overlaps(k, { from: f.from, to: f.to })));
    const extra: { from_word: number; to_word: number }[] = [];
    let secs = keptSecs;
    for (const f of removable) {
      if (secs <= shortTarget) break;
      extra.push({ from_word: f.from, to_word: f.to });
      secs -= f.end - f.start;
    }
    if (extra.length) variants.push({ label: `Versión de ${shortTarget} s`, why: "Para anuncios y pruebas rápidas: lo esencial y la CTA.", hook_from_word: -1, hook_to_word: -1, extra_cuts: extra, keep_broll: true });
  }
  if (hooks.length > 1) variants.push({ label: "Otro gancho", why: "Prueba a abrir con otra frase.", hook_from_word: hooks[1]!.from_word, hook_to_word: hooks[1]!.to_word, extra_cuts: [], keep_broll: true });

  // "Versión de 30 s" pedida en "Edítalo así": la versión corta pasa a ser la principal.
  let finalCuts = safeCuts;
  if (target && variants[0]?.extra_cuts.length) {
    finalCuts = [...safeCuts, ...variants[0].extra_cuts.map((c) => ({ ...c, reason: "off_topic" as const, why: `Para llegar a ${target} s.` }))];
    variants.shift();
    changes.push(`Recorté a unos ${target} s.`);
  }

  // Problemas que encontró la segunda mirada: se arreglan.
  for (const i of input.issues ?? []) {
    if (i.kind === "tapa_importante") changes.push("Quité el b-roll que tapaba lo que muestras.");
    if (i.kind === "subtitulo_sobre_texto") changes.push("Oculté los subtítulos encima del texto en pantalla.");
    if (i.kind === "toma_mala") changes.push("Corté la toma mala que quedaba.");
  }

  // Efectos de la biblioteca: portada al abrir, checklist si enumera, gráfico si habla de crecer (y lo que pida la persona).
  const taken = [
    ...broll.map((b) => ({ from: b.from_word, to: b.to_word })),
    ...(map?.shots ?? []).filter((s) => s.important).map((s) => ({ from: s.from, to: s.to })),
    ...(map?.badTakes ?? []).map((b) => ({ from: b.from, to: b.to })),
  ];
  const effects = input.fx ? simulateEffects({ words, limits: input.fx, removed, taken, instruction: input.instruction }) : [];
  const fxAsked = input.instruction ? /efecto/.test(instruction) : false;
  if (fxAsked) changes.push(effects.length ? "Ajusté los efectos como pediste." : "Quité los efectos.");

  const goal = brief.goal ?? "otro";
  return {
    summary: `${map ? `Vi ${map.kind === "anuncio" ? "un anuncio" : "tu video"}${map.shots.some((s) => s.important) ? " con partes que muestran algo importante (no las tapé)" : ""}${map.badTakes.length ? ` y ${map.badTakes.length === 1 ? "una toma mala que corté" : `${map.badTakes.length} tomas malas que corté`}` : ""}. ` : ""}Dejé ${goal === "anuncio" ? "el gancho en los primeros segundos, ritmo alto y la CTA clara al final" : "un gancho fuerte, el contenido completo y un cierre claro"}.`,
    warning: "",
    pace,
    cuts: finalCuts,
    hooks,
    moves: [],
    emphasis_words: emphasis,
    zooms,
    broll,
    caption_hide,
    effects,
    variants,
    changes: [...new Set(changes)],
  };
}

/** Crítico simulado: confirma las verificaciones automáticas en el cuadro más cercano y pone un puntaje. */
export function simulateCritic(issues: CriticIssue[], frames: KeyFrame[]): CriticWire {
  const weight = { alta: 18, media: 9, baja: 4 } as const;
  const nearest = (t: number) => {
    let best = 0;
    frames.forEach((f, i) => {
      if (Math.abs(f.t - t) < Math.abs(frames[best]!.t - t)) best = i;
    });
    return best + 1;
  };
  const score = Math.max(35, 96 - issues.reduce((a, i) => a + weight[i.severity], 0));
  return {
    score,
    verdict: issues.length ? `Encontré ${issues.length === 1 ? "un detalle" : `${issues.length} detalles`} para corregir antes de exportar.` : "Se ve bien: el gancho abre fuerte, no hay tomas malas y nada importante queda tapado.",
    issues: issues.map((i) => ({ kind: i.kind, severity: i.severity, frame: frames.length ? nearest(i.at) : 0, note: i.note, fix: i.fix })),
  };
}
