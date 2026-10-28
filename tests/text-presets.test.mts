/**
 * Pruebas de los textos a mano del Estudio (lib/video/text-presets.ts) sin canvas ni red: cada estilo arma una escena
 * v2 válida en 9:16 y 16:9 con marcas oscuras y claras, sin desbordes, con la fuente y los colores de la marca (o el
 * color propio), y lo nuevo del motor (sin velo, caja medida, sombra, salidas) no cambia las escenas de antes.
 *   pnpm test:textos
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brandGraphicLook, type GraphicLook } from "../lib/video/graphics";
import { approxMeasure, compileScene, renderFrame, sceneSchema, SAMPLE_THEMES, validateScene, type MotionCanvas, type MotionSceneInput } from "../lib/video/motion";
import type { Node, TextNode } from "../lib/video/motion/nodes";
import { motionTheme } from "../lib/video/motion-graphics";
import { graphicHidesCaptions } from "../lib/video/effects";
import { brollItemSchema } from "../lib/video/plan";
import { defaultEmphasis, isTextOption, TEXT_PRESET_KEYS, TEXT_PRESETS, textOption, textScene, updateTextOption, type TextPresetKey } from "../lib/video/text-presets";

const LOOKS: Record<string, GraphicLook> = {
  oscura: brandGraphicLook({ colors: { primary: "#030a22", accent: "#2b8cff" }, fonts: { heading: "Inter" } } as never),
  clara: brandGraphicLook({ colors: { primary: "#f3eee4", accent: "#e2552d" }, fonts: { heading: "Montserrat" } } as never),
  lima: brandGraphicLook({ colors: { primary: "#0b0b0c", accent: "#c8ff3d" }, fonts: { heading: "Montserrat" } } as never),
  sinMarca: brandGraphicLook(null),
};
const FORMATS = ["9:16", "16:9"] as const;
const size = (f: (typeof FORMATS)[number]) => (f === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

const LONG: Record<TextPresetKey, string> = {
  title: "Lo que nadie te dice sobre vender por mensaje",
  titleBox: "Tres errores que frenan tus ventas este mes",
  subtitle: "Si haces esto todos los días, en un mes lo vas a notar",
  pill: "Nuevo episodio",
  number: "12,500",
  quote: "No necesitas más seguidores, necesitas más conversaciones con las personas correctas",
  marker: "El seguimiento es donde está el dinero",
  strike: "Publicar todos los días sin un plan claro",
  cta: "Comenta GUÍA y te la mando",
  lowerThird: "María Fernanda Rodríguez",
  typewriter: "Te explico en treinta segundos cómo armar tu primera oferta",
  neon: "Abierto 24 horas",
};

function texts(nodes: Node[]): TextNode[] {
  const out: TextNode[] = [];
  const walk = (n: Node) => (n.kind === "text" ? out.push(n) : n.kind === "group" ? n.children.forEach(walk) : undefined);
  nodes.forEach(walk);
  return out;
}

/** Textos y cifras (para comparar tamaños). */
function sized(nodes: Node[]): { size: number }[] {
  const out: { size: number }[] = [];
  const walk = (n: Node) => (n.kind === "text" || n.kind === "counter" ? out.push(n) : n.kind === "group" ? n.children.forEach(walk) : undefined);
  nodes.forEach(walk);
  return out;
}

