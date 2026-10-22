/**
 * Prueba del estratega: validación de las herramientas, referencias citables, preguntas sugeridas,
 * historial para el modelo y el flujo simulado. Sin base de datos, salvo el último bloque, que corre las
 * herramientas de verdad si hay una base de prueba:
 *   TEST_DATABASE_URL=postgres://... pnpm test:estratega
 * Ese bloque inserta y borra sus propias piezas (marcadas con external_id "est-test-…").
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { conversationTitle, suggestedQuestions } from "../lib/ai/prompts/estratega";
import { classifyQuestion, composeFakeAnswer, detectNetwork, fakeIdeaCalls, planFakeTools } from "../lib/strategist/fake";
import { extractCitations, parseToolCall, RefRegistry, stripUnknownRefs, toIdea, toolDefinitions, TOOL_NAMES, toolStatus } from "../lib/strategist/tools";

describe("herramientas", () => {
  test("todas tienen descripción y esquema de objeto sin $schema", () => {
    const defs = toolDefinitions();
    assert.equal(defs.length, TOOL_NAMES.length);
    for (const d of defs) {
      assert.ok(d.description.length > 30, d.name);
      assert.equal(d.input_schema.type, "object");
      assert.equal("$schema" in d.input_schema, false);
    }
    const search = defs.find((d) => d.name === "buscar_piezas")!;
    assert.deepEqual((search.input_schema.properties as Record<string, { enum?: string[] }>).red!.enum, ["instagram", "youtube", "tiktok"]);
  });

  test("valida la entrada y aplica valores por defecto", () => {
    const ok = parseToolCall("buscar_piezas", { red: "tiktok" });
    assert.ok(ok.ok);
    assert.deepEqual(ok.ok && ok.input, { red: "tiktok", orden: "puntaje", direccion: "desc", limite: 8 });
    const cal = parseToolCall("calendario", {});
    assert.ok(cal.ok && (cal.input as { dias: number }).dias === 7);
  });

  test("rechaza lo que no es una herramienta, filtros abiertos y límites fuera de rango", () => {
    assert.match((parseToolCall("sql", { q: "select 1" }) as { error: string }).error, /No existe/);
    assert.equal(parseToolCall("buscar_piezas", { red: "facebook" }).ok, false);
    assert.equal(parseToolCall("buscar_piezas", { limite: 500 }).ok, false);
    assert.equal(parseToolCall("buscar_piezas", { orden: "views; drop table" }).ok, false);
    assert.equal(parseToolCall("resumen_periodo", { desde: "2026-02-31", hasta: "2026-03-10" }).ok, false);
    assert.equal(parseToolCall("calendario", { dias: 90 }).ok, false);
    assert.equal(parseToolCall("informe_mensual", { mes: "2026-13" }).ok, false);
    assert.equal(parseToolCall("proponer_idea", { titulo: "x", idea: "corta", formato: "REEL", redes: [] }).ok, false);
  });

  test("textos de estado en español", () => {
    assert.equal(toolStatus("buscar_piezas", { red: "youtube" }), "Revisando tus piezas de YouTube…");
    assert.equal(toolStatus("calendario", {}), "Revisando tu calendario…");
  });

  test("una propuesta se convierte en idea con redes sin repetir", () => {
    const parsed = parseToolCall("proponer_idea", { titulo: "El error de la llamada", idea: "Cuenta el error más común con un caso real.", formato: "REEL", redes: ["INSTAGRAM", "INSTAGRAM", "TIKTOK"], fecha: "2026-10-24" });
    assert.ok(parsed.ok);
    const idea = toIdea(parsed.input as never, "id-1");
    assert.deepEqual(idea.platforms, ["INSTAGRAM", "TIKTOK"]);
    assert.equal(idea.hook, null);
    assert.equal(idea.date, "2026-10-24");
  });
});

describe("referencias", () => {
  test("numera, no repite la misma pieza y sigue la numeración de la conversación", () => {
    const r = new RefRegistry([{ ref: "P2", kind: "pieza", label: "Vieja", detail: null, href: "/metricas/a", targetId: "11111111-1111-1111-1111-111111111111", platform: "TIKTOK" }]);
    const a = r.piece({ id: "22222222-2222-2222-2222-222222222222", label: "Nueva", detail: "TikTok", platform: "TIKTOK" });
    assert.equal(a, "P3");
    assert.equal(r.piece({ id: "11111111-1111-1111-1111-111111111111", label: "Vieja", detail: null, platform: "TIKTOK" }), "P2");
    assert.equal(r.figure({ label: "Total", detail: null, href: "/metricas" }), "C1");
    assert.equal(r.entry({ id: "e1", label: "Reel", detail: null, href: "/calendario?fecha=2026-10-23" }), "E1");
    assert.equal(r.pieceId("[P3]"), "22222222-2222-2222-2222-222222222222");
    assert.equal(r.pieceId("C1"), null);
    assert.equal(r.get("p3")?.href, "/metricas/22222222-2222-2222-2222-222222222222");
  });

  test("las citas salen en orden, sin repetir, y las inventadas se quitan", () => {
    const r = new RefRegistry();
    r.piece({ id: "a", label: "A", detail: null, platform: "INSTAGRAM" });
    r.figure({ label: "Total", detail: null, href: "/metricas" });
    const text = "Subiste [C1]. La mejor fue [P1] y otra vez [P1]. Esta no existe [P9].";
    assert.deepEqual(
      extractCitations(text, r).map((c) => c.ref),
      ["C1", "P1"],
    );
    assert.equal(stripUnknownRefs(text, r), "Subiste [C1]. La mejor fue [P1] y otra vez [P1]. Esta no existe.");
  });
});

describe("prompts", () => {
  test("preguntas sugeridas con sus datos", () => {
    const s = suggestedQuestions({ platforms: ["INSTAGRAM", "YOUTUBE"], dropping: "YOUTUBE", hookPlatform: "INSTAGRAM", hasGoal: true, hasReport: false });
    assert.deepEqual(s, ["¿Qué publico esta semana?", "¿Por qué bajó YouTube este mes?", "¿Qué gancho me funciona mejor en Instagram?", "¿Voy a llegar a mi meta de seguidores?"]);
    const none = suggestedQuestions({ platforms: [], dropping: null, hookPlatform: null, hasGoal: false, hasReport: false });
    assert.equal(none.length, 3);
    assert.ok(suggestedQuestions({ platforms: ["TIKTOK"], dropping: null, hookPlatform: null, hasGoal: false, hasReport: true }).includes("Resúmeme el último informe mensual."));
  });

  test("título de la conversación corto", () => {
    assert.equal(conversationTitle("  ¿Qué   publico\nesta semana? "), "¿Qué publico esta semana?");
    const long = conversationTitle("¿".padEnd(120, "palabra "));
    assert.ok(long.length <= 70 && long.endsWith("…"));
  });
});

describe("historial para el modelo", async () => {
  // engine.ts importa server-only: se prueba con la condición react-server (pnpm test:estratega la pone).
  const { historyToMessages } = await import("../lib/strategist/engine");
  test("une mensajes seguidos, agrega la leyenda de citas y descarta la pregunta sin respuesta", () => {
    const msgs = historyToMessages([
      { role: "assistant", content: "Hola", citations: [] },
      { role: "user", content: "¿Qué publico?", citations: [] },
      { role: "assistant", content: "Publica [P1].", citations: [{ ref: "P1", kind: "pieza", label: "El error", detail: "TikTok", href: "/metricas/x", targetId: "x", platform: "TIKTOK" }] },
      { role: "user", content: "¿Y en YouTube?", citations: [] },
      { role: "user", content: "¿Y en TikTok?", citations: [] },
    ]);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0]!.role, "user");
    assert.match(String(msgs[1]!.content), /Referencias citadas: P1 = El error · TikTok/);
  });
});

describe("flujo simulado", () => {
  test("clasifica preguntas y redes", () => {
    assert.equal(classifyQuestion("¿Qué publico esta semana?"), "publicar");
    assert.equal(classifyQuestion("¿Por qué bajó YouTube?"), "baja");
    assert.equal(classifyQuestion("¿Qué gancho me funciona mejor en TikTok?"), "ganchos");
    assert.equal(classifyQuestion("¿Cuál es la retención de mis reels?"), "retencion");
    assert.equal(classifyQuestion("¿Voy a llegar a mi meta?"), "meta");
    assert.equal(detectNetwork("mis shorts")?.key, "youtube");
    assert.equal(detectNetwork("hola"), null);
  });

  test("cada plan usa solo herramientas válidas", () => {
    for (const q of ["¿Qué publico?", "¿Por qué bajó TikTok?", "gancho", "meta", "informe", "retención en instagram", "hola"]) {
      for (const call of planFakeTools(q, "2026-10-22")) assert.ok(parseToolCall(call.name, call.input).ok, `${q}: ${call.name}`);
    }
  });

  test("la respuesta usa las cifras recibidas y no inventa", () => {
    const outputs = [
      {
        resumen: [
          { ref: "C1", red: "Total", actual: { piezas: 10, vistas: 5000, interaccion_pct: 4, seguidores_netos: 30 }, anterior: { piezas: 10, vistas: 10000 }, cambio_pct: { vistas: -50, piezas: 0 } },
          { ref: "C2", red: "YouTube", actual: { piezas: 2, vistas: 1000, interaccion_pct: 3, seguidores_netos: 5 }, anterior: { piezas: 6, vistas: 4000 }, cambio_pct: { vistas: -75, piezas: -66.7 } },
        ],
      },
      { piezas: [{ ref: "P1", red: "YouTube", tipo: "Video", texto: "Video flojo", x_mediana: 0.3, vistas: 100, gancho: "Pregunta" }] },
      { piezas: [{ ref: "P2", red: "YouTube", tipo: "Video", texto: "Video bueno", x_mediana: 2.4, vistas: 900, gancho: "Resultado" }] },
    ];
    const text = composeFakeAnswer("¿Por qué bajó YouTube?", outputs);
    assert.match(text, /YouTube bajó \*\*75 %\*\* en vistas: 1,000 en los últimos 28 días contra 4,000/);
    assert.match(text, /Publicaste menos: 2 piezas contra 6/);
    assert.match(text, /\[P1\] ×0\.3; la primera abre con un gancho de pregunta/);
    assert.match(text, /\[P2\] con ×2\.4/);
    assert.match(text, /Respuesta simulada/);
  });

  test("propone ideas solo cuando preguntan qué publicar, y válidas", () => {
    const outputs = [{ dias_sin_nada: [] }, { ref: "C1", tipos: [{ tipo: "Resultado", piezas: 5, mediana_x: 2.1, mejor_pieza: { ref: "P2", texto: "Así llené mi agenda" } }] }, { piezas: [{ ref: "P1", texto: "Mi mejor reel", x_mediana: 3.2 }] }];
    const calls = fakeIdeaCalls("¿Qué publico esta semana?", outputs, "2026-10-22");
    assert.equal(calls.length, 2);
    for (const c of calls) assert.ok(parseToolCall(c.name, c.input).ok, JSON.stringify(c.input));
    assert.deepEqual(fakeIdeaCalls("¿Por qué bajó?", outputs, "2026-10-22"), []);
  });
});

// ─── Contra la base (opcional) ─────────────────────────────────────────────

const url = process.env.TEST_DATABASE_URL;
describe("herramientas contra la base", { skip: !url && "TEST_DATABASE_URL no está definida" }, async () => {
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
  const { TOOL_IMPLEMENTATIONS } = await import("../lib/strategist/queries");
  const { todayIn, addDays } = await import("../lib/metrics/params");
  const { sql } = await import("drizzle-orm");
  const db = getDb();
  const inputOf = (p: ReturnType<typeof parseToolCall>): never => {
    assert.ok(p.ok);
    return p.input as never;
  };
  const today = todayIn("America/Mexico_City");
  let account = "";

  before(async () => {
    await db.execute(sql`delete from content_items where external_id like 'est-test-%'`);
    const [a] = await db
      .insert(schema.socialAccounts)
      .values({ platform: "TIKTOK", externalId: `est-test-${Date.now()}`, handle: "est_test", accessTokenEnc: "prueba-sin-token", current: false, status: "ACTIVE" } as typeof schema.socialAccounts.$inferInsert)
      .returning({ id: schema.socialAccounts.id });
    account = a!.id;
    const rows = [
      { t: "Deja de publicar todos los días", perf: 3.1, hook: "contraste", views: 31000 },
      { t: "Esto me cambió la agenda", perf: 0.4, hook: "curiosidad", views: 4000 },
      { t: "3 errores al grabar", perf: 1.2, hook: "lista", views: 12000 },
    ];
    for (const [i, r] of rows.entries()) {
      await db.insert(schema.contentItems).values({
        socialAccountId: account,
        platform: "TIKTOK",
        externalId: `est-test-${i}`,
        type: "VIDEO",
        title: `ZZTEST ${r.t}`,
        publishedAt: new Date(`${addDays(today, -(i + 2))}T18:00:00Z`),
        views: r.views,
        likes: 100,
        comments: 10,
        shares: 5,
        perfScore: r.perf,
        hookType: r.hook,
        durationSec: 30,
      });
    }
  });

  after(async () => {
    await db.execute(sql`delete from content_items where external_id like 'est-test-%'`);
    await db.execute(sql`delete from social_accounts where id = ${account}::uuid`);
    await (globalThis as unknown as { pool?: { end(): Promise<void> } }).pool?.end();
  });

  test("buscar_piezas filtra por texto y ordena por puntaje; los datos que TikTok no da quedan en null", async () => {
    const registry = new RefRegistry();
    const input = parseToolCall("buscar_piezas", { red: "tiktok", texto: "ZZTEST", orden: "puntaje" });
    assert.ok(input.ok);
    const out = await TOOL_IMPLEMENTATIONS.buscar_piezas(input.input as never, { registry, ideas: [] });
    const piezas = out.content.piezas as { ref: string; texto: string; x_mediana: number; guardados: number | null; alcance: number | null; gancho: string }[];
    assert.equal(out.content.total_que_cumplen, 3);
    assert.deepEqual(
      piezas.map((p) => p.x_mediana),
      [3.1, 1.2, 0.4],
    );
    assert.equal(piezas[0]!.ref, "P1");
    assert.equal(piezas[0]!.guardados, null);
    assert.equal(piezas[0]!.alcance, null);
    assert.equal(piezas[0]!.gancho, "Contraste");
    assert.match(registry.get("P1")!.href, /^\/metricas\/[0-9a-f-]{36}$/);
  });

  test("filtro por gancho y orden ascendente", async () => {
    const registry = new RefRegistry();
    const input = parseToolCall("buscar_piezas", { texto: "ZZTEST", gancho: "curiosidad", direccion: "asc" });
    assert.ok(input.ok);
    const out = await TOOL_IMPLEMENTATIONS.buscar_piezas(input.input as never, { registry, ideas: [] });
    assert.equal((out.content.piezas as unknown[]).length, 1);
  });

  test("analisis_pieza solo acepta piezas ya mostradas", async () => {
    const registry = new RefRegistry();
    const unknown = await TOOL_IMPLEMENTATIONS.analisis_pieza({ pieza: "P7" }, { registry, ideas: [] });
    assert.match(String(unknown.content.error), /No conozco la pieza P7/);
    const search = parseToolCall("buscar_piezas", { texto: "ZZTEST", limite: 1 });
    await TOOL_IMPLEMENTATIONS.buscar_piezas(inputOf(search), { registry, ideas: [] });
    const detail = await TOOL_IMPLEMENTATIONS.analisis_pieza({ pieza: "P1" }, { registry, ideas: [] });
    assert.equal(detail.content.ref, "P1");
    assert.equal(detail.content.tiene_curva_de_retencion, false);
    assert.equal(detail.content.por_que_funciono, null);
  });

  test("proponer_idea tiene tope y quita referencias inventadas", async () => {
    const registry = new RefRegistry();
    const ideas: never[] = [];
    const input = parseToolCall("proponer_idea", { titulo: "Idea uno", idea: "Una idea con una cita falsa [P9].", formato: "REEL", redes: ["TIKTOK"] });
    const out = await TOOL_IMPLEMENTATIONS.proponer_idea(inputOf(input), { registry, ideas });
    assert.equal(out.idea!.idea, "Una idea con una cita falsa.");
    const full = { registry, ideas: [out.idea!, out.idea!, out.idea!] as never[] };
    const capped = await TOOL_IMPLEMENTATIONS.proponer_idea(inputOf(input), full);
    assert.match(String(capped.content.error), /Ya propusiste 3/);
  });
});
