/**
 * Herramientas de YouTube sin base ni red: detección de caídas de retención, cruce con la transcripción,
 * lectura de subtítulos, largo de títulos y armado de la plantilla de miniaturas.
 *   pnpm test:youtube
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectDrops, dropSentence, introEnd, quoteForDrop, relativeLabel, relativeSummary, retentionMarks } from "../lib/youtube/retention.ts";
import { editorSegments, parseSubtitles, sanitizeSegments, wordsToSegments } from "../lib/youtube/transcript.ts";
import { checkTitle, cleanTitle, countFitting, normalizeTitleGroups, visibleLength } from "../lib/youtube/titles.ts";
import { backgroundPrompt, highlightIndexes, splitLines, thumbColors, thumbFontFromBrand, thumbnailLayout, thumbTextIssues, THUMB_WIDTH } from "../lib/youtube/thumbnail-layout.ts";
import type { RetentionPoint } from "../lib/youtube/types.ts";

/** Curva simulada: arranque (primeros 30 s de 600) que pierde 30 %, caída de 12 puntos al 40 %, otra de 6 al 70 % y el final. */
function curve(opts: { cliffs?: [number, number][]; intro?: number; noise?: number; introPts?: number } = {}): RetentionPoint[] {
  const introPts = opts.introPts ?? 5;
  const cliffs = opts.cliffs ?? [
    [40, 0.12],
    [70, 0.06],
  ];
  const points: RetentionPoint[] = [];
  let r = 1;
  for (let i = 1; i <= 100; i++) {
    if (i <= introPts) r -= (opts.intro ?? 0.3) / introPts;
    else r -= 0.002;
    for (const [at, loss] of cliffs) if (i > at && i <= at + 3) r -= loss / 3;
    if (i > 96) r -= 0.04;
    const noise = opts.noise ? Math.sin(i * 7.3) * opts.noise : 0;
    points.push({ at: i / 100, ratio: Math.max(0, r + noise), relative: i <= introPts ? 0.7 : 0.5 });
  }
  return points;
}

describe("caídas de retención", () => {
  test("encuentra el arranque y las dos caídas del cuerpo, en orden y sin el final", () => {
    const drops = detectDrops(curve(), 600);
    assert.equal(drops.length, 3, JSON.stringify(drops));
    const [intro, a, b] = drops;
    assert.equal(intro!.intro, true);
    assert.ok(intro!.lostPct >= 22 && intro!.lostPct <= 32, `arranque ${intro!.lostPct}`);
    assert.equal(intro!.startSec, 6);
    assert.ok(a!.fromAt >= 0.38 && a!.toAt <= 0.46, `primera ${a!.fromAt}-${a!.toAt}`);
    assert.ok(a!.lostPct >= 10 && a!.lostPct <= 14, `pierde ${a!.lostPct}`);
    assert.ok(b!.fromAt >= 0.68 && b!.toAt <= 0.76, `segunda ${b!.fromAt}-${b!.toAt}`);
    assert.ok(drops.every((d) => d.toAt < 0.96), "el final no cuenta");
    assert.ok(a!.startSec! >= 228 && a!.startSec! <= 246);
  });

  test("una curva pareja no tiene caídas en el cuerpo", () => {
    const drops = detectDrops(curve({ cliffs: [], intro: 0.05 }), 600);
    assert.deepEqual(drops, []);
  });

  test("el ruido de un video con pocas vistas no inventa caídas", () => {
    const drops = detectDrops(curve({ cliffs: [[50, 0.1]], intro: 0.05, noise: 0.006 }), 300);
    assert.equal(drops.length, 1, JSON.stringify(drops));
    assert.ok(drops[0]!.fromAt >= 0.47 && drops[0]!.fromAt <= 0.52);
  });

  test("con pocos puntos no dice nada; sin duración no da segundos", () => {
    assert.deepEqual(detectDrops(curve().slice(0, 5), 600), []);
    const drops = detectDrops(curve(), null);
    assert.ok(drops.length >= 2);
    assert.equal(drops[0]!.startSec, null);
  });

  test("un short (repite y pasa de 100 %) usa el primer 10 % como arranque", () => {
    assert.equal(introEnd(30), 0.1);
    assert.equal(introEnd(1200), 0.025);
    const loop = curve({ intro: 0.4, introPts: 10 }).map((p) => ({ ...p, ratio: p.ratio + 0.3 }));
    const drops = detectDrops(loop, 30);
    assert.equal(drops[0]!.intro, true);
  });

  test("marcas y comparación con videos parecidos", () => {
    const marks = retentionMarks(curve(), 600);
    assert.ok(marks.intro! < 75 && marks.intro! > 65);
    const rel = relativeSummary(curve(), 600);
    assert.ok(rel && rel.intro > 0.6);
    assert.equal(relativeLabel(rel!.intro), "por encima del promedio");
    assert.equal(relativeLabel(0.5), "en el promedio");
    assert.equal(relativeSummary(curve().map(({ at, ratio }) => ({ at, ratio })), 600), null);
  });
});

