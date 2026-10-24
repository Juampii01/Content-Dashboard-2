/**
 * Composiciones: contrato, revisión estática, sandbox (código malicioso bloqueado), validación de las muestras y
 * paridad vista previa = render (la lista de dibujo del sandbox del navegador es idéntica a la del de Node).
 *
 *   node --import tsx --test tests/compos.test.mts
 */
import { layerKey, stackIndex } from "../lib/video/layers";
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { checkStatic, moduleScript } from "../lib/video/compos/static";
import { NodeSandbox } from "../lib/video/compos/sandbox-node";
import { validateComposition, sampleTimes, codeHash } from "../lib/video/compos/validate";
import { COMPOS_SAMPLES } from "../lib/video/compos/samples";
import { RUNTIME_SOURCE } from "../lib/video/compos/runtime-source";
import { cleanCompositions, compileComposition, composSegments, needsMask, type Composition } from "../lib/video/compos/schema";
import type { ComposEnvData } from "../lib/video/compos/contract";

const env: ComposEnvData = {
  width: 1080,
  height: 1920,
  duration: 3.2,
  seed: 11,
  words: [
    { text: "Te", t0: 0.1, t1: 0.3, strong: false },
    { text: "cuento", t0: 0.3, t1: 0.7, strong: false },
    { text: "publicar", t0: 0.8, t1: 1.2, strong: true },
    { text: "sin", t0: 1.2, t1: 1.4, strong: false },
    { text: "gancho", t0: 1.4, t1: 1.9, strong: false },
  ],
  params: {},
  brand: { accent: "#0070f8", bg: "#030a22", surface: "#07163f", ink: "#ffffff", muted: "#a7b9d4", accentText: "#ffffff", display: "Montserrat" },
  face: { x: 330, y: 480, w: 380, h: 420 },
  captions: { y: 1150, h: 320, visible: false },
  mask: true,
  assets: [],
};

const ok = (body: string) => `export default { render(ctx, t, env) { ${body} } };`;

test("revisión estática: pasa un módulo normal y rechaza las puertas de escape", () => {
  assert.equal(checkStatic(ok("ctx.fillRect(0, 0, 10, 10);")).ok, true);
  const bad: Record<string, string> = {
    import: `import x from "y"; export default { render() {} };`,
    require: ok("require('fs')"),
    process: ok("process.exit(1)"),
    fetch: ok("fetch('https://x.com')"),
    globalThis: ok("globalThis.a = 1"),
    self: ok("self.postMessage(1)"),
    eval: ok("eval('1')"),
    Function: ok("Function('return 1')()"),
    constructor: ok("ctx.constructor.constructor('return process')()"),
    proto: ok("({}).__proto__"),
    computed: ok("ctx['constructor']"),
    dynamicImport: ok("import('x')"),
    Date: ok("Date.now()"),
    setTimeout: ok("setTimeout(() => 1)"),
    async: `export default { async render() {} };`,
    noExport: `function render() {}`,
    topLevel: `ctx.fillRect(0,0,1,1); export default { render() {} };`,
    unknownGlobal: ok("navigatorX.y = 1"),
    tooLong: ok("/*" + "x".repeat(30_000) + "*/"),
  };
  for (const [name, code] of Object.entries(bad)) assert.equal(checkStatic(code).ok, false, `debería rechazar: ${name}`);
});

