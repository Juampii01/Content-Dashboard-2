/**
 * Pruebas del motor de motion graphics (lib/video/motion) sin canvas ni red: esquema, curvas, comportamientos,
 * números que cuentan, íconos, componentes, validador, compatibilidad con los gráficos v1 y render determinista
 * contra un contexto que graba las llamadas.
 *   pnpm test:motion
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { brandGraphicLook, type GraphicSpec } from "../lib/video/graphics";
import {
  approxMeasure,
  applyEase,
  COMPONENTS,
  COMPONENT_NAMES,
  compileScene,
  contentRegion,
  EASINGS,
  formatCount,
  ICON_NAMES,
  parseCount,
  renderFrame,
  sceneFromV1,
  sceneSchema,
  SAMPLE_THEMES,
  spring,
  toMotionScene,
  validateCompiled,
  validateScene,
  type MotionCanvas,
  type MotionSceneInput,
} from "../lib/video/motion";
import { countUp, fadeUp, pop, pulse, stagger } from "../lib/video/motion/animate";
import { iconPaths } from "../lib/video/motion/icons";
import { lastKeyTime, propAt, valueAt, type Node } from "../lib/video/motion/nodes";
import { parsePath, pathBounds } from "../lib/video/motion/path";

const theme = SAMPLE_THEMES.maestria!.theme;
const scene = (layers: MotionSceneInput["layers"], extra: Partial<MotionSceneInput> = {}): MotionSceneInput => ({ v: 2, duration: 3.5, format: "9:16", mode: "full", theme, layers, ...extra });
const opts = { width: 1080, height: 1920, measure: approxMeasure };
const blank = (): Node => ({ kind: "rect", x: 0, y: 0, w: 10, h: 10, r: 0, tracks: {}, box: { x: 0, y: 0, w: 10, h: 10 } });

/** Contexto falso: guarda cada llamada (para comprobar que el render es determinista y no falla). */
function recorder(): MotionCanvas & { log: string[] } {
  const log: string[] = [];
  const grad = { addColorStop: (o: number, c: string) => log.push(`stop ${o} ${c}`) };
  const target: Record<string, unknown> = { log, letterSpacing: "0px", globalAlpha: 1 };
  return new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (key === "measureText") return (s: string) => ({ width: approxMeasure(s, String(t.font ?? "700 40px Inter"), 0) });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => grad;
      return (...args: unknown[]) => log.push(`${key}(${args.map((a) => (typeof a === "number" ? a.toFixed(2) : String(a))).join(",")})`);
    },
    set(t, key: string, value) {
      t[key] = value;
      if (key !== "log") log.push(`${key}=${typeof value === "number" ? value.toFixed(3) : typeof value === "string" ? value : "obj"}`);
      return true;
    },
  }) as unknown as MotionCanvas & { log: string[] };
}

describe("esquema", () => {
  test("acepta una escena con componentes y primitivas", () => {
    const s = sceneSchema.parse(
      scene([
        { type: "component", component: "statCard", props: { value: "x2" } },
        { type: "text", text: "Hola", x: 0.5, y: 0.8, color: "accent@0.6", animate: [{ type: "fadeUp", at: 0.2 }] },
        { type: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.1, fill: "surface", animate: [{ type: "fill", at: 0 }], grow: "right" },
        { type: "icon", name: "rocket", x: 0.5, y: 0.3, tile: "accent", animate: [{ type: "draw", at: 0.1 }] },
        { type: "line", points: [[0.1, 0.9], [0.9, 0.9]], head: "end", animate: [{ type: "draw", at: 0 }] },
        { type: "group", children: [{ type: "ellipse", w: 0.1, fill: "accent" }], animate: [{ type: "pop", at: 0, each: 0.1 }] },
      ]),
    );
    assert.equal(s.layers.length, 6);
    assert.equal(s.position, "top");
  });
  test("rechaza hex sueltos, íconos que no existen y componentes desconocidos", () => {
    assert.equal(sceneSchema.safeParse(scene([{ type: "text", text: "x", color: "#ff0000" }])).success, false);
    assert.equal(sceneSchema.safeParse(scene([{ type: "icon", name: "instagram" }] as never)).success, false);
    assert.equal(sceneSchema.safeParse(scene([{ type: "component", component: "pieChart" }] as never)).success, false);
    assert.equal(sceneSchema.safeParse({ ...scene([{ type: "component", component: "statCard", props: { value: "1" } }]), v: 1 }).success, false);
  });
});