describe("estilos de texto", () => {
  test("son 12, con nombre, ayuda y una muestra", () => {
    assert.equal(TEXT_PRESET_KEYS.length, 12);
    for (const k of TEXT_PRESET_KEYS) {
      const p = TEXT_PRESETS[k];
      assert.ok(p.label && p.hint && p.sample, k);
      assert.doesNotMatch(`${p.label} ${p.hint}`, /\b(podés|tenés|querés|vos)\b/);
    }
  });

  for (const look of Object.keys(LOOKS))
    for (const format of FORMATS)
      test(`cada estilo da una escena válida y sin desbordes (marca ${look}, ${format})`, () => {
        for (const k of TEXT_PRESET_KEYS) {
          for (const [label, text, sub] of [
            ["muestra", TEXT_PRESETS[k].sample, TEXT_PRESETS[k].sub],
            ["largo", LONG[k], TEXT_PRESETS[k].sub],
          ] as const) {
            const scene = textScene({ preset: k, text, ...(sub ? { sub } : {}) }, LOOKS[look]!, { format });
            const r = validateScene(scene);
            const errors = r.issues.filter((i) => i.severity === "error").map((i) => i.message);
            assert.deepEqual(errors, [], `${k} (${label}): ${errors.join(" | ")}`);
            // Nada fuera de la zona segura ni debajo de los botones de Reels.
            const warns = r.issues.filter((i) => i.code === "safe-zone" || i.code === "buttons").map((i) => i.message);
            assert.deepEqual(warns, [], `${k} (${label}): ${warns.join(" | ")}`);
          }
        }
      });

  test("los tres tamaños y los tres lugares se respetan", () => {
    const look = LOOKS.oscura!;
    for (const k of TEXT_PRESET_KEYS) {
      const sizeOf = (s: "s" | "m" | "l") => Math.max(...texts(compileScene(textScene({ preset: k, text: "Hola", size: s }, look, { format: "9:16" }), { ...size("9:16"), measure: approxMeasure }).nodes).map((n) => n.size));
      const numSize = (s: "s" | "m" | "l") => Math.max(...sized(compileScene(textScene({ preset: k, text: "+30", size: s }, look, { format: "9:16" }), { ...size("9:16"), measure: approxMeasure }).nodes).map((n) => n.size));
      if (k === "number") assert.ok(numSize("s") < numSize("m") && numSize("m") < numSize("l"), "la cifra también crece");
      assert.ok(sizeOf("s") < sizeOf("m") && sizeOf("m") < sizeOf("l"), `${k}: chico < mediano < grande`);
      const yOf = (position: "top" | "center" | "bottom") => {
        const c = compileScene(textScene({ preset: k, text: "Hola mundo", position }, look, { format: "9:16" }), { ...size("9:16"), measure: approxMeasure });
        return c.content.y + c.content.h / 2;
      };
      assert.ok(yOf("top") < yOf("center") && yOf("center") < yOf("bottom"), `${k}: arriba < centro < abajo`);
    }
  });

  test("todos los tamaños y lugares siguen siendo válidos", () => {
    for (const k of TEXT_PRESET_KEYS)
      for (const s of ["s", "m", "l"] as const)
        for (const position of ["top", "center", "bottom"] as const)
          for (const format of FORMATS) {
            const r = validateScene(textScene({ preset: k, text: TEXT_PRESETS[k].sample, sub: TEXT_PRESETS[k].sub, size: s, position }, LOOKS.clara!, { format }));
            assert.ok(r.ok, `${k} ${s} ${position} ${format}: ${r.issues.map((i) => i.message).join(" | ")}`);
          }
  });
});