test("sandbox: bucle infinito, memoria, demasiadas operaciones y escapes no rompen el proceso", async () => {
  const cases: Record<string, [string, string]> = {
    loop: [ok("while (true) {}"), "timeout"],
    memory: [ok("const a = []; for (;;) a.push(new Array(1e6).fill(1));"), "memory"],
    ops: [ok("for (let i = 0; i < 100000; i++) ctx.fillRect(0, 0, 1, 1);"), "limit"],
    escapeCtor: [ok('const k = "constr" + "uctor"; ctx[k][k]("return process")().exit(1);'), "error"],
    escapeArrow: [ok('const F = (() => 0)["constr" + "uctor"]; F("return this")().x = 1;'), "error"],
    throws: [ok("if (t > 0.5) { const o = null; o.x = 1; }"), "error"],
    badColor: [ok('ctx.fillStyle = "url(https://x)"; ctx.fillRect(0,0,1,1);'), "error"],
  };
  for (const [name, [code, kind]] of Object.entries(cases)) {
    const opened = await NodeSandbox.open(code, env);
    assert.ok(opened.ok, `${name} debería abrir`);
    if (!opened.ok) continue;
    const r = await opened.sandbox.frame(1);
    assert.equal(r.ok, false, `${name} debería fallar`);
    if (!r.ok) assert.equal(r.kind, kind, `${name}: ${r.error}`);
    await opened.sandbox.close();
  }
  // El proceso sigue vivo y el sandbox siguiente funciona.
  const again = await NodeSandbox.open(ok("ctx.fillRect(0, 0, 10, 10);"), env);
  assert.ok(again.ok);
  if (again.ok) {
    const r = await again.sandbox.frame(0.5);
    assert.ok(r.ok);
    await again.sandbox.close();
  }
});

test("sandbox: el global del contexto no tiene nada del host (process, require, Buffer, fetch)", async () => {
  // Desde dentro, la única forma de ver el global es por un escape (bloqueado); se prueba que aunque se llegue a él
  // por Math (objeto del contexto), sus vecinos no son los del host.
  const probe = ok(`
    const found = ["process", "require", "Buffer", "fetch", "setTimeout"].filter((n) => Object.getOwnPropertyNames(Object.getPrototypeOf(Math)).includes(n));
    ctx.fillStyle = found.length === 0 ? "#00ff00" : "#ff0000";
    ctx.fillRect(0, 0, 1, 1);
  `);
  const opened = await NodeSandbox.open(probe, env);
  assert.ok(opened.ok, opened.ok ? "" : opened.error);
  if (!opened.ok) return;
  const r = await opened.sandbox.frame(0);
  assert.ok(r.ok);
  if (r.ok) assert.ok(JSON.stringify(r.frame.o).includes("#00ff00"));
  await opened.sandbox.close();
});

test("las 9 muestras pasan la validación (rápidas, deterministas y dibujan algo)", async () => {
  assert.ok(COMPOS_SAMPLES.length >= 9);
  for (const s of COMPOS_SAMPLES) {
    const check = await validateComposition(s.code, { ...env, params: Object.fromEntries(s.params.map((p) => [p.key, p.value])) });
    assert.ok(check.ok, `${s.key}: ${check.ok ? "" : check.error}`);
    if (check.ok) {
      assert.ok(check.stats.avgMs < 45, `${s.key} lenta: ${check.stats.avgMs} ms`);
      for (const p of s.params) assert.ok(p.key in check.defaults, `${s.key}: el parámetro ${p.key} tiene que estar en params del módulo`);
    }
  }
});

test("validación: rechaza lo no determinista y lo que no dibuja", async () => {
  const nondet = `let n = 0; export default { render(ctx, t) { n++; ctx.fillRect(0, 0, n, 1); } };`;
  const r1 = await validateComposition(nondet, env);
  assert.equal(r1.ok, false);
  assert.match(r1.ok ? "" : r1.error, /determinista/);
  const empty = await validateComposition(ok(""), env);
  assert.equal(empty.ok, false);
});

