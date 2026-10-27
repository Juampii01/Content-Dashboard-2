/**
 * Mapa del video: lo que respondió Claude mirando las hojas (formato de cable → VideoMap validado) o, sin IA o sin
 * imágenes, uno armado solo con las medidas del worker y la transcripción (también es el simulador de AI_FAKE=1).
 * Sin nada de servidor.
 */
import { sentences, type Sentence } from "@/lib/ai/prompts/editor";
import type { MapWire } from "@/lib/ai/prompts/director";
import { band, wordsInSpan } from "./context";
import { BRIEF_GOALS, EMPTY_BRIEF, type BeatRole, type Brief, type Eyes, type MapBadTake, type MapBeat, type MapShot, type MapText, type VideoMap } from "./types";
import type { Word } from "../types";
import { norm } from "../text";

const clip = (s: string, n: number) => s.trim().slice(0, n);
const FIGURE_RE = /\d|(?:^|\s)(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|veinte|treinta|cuarenta|cincuenta|cien|mil|millón|millones|doble|triple|mitad)(?=\s|[.,!?]|$)/i;
const CTA_RE = /\b(comenta|escr[ií]beme|escribe|s[ií]gueme|seguime|s[ií]guenos|mi perfil|link|enlace|haz clic|reserva|agenda (una|tu|la)|compra (ya|ahora|aqu[ií])|descarga|reg[ií]strate|dm|m[aá]ndame|guarda|comp[aá]rtelo|entra a|entr[aá] a)\b/i;
const PROBLEM_RE = /\b(error|problema|pierde|pierden|perder|nadie|nunca|dejas?|cuesta|caro|fracas|falla)\w*/i;
const PROMISE_RE = /\b(hoy te|te muestro|te enseño|vas a|aprende|c[oó]mo|secreto|la clave|lo que funciona|cambia todo)\b/i;
const OFFER_RE = /\b(gratis|precio|oferta|descuento|acceso|programa|curso|servicio|cup[oó]n|inscr[ií]bete)\b/i;

/** Mapa a partir de la respuesta de Claude: segundos → palabras, ids válidos, textos acotados. */
export function mapFromWire(w: MapWire, words: Word[], eyes: Eyes | null): VideoMap {
  const n = words.length;
  const okRange = (a: number, b: number) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b < n && a <= b;
  const frameAt = (t: number, f: number) => (eyes?.samples.some((s) => s.i === f) ? f : nearestFrame(eyes, t));
  const shots: MapShot[] = [];
  for (const s of w.shots.slice(0, 40)) {
    const a = Math.min(s.from_s, s.to_s);
    const b = Math.max(s.from_s, s.to_s);
    const span = wordsInSpan(words, a, b);
    if (!span) continue;
    shots.push({ from: span.from, to: span.to, start: round(a), end: round(b), kind: s.kind, shows: clip(s.shows, 140), important: s.important, why: clip(s.why, 200), frame: frameAt((a + b) / 2, s.frame) });
  }
  const badTakes: MapBadTake[] = [];
  for (const s of w.bad_takes.slice(0, 30)) {
    const a = Math.min(s.from_s, s.to_s);
    const b = Math.max(s.from_s, s.to_s);
    const span = wordsInSpan(words, a, b);
    if (!span) continue;
    badTakes.push({ from: span.from, to: span.to, start: round(a), end: round(b), kind: s.kind, note: clip(s.note, 200), frame: frameAt((a + b) / 2, s.frame) });
  }
  const onScreenText: MapText[] = w.on_screen_text.slice(0, 30).map((t) => ({ start: round(Math.min(t.from_s, t.to_s)), end: round(Math.max(t.from_s, t.to_s)), text: clip(t.text, 120), band: t.band }));
  const beats: MapBeat[] = w.beats
    .filter((b) => okRange(b.from_word, b.to_word))
    .sort((a, b) => a.from_word - b.from_word)
    .filter((b, i, all) => i === 0 || b.from_word > all[i - 1]!.to_word)
    .slice(0, 40)
    .map((b) => ({ from: b.from_word, to: b.to_word, role: b.role, summary: clip(b.summary, 160) }));
  const goal = (BRIEF_GOALS as readonly string[]).includes(w.brief.goal) ? (w.brief.goal as Brief["goal"]) : null;
  // La CTA que se infiere es la que se DICE en el video (el modelo a veces trae la de Mi marca, que puede no coincidir).
  const ctaBeat = beats.filter((b) => b.role === "cta").at(-1);
  const saidCta = ctaBeat ? words.slice(ctaBeat.from, ctaBeat.to + 1).map((x) => x.text).join(" ") : "";
  // Se compara con lo que se dice en la parte de la CTA (si el mapa la marcó) o en todo el video.
  const scope = ctaBeat ? words.slice(ctaBeat.from, ctaBeat.to + 1) : words;
  const inferredCta = spokenCta(scope, [w.brief.cta, w.cta]) ?? (saidCta ? clip(saidCta, 300) : clip(w.brief.cta, 300));
  return {
    kind: w.kind,
    summary: clip(w.summary, 300),
    setting: clip(w.setting, 300),
    shots,
    badTakes,
    onScreenText,
    beats,
    figures: w.figures.map((f) => clip(f, 60)).filter(Boolean).slice(0, 12),
    promise: clip(w.promise, 200),
    objection: clip(w.objection, 200),
    cta: clip(w.cta, 200),
    inferredBrief: { goal, audience: clip(w.brief.audience, 300), cta: inferredCta, mustKeep: clip(w.brief.must_keep, 400), notes: "" },
    by: "ai",
    frames: eyes?.samples.length ?? 0,
  };
}

