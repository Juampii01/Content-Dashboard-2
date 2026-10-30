/**
 * Edición solo con IA: las acciones nuevas del chat del video (transición, sonido, música, zoom, cortar, voz, quitar,
 * deshacer y subtítulos con estilo) se validan bien y ubican el momento por lo que dice la persona.
 *   pnpm test:chat-acciones
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { chatItems, findWords, normWord } = await import("../lib/video/chat-library");
const { NO_EXTRA } = await import("../lib/ai/prompts/chat-video");

const words = "Hola a todos bueno eh hoy les cuento el precio de mi curso, en fin listo vamos".split(" ");
const ids = new Set(words.map((_, i) => i));
const max = words.length - 1;
const library = { text: "", codes: new Map() } as unknown as import("../lib/video/broll").LibraryPrompt;
const base = { scope: "momento" as const, title: "t", prompt: "p", attachments: [], layout: null, library: null, clip_start: null, text_style: null, look: null, ...NO_EXTRA };
const one = (it: Record<string, unknown> & { kind: string; from_word: number; to_word: number }) => chatItems([{ ...base, ...it } as never], [], max, ids, library, words);

describe("palabras: «cuando digo X»", () => {
  test("sin tildes ni signos, y secuencias de varias palabras", () => {
    assert.equal(normWord("¡Precio,"), "precio");
    assert.deepEqual(findWords(words, "precio", 6, 12), { first: 9, last: 9 });
    assert.deepEqual(findWords(words, "bueno, eh", 0, 8), { first: 3, last: 4 });
    assert.equal(findWords(words, "zapato", 0, max), null);
  });
});

describe("acciones nuevas", () => {
  test("sonido en la palabra que dice la persona, con volumen acotado", () => {
    const [it] = one({ kind: "sonido", from_word: 6, to_word: 14, sound: "whoosh", hit_text: "precio", level: -50 });
    assert.equal(it!.from_word, 9);
    assert.equal(it!.level, -30);
  });
  test("sonido sin el sonido: se descarta", () => {
    assert.equal(one({ kind: "sonido", from_word: 6, to_word: 14 }).length, 0);
  });
  test("transición con el segundo que dio la persona", () => {
    const [it] = one({ kind: "transicion", from_word: 0, to_word: 3, transition: "tr_whip", at_second: 12.5 });
    assert.equal(it!.at_second, 12.5);
  });
  test("transición sin palabra ni segundo: al principio de la frase", () => {
    const [it] = one({ kind: "transicion", from_word: 6, to_word: 9, transition: "tr_whip" });
    assert.deepEqual([it!.from_word, it!.to_word, it!.at_second], [6, 6, null]);
  });
  test("cortar desde una palabra hasta otra; si no encuentra lo que dijo, no corta nada", () => {
    const [it] = one({ kind: "cortar", from_word: 0, to_word: max, hit_text: "en fin", end_text: "listo" });
    assert.deepEqual([it!.from_word, it!.to_word], [13, 15]);
    const [solo] = one({ kind: "cortar", from_word: 0, to_word: 8, hit_text: "bueno eh" });
    assert.deepEqual([solo!.from_word, solo!.to_word], [3, 4]);
    assert.equal(one({ kind: "cortar", from_word: 0, to_word: 8, hit_text: "zapato" }).length, 0);
    assert.equal(one({ kind: "cortar", from_word: 0, to_word: max, hit_text: "en fin", end_text: "zapato" }).length, 0);
  });
  test("música y voz van a todo el video, con volumen acotado", () => {
    const [m] = one({ kind: "musica", from_word: 3, to_word: 5, music: "lofi", level: -2 });
    assert.deepEqual([m!.scope, m!.from_word, m!.level], ["todo", -1, -6]);
    assert.equal(one({ kind: "musica", from_word: -1, to_word: -1 }).length, 0, "sin estilo ni volumen no hay acción");
    const [v] = one({ kind: "voz", from_word: -1, to_word: -1, level: 20 });
    assert.equal(v!.level, 6);
  });
  test("quitar en un tramo o en todo; deshacer siempre en todo", () => {
    const [q] = one({ kind: "quitar", from_word: 6, to_word: 9, remove: "animaciones" });
    assert.deepEqual([q!.from_word, q!.to_word], [6, 9]);
    const [t] = one({ kind: "quitar", scope: "todo", from_word: 3, to_word: 4, remove: "sonidos" } as never);
    assert.equal(t!.from_word, -1);
    assert.equal(one({ kind: "quitar", from_word: 6, to_word: 9 }).length, 0);
    const [d] = one({ kind: "deshacer", from_word: 3, to_word: 4 });
    assert.equal(d!.scope, "todo");
  });
  test("zoom en un tramo que existe; el final se acota al video", () => {
    assert.equal(one({ kind: "zoom", from_word: 9, to_word: 10 }).length, 1);
    assert.equal(one({ kind: "zoom", from_word: 15, to_word: 410 })[0]!.to_word, max);
    assert.equal(one({ kind: "zoom", from_word: 0, to_word: 16 })[0]!.to_word, 7, "como mucho 8 palabras");
  });
  test("subtítulos con estilo y tamaño", () => {
    const [s] = one({ kind: "subtitulos", from_word: -1, to_word: -1, caption_style: "hormozi", caption_size: "grande" });
    assert.deepEqual([s!.caption_style, s!.caption_size, s!.scope], ["hormozi", "grande", "todo"]);
  });
  test("corregir una palabra en todo el video", () => {
    const [c] = one({ kind: "corregir", from_word: -1, to_word: -1, hit_text: "precio", prompt: " PRECIO " });
    assert.deepEqual([c!.wordIds, c!.prompt, c!.scope], [[9], "PRECIO", "todo"]);
    assert.equal(one({ kind: "corregir", from_word: -1, to_word: -1, hit_text: "zapato", prompt: "x" }).length, 0);
  });
});