describe("cruce con la transcripción", () => {
  const segments = [
    { start: 225, end: 230, text: "Y ahora te voy a contar" },
    { start: 230, end: 236, text: "cuánto cuesta el programa completo," },
    { start: 236, end: 242, text: "que son 2,000 dólares." },
    { start: 300, end: 305, text: "Otra cosa que no tiene que salir." },
  ];

  test("toma lo que se decía justo antes y durante la caída", () => {
    const q = quoteForDrop(segments, { startSec: 234, endSec: 240 });
    assert.ok(q);
    assert.equal(q.text, "cuánto cuesta el programa completo, que son 2,000 dólares.");
    assert.equal(q.start, 230);
    assert.equal(dropSentence({ lostPct: 18.2, intro: false }, q), "Aquí se fue el 18 %: estabas diciendo «cuánto cuesta el programa completo, que son 2,000 dólares.»");
  });

  test("recorta frases largas quedándose con el final y no inventa si no hay texto", () => {
    const long = [{ start: 0, end: 10, text: "palabra ".repeat(60).trim() }];
    const q = quoteForDrop(long, { startSec: 5, endSec: 8 }, 4, 50)!;
    assert.ok(q.text.startsWith("…") && q.text.length <= 52);
    assert.equal(quoteForDrop(segments, { startSec: 400, endSec: 410 }), null);
    assert.equal(quoteForDrop([], { startSec: 1, endSec: 2 }), null);
    assert.equal(dropSentence({ lostPct: 30, intro: true }, null), "En el arranque se fue el 30 %.");
  });
});

describe("subtítulos", () => {
  test("lee SRT", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,500\nHola, <i>bienvenido</i>\n\n2\n00:00:03,500 --> 00:00:06,000\nHoy te cuento algo\ncon dos líneas\n";
    assert.deepEqual(parseSubtitles(srt), [
      { start: 1, end: 3.5, text: "Hola, bienvenido" },
      { start: 3.5, end: 6, text: "Hoy te cuento algo con dos líneas" },
    ]);
  });

  test("lee VTT automático de YouTube sin repetir el rodillo", () => {
    const vtt = `WEBVTT
Kind: captions
Language: es

00:00:00.320 --> 00:00:02.879 align:start position:0%
hola<00:00:00.640><c> a</c><00:00:00.880><c> todos</c>

00:00:02.879 --> 00:00:02.889 align:start position:0%
hola a todos

00:00:02.889 --> 00:00:05.000 align:start position:0%
hola a todos
hoy<00:00:03.200><c> vamos</c><c> a</c><c> ver</c>

00:01:02.000 --> 00:01:04.000
[Música]
`;
    assert.deepEqual(parseSubtitles(vtt), [
      { start: 0.32, end: 2.88, text: "hola a todos" },
      { start: 2.89, end: 5, text: "hoy vamos a ver" },
    ]);
  });

  test("palabras del Editor a frases con los tiempos del video final", () => {
    const words = ["Hola", "a", "todos.", "Hoy", "vemos", "precios"].map((text, id) => ({ id, text, start: id * 0.5 + (id >= 3 ? 5 : 0), end: id * 0.5 + 0.4 + (id >= 3 ? 5 : 0) }));
    assert.deepEqual(wordsToSegments(words).map((s) => s.text), ["Hola a todos.", "Hoy vemos precios"]);
    const transcript = { version: 1 as const, provider: "x", language: "es", duration: 10, words };
    // Se cortan las palabras 1 y 2: en el video final "Hoy" empieza mucho antes que en el original.
    const plan = { removals: [{ from_word: 1, to_word: 2, reason: "x" }], hook_candidates: [], selected_hook: null, corrections: {}, captions: { emphasis_words: [] } };
    const segs = editorSegments(transcript, plan as never, 10);
    assert.equal(segs.map((s) => s.text).join(" | "), "Hola Hoy vemos precios");
    // En el original "precios" termina a los 7,9 s; en el video final, mucho antes.
    assert.ok(segs[0]!.end < 3, `termina en ${segs[0]!.end}`);
  });

  test("sanea lo que llega de afuera", () => {
    const out = sanitizeSegments([
      { start: 5, end: 4, text: "mal" },
      { start: 2, end: 3, text: "  b " },
      { start: 1, end: 2, text: "a" },
      { start: Number.NaN, end: 2, text: "x" },
    ]);
    assert.deepEqual(out, [
      { start: 1, end: 2, text: "a" },
      { start: 2, end: 3, text: "b" },
    ]);
  });
});

