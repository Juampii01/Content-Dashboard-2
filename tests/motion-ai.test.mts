/**
 * Pruebas de los gráficos con IA del motor de motion graphics, sin red ni base: esquema del plan con escenas v1 y
 * v2, armado de la escena desde la respuesta de Claude (con el tema de Mi marca), validación con reintento y
 * arreglos automáticos, cifras que no se inventan, edición manual de textos y el director simulado (AI_FAKE).
 *   pnpm test:motion
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { fakeResponse } from "../lib/ai/fake";
import { brollMotionAiSchema, MOTION_RULES, motionAdjustTask, motionRequestAiSchema, motionRequestTask, motionRetryAiSchema, motionRetryTask, type MotionSceneAi } from "../lib/ai/prompts/motion";
import { brandGraphicLook, type GraphicSpec } from "../lib/video/graphics";
import { COMPONENT_NAMES, ICON_NAMES } from "../lib/video/motion";
import { autoFix, fallbackScene, fitProps, resolveScenes, sceneFromAi, sceneToAi, shorten, type MotionJob } from "../lib/video/motion-build";
import { brollGraphicOption, brollGraphicTitle, checkScene, graphicKindLabel, sceneFields, sceneTexts, setSceneField, unsupportedSceneNumbers, withBrandTheme } from "../lib/video/motion-graphics";
import { planSchemaFor } from "../lib/video/plan";
import type { EditPlan } from "../lib/video/types";

const look = brandGraphicLook({ colors: { primary: "#0f1a14", accent: "#c8ff3d" }, fonts: { heading: "Montserrat" } });
const ctx = { look, format: "9:16" as const, duration: 3 };
const comp = (component: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ kind: "component", component, at: 0, scale: 1, place: "auto", props, ...extra });
const ai = (layers: unknown[], extra: Partial<MotionSceneAi> = {}): MotionSceneAi => motionRequestAiSchema.parse({ title: "", mode: "full", position: "top", layers, refusal: "", alternative: "", note: "", ...extra }) as MotionSceneAi;
const spoken = "Una clínica en Houston pasó de tres a seis citas por cada diez llamadas";

describe("respuesta de la IA", () => {
  test("el esquema genera JSON Schema para la salida estructurada", () => {
    for (const s of [motionRequestAiSchema, motionRetryAiSchema, brollMotionAiSchema]) {
      const f = zodOutputFormat(s as never);
      assert.equal((f.schema as { type?: string }).type, "object");
    }
  });

  test("es permisivo: un ícono o color mal escrito no tira la respuesta, una capa rara se descarta", () => {
    const parsed = motionRequestAiSchema.parse({
      title: "x",
      mode: "pantalla",
      position: "top",
      refusal: "",
      alternative: "",
      note: "",
      layers: [comp("iconBurst", { icon: "unicornio", title: "Lanza ya", caption: "" }), { kind: "video", url: "x" }, { kind: "text", text: "Hola", color: "#ff0000" }],
    });
    assert.equal(parsed.mode, "full");
    const layers = parsed.layers.filter(Boolean) as Record<string, unknown>[];
    assert.equal(layers.length, 2);
    assert.equal((layers[0]!.props as { icon: string }).icon, "sparkles");
    assert.equal(layers[1]!.color, "bg");
    assert.ok(ICON_NAMES.includes("sparkles"));
  });

  test("las reglas traen el catálogo, los íconos, los límites y ejemplos buenos y malos", () => {
    for (const name of COMPONENT_NAMES) assert.ok(MOTION_RULES.includes(`- ${name} (`), name);
    assert.ok(MOTION_RULES.includes("message-circle: mensaje"));
    assert.ok(/LÍMITES[\s\S]*Personas[\s\S]*Logos/.test(MOTION_RULES));
    assert.ok(MOTION_RULES.includes("EJEMPLOS MALOS"));
    assert.ok(!/#[0-9a-f]{6}"/i.test(MOTION_RULES.replace('"color": "#FF0000"', "")), "las reglas no traen colores hex como ejemplo de uso");
  });
});

describe("escena desde la IA", () => {
  test("arma la escena con el tema de Mi marca y acota lo que se sale de rango", () => {
    const scene = sceneFromAi(ai([comp("statCard", { value: "x2", label: "más citas", eyebrow: "", icon: "" }, { scale: 9, at: 40 }), { kind: "text", text: "Hola", x: 3, y: -1, w: 0.8, size: 9000, weight: 950, font: "display", color: "accent", align: "center", uppercase: false, emphasis_words: "", emphasis_style: "none", animate: [] }]), ctx)!;
    assert.ok(scene);
    assert.equal(scene.theme.accent, look.theme.accent);
    assert.equal(scene.theme.font, "montserrat");
    const [c, t] = scene.layers as { scale?: number; at?: number; x?: number; y?: number; size?: number; weight?: number; animate?: unknown[] }[];
    assert.equal(c!.scale, 1.5);
    assert.equal(c!.at, 3);
    assert.deepEqual([t!.x, t!.y, t!.size, t!.weight], [1, 0, 400, 900]);
    assert.ok(t!.animate!.length > 0, "una primitiva sin animación recibe una entrada por defecto");
  });

  test("sin capas útiles no hay escena", () => {
    assert.equal(sceneFromAi(ai([]), ctx), null);
    assert.equal(sceneFromAi(ai([{ kind: "counter", value: "sin cifra", x: 0.5, y: 0.5, size: 200, color: "text", animate: [] }]), ctx), null);
  });

  test("ida y vuelta: escena → forma de la IA → escena", () => {
    const scene = sceneFromAi(ai([comp("checklist", { title: "Antes de publicar", items: ["Gancho", "Subtítulos", "Llamado"] }, { place: "top" })]), ctx)!;
    const back = sceneFromAi(motionRequestAiSchema.parse({ ...sceneToAi(scene), refusal: "", alternative: "", note: "" }) as MotionSceneAi, ctx)!;
    assert.deepEqual(back.layers, scene.layers);
  });

  test("el tema siempre es el de la marca (aunque llegue otro)", () => {
    const scene = sceneFromAi(ai([comp("keyword", { text: "Sistema", label: "", emphasis: "marker" })]), ctx)!;
    const other = brandGraphicLook({ colors: { primary: "#ffffff", accent: "#e2552d" }, fonts: { heading: "Inter" } });
    assert.equal(withBrandTheme(scene, other).theme.accent, other.theme.accent);
  });
});

describe("validación", () => {
  test("cifras: solo las dichas (o las que escribe la persona en su pedido)", () => {
    const scene = sceneFromAi(ai([comp("beforeAfter", { from: "3", to: "6", fromLabel: "Antes", toLabel: "Ahora", label: "citas de cada 10" })]), ctx)!;
    assert.deepEqual(unsupportedSceneNumbers(scene, spoken), []);
    const invented = sceneFromAi(ai([comp("statCard", { value: "+300%", label: "más citas", eyebrow: "", icon: "" })]), ctx)!;
    assert.deepEqual(unsupportedSceneNumbers(invented, spoken), [300]);
    assert.deepEqual(unsupportedSceneNumbers(invented, `${spoken} pon +300%`), []);
    const check = checkScene(invented, { allowed: spoken });
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("300")));
  });

  test("los pasos numerados no cuentan como cifra; en un gráfico de cifras, sí", () => {
    const steps = sceneFromAi(ai([comp("steps", { title: "", steps: ["Paso 1", "Paso 2", "Paso 3"], icons: [] })]), ctx)!;
    assert.deepEqual(unsupportedSceneNumbers(steps, "sin números"), []);
    const bars = sceneFromAi(ai([comp("barChart", { title: "", bars: [{ label: "A", value: 2 }, { label: "B", value: 3 }], prefix: "", suffix: "", highlight: -1 })]), ctx)!;
    assert.deepEqual(unsupportedSceneNumbers(bars, "sin números"), [2, 3]);
  });

  test("una idea por gráfico, palabras prohibidas y textos que no entran", () => {
    const two = sceneFromAi(ai([comp("keyword", { text: "Sistema", label: "", emphasis: "marker" }), comp("quote", { text: "Vende con un sistema", highlight: "", author: "" })]), ctx)!;
    assert.ok(checkScene(two, { allowed: "" }).errors.some((e) => e.includes("Una sola idea")));
    const banned = sceneFromAi(ai([comp("keyword", { text: "Gratis hoy", label: "", emphasis: "marker" })]), ctx)!;
    assert.ok(checkScene(banned, { allowed: "", bannedWords: ["gratis"] }).errors.some((e) => e.includes("prohibidas")));
    const long = sceneFromAi(ai([comp("keyword", { text: "Una palabra clave larguísima que no entra", label: "", emphasis: "marker" })]), ctx)!;
    const check = checkScene(long, { allowed: "" });
    assert.ok(check.errors.some((e) => e.includes("Palabra clave") && e.includes("máximo 28")), check.errors.join(" | "));
  });
});

describe("reintento y arreglos", () => {
  const job = (a: MotionSceneAi, extra: Partial<MotionJob> = {}): MotionJob => ({ ai: a, spoken, ...ctx, ...extra });
  const good = ai([comp("beforeAfter", { from: "3", to: "6", fromLabel: "Antes", toLabel: "Ahora", label: "citas de cada 10" })]);
  const invented = ai([comp("statCard", { value: "+300%", label: "más citas", eyebrow: "", icon: "" })]);

  test("bien de entrada: no reintenta", async () => {
    let calls = 0;
    const [o] = await resolveScenes([job(good)], { retries: 2, retry: async () => (calls++, []) });
    assert.equal(o!.how, "ok");
    assert.equal(calls, 0);
  });

  test("con problemas: le explica a Claude qué pasa y usa la versión corregida", async () => {
    const seen: string[][] = [];
    const [o] = await resolveScenes([job(invented)], {
      retries: 2,
      retry: async (items) => {
        seen.push(...items.map((i) => i.problems));
        return items.map(() => good);
      },
    });
    assert.equal(o!.how, "retry");
    assert.ok(seen[0]!.some((p) => p.includes("300")));
    assert.equal((o!.scene!.layers[0] as { component: string }).component, "beforeAfter");
  });

  test("como máximo los reintentos pedidos, todos en una llamada por ronda", async () => {
    let calls = 0;
    const outcomes = await resolveScenes([job(invented), job(good), job(invented)], { retries: 2, retry: async (items) => (calls++, items.map(() => invented)) });
    assert.equal(calls, 2);
    assert.deepEqual(
      outcomes.map((o) => o.how),
      ["fallback", "ok", "fallback"],
    );
    // El simplificado no lleva la cifra inventada.
    for (const o of [outcomes[0]!, outcomes[2]!]) assert.deepEqual(unsupportedSceneNumbers(o.scene!, spoken), []);
  });

  test("si el reintento falla (red), se arregla sin IA", async () => {
    const long = ai([comp("keyword", { text: "Seguimiento constante y ordenado", label: "", emphasis: "marker" })], { mode: "overlay" });
    const [o] = await resolveScenes([job(long)], { retries: 1, retry: async () => Promise.reject(new Error("sin red")) });
    assert.equal(o!.how, "auto");
    assert.ok(sceneTexts(o!.scene!)[0]!.length <= 28);
  });

  test("autoFix recorta al límite del componente y achica; fallbackScene arma algo legible", () => {
    assert.equal(shorten("Seguimiento constante y ordenado", 28), "Seguimiento constante y");
    const props = fitProps("list", { title: "", items: ["uno", "dos", "tres", "cuatro", "cinco", "seis"], marker: "number", icons: [] });
    assert.equal((props.items as string[]).length, 5);
    const scene = sceneFromAi(ai([comp("list", { title: "", items: ["uno", "dos", "tres", "cuatro", "cinco", "seis"], marker: "number", icons: [] })]), ctx)!;
    assert.ok(autoFix(scene, { allowed: "" }));
    const simple = fallbackScene({ texts: ["Embudo de ventas"], spoken, opts: { allowed: spoken }, ...ctx })!;
    assert.equal(graphicKindLabel(simple), "Palabra clave");
  });
});

describe("plan y edición", () => {
  const scene = sceneFromAi(ai([comp("funnel", { title: "", levels: [{ label: "Seguidores", value: "" }, { label: "Clientes", value: "" }] })]), ctx)!;
  const v1: GraphicSpec = { v: 1, template: "keyword", mode: "overlay", position: "top", theme: look.theme, font: look.font, text: "Seguimiento", label: "", emphasis: "highlight" };
  const plan = (graphic: unknown): EditPlan =>
    ({
      version: 2,
      format: "9:16",
      segments: [],
      order: [],
      removals: [],
      proposed_removals: [],
      hook_candidates: [],
      selected_hook: null,
      captions: { preset: "clasico", emphasis_words: [] },
      corrections: {},
      overlays: [],
      broll: [{ id: "b1", from_word: 2, to_word: 5, query_en: "x", keywords: [], choice: { source: "graphic", id: "g", duration: 0, width: 0, height: 0, graphic }, options: [] }],
      audio: { music_asset_id: null, music_db: -22, target_lufs: -14 },
      framing: { mode: "center", offset_x: 0 },
      off_script: [],
      summary: "",
      warning: "",
      planned_by: "ai",
    }) as unknown as EditPlan;

  test("el plan acepta escenas v2 y specs v1 guardados, y rechaza colores sueltos", () => {
    assert.ok(planSchemaFor(20).safeParse(plan(scene)).success);
    assert.ok(planSchemaFor(20).safeParse(plan(v1)).success);
    const hex = structuredClone(scene) as unknown as { layers: Record<string, unknown>[] };
    hex.layers.push({ type: "text", text: "x", color: "#ff0000" });
    assert.equal(planSchemaFor(20).safeParse(plan(hex)).success, false);
  });

  test("opción, título y etiquetas para v1 y v2", () => {
    assert.equal(brollGraphicOption(scene).source, "graphic");
    assert.equal(brollGraphicOption(scene).id, brollGraphicOption(structuredClone(scene)).id);
    assert.equal(brollGraphicTitle(scene), "Embudo · Seguidores");
    assert.equal(graphicKindLabel(v1), "Palabra clave");
  });

  test("edición manual: campos de texto con nombres claros y cambio de un valor", () => {
    const fields = sceneFields(scene);
    assert.deepEqual(
      fields.map((f) => f.label),
      ["Título", "Nivel 1 · rótulo", "Nivel 1 · cifra", "Nivel 2 · rótulo", "Nivel 2 · cifra"],
    );
    const next = setSceneField(scene, fields[1]!.id, "Audiencia");
    assert.equal(sceneTexts(next)[0], "Audiencia");
    assert.equal(sceneTexts(scene)[0], "Seguidores", "no muta la escena original");
  });
});

describe("director simulado (AI_FAKE)", () => {
  const chips = [
    ["Un embudo Seguidores → Conversaciones → Clientes que se llena", "funnel"],
    ["Una notificación de DM que diga 'Quiero info del programa'", "dmNotification"],
    ["Barras que suben de 2 a 10 clientes por mes", "barChart"],
    ["Un checklist que se tilda: Contenido, Conversación, Cierre", "checklist"],
    ["La palabra ANUNCIOS tachada y abajo SISTEMA en azul", "text"],
  ] as const;

  for (const format of ["9:16", "16:9"] as const)
    test(`los ejemplos de la revisión salen válidos (${format})`, () => {
      for (const [request, kind] of chips) {
        const out = motionRequestAiSchema.parse(fakeResponse("video.motion.pedido", motionRequestTask({ request, spoken, around: spoken, format, duration: 3 })));
        const scene = sceneFromAi(out as MotionSceneAi, { ...ctx, format })!;
        const first = scene.layers[0] as { type: string; component?: string };
        assert.equal(first.component ?? first.type, kind, request);
        const check = checkScene(scene, { allowed: `${spoken} ${request}` });
        assert.ok(check.ok, `${request}: ${check.errors.join(" | ")}`);
      }
    });

  test("rechaza lo que entra en los límites con una alternativa", () => {
    for (const request of ["Una foto mía sonriendo", "El logo de Instagram", "Una persona aplaudiendo"]) {
      const out = motionRequestAiSchema.parse(fakeResponse("video.motion.pedido", motionRequestTask({ request, spoken, around: spoken, format: "9:16", duration: 3 })));
      assert.ok(out.refusal && out.alternative, request);
      assert.equal(out.layers.length, 0);
    }
  });

  test("ajusta el gráfico actual (más grande, arriba) y el reintento simulado acorta", () => {
    const scene = sceneFromAi(ai([comp("checklist", { title: "", items: ["Contenido", "Conversación", "Cierre"] })]), ctx)!;
    const out = motionRequestAiSchema.parse(fakeResponse("video.motion.ajuste", motionAdjustTask({ request: "más grande y arriba", spoken, around: spoken, format: "9:16", duration: 3, current: sceneToAi(scene) })));
    const next = sceneFromAi(out as MotionSceneAi, ctx)!;
    const layer = next.layers[0] as { scale: number; region?: { y: number } };
    assert.ok(layer.scale > 1);
    assert.ok(layer.region && layer.region.y < 0.2);
    const retry = motionRetryAiSchema.parse(fakeResponse("video.motion.retry", motionRetryTask([{ spoken, format: "9:16", duration: 3, scene: sceneToAi(scene), problems: ["x"] }])));
    assert.equal(retry.graphics.length, 1);
  });

  test("el plan automático trae escenas v2 válidas", () => {
    const task = `CANTIDAD: 2\nDURACIÓN: 1.5–4.0 s\nGRÁFICOS: 1.5–5.0 s\nF1 [0–5] 2.0 s (0.0–2.0): Hoy te cuento algo.\nF2 [6–17] 4.0 s (2.0–6.0): Una clínica en Houston pasó de tres a seis citas por cada diez llamadas.\nF3 [18–24] 3.0 s (6.0–9.0): Lo primero es preguntar qué le pasa.\nF4 [25–28] 2.0 s (9.0–11.0): Comenta LLAMADA.`;
    const out = brollMotionAiSchema.parse(fakeResponse("video.broll.motion", task));
    const graphics = out.broll.filter((b) => b.kind === "graphic" && b.graphic);
    assert.ok(graphics.length >= 1);
    for (const g of graphics) assert.ok(sceneFromAi(g.graphic as MotionSceneAi, ctx));
  });
});