describe("curvas y pistas", () => {
  test("todas las curvas van de 0 a 1", () => {
    for (const [name, fn] of Object.entries(EASINGS)) {
      assert.ok(Math.abs(fn(0)) < 1e-6, `${name}(0)`);
      assert.ok(Math.abs(fn(1) - 1) < 1e-6, `${name}(1)`);
    }
    assert.equal(spring(0), 0);
    assert.equal(spring(1), 1);
  });
  test("el resorte se pasa (rebote) y se asienta", () => {
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => spring(i / 100, 0.5)));
    assert.ok(peak > 1.02, `rebota (${peak})`);
    assert.ok(Math.abs(spring(0.95, 0.5) - 1) < 0.05);
    assert.ok(Math.max(...Array.from({ length: 100 }, (_, i) => spring(i / 100, 0))) <= 1.0001, "sin rebote no se pasa");
    assert.ok(Math.abs(applyEase({ type: "spring", bounce: 0.3 }, 0.5) - spring(0.5, 0.3)) < 0.01);
  });
  test("valueAt interpola con la curva del keyframe de llegada", () => {
    const tr = [{ t: 1, v: 0 }, { t: 2, v: 10, ease: "linear" as const }];
    assert.equal(valueAt(tr, 0, 5), 0);
    assert.equal(valueAt(tr, 1.5, 5), 5);
    assert.equal(valueAt(tr, 3, 5), 10);
    assert.equal(valueAt(undefined, 1, 7), 7);
  });
  test("comportamientos: fadeUp, pop, countUp, stagger y pulse", () => {
    const n = fadeUp(blank(), { at: 0.5, dist: 40 });
    assert.equal(propAt(n, "opacity", 0.4), 0);
    assert.equal(propAt(n, "y", 0.5), 40);
    assert.equal(propAt(n, "y", 2), 0);
    assert.equal(propAt(n, "opacity", 2), 1);
    const p = pop(blank(), { at: 0, from: 0.5 });
    assert.equal(propAt(p, "scale", 0), 0.5);
    assert.equal(propAt(p, "scale", 1), 1);
    const c = countUp(blank(), { at: 0.2, dur: 1 });
    assert.equal(propAt(c, "value", 0), 0);
    assert.equal(propAt(c, "value", 2), 1);
    const list = stagger([blank(), blank(), blank()], 0.1, (x, at) => fadeUp(x, { at }));
    assert.deepEqual(list.map((x) => x.tracks.opacity![0]!.t), [0, 0.1, 0.2]);
    const pl = pulse(blank(), { at: 1, count: 3, period: 1 });
    assert.equal(lastKeyTime([pl]), 0, "el pulso no alarga la entrada");
  });
});

describe("números que cuentan", () => {
  const cases: [string, number, string, string][] = [
    ["x2", 2, "x", ""],
    ["+40%", 40, "+", "%"],
    ["10K", 10, "", "K"],
    ["6/10", 6, "", "/10"],
    ["12,345", 12345, "", ""],
    ["1.500", 1500, "", ""],
    ["2.5M", 2.5, "", "M"],
    ["US$ 3,5", 3.5, "US$ ", ""],
  ];
  for (const [text, to, prefix, suffix] of cases)
    test(text, () => {
      const f = parseCount(text);
      assert.equal(f.to, to);
      assert.equal(f.prefix, prefix);
      assert.equal(f.suffix, suffix);
      const end = formatCount(f, 1);
      assert.equal(`${end.prefix}${end.digits}${end.suffix}`, text);
    });
  test("formato a mitad de camino (es-419: coma de miles)", () => {
    assert.equal(formatCount(parseCount("12,345"), 0.5).digits, "6,173");
    assert.equal(formatCount(parseCount("10.000"), 0.5).digits, "5.000");
    assert.equal(formatCount(parseCount("2.5"), 0.5).digits, "1.3");
    assert.equal(formatCount(parseCount("3,5"), 0.5).digits, "1,8");
    assert.equal(formatCount(parseCount("10", 2), 0).digits, "2");
  });
});