describe("marca y color", () => {
  test("la escena lleva el tema de la marca (fuente y colores) y va sobre el video sin velo", () => {
    for (const look of Object.values(LOOKS)) {
      const scene = textScene({ preset: "title", text: "Hola" }, look, { format: "9:16" });
      assert.equal(scene.mode, "overlay");
      assert.equal(scene.veil, "none");
      assert.equal(scene.theme.font, look.font);
      assert.equal(scene.theme.accent, motionTheme(look).accent);
      assert.equal(scene.theme.bg, look.theme.bg);
      const c = compileScene(scene, { ...size("9:16"), measure: approxMeasure });
      assert.deepEqual(c.veil, []);
    }
  });

  test("lo destacado usa el acento de la marca; un color propio manda", () => {
    const look = LOOKS.clara!;
    assert.equal(textScene({ preset: "pill", text: "Nuevo" }, look, { format: "9:16" }).colors?.accent, look.theme.accent);
    assert.equal(textScene({ preset: "cta", text: "Escríbeme" }, look, { format: "9:16" }).colors?.accent, look.theme.accent);
    assert.equal(textScene({ preset: "pill", text: "Nuevo", color: "#00aa55" }, look, { format: "9:16" }).colors?.accent, "#00aa55");
    assert.equal(textScene({ preset: "title", text: "Hola", color: "#FFCC00" }, look, { format: "9:16" }).colors?.text, "#ffcc00");
    assert.equal(textScene({ preset: "title", text: "Hola", color: "brand" }, look, { format: "9:16" }).colors?.text, look.theme.accent);
    assert.equal(textScene({ preset: "titleBox", text: "Hola", color: "black" }, look, { format: "9:16" }).colors?.surface, "#111111");
    // La tinta sobre el color propio se lee (blanca sobre oscuro, negra sobre claro).
    assert.equal(textScene({ preset: "pill", text: "Nuevo", color: "#ffee00" }, look, { format: "9:16" }).colors?.accentText, "#111111");
    assert.equal(textScene({ preset: "pill", text: "Nuevo", color: "#1a1a80" }, look, { format: "9:16" }).colors?.accentText, "#ffffff");
  });

  test("el color propio sobrevive a que el render vuelva a poner el tema de la marca", () => {
    const look = LOOKS.oscura!;
    const scene = textScene({ preset: "title", text: "Hola", color: "#ff3366" }, look, { format: "9:16" });
    const rebranded = sceneSchema.parse({ ...scene, theme: motionTheme(LOOKS.lima!) });
    const t = texts(compileScene(rebranded, { ...size("9:16"), measure: approxMeasure }).nodes)[0]!;
    assert.match(String(t.color), /255,51,102/);
  });

  test("con caja, el texto se mide contra su caja (contraste) y la caja lo abraza", () => {
    const c = compileScene(textScene({ preset: "titleBox", text: "Paso uno" }, LOOKS.oscura!, { format: "9:16" }), { ...size("9:16"), measure: approxMeasure });
    const g = c.nodes[0]!;
    assert.equal(g.kind, "group");
    if (g.kind !== "group") return;
    const [plate, txt] = g.children;
    assert.equal(plate!.kind, "rect");
    assert.equal(txt!.kind, "text");
    assert.equal(txt!.on, "#ffffff");
    assert.ok(plate!.box.x < txt!.box.x && plate!.box.x + plate!.box.w > txt!.box.x + txt!.box.w);
    assert.ok(plate!.box.y < txt!.box.y && plate!.box.y + plate!.box.h > txt!.box.y + txt!.box.h);
  });
});

describe("animación", () => {
  test("cada estilo entra animado y sale al final", () => {
    for (const k of TEXT_PRESET_KEYS) {
      const scene = textScene({ preset: k, text: TEXT_PRESETS[k].sample, sub: TEXT_PRESETS[k].sub }, LOOKS.oscura!, { format: "9:16" });
      assert.notEqual(scene.exit, "none", k);
      const c = compileScene(scene, { ...size("9:16"), measure: approxMeasure });
      assert.ok(c.exit.dur > 0, k);
      const animated = (n: Node): boolean => Object.keys(n.tracks).length > 0 || (n.kind === "group" && n.children.some(animated));
      assert.ok(c.nodes.some(animated), `${k} entra con animación`);
      assert.equal(c.timeScale, 1, `${k}: la entrada entra en 2,5 s sin apretarse`);
    }
  });

  test("la máquina de escribir escribe, el marcador barre y el tachado tacha", () => {
    const at = (k: TextPresetKey, prop: "chars" | "mark" | "strike") => {
      const c = compileScene(textScene({ preset: k, text: TEXT_PRESETS[k].sample }, LOOKS.oscura!, { format: "9:16" }), { ...size("9:16"), measure: approxMeasure });
      const t = texts(c.nodes)[0]!;
      return t.tracks[prop];
    };
    assert.ok(at("typewriter", "chars")?.length);
    assert.ok(at("marker", "mark")?.length);
    assert.ok(at("strike", "strike")?.length);
  });

  test("dibuja sin velo: el primer cuadro no pinta el fondo", () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      { measureText: (s: string) => ({ width: s.length * 20 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) } as Record<string, unknown>,
      {
        get: (t, p) => (p in t ? t[p as string] : typeof p === "string" ? (...a: unknown[]) => void calls.push(`${p}(${a.length})`) : undefined),
        set: () => true,
      },
    ) as unknown as MotionCanvas;
    const c = compileScene(textScene({ preset: "title", text: "Hola" }, LOOKS.oscura!, { format: "9:16" }), { ...size("9:16"), measure: approxMeasure });
    renderFrame(ctx, c, 0.001);
    assert.ok(!calls.includes("fillRect(4)"), "sin velo no se pinta el cuadro entero");
  });
});

