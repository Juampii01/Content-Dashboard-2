/**
 * Pruebas del b-roll "a medida" (gráficos con la marca) sin base ni red: esquema del diseño, armado desde la
 * respuesta de la IA, cifras que no se inventan, diseño de la escena y plan con gráficos.
 *   pnpm test:video
 *
 * Con WORKER_PYTHON (el Python del worker, con Pillow y numpy) también compara el diseño de la vista previa con el
 * del worker, caja por caja (worker/scripts/graphic_scene_dump.py).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { brollTask } from "../lib/ai/prompts/editor";
import { brollCredits, brollSegments } from "../lib/video/effects";
import { buildScene, counterText, elementState, highlightIndexes, splitValue, type Measure } from "../lib/video/graphic-scene";
import {
  brandGraphicLook,
  defaultGraphic,
  graphicFromAi,
  graphicId,
  graphicOption,
  graphicSpecSchema,
  numbersSupported,
  spokenNumbers,
  switchTemplate,
  type GraphicAi,
  type GraphicSpec,
} from "../lib/video/graphics";
import { planSchemaFor } from "../lib/video/plan";
import { buildTimeline } from "../lib/video/timeline";
import type { BrollItem, EditPlan, Word } from "../lib/video/types";

const look = brandGraphicLook({ colors: { primary: "#030a22", accent: "#4da3ff" }, fonts: { heading: "Inter" } });
const base = { v: 1 as const, theme: look.theme, font: look.font, position: "top" as const };
const SPECS: GraphicSpec[] = [
  { ...base, template: "number", mode: "full", value: "+40%", label: "más citas agendadas en un mes" },
  { ...base, template: "list", mode: "full", title: "Lo que revisa un buen anuncio", items: ["Un gancho en 3 segundos", "Una oferta clara y concreta", "Una sola llamada a la acción", "Seguimiento el mismo día"] },
  { ...base, template: "quote", mode: "overlay", text: "El problema no es el anuncio, es lo que pasa después del clic", highlight: "después del clic" },
  { ...base, template: "keyword", mode: "overlay", text: "Seguimiento", label: "La clave", emphasis: "highlight" },
  { ...base, template: "compare", mode: "full", left: { label: "Mito", text: "Necesitas más seguidores para vender" }, right: { label: "Realidad", text: "Necesitas un sistema que convierta" } },
  { ...base, template: "flow", mode: "full", title: "El sistema", steps: ["Anuncio", "Llamada de venta", "Cliente"] },
];
/** Medición falsa y fija (la misma que worker/scripts/graphic_scene_dump.py). */
const measure: Measure = (text, font, size) => text.length * Math.round(size) * (font.weight === 900 ? 0.6 : 0.55);