describe("íconos", () => {
  test("todos se leen y caben en su grilla de 24", () => {
    assert.ok(ICON_NAMES.length >= 60 && ICON_NAMES.length <= 110, `${ICON_NAMES.length} íconos`);
    for (const name of ICON_NAMES) {
      const paths = iconPaths(name);
      assert.ok(paths.length > 0, name);
      for (const p of paths) {
        const b = pathBounds(p);
        assert.ok(b.x >= -1.5 && b.y >= -1.5 && b.x + b.w <= 25.5 && b.y + b.h <= 25.5, `${name} fuera de la grilla`);
        assert.ok(Number.isFinite(p.length) && p.length > 0, `${name} sin largo`);
      }
    }
  });
  test("arcos y comandos relativos", () => {
    const circle = parsePath("M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0Z");
    assert.ok(Math.abs(circle.length - 2 * Math.PI * 10) < 0.5, `perímetro ${circle.length}`);
    const sq = parsePath("M0 0h10v10h-10z");
    assert.ok(Math.abs(sq.length - 40) < 1e-6);
  });
});

describe("componentes", () => {
  for (const name of COMPONENT_NAMES) {
    for (const [format, mode, position] of [
      ["9:16", "full", "top"],
      ["16:9", "full", "top"],
      ["9:16", "overlay", "bottom"],
      ["16:9", "overlay", "top"],
    ] as const) {
      test(`${name} ${format} ${mode}`, () => {
        const def = COMPONENTS[name];
        const s = sceneSchema.parse(scene([{ type: "component", component: name, props: def.example as Record<string, unknown> }], { format, mode, position }));
        const size = format === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
        const c = compileScene(s, { ...opts, ...size });
        assert.equal(c.notes.length, 0, c.notes.join(" "));
        assert.ok(c.nodes.length > 0);
        const issues = validateCompiled(c).filter((i) => i.code === "overflow" || i.code === "overlap" || i.code === "component");
        assert.deepEqual(issues, [], issues.map((i) => i.message).join("\n"));
        // Todo queda dentro de la caja del contenido (con un margen para sombras y brillos).
        const region = contentRegion(size.width, size.height, mode, position);
        for (const n of c.nodes) {
          if (n.role !== "text" && n.role !== "card") continue;
          assert.ok(n.box.y >= region.y - 4 && n.box.y + n.box.h <= region.y + region.h + 4, `${name}: ${n.label ?? n.kind} fuera de la caja vertical`);
        }
        assert.ok((def.texts as (p: unknown) => string[])(def.props.parse(def.example)).length > 0);
      });
    }
  }
  test("los ejemplos no traen datos de marcas de terceros", () => {
    for (const name of COMPONENT_NAMES) assert.doesNotMatch(JSON.stringify(COMPONENTS[name].example), /instagram|whatsapp|tiktok|facebook/i);
  });
});

describe("render", () => {
  test("es determinista y respeta la salida", () => {
    const s = sceneSchema.parse(scene([{ type: "component", component: "funnel", props: COMPONENTS.funnel.example as Record<string, unknown> }]));
    const a = recorder();
    const b = recorder();
    const ca = compileScene(s, { ...opts, measure: approxMeasure });
    const cb = compileScene(s, { ...opts, measure: approxMeasure });
    renderFrame(a, ca, 1.2);
    renderFrame(b, cb, 1.2);
    assert.ok(a.log.length > 50);
    assert.deepEqual(a.log, b.log);
    // Al final todo salió: no se dibuja contenido (solo el fondo).
    const end = recorder();
    renderFrame(end, ca, s.duration);
    const mid = recorder();
    renderFrame(mid, ca, s.duration * 0.6);
    assert.ok(end.log.filter((l) => l.startsWith("fillText")).length === 0, "al final no queda texto");
    assert.ok(mid.log.filter((l) => l.startsWith("fillText")).length > 0);
  });
  test("comprime la entrada si el tramo es corto", () => {
    const long = compileScene(sceneSchema.parse(scene([{ type: "component", component: "checklist", props: COMPONENTS.checklist.example as Record<string, unknown> }], { duration: 5 })), opts);
    const short = compileScene(sceneSchema.parse(scene([{ type: "component", component: "checklist", props: COMPONENTS.checklist.example as Record<string, unknown> }], { duration: 1.4 })), opts);
    assert.equal(long.timeScale, 1);
    assert.ok(short.timeScale < 1 && short.timeScale >= 0.35);
    assert.ok(lastKeyTime(short.nodes) <= short.exit.start + 0.01);
  });
});