describe("compatibilidad", () => {
  const theme = SAMPLE_THEMES.maestria!.theme;
  const old: MotionSceneInput = { v: 2, duration: 3, format: "9:16", mode: "overlay", theme, layers: [{ type: "text", text: "Hola" }] };

  test("una escena de antes (sin los campos nuevos) se arma igual: con velo y la salida de siempre", () => {
    const parsed = sceneSchema.parse(old);
    assert.equal(parsed.veil, undefined);
    assert.equal(parsed.colors, undefined);
    const c = compileScene(parsed, { width: 1080, height: 1920, measure: approxMeasure });
    assert.ok(c.veil.length > 0);
    assert.equal(c.exit.kind, "auto");
    const t = texts(c.nodes)[0]!;
    assert.equal(t.shadow, undefined);
    assert.equal(c.nodes[0]!.kind, "text");
  });

  test("los subtítulos solo se ocultan con los textos de abajo", () => {
    const look = LOOKS.oscura!;
    assert.equal(graphicHidesCaptions(textScene({ preset: "title", text: "Hola", position: "top" }, look, { format: "9:16" })), false);
    assert.equal(graphicHidesCaptions(textScene({ preset: "title", text: "Hola", position: "center" }, look, { format: "9:16" })), false);
    assert.equal(graphicHidesCaptions(textScene({ preset: "subtitle", text: "Hola" }, look, { format: "9:16" })), true);
    // Un gráfico de antes sobre el video, igual que siempre.
    assert.equal(graphicHidesCaptions(sceneSchema.parse(old)), true);
  });

  test("el b-roll guarda lo elegido y el plan lo conserva", () => {
    const look = LOOKS.oscura!;
    const option = textOption({ preset: "lowerThird", text: "Ana Gómez", sub: "Coach" }, look, { format: "9:16" });
    assert.ok(isTextOption(option));
    const item = brollItemSchema.parse({ id: "u1", from_word: 0, to_word: 3, query_en: "", keywords: [], choice: option, options: [option] });
    assert.equal(item.choice?.text?.preset, "lowerThird");
    assert.equal(item.choice?.text?.sub, "Coach");
    assert.equal((item.choice?.graphic as { veil?: string }).veil, "none");
    // Cambiar el texto vuelve a armar la escena (otro id) y conserva el resto.
    const next = updateTextOption(option, { text: "Ana María Gómez" }, look, "9:16")!;
    assert.notEqual(next.id, option.id);
    assert.equal(next.text?.sub, "Coach");
    assert.equal(updateTextOption(option, { text: "" }, look, "9:16"), null);
    // Un b-roll de antes (sin texto) sigue pasando.
    assert.ok(brollItemSchema.parse({ id: "b1", from_word: 0, to_word: 3, query_en: "x", keywords: [], choice: null, options: [] }));
  });

  test("palabras resaltadas por defecto", () => {
    assert.equal(defaultEmphasis("La clave"), "La clave");
    assert.equal(defaultEmphasis("La clave es la constancia"), "la constancia");
  });
});
