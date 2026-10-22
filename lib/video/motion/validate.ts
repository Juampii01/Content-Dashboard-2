/**
 * Validador geométrico de escenas: arma la escena con el mismo motor y revisa lo que se ve en el momento de
 * lectura (todo ya entró, antes de la salida). Devuelve problemas en español, pensados para que la IA reintente:
 * textos que no entran, elementos que se pisan, cosas fuera de la zona segura y contraste bajo.
 *
 * En el servidor no hay canvas: si no llega una medición, se usa una aproximación de anchos de Inter (alcanza para
 * detectar desbordes; la vista previa y el render miden con la fuente real).
 */
import { contrast, over, toHex } from "./color";
import { compileScene, reelsButtons, type CompiledScene, type FontFamilies } from "./compile";
import { propAt, type Box, type Node } from "./nodes";
import { sceneSchema, type MotionScene } from "./schema";
import type { Measurer } from "./text";

export type IssueCode = "schema" | "component" | "overflow" | "overlap" | "safe-zone" | "buttons" | "contrast" | "timing";
export type SceneIssue = { code: IssueCode; severity: "error" | "warning"; message: string; node?: string };

// ─── Medición aproximada (sin canvas) ─────────────────────────────────────

const NARROW = new Set([..."il.,:;'!|ìíïjI1()[]{}tf/"]);
const WIDE = new Set([..."mwMW@%"]);
/** Ancho aproximado de un texto en Inter (para validar en el servidor). */
export const approxMeasure: Measurer = (text, font, tracking) => {
  const m = font.match(/^(\d+)\s+([\d.]+)px/);
  const weight = m ? Number(m[1]) : 700;
  const size = m ? Number(m[2]) : 40;
  const wf = 1 + ((weight - 500) / 400) * 0.1;
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 0.27;
    else if (NARROW.has(ch)) w += 0.3;
    else if (WIDE.has(ch)) w += 0.86;
    else if (/[0-9]/.test(ch)) w += 0.62;
    else if (/[A-ZÁÉÍÓÚÑ]/.test(ch)) w += 0.68;
    else w += 0.56;
  }
  return w * size * wf + tracking * Math.max(0, [...text].length - 1);
};

// ─── Geometría ya asentada ────────────────────────────────────────────────

type Placed = { node: Node; box: Box; on: string | undefined; depth: number; group: number };

function settledBoxes(c: CompiledScene, t: number): Placed[] {
  const out: Placed[] = [];
  let groupId = 0;
  const visit = (n: Node, dx: number, dy: number, depth: number, group: number) => {
    const ox = dx + propAt(n, "x", t);
    const oy = dy + propAt(n, "y", t);
    const s = propAt(n, "scale", t);
    const visible = (n.alpha ?? 1) * propAt(n, "opacity", t) > 0.05;
    if (!visible) return;
    const b = n.box;
    const [px, py] = n.pivot ?? [b.x + b.w / 2, b.y + b.h / 2];
    const box = { x: px + (b.x - px) * s + ox, y: py + (b.y - py) * s + oy, w: b.w * s, h: b.h * s };
    out.push({ node: n, box, on: n.on, depth, group });
    if (n.kind === "group") {
      const g = ++groupId;
      n.children.forEach((ch) => visit(ch, ox, oy, depth + 1, g));
    }
  };
  c.nodes.forEach((n) => visit(n, 0, 0, 0, 0));
  return out;
}

const inter = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (a: Box, b: Box, tol = 1) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;

function describe(n: Node): string {
  if (n.kind === "text") {
    const t = n.lines.map((l) => l.text).join(" ");
    return `«${t.length > 40 ? `${t.slice(0, 38)}…` : t}»`;
  }
  if (n.kind === "counter") return `la cifra «${n.fmt.final}»`;
  return n.label ?? "un elemento";
}

/** Color CSS (rgba() o hex) sobre un fondo → hex resultante. */
function solidOver(color: string, under: string): string | null {
  if (color.startsWith("#")) return color;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = "1"] = m[1]!.split(",").map((x) => x.trim());
  return over(toHex({ r: Number(r), g: Number(g), b: Number(b) }), Number(a), under);
}