describe("validador", () => {
  test("errores de esquema en español", () => {
    const r = validateScene({ v: 2, duration: 3, format: "9:16", mode: "full", theme, layers: [] });
    assert.equal(r.ok, false);
    assert.match(r.issues[0]!.message, /layers/);
  });
  test("detecta texto que no entra, choques, zona segura y contraste", () => {
    const long = "Esta frase es larguísima y no tiene ninguna forma de entrar en una sola línea angosta del gráfico";
    const r = validateScene(
      scene([
        { type: "text", text: long, x: 0.5, y: 0.3, w: 0.3, size: 90, minSize: 80, maxLines: 1 },
        { type: "text", text: "Primero", x: 0.5, y: 0.5, size: 80 },
        { type: "text", text: "Segundo", x: 0.5, y: 0.51, size: 80 },
        { type: "text", text: "Borde", x: 0.02, y: 0.5, anchor: "top-left", size: 60 },
        { type: "text", text: "Apenas se ve", x: 0.5, y: 0.7, size: 40, color: "bg@0.2" },
        { type: "component", component: "statCard", props: { value: "1", label: "x".repeat(70) } },
      ]),
    );
    const codes = new Set(r.issues.map((i) => i.code));
    assert.equal(r.ok, false);
    for (const code of ["overflow", "overlap", "safe-zone", "contrast", "component"]) assert.ok(codes.has(code as never), `falta ${code}: ${r.issues.map((i) => i.message).join(" | ")}`);
    for (const i of r.issues) assert.doesNotMatch(i.message, /\b(the|is|invalid)\b/i);
  });
  test("botones de Reels (abajo a la derecha)", () => {
    const r = validateScene(scene([{ type: "text", text: "Aquí no", x: 0.86, y: 0.7, anchor: "top-left", w: 0.12, size: 40 }]));
    assert.ok(r.issues.some((i) => i.code === "buttons" || i.code === "safe-zone"));
  });
});

describe("compatibilidad con gráficos v1", () => {
  const look = brandGraphicLook({ colors: { primary: "#030a22", accent: "#4da3ff" }, fonts: { heading: "Montserrat" } });
  const base = { v: 1 as const, theme: look.theme, font: look.font, position: "bottom" as const };
  const SPECS: GraphicSpec[] = [
    { ...base, template: "number", mode: "full", value: "+40%", label: "más citas agendadas en un mes" },
    { ...base, template: "list", mode: "full", title: "Lo que revisa un buen anuncio", items: ["Un gancho en 3 segundos", "Una oferta clara y concreta", "Una sola llamada a la acción", "Seguimiento el mismo día"] },
    { ...base, template: "quote", mode: "overlay", text: "El problema no es el anuncio, es lo que pasa después del clic", highlight: "después del clic" },
    { ...base, template: "keyword", mode: "overlay", text: "Seguimiento", label: "La clave para que tus anuncios sí vendan", emphasis: "underline" },
    { ...base, template: "compare", mode: "full", left: { label: "Mito", text: "Necesitas más seguidores para vender" }, right: { label: "Realidad", text: "Necesitas un sistema que convierta" } },
    { ...base, template: "flow", mode: "full", title: "El sistema", steps: ["Anuncio", "Llamada de venta", "Cliente"] },
  ];
  const expected = { number: "statCard", list: "list", quote: "quote", keyword: "keyword", compare: "comparison", flow: "steps" } as const;
  for (const spec of SPECS)
    test(spec.template, () => {
      const s = sceneFromV1(spec, { duration: 3, format: "9:16" });
      assert.equal(s.v, 2);
      assert.equal(s.mode, spec.mode);
      assert.equal(s.position, "bottom");
      assert.equal(s.theme.font, "montserrat");
      assert.equal(s.theme.accent, look.theme.accent);
      const layer = s.layers[0]!;
      assert.equal(layer.type, "component");
      assert.equal(layer.type === "component" && layer.component, expected[spec.template]);
      const c = compileScene(s, opts);
      assert.equal(c.notes.length, 0, c.notes.join(" "));
    });
  test("toMotionScene acepta v1 y v2 y descarta lo que no sirve", () => {
    assert.equal(toMotionScene(SPECS[0], { duration: 2, format: "16:9" })?.format, "16:9");
    const v2 = scene([{ type: "component", component: "keyword", props: { text: "Hola" } }]);
    assert.equal(toMotionScene(v2, { duration: 2, format: "9:16" })?.duration, 2);
    assert.equal(toMotionScene({ v: 3 }, { duration: 2, format: "9:16" }), null);
    assert.equal(toMotionScene(null, { duration: 2, format: "9:16" }), null);
  });
});

describe("worker", () => {
  test("el motor empaquetado está al día (pnpm motion:bundle)", () => {
    execFileSync(process.execPath, ["scripts/motion-bundle.mjs", "--check"], { stdio: "pipe" });
  });
});
