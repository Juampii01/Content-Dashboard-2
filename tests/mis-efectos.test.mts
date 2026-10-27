/**
 * Mis efectos: huella sin duplicados, categorías, textos que se adaptan al tramo, candidatos con rotación, reuso
 * simulado y, si hay una base de prueba, el guardado (sin duplicados, versiones, quitar), el guardado al renderizar y
 * la seguridad al usar un efecto (el código se vuelve a validar en el sandbox).
 *   pnpm test:mis-efectos                      (sin base: solo lo que no la necesita)
 *   TEST_DATABASE_URL=postgres://... pnpm test:mis-efectos
 * El bloque con base crea y borra sus propias filas (proyectos con título "mis-efectos-test").
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { normalizedHash } from "../lib/video/compos/library-hash";
import { candidatesText, categoryOf, describeEffect, fillParams, rankCandidates, type LibraryCandidate } from "../lib/video/compos/library";
import { fakePlan } from "../lib/video/compos/fake";
import { COMPOS_SAMPLES } from "../lib/video/compos/samples";
import { composPlanWireSchema } from "../lib/ai/prompts/compos";

const sample = (key: string) => COMPOS_SAMPLES.find((s) => s.key === key)!;

describe("huella", () => {
  test("igual con otros espacios, saltos de línea y comentarios; distinta si cambia el código", () => {
    const code = sample("counter_up").code;
    const spaced = `// comentario arriba\n/* otro\n comentario */\n\n   ${code.trim()}   \n\n// fin\n`;
    assert.equal(normalizedHash(code), normalizedHash(spaced));
    assert.notEqual(normalizedHash(code), normalizedHash(code.replace(/0\.5/, "0.55")));
    assert.match(normalizedHash(code), /^n[0-9a-z]+$/);
  });
  test("las 9 muestras dan huellas distintas", () => {
    assert.equal(new Set(COMPOS_SAMPLES.map((s) => normalizedHash(s.code))).size, COMPOS_SAMPLES.length);
  });
});

describe("categorías y descripción", () => {
  test("por familias, nombre e imágenes", () => {
    assert.equal(categoryOf({ name: "Cifra que gira", tags: [], code: "", images: [] }), "cifras");
    assert.equal(categoryOf({ name: "X", tags: ["tarjeta-3d"], code: "", images: [] }), "tarjetas");
    assert.equal(categoryOf({ name: "Mapa con foco", tags: [], code: "", images: [{ id: "g1", key: "k", width: 10, height: 10, prompt: "" } as never] }), "imagen");
    assert.equal(categoryOf({ name: "Palabra con glitch", tags: [], code: "", images: [] }), "texto");
    assert.equal(categoryOf({ name: "Algo", tags: [], code: "", images: [] }), "otros");
  });
  test("la descripción junta el pedido, el porqué y el momento", () => {
    assert.equal(describeEffect({ name: "A", why: "Marca la cifra.", request: "la cifra en 3D", moment: "m2" }), "Pedido: la cifra en 3D · Marca la cifra. · Momento: m2");
    assert.equal(describeEffect({ name: "Solo nombre" }), "Solo nombre");
  });
});

describe("textos que se adaptan al tramo", () => {
  const spoken = [
    { text: "Crecimos", emphasis: false },
    { text: "un" },
    { text: "45%", emphasis: true },
    { text: "en" },
    { text: "ventas," },
    { text: "sin" },
    { text: "anuncios." },
  ];
  test("cifra donde había cifra, palabra marcada y frase con las mayúsculas del original", () => {
    const out = fillParams(
      [
        { key: "value", label: "Cifra", value: "+327%" },
        { key: "word", label: "Palabra", value: "IMPARABLE" },
        { key: "line", label: "Frase", value: "Nadie te enseña esto" },
      ],
      spoken,
    );
    assert.equal(out[0]!.value, "45%");
    assert.equal(out[1]!.value, "45%".toUpperCase());
    assert.equal(out[2]!.value, "Crecimos un 45% en ventas", "sin la palabra suelta del final");
  });
  test("sin cifra dicha, la cifra queda como estaba; las listas no se tocan", () => {
    const out = fillParams(
      [
        { key: "value", label: "Cifra", value: "+327%" },
        { key: "item1", label: "Punto 1", value: "Ganchos" },
      ],
      [{ text: "Esto" }, { text: "funciona" }],
    );
    assert.equal(out[0]!.value, "+327%");
    assert.equal(out[1]!.value, "Ganchos");
  });
  test("sin palabras, todo queda igual", () => {
    const params = [{ key: "word", label: "Palabra", value: "HOLA" }];
    assert.deepEqual(fillParams(params, []), params);
  });
});