describe("títulos", () => {
  test("cuenta caracteres visibles (tildes y emojis valen uno)", () => {
    assert.equal(visibleLength("Educación"), 9);
    assert.equal(visibleLength("🔥 Ojo"), 5);
    const ok = checkTitle("Cómo conseguir tus primeros 10 clientes sin anuncios");
    assert.equal(ok.fits, true);
    const long = checkTitle("Cómo conseguí mis primeros 10 clientes de agencia de IA sin gastar en anuncios ni tener seguidores");
    assert.equal(long.fits, false);
    assert.equal(long.overBy, long.chars - 60);
    assert.equal(visibleLength(long.preview), 60);
    assert.ok(long.preview.endsWith("…"));
    assert.equal(checkTitle("x".repeat(101)).tooLong, true);
  });

  test("limpia comillas y punto final", () => {
    assert.equal(cleanTitle('  "Deja de  cobrar barato."  '), "Deja de cobrar barato");
    assert.equal(cleanTitle("Esto no lo sabías…"), "Esto no lo sabías…");
  });

  test("agrupa por ángulo, quita repetidos y los demasiado largos", () => {
    let n = 0;
    const groups = normalizeTitleGroups(
      [
        { angle: "curiosidad", options: [{ text: "Lo que nadie te dice de la IA", why: "a" }, { text: "Lo que NADIE te dice de la ia", why: "dup" }] },
        { angle: "resultado", options: [{ text: "x".repeat(120), why: "largo" }, { text: "3 clientes en 30 días", why: "b" }] },
        { angle: "inventado", options: [{ text: "Otro título", why: "c" }] },
        { angle: "curiosidad", options: [{ text: "El error que me costó 2 clientes", why: "d" }] },
      ],
      10,
      () => `t${++n}`,
    );
    assert.deepEqual(groups.map((g) => [g.angle, g.options.map((o) => o.text)]), [
      ["curiosidad", ["Lo que nadie te dice de la IA", "Otro título", "El error que me costó 2 clientes"]],
      ["resultado", ["3 clientes en 30 días"]],
    ]);
    assert.deepEqual(countFitting(groups), { total: 4, fitting: 4, long: [] });
  });
});