/** Revisa una escena ya compilada. */
export function validateCompiled(c: CompiledScene): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const note of c.notes) issues.push({ code: "component", severity: "error", message: note });
  const hold = Math.max(0, c.exit.start - 0.05);
  const placed = settledBoxes(c, hold);
  const texts = placed.filter((p) => p.node.kind === "text" || p.node.kind === "counter");
  const ground = c.theme.bg;
  const u = c.unit;

  // Desbordes.
  for (const p of texts) {
    if (p.node.kind === "text" && p.node.overflow) issues.push({ code: "overflow", severity: "error", message: `El texto ${describe(p.node)} no entra en su espacio ni con la letra más chica: acórtalo.`, ...(p.node.id ? { node: p.node.id } : {}) });
    if (p.box.x < -1 || p.box.y < -1 || p.box.x + p.box.w > c.width + 1 || p.box.y + p.box.h > c.height + 1) issues.push({ code: "overflow", severity: "error", message: `${cap(describe(p.node))} se sale de la pantalla.` });
  }

  // Zona segura y botones de Reels.
  const buttons = reelsButtons(c.width, c.height);
  for (const p of placed) {
    const role = p.node.role;
    if (role !== "text" && role !== "card" && p.node.kind !== "counter") continue;
    if (p.depth > 0 && role === "card") continue;
    if (!inside(p.box, c.safe, 4 * u)) {
      issues.push({ code: "safe-zone", severity: "warning", message: `${cap(describe(p.node))} queda muy cerca del borde (fuera de la zona segura): achícalo o muévelo hacia el centro.` });
      continue;
    }
    if (buttons && role === "text" && inter(p.box, buttons) > 0) issues.push({ code: "buttons", severity: "warning", message: `${cap(describe(p.node))} queda debajo de los botones de Reels (abajo a la derecha).` });
  }

  // Elementos que se pisan (textos entre sí y tarjetas entre sí).
  const check = (list: Placed[], what: string) => {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.node.overlap || b.node.overlap) continue;
        const shrink = (x: Box) => ({ x: x.x + 2 * u, y: x.y + 2 * u, w: Math.max(0, x.w - 4 * u), h: Math.max(0, x.h - 4 * u) });
        const area = inter(shrink(a.box), shrink(b.box));
        const small = Math.min(a.box.w * a.box.h, b.box.w * b.box.h);
        if (small > 0 && area / small > 0.08) issues.push({ code: "overlap", severity: "error", message: `${cap(describe(a.node))} se pisa con ${describe(b.node)}${what}.` });
      }
  };
  check(texts, "");
  check(
    placed.filter((p) => p.node.role === "card" && p.depth === 0),
    " (tarjetas encimadas)",
  );

  // Contraste del texto con lo que tiene detrás.
  for (const p of texts) {
    const n = p.node;
    const color = n.kind === "text" || n.kind === "counter" ? n.color : null;
    if (typeof color !== "string") continue;
    const under = p.on ?? ground;
    const fg = solidOver(color, under);
    if (!fg) continue;
    // Texto grande (o en negrita desde 22 unidades) pide 3:1; el resto, 4,5:1 (WCAG AA).
    const weight = Number(n.font.match(/^(\d+)/)?.[1] ?? 400);
    const need = n.size >= 40 * u || (weight >= 700 && n.size >= 22 * u) ? 3 : 4.5;
    const ratio = contrast(fg, under);
    if (ratio < need) issues.push({ code: "contrast", severity: "error", message: `${cap(describe(n))} se lee mal sobre su fondo (contraste ${ratio.toFixed(1).replace(".", ",")}:1; hace falta ${need}:1). Usa otro color del tema.` });
  }

  if (c.timeScale < 0.6) issues.push({ code: "timing", severity: "warning", message: "El tramo es corto para este gráfico: la animación se aprieta mucho. Usa menos elementos o un tramo más largo." });
  return dedupe(issues);
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
function dedupe(list: SceneIssue[]): SceneIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

export type ValidateOptions = { width?: number; height?: number; measure?: Measurer; fonts?: FontFamilies };

/** Valida una escena (esquema + geometría). `ok` es falso si hay algún error (las advertencias no frenan). */
export function validateScene(input: unknown, opts: ValidateOptions = {}): { ok: boolean; issues: SceneIssue[]; scene: MotionScene | null } {
  const parsed = sceneSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 6).map<SceneIssue>((i) => ({ code: "schema", severity: "error", message: `${i.path.length ? `En «${i.path.join(".")}»: ` : ""}${spanishZod(i.message)}` }));
    return { ok: false, issues, scene: null };
  }
  const scene = parsed.data;
  const size = scene.format === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const compiled = compileScene(scene, { width: opts.width ?? size.width, height: opts.height ?? size.height, measure: opts.measure ?? approxMeasure, ...(opts.fonts ? { fonts: opts.fonts } : {}) });
  const issues = validateCompiled(compiled);
  return { ok: !issues.some((i) => i.severity === "error"), issues, scene };
}

/** Los mensajes por defecto de Zod vienen en inglés: los más comunes, en español. */
function spanishZod(msg: string): string {
  if (/Too big/i.test(msg)) return "es demasiado largo.";
  if (/Too small/i.test(msg)) return "es demasiado corto o le faltan elementos.";
  if (/Invalid input/i.test(msg)) return "tiene un valor que no sirve.";
  if (/Invalid option|expected one of/i.test(msg)) return "no es una opción válida.";
  if (/Required|received undefined/i.test(msg)) return "falta este dato.";
  return msg;
}