function nearestFrame(eyes: Eyes | null, t: number): number | null {
  if (!eyes?.samples.length) return null;
  return eyes.samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best)).i;
}

const round = (n: number) => Math.round(n * 100) / 100;

function beatRole(f: Sentence, i: number, all: Sentence[]): BeatRole {
  if (i === 0) return "gancho";
  if (i === all.length - 1 && CTA_RE.test(f.text)) return "cta";
  if (CTA_RE.test(f.text) && i >= all.length - 2) return "cta";
  if (FIGURE_RE.test(f.text)) return "cifra";
  if (OFFER_RE.test(f.text) && i >= all.length / 2) return "oferta";
  if (PROBLEM_RE.test(f.text)) return "problema";
  if (PROMISE_RE.test(f.text)) return "promesa";
  return "punto";
}

/**
 * Mapa solo con las medidas (sin mirar las imágenes): sirve cuando no hay IA, cuando no hay hojas y como simulador
 * coherente en AI_FAKE=1. Usa lo que de verdad midió el worker: tramos sin cara y nítidos con texto = pantalla o
 * producto (importante); borrosos, oscuros o sin cara entre tramos con cara = tomas malas.
 */
export function mapFromMeasures(eyes: Eyes | null, words: Word[]): VideoMap {
  const tramos = eyes?.tramos ?? [];
  const faceVideo = (eyes?.stats.faceRatio ?? 0) >= 0.4;
  const shots: MapShot[] = [];
  const badTakes: MapBadTake[] = [];
  const onScreenText: MapText[] = [];
  for (const t of tramos) {
    const span = wordsInSpan(words, t.start, t.end);
    const frame = t.samples[Math.floor(t.samples.length / 2)] ?? null;
    if (t.text) {
      const last = onScreenText[onScreenText.length - 1];
      if (last && last.text === t.text && Math.abs(last.end - t.start) < 0.6) last.end = round(t.end);
      else onScreenText.push({ start: round(t.start), end: round(t.end), text: t.text.slice(0, 120), band: band(t.textBand) });
    }
    if (!span) continue;
    // La luz solo cuenta con una persona en cuadro: una pantalla en modo oscuro no es una toma mala.
    const person = t.faceRatio >= 0.5;
    const bad = t.blurry
      ? "borroso"
      : person && t.dark
        ? "oscuro"
        : person && t.backlit
          ? "contraluz"
          : t.shaky
            ? "movido"
            : faceVideo && t.faceRatio < 0.15 && !t.text
              ? "fuera_de_cuadro"
              : person && t.frontalRatio < 0.3
                ? "mira_a_otro_lado"
                : null;
    if (bad) {
      const note = {
        borroso: "La imagen está desenfocada.",
        oscuro: "Está muy oscuro.",
        contraluz: "Tu cara queda a contraluz.",
        movido: "La cámara se mueve mucho.",
        fuera_de_cuadro: "No se te ve en cuadro.",
        mira_a_otro_lado: "Miras a otro lado, no a cámara.",
      }[bad];
      badTakes.push({ from: span.from, to: span.to, start: round(t.start), end: round(t.end), kind: bad, note, frame });
      continue;
    }
    if (t.faceRatio < 0.15) {
      const screen = Boolean(t.text);
      const prev = shots[shots.length - 1];
      if (prev && prev.kind === (screen ? "pantalla" : "producto") && prev.to >= span.from - 1) {
        prev.to = span.to;
        prev.end = round(t.end);
        continue;
      }
      shots.push({
        from: span.from,
        to: span.to,
        start: round(t.start),
        end: round(t.end),
        kind: screen ? "pantalla" : "producto",
        shows: screen ? `Pantalla con texto: "${t.text.slice(0, 60)}"` : "Algo que se muestra sin tu cara (producto o toma de apoyo)",
        important: true,
        why: "Se ve algo que no eres tú hablando: taparlo con b-roll haría perder lo que muestras.",
        frame,
      });
    } else {
      const prev = shots[shots.length - 1];
      if (prev && prev.kind === "a_camara" && prev.to >= span.from - 1) {
        prev.to = span.to;
        prev.end = round(t.end);
        continue;
      }
      shots.push({ from: span.from, to: span.to, start: round(t.start), end: round(t.end), kind: "a_camara", shows: "Hablas a cámara", important: false, why: "", frame });
    }
  }
  const phrases = sentences(words);
  const beats: MapBeat[] = phrases.map((f, i) => ({ from: f.from, to: f.to, role: beatRole(f, i, phrases), summary: "" }));
  // Cifras: la cifra con las palabras de alrededor ("ochenta por ciento", "de cuarenta a doce dólares"), sin repetir.
  const NUM = "(?<![a-záéíóúñ0-9])(?:\\d[\\d.,%]*|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|mil|doble|triple|mitad)(?![a-záéíóúñ])";
  const figureRe = new RegExp(`(?:\\bde\\s+)?${NUM}(?:\\s+por\\s+ciento|\\s+(?:a|por|de|mil|millones)\\s+${NUM})?(?:\\s+[a-záéíóúñ$%]+){0,2}`, "gi");
  const figures = [...new Set(phrases.flatMap((f) => f.text.match(figureRe) ?? []).map((m) => m.replace(/[.,?¿!¡]+$/, "").trim()).filter((m) => m.split(/\s+/).length >= 2))].slice(0, 6);
  const ctaPhrase = [...phrases].reverse().find((f) => CTA_RE.test(f.text));
  const anyScreen = shots.some((s) => s.important);
  const offer = phrases.some((f) => OFFER_RE.test(f.text));
  const kind: VideoMap["kind"] = !faceVideo ? (anyScreen ? "demo_pantalla" : "otro") : anyScreen && (offer || ctaPhrase) ? "anuncio" : "talking_head";
  const goal: Brief["goal"] = kind === "anuncio" ? "anuncio" : offer ? "vender" : "educar";
  const important = shots.filter((s) => s.important);
  return {
    kind,
    summary: kind === "anuncio" ? "Un anuncio: hablas a cámara, muestras el producto y cierras con una llamada a la acción." : kind === "demo_pantalla" ? "Una demo de pantalla con tu voz." : "Hablas a cámara sobre un tema.",
    setting: faceVideo ? "Tú a cámara, plano medio." : "Sin una persona a cámara la mayor parte del tiempo.",
    shots,
    badTakes,
    onScreenText,
    beats,
    figures,
    promise: phrases.find((f) => PROMISE_RE.test(f.text))?.text.slice(0, 200) ?? "",
    objection: "",
    cta: ctaPhrase?.text.slice(0, 200) ?? "",
    inferredBrief: {
      ...EMPTY_BRIEF,
      goal,
      audience: "",
      cta: ctaPhrase?.text.slice(0, 200) ?? "",
      mustKeep: important.length ? `Lo que se ve entre ${important.map((s) => `${s.start.toFixed(0)} y ${s.end.toFixed(0)} s`).join(", ")}` : "",
    },
    by: "medidas",
    frames: eyes?.samples.length ?? 0,
  };
}