test("paridad: el sandbox del navegador (Function en su propio global) da la misma lista que el de Node", async () => {
  for (const s of COMPOS_SAMPLES) {
    const data = { ...env, params: Object.fromEntries(s.params.map((p) => [p.key, p.value])) };
    // "Navegador": runtime y módulo evaluados con Function en un global propio (como en /compos-sandbox.js).
    const ctx = vm.createContext({});
    vm.runInContext(`Function(${JSON.stringify(RUNTIME_SOURCE)})()`, ctx);
    vm.runInContext(`__compos.setup(${JSON.stringify(JSON.stringify(data))})`, ctx);
    const st = checkStatic(s.code);
    assert.ok(st.ok);
    if (!st.ok) continue;
    vm.runInContext(`Function(${JSON.stringify(moduleScript(st.body))})()`, ctx);
    const opened = await NodeSandbox.open(s.code, data);
    assert.ok(opened.ok);
    if (!opened.ok) continue;
    for (const t of sampleTimes(data.duration, 6)) {
      const browser = vm.runInContext(`__compos.frame(${t})`, ctx) as string;
      const node = await opened.sandbox.frame(t);
      assert.ok(node.ok);
      if (node.ok) assert.equal(JSON.stringify(JSON.parse(browser).frame), JSON.stringify(node.frame), `${s.key} en ${t}`);
    }
    await opened.sandbox.close();
  }
});

test("plan: tramos, recorte, limpieza y spec de una composición", () => {
  const words = [0, 1, 2, 3, 4, 5].map((i) => ({ id: i, text: `p${i}`, start: i * 0.5, end: i * 0.5 + 0.4, emphasis: false, stop: false }));
  const tl = { words, duration: 3.2 };
  const sample = COMPOS_SAMPLES.find((s) => s.key === "text_behind")!;
  const item: Composition = { id: "c1", from_word: 1, to_word: 4, name: sample.name, code: sample.code, params: sample.params, source: "director" };
  const [seg] = composSegments(tl, [item]);
  assert.ok(seg && seg.start >= 0.4 && seg.end <= 3.2);
  assert.equal(needsMask(sample.code), true);
  const spec = compileComposition({ item, start: seg!.start, end: seg!.end, timeline: tl, format: "9:16", brand: { accent: "#ff0000", bg: "#000000", surface: "#111111", text: "#ffffff", muted: "#999999", accentText: "#ffffff", font: "inter" }, face: env.face, captionsVisible: true });
  assert.equal(spec.kind, "composition");
  assert.equal(spec.mask, true);
  assert.equal(spec.compos!.env.params.word, "ENFOQUE");
  // Se pisan: conviven en capas (la capa se conserva). Fuera de la transcripción: se descarta.
  const clean = cleanCompositions([item, { ...item, id: "c2", from_word: 3, to_word: 5, layer: 2 }, { ...item, id: "c3", from_word: 9, to_word: 12 }], 6);
  assert.deepEqual(clean.map((c) => c.id), ["c1", "c2"]);
  assert.equal(clean[1]!.layer, 2);
  const both = composSegments(tl, clean);
  assert.equal(both.length, 2);
  assert.ok(both[1]!.start < both[0]!.end, "los tramos se superponen, sin recortarse");
  assert.equal(both[1]!.layer, 2);
  // El orden de dibujo: con la misma capa, la composición va sobre el efecto y bajo la transición.
  const order = stackIndex([
    { key: layerKey("transition", "t"), kind: "transition", start: 1 },
    { key: layerKey("compos", "c"), kind: "compos", start: 1 },
    { key: layerKey("fx", "f"), kind: "fx", start: 1 },
    { key: layerKey("broll", "b"), kind: "broll", start: 1, layer: 1 },
  ]);
  assert.deepEqual([...order.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k), ["f:f", "c:c", "t:t", "b:b"]);
  assert.equal(codeHash("a"), codeHash("a"));
  assert.notEqual(codeHash("a"), codeHash("b"));
});

test("variedad: la apertura rota entre videos y deja al final lo que la marca usó hace poco", async () => {
  const { openerOrder, OPENERS } = await import("../lib/video/fx/openers");
  const a = openerOrder([{ text: "Hoy" }, { text: "te" }, { text: "cuento" }]);
  const b = openerOrder([{ text: "Tres" }, { text: "errores" }, { text: "que" }]);
  assert.equal(a.length, OPENERS.length);
  assert.notDeepEqual(a, b, "dos videos distintos no abren en el mismo orden");
  const recent = openerOrder([{ text: "Hoy" }], ["cover_story", "glass_type"]);
  assert.equal(recent.at(-1), "cover_story");
  assert.equal(recent.at(-2), "glass_type");
});