describe("plantilla de miniaturas", () => {
  test("texto de 2 a 4 palabras con avisos claros", () => {
    assert.deepEqual(thumbTextIssues("Deja de cobrar barato"), []);
    assert.equal(thumbTextIssues("Hola").length, 1);
    assert.match(thumbTextIssues("una dos tres cuatro cinco")[0]!, /5 palabras/);
    assert.match(thumbTextIssues("  ")[0]!, /Escribe/);
  });

  test("líneas parejas y resaltado sin importar tildes ni mayúsculas", () => {
    assert.deepEqual(splitLines(["DEJA", "DE", "COBRAR", "BARATO"], 2), [["DEJA", "DE"], ["COBRAR", "BARATO"]]);
    assert.deepEqual(splitLines(["DEJA", "DE", "COBRAR", "BARATO"], 3), [["DEJA", "DE"], ["COBRAR"], ["BARATO"]]);
    assert.deepEqual(splitLines(["NO", "SIRVE"], 1), [["NO", "SIRVE"]]);
    assert.deepEqual([...highlightIndexes(["Gané", "más", "cobrando", "MÁS"], "mas cobrando")], [1, 2]);
    assert.equal(highlightIndexes(["a", "b"], "zeta").size, 0);
  });

  test("texto a la izquierda con la foto a la derecha, y al revés", () => {
    const left = thumbnailLayout({ text: "Deja de cobrar barato", highlight: "barato", layout: "texto-izquierda", hasPhoto: true, font: "anton" });
    assert.equal(left.align, "left");
    assert.ok(left.photoBox && left.photoBox.x > left.textBox.x + left.textBox.w - 120);
    assert.ok(left.lines.length >= 2 && left.lines.length <= 3);
    assert.deepEqual(left.lines.flat().map((w) => w.text), ["DEJA", "DE", "COBRAR", "BARATO"]);
    assert.deepEqual(left.lines.flat().map((w) => w.highlight), [false, false, false, true]);
    assert.ok(left.fontSize >= 64 && left.fontSize <= 168);
    // El renglón más largo entra en la caja con el ancho medio de la fuente, y en altura.
    const longest = Math.max(...left.lines.map((l) => l.map((w) => w.text).join(" ").length));
    assert.ok(longest * 0.47 * left.fontSize <= left.textBox.w + 1);
    assert.ok(left.lines.length * left.fontSize * left.lineHeight <= left.textBox.h);
    assert.equal(left.shade, "left");

    const right = thumbnailLayout({ text: "Deja de cobrar barato", highlight: "", layout: "texto-derecha", hasPhoto: true, font: "anton" });
    assert.equal(right.align, "right");
    assert.ok(right.photoBox!.x < 0 + 10);
    assert.ok(right.textBox.x + right.textBox.w <= THUMB_WIDTH - 64);
    assert.equal(right.shade, "right");
  });

  test("sin foto o centrado, el texto usa todo el ancho y crece", () => {
    const withPhoto = thumbnailLayout({ text: "IA gratis", highlight: "", layout: "texto-izquierda", hasPhoto: true, font: "montserrat" });
    const center = thumbnailLayout({ text: "IA gratis", highlight: "", layout: "texto-centro", hasPhoto: true, font: "montserrat" });
    assert.equal(center.photoBox, null);
    assert.equal(center.align, "center");
    assert.equal(center.textBox.w, THUMB_WIDTH - 128);
    assert.ok(center.fontSize >= withPhoto.fontSize);
    const serif = thumbnailLayout({ text: "La verdad", highlight: "", layout: "texto-centro", hasPhoto: false, font: "playfair" });
    assert.equal(serif.uppercase, false);
    assert.deepEqual(serif.lines.flat().map((w) => w.text), ["La", "verdad"]);
  });

  test("fuente y colores de la marca, con respaldo legible", () => {
    assert.equal(thumbFontFromBrand("Montserrat Black"), "montserrat");
    assert.equal(thumbFontFromBrand(null), "anton");
    assert.equal(thumbColors({ primary: "#030a22", accent: "#0b0b0b" }).accent, "#ffd400");
    assert.equal(thumbColors({ primary: "#030a22", accent: "#ffcc00" }).accent, "#ffcc00");
  });

  test("el fondo se pide sin texto ni personas y con aire del lado del texto", () => {
    const p = backgroundPrompt({ scene: "Una oficina de noche", layout: "texto-izquierda", hasPhoto: true, niche: "agencias de IA", colors: { primary: "#030a22" } });
    assert.match(p, /16:9/);
    assert.match(p, /PROHIBIDO: cualquier texto/);
    assert.match(p, /Sin personas/);
    assert.match(p, /mitad izquierda limpia/);
    assert.match(p, /#030a22/);
  });
});