describe("candidatos para reusar", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const base: LibraryCandidate = { id: "a", name: "Cifra que gira en 3D", description: "La cifra que dice en una tarjeta 3D", category: "cifras", tags: ["tarjeta-3d"], duration: 3, params: [], usedCount: 0, lastUsedAt: null, favorite: false };
  const list: LibraryCandidate[] = [
    base,
    { ...base, id: "b", name: "Palabra gigante detrás", description: "La palabra clave detrás de la persona", category: "texto", tags: ["texto-detras"] },
    { ...base, id: "c", name: "Cifra con contador", description: "Un contador que sube hasta la cifra", tags: ["contador"], lastUsedAt: new Date(now - 3_600_000).toISOString() },
  ];
  test("encaja por palabras del pedido; lo usado hace poco va al final y lo que ya está en el video no se ofrece", () => {
    const ranked = rankCandidates(list, { brief: "La cifra en una tarjeta que gira", said: "crecimos 45 por ciento", exclude: [], now });
    assert.equal(ranked[0]!.id, "a");
    assert.equal(ranked.at(-1)!.id, "c");
    const without = rankCandidates(list, { brief: "La cifra en una tarjeta que gira", said: "", exclude: ["a"], now });
    assert.ok(!without.some((e) => e.id === "a"));
  });
  test("el texto para el prompt lleva id, nombre y textos editables", () => {
    const text = candidatesText([{ ...base, params: [{ key: "value", label: "Cifra", value: "+327%" }] }]);
    assert.match(text, /id "a"/);
    assert.match(text, /value="\+327%"/);
  });
  test("el plan simulado reusa cuando el pedido coincide y la salida pasa el esquema", () => {
    const lib = [{ id: "a", name: "Cifra que gira en 3D", description: "tarjeta", params: [{ key: "value", value: "+10%" }] }];
    const hit = composPlanWireSchema.parse(fakePlan("Quiero la cifra que gira con fuerza", lib));
    assert.equal(hit.reuse, "a");
    assert.deepEqual(hit.reuse_params, [{ key: "value", value: "+10%" }]);
    const miss = composPlanWireSchema.parse(fakePlan("Un mapa del mundo", lib));
    assert.equal(miss.reuse, "");
    assert.equal(miss.images.length, 1);
  });
});

// ─── Contra la base (opcional) ─────────────────────────────────────────────