/** Rango de palabras que el brief pide no cortar (DEBE QUEDAR): las frases que contienen sus palabras importantes. */
export function mustKeepRanges(mustKeep: string, words: Word[]): { from: number; to: number }[] {
  const terms = mustKeep
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ñ$%]+/)
    .filter((t) => t.length >= 4 && !["parte", "donde", "cuando", "nada", "todo", "esto", "esta", "este", "sobre", "corte", "cortes", "cortar"].includes(t));
  if (!terms.length) return [];
  const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return sentences(words)
    .filter((f) => terms.some((t) => plain(f.text).includes(t)))
    .map((f) => ({ from: f.from, to: f.to }));
}

/** La primera CTA candidata que se dice en el video (al menos la mitad de sus palabras con contenido aparecen dichas). */
export function spokenCta(words: Word[], candidates: string[]): string | null {
  const said = new Set(words.map((w) => norm(w.text)).filter(Boolean));
  for (const c of candidates) {
    const toks = c.split(/\s+/).map(norm).filter((t) => t.length > 3);
    if (!toks.length) continue;
    const hits = toks.filter((t) => said.has(t) || [...said].some((s) => s.length > 4 && (s.startsWith(t.slice(0, 5)) || t.startsWith(s.slice(0, 5))))).length;
    if (hits / toks.length >= 0.6) return c.trim().slice(0, 300);
  }
  return null;
}