describe("diseño del gráfico", () => {
  test("el esquema acepta las 6 plantillas y rechaza lo que no sirve", () => {
    for (const spec of SPECS) assert.ok(graphicSpecSchema.safeParse(spec).success, spec.template);
    assert.equal(graphicSpecSchema.safeParse({ ...SPECS[0], value: "mucho" }).success, false); // una cifra sin número
    assert.equal(graphicSpecSchema.safeParse({ ...SPECS[1], items: ["uno"] }).success, false); // lista de un punto
    assert.equal(graphicSpecSchema.safeParse({ ...SPECS[5], steps: ["a", "b"] }).success, false); // flujo de 2 pasos
    assert.equal(graphicSpecSchema.safeParse({ ...SPECS[3], text: "x".repeat(29) }).success, false); // palabra clave larga
    assert.equal(graphicSpecSchema.safeParse({ ...SPECS[0], theme: { ...look.theme, accent: "azul" } }).success, false);
  });

  test("colores y fuente de Mi marca (y los de MaestrIA si no hay)", () => {
    assert.equal(look.theme.bg, "#030a22");
    assert.equal(look.theme.accent, "#4da3ff");
    assert.equal(brandGraphicLook({ colors: null, fonts: { heading: "Montserrat" } }).font, "montserrat");
    assert.match(brandGraphicLook(null).theme.bg, /^#[0-9a-f]{6}$/i);
    const light = brandGraphicLook({ colors: { primary: "#f3eee4", accent: "#e2552d" }, fonts: null });
    assert.equal(light.theme.text, "#111111");
  });

  test("id estable por contenido", () => {
    assert.equal(graphicId(SPECS[0]!), graphicId({ ...SPECS[0]! }));
    assert.equal(graphicId(SPECS[0]!), graphicId(Object.fromEntries(Object.entries(SPECS[0]!).reverse()) as GraphicSpec));
    assert.notEqual(graphicId(SPECS[0]!), graphicId({ ...SPECS[0]!, value: "+41%" } as GraphicSpec));
    const option = graphicOption(SPECS[0]!);
    assert.equal(option.source, "graphic");
    assert.match(option.title ?? "", /^Número · \+40%/);
  });

  test("gráfico nuevo a mano: cifra si se dice una, si no la frase", () => {
    const number = defaultGraphic("Pasamos de tres a seis citas por cada diez llamadas.", look);
    assert.equal(number.template, "number");
    assert.ok(graphicSpecSchema.safeParse(number).success);
    const quote = defaultGraphic("Lo que funciona de verdad es preguntar primero", look);
    assert.equal(quote.template, "quote");
    for (const t of ["list", "keyword", "compare", "flow"] as const) assert.ok(graphicSpecSchema.safeParse(switchTemplate(quote, t, "Lo que funciona de verdad")).success, t);
  });
});

describe("cifras", () => {
  test("lee cifras dichas con números y con palabras", () => {
    assert.deepEqual(spokenNumbers("pasó de tres a seis citas por cada diez llamadas"), [3, 6, 10]);
    assert.ok(spokenNumbers("llegamos a diez mil seguidores").includes(10000));
    assert.ok(spokenNumbers("treinta y cinco clientes").includes(35));
    assert.ok(spokenNumbers("un 40 % más").includes(40));
    assert.ok(spokenNumbers("vendimos 1.500 cursos").includes(1500));
    assert.ok(spokenNumbers("duplicamos las ventas").includes(2));
    assert.ok(spokenNumbers("we doubled our sales in two months").includes(2));
  });

  test("un gráfico solo puede mostrar cifras que se dicen en el tramo", () => {
    const spec = { ...SPECS[0]!, value: "x2", label: "más ventas" } as GraphicSpec;
    assert.ok(numbersSupported(spec, "en un mes duplicamos las ventas"));
    assert.equal(numbersSupported(spec, "en un mes vendimos más"), false);
    const ratio = { ...SPECS[0]!, value: "6/10", label: "citas por cada 10 llamadas" } as GraphicSpec;
    assert.ok(numbersSupported(ratio, "pasó de tres a seis citas por cada diez llamadas"));
    assert.equal(numbersSupported({ ...SPECS[0]!, value: "10K", label: "" } as GraphicSpec, "llegamos a diez mil"), true);
    assert.equal(numbersSupported({ ...SPECS[0]!, value: "10K", label: "" } as GraphicSpec, "llegamos a mil"), false);
    // En listas y flujos, "3 segundos" sí cuenta como cifra, pero 1 a 4 sueltos no (numeración).
    assert.equal(numbersSupported(SPECS[1]!, "un gancho, una oferta y una llamada"), true);
  });
});

describe("respuesta de la IA", () => {
  const ai = (over: Partial<GraphicAi>): GraphicAi => ({ template: "number", mode: "full", position: "top", headline: "", label: "", highlight: "", items: [], item_labels: [], ...over });

  test("arma cada plantilla y recorta textos largos", () => {
    assert.equal(graphicFromAi(ai({ headline: "x2", label: "ventas" }), look)?.template, "number");
    const list = graphicFromAi(ai({ template: "list", items: ["Uno", "Dos", "Tres", "Cuatro", "Cinco"] }), look);
    assert.equal(list?.template === "list" && list.items.length, 4);
    const compare = graphicFromAi(ai({ template: "compare", items: ["Publicar todos los días", "Publicar con un sistema"], item_labels: ["Mito", "Realidad"] }), look);
    assert.equal(compare?.template === "compare" && compare.right.label, "Realidad");
    const kw = graphicFromAi(ai({ template: "keyword", mode: "overlay", headline: "Una palabra clave demasiado larga para la pantalla" }), look);
    assert.ok(kw && kw.template === "keyword" && kw.text.length <= 28);
  });

  test("descarta lo que no sirve (null: el tramo pasa a stock)", () => {
    assert.equal(graphicFromAi(ai({ headline: "muchos" }), look), null);
    assert.equal(graphicFromAi(ai({ template: "flow", items: ["A", "B"] }), look), null);
    assert.equal(graphicFromAi(ai({ template: "quote", headline: "" }), look), null);
  });

  test("la tarea avisa la duración de los gráficos (o que no hay)", () => {
    const words: Word[] = "Hoy te cuento algo. Duplicamos las ventas en un mes. Comenta YA.".split(" ").map((text, id) => ({ id, text, start: id * 0.4, end: id * 0.4 + 0.35 }));
    const common = { words, count: 2, minSeconds: 1.5, maxSeconds: 4, forbidden: [], format: "9:16", libraryTags: [] };
    assert.match(brollTask({ ...common, graphics: { minSeconds: 1.5, maxSeconds: 5 } }), /GRÁFICOS: 1\.5–5\.0 s/);
    assert.match(brollTask({ ...common, graphics: null }), /GRÁFICOS: no disponibles/);
    assert.match(brollTask({ ...common, graphics: { minSeconds: 1.5, maxSeconds: 5 }, stock: false }), /STOCK: no hay/);
  });
});

describe("escena", () => {
  const sizes = [
    [1080, 1920],
    [1920, 1080],
  ] as const;

  test("todo entra en su zona, en los dos formatos, modos y alturas", () => {
    for (const spec of SPECS)
      for (const [w, h] of sizes)
        for (const mode of ["full", "overlay"] as const)
          for (const position of ["top", "bottom"] as const) {
            const scene = buildScene({ ...spec, mode, position }, w, h, 3, measure);
            assert.ok(scene.elements.length > 0);
            for (const e of scene.elements) {
              if (e.paints.some((p) => p.type === "glow")) continue;
              const msg = `${spec.template} ${mode} ${w}x${h} ${position}`;
              assert.ok(e.x >= scene.box.x - 2 && e.x + e.w <= scene.box.x + scene.box.w + 2, msg);
              assert.ok(e.y >= scene.box.y - 2 && e.y + e.h <= scene.box.y + scene.box.h + 2, msg);
            }
          }
  });

  test("entra, se queda y sale (y los tramos cortos aprietan las entradas)", () => {
    const scene = buildScene(SPECS[1]!, 1080, 1920, 3, measure);
    const op = (t: number) => scene.elements.map((e) => elementState(scene, e, t).opacity);
    assert.ok(op(0).some((o) => o < 0.05));
    assert.ok(op(2.4).every((o) => o > 0.99));
    assert.ok(op(2.99).every((o) => o < 0.2));
    const short = buildScene(SPECS[1]!, 1080, 1920, 1.5, measure);
    assert.ok(short.timeScale < 1);
  });

  test("el contador cuenta con easing y termina en la cifra exacta", () => {
    for (const [value, final] of [["+40%", "40"], ["1.500", "1.500"], ["2,5x", "2,5"]] as const) {
      const scene = buildScene({ ...SPECS[0]!, value } as GraphicSpec, 1080, 1920, 3, measure);
      const c = scene.elements.flatMap((e) => e.paints).find((p) => p.type === "counter");
      assert.ok(c && c.type === "counter");
      assert.equal(counterText(scene, c.counter, 2.5), final);
      const early = Number(counterText(scene, c.counter, 0.25).replace(/\./g, "").replace(",", "."));
      const later = Number(counterText(scene, c.counter, 0.5).replace(/\./g, "").replace(",", "."));
      assert.ok(early < later, `${value}: ${early} < ${later}`);
    }
    assert.deepEqual(splitValue("x2"), { prefix: "x", num: "2", suffix: "", to: 2, decimals: 0, thousands: "", decimalChar: "," });
  });

  test("resalta la frase pedida", () => {
    assert.deepEqual([...highlightIndexes("El problema no es el anuncio, es lo que pasa después del clic".split(" "), "después del clic")], [10, 11, 12]);
  });

  test("mismo diseño que el worker (caja por caja)", { skip: !process.env.WORKER_PYTHON && "sin WORKER_PYTHON" }, () => {
    for (const spec of SPECS)
      for (const [w, h] of sizes)
        for (const mode of ["full", "overlay"] as const)
          for (const duration of [1.6, 3, 5]) {
            const input = { spec: { ...spec, mode }, width: w, height: h, duration };
            const py = JSON.parse(execFileSync(process.env.WORKER_PYTHON!, ["worker/scripts/graphic_scene_dump.py"], { input: JSON.stringify(input) }).toString());
            const ts = buildScene(input.spec, w, h, duration, measure);
            const msg = `${spec.template} ${mode} ${w}x${h} ${duration}s`;
            assert.equal(py.elements.length, ts.elements.length, msg);
            assert.ok(Math.abs(py.timeScale - ts.timeScale) < 1e-3, msg);
            ts.elements.forEach((e, i) => {
              const p = py.elements[i];
              for (const k of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(p[k] - e[k]) < 0.05, `${msg} #${i} ${k}: ${p[k]} vs ${e[k]}`);
              assert.equal(p.kind, e.anim.kind, msg);
              assert.ok(Math.abs(p.start - e.anim.start) < 1e-3, msg);
              assert.deepEqual(p.paints, e.paints.map((x) => x.type), msg);
            });
          }
  });
});

describe("plan con gráficos", () => {
  const words: Word[] = Array.from({ length: 40 }, (_, id) => ({ id, text: `p${id}`, start: id * 0.4, end: id * 0.4 + 0.35 }));
  const plan = (broll: BrollItem[]): EditPlan => ({
    version: 2, format: "9:16", segments: [], order: [], removals: [], proposed_removals: [], hook_candidates: [], selected_hook: null,
    captions: { preset: "clasico", emphasis_words: [] }, corrections: {}, overlays: [], broll,
    audio: { music_asset_id: null, music_db: -22, target_lufs: -14 }, framing: { mode: "center", offset_x: 0 }, off_script: [], summary: "", warning: "", planned_by: "ai",
  });
  const item = (choice: BrollItem["choice"]): BrollItem => ({ id: "b1", from_word: 10, to_word: 16, query_en: "chart", keywords: [], choice, options: choice ? [choice] : [] });

  test("el plan acepta un gráfico y rechaza uno sin diseño", () => {
    assert.ok(planSchemaFor(words.length).safeParse(plan([item(graphicOption(SPECS[0]!))])).success);
    const broken = { ...graphicOption(SPECS[0]!), graphic: null };
    assert.equal(planSchemaFor(words.length).safeParse(plan([item(broken)])).success, false);
    const stockWithSpec = { source: "pexels" as const, id: "1", duration: 5, width: 1080, height: 1920, file: "https://videos.pexels.com/a.mp4", graphic: SPECS[0]! };
    assert.equal(planSchemaFor(words.length).safeParse(plan([item(stockWithSpec)])).success, false);
  });

  test("los gráficos van en el timeline como cualquier b-roll y sin créditos", () => {
    const p = plan([item(graphicOption(SPECS[0]!))]);
    const timeline = buildTimeline(words, p, 16);
    const segs = brollSegments(timeline, p.broll);
    assert.equal(segs.length, 1);
    assert.equal(segs[0]!.option.source, "graphic");
    assert.equal(brollCredits(segs), "");
  });
});