const url = process.env.TEST_DATABASE_URL;
describe("Mis efectos contra la base", { skip: !url && "TEST_DATABASE_URL no está definida" }, async () => {
  if (!url) return;
  Object.assign(process.env, {
    DATABASE_URL: url,
    DATABASE_URL_UNPOOLED: url,
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(40),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CRON_SECRET: "y".repeat(40),
    APP_TIMEZONE: "America/Mexico_City",
  });
  const { getDb, schema } = await import("../lib/db");
  const { eq, inArray, sql } = await import("drizzle-orm");
  const lib = await import("../lib/video/compos/library-service");
  const { codeHash } = await import("../lib/video/compos/validate-hash");
  const db = getDb();
  const words = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: i, text: ["Crecimos", "un", "45%", "en", "ventas", "sin", "pagar", "anuncios"][i]!, start: i * 0.45, end: i * 0.45 + 0.4, emphasis: i === 2, stop: false }));
  const timeline = { words: words.map((w) => ({ ...w })), duration: 3.8, clips: [] } as never;
  const projects: string[] = [];
  const project = async () => {
    const [p] = await db.insert(schema.videoProjects).values({ title: "mis-efectos-test" } as typeof schema.videoProjects.$inferInsert).returning({ id: schema.videoProjects.id });
    projects.push(p!.id);
    return { id: p!.id, title: "mis-efectos-test", director: null };
  };
  // Cada corrida usa un código propio (una constante con un número único): así nunca coincide con efectos reales de
  // la base y la limpieza solo borra lo que creó esta prueba.
  const nonce = Date.now();
  const comp = (key: string, over: Record<string, unknown> = {}) => {
    const s = sample(key);
    const code = `const pruebaMisEfectos = ${nonce};\n${s.code}`;
    return { id: `c${key.slice(0, 6)}`, from_word: 1, to_word: 5, name: s.name, code, params: s.params, source: "director" as const, checked: codeHash(code), tags: ["prueba"], ...over };
  };
  const ctx = (projectId: string) => ({
    projectId,
    timeline,
    format: "9:16" as const,
    brand: { accent: "#0070f8", bg: "#030a22", surface: "#07163f", text: "#ffffff", muted: "#a7b9d4", accentText: "#ffffff", font: "inter" } as never,
    captionsVisible: true,
    face: () => ({ x: 330, y: 480, w: 380, h: 420 }),
    spoken: (from: number, to: number) => words.filter((w) => w.id >= from && w.id <= to).map((w) => ({ text: w.text, emphasis: w.emphasis })),
  });

  after(async () => {
    const rows = await db.select({ id: schema.createdEffects.id }).from(schema.createdEffects).where(inArray(schema.createdEffects.sourceProjectId, projects.length ? projects : ["00000000-0000-0000-0000-000000000000"]));
    const ids = rows.map((r) => r.id);
    if (ids.length) await db.delete(schema.createdEffects).where(inArray(schema.createdEffects.id, ids));
    if (projects.length) await db.delete(schema.videoProjects).where(inArray(schema.videoProjects.id, projects));
  });

  test("sin duplicados por la huella normalizada; un cambio de la misma animación es versión nueva", async () => {
    const p = await project();
    const a = comp("counter_up");
    const first = await lib.saveComposition(p, a, 3, "auto");
    assert.equal(first.status, "created");
    // Mismo código con otros espacios: el mismo efecto.
    const again = await lib.saveComposition(p, { ...a, code: `${a.code}\n// otra vez\n` }, 3, "auto");
    assert.equal(again.status, "exists");
    assert.equal(again.id, first.id);
    // La misma animación del mismo video con otro código: versión 2 de la misma familia.
    const v2 = await lib.saveComposition(p, { ...a, code: a.code.replace("0.5", "0.55") }, 3, "auto");
    assert.equal(v2.status, "version");
    assert.equal(v2.version, 2);
    const row = await lib.loadEffect(v2.id);
    assert.equal(row!.rootId, first.id);
    assert.equal(row!.name, (await lib.loadEffect(first.id))!.name);
  });

  test("lo que se quita no vuelve solo al renderizar; guardarlo a mano lo recupera", async () => {
    const p = await project();
    const a = comp("underline_draw");
    const saved = await lib.saveComposition(p, a, 3, "auto");
    assert.ok(await lib.removeEffect(saved.id));
    assert.equal((await lib.saveComposition(p, a, 3, "auto")).status, "skipped");
    assert.ok(!(await lib.listMyEffects()).some((e) => e.id === saved.id));
    assert.equal((await lib.saveComposition(p, a, 3, "manual")).status, "restored");
    assert.ok((await lib.listMyEffects()).some((e) => e.id === saved.id));
  });

  test("al renderizar: guarda las validadas, marca lib_id, cuenta un uso por video y pide la muestra", async () => {
    const p = await project();
    const ok = comp("letter_glitch", { id: "cok" });
    const unchecked = comp("list_reveal", { id: "cno", checked: undefined });
    const plan = { compositions: [ok, unchecked] } as never;
    const r1 = await lib.saveFromRender(p, plan, timeline);
    const marked = (r1.plan.compositions ?? []) as { id: string; lib_id?: string }[];
    const libId = marked.find((c) => c.id === "cok")!.lib_id!;
    assert.ok(libId);
    assert.equal(marked.find((c) => c.id === "cno")!.lib_id, undefined, "sin validar no se guarda");
    assert.deepEqual(r1.samples, [{ effectId: libId, compId: "cok" }]);
    await lib.saveFromRender(p, plan, timeline);
    assert.equal((await lib.loadEffect(libId))!.usedCount, 1, "otro render del mismo video no cuenta otra vez");
    const other = await project();
    await lib.saveFromRender(other, plan, timeline);
    const row = (await lib.loadEffect(libId))!;
    assert.equal(row.usedCount, 2);
    assert.ok(row.lastUsedAt);
    // Con muestra, ya no se pide.
    await lib.setSample(libId, { posterKey: `editor/efectos/${libId}/poster.jpg`, sampleKey: `editor/efectos/${libId}/muestra.webm` });
    assert.deepEqual((await lib.saveFromRender(other, plan, timeline)).samples, []);
  });

  test("usar un efecto en otro video: textos adaptados y código validado otra vez (lo alterado no pasa)", async () => {
    const p = await project();
    const saved = await lib.saveComposition(p, comp("card3d_stat"), 3, "manual");
    const other = await project();
    const row = (await lib.loadEffect(saved.id))!;
    const params = await lib.adaptParams(ctx(other.id), row, 1, 6, false);
    assert.equal(params.find((x) => x.key === "value")!.value, "45%");
    const built = await lib.buildFromEffect(ctx(other.id), row, { from: 1, to: 6, params, source: "user" });
    assert.equal(built.lib_id, saved.id);
    assert.equal(built.checked, codeHash(row.code));
    assert.equal(built.source, "user");
    // Alguien cambió el código en la base: se vuelve a validar y no pasa.
    await db.update(schema.createdEffects).set({ code: "export default { render(ctx){ globalThis.fetch('x') } }" }).where(eq(schema.createdEffects.id, saved.id));
    const bad = (await lib.loadEffect(saved.id))!;
    await assert.rejects(() => lib.buildFromEffect(ctx(other.id), bad, { from: 1, to: 6, params, source: "user" }), /no funciona en este tramo/);
  });

  test("candidatos: sin los quitados, con rotación y solo los que entran en el tramo", async () => {
    const p = await project();
    const s = await lib.saveComposition(p, comp("zoom_motion_blur"), 2.5, "manual");
    const near = await lib.effectCandidates({ brief: "zoom con desenfoque de movimiento", said: "", exclude: [], duration: 2.5, limit: 50 });
    assert.ok(near.some((e) => e.id === s.id));
    assert.ok(!(await lib.effectCandidates({ brief: "zoom", said: "", exclude: [s.id], duration: 2.5, limit: 50 })).some((e) => e.id === s.id));
    assert.ok(!(await lib.effectCandidates({ brief: "zoom", said: "", exclude: [], duration: 9, limit: 50 })).some((e) => e.id === s.id), "9 s es demasiado largo para un efecto de 2,5 s");
    await db.execute(sql`select 1`);
  });
});
