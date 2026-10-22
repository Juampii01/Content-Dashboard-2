/**
 * Compatibilidad: los gráficos v1 (6 plantillas guardadas en los planes, lib/video/graphics.ts) se expresan como una
 * escena v2 con el componente equivalente. Así los planes existentes se ven y se renderizan con el motor nuevo.
 */
import type { GraphicSpec } from "../graphics";
import { sceneSchema, type MotionScene, type MotionSceneInput } from "./schema";

type Ctx = { duration: number; format: "9:16" | "16:9" };

/** Escena v2 equivalente a un spec v1 (mismos textos, colores, fuente, modo y posición). */
export function sceneFromV1(spec: GraphicSpec, { duration, format }: Ctx): MotionScene {
  const theme = { ...spec.theme, font: spec.font, backdrop: "glow-grid" as const };
  let layer: MotionSceneInput["layers"][number];
  switch (spec.template) {
    case "number":
      layer = { type: "component", component: "statCard", props: { value: spec.value, label: spec.label } };
      break;
    case "list":
      layer = { type: "component", component: "list", props: { title: spec.title, items: spec.items, marker: "number" } };
      break;
    case "quote":
      layer = { type: "component", component: "quote", props: { text: spec.text, highlight: spec.highlight } };
      break;
    case "keyword":
      layer = { type: "component", component: "keyword", props: { text: spec.text, label: spec.label, emphasis: spec.emphasis === "underline" ? "underline" : "marker" } };
      break;
    case "compare":
      layer = { type: "component", component: "comparison", props: { left: spec.left, right: spec.right } };
      break;
    case "flow":
      layer = { type: "component", component: "steps", props: { title: spec.title, steps: spec.steps } };
      break;
  }
  return sceneSchema.parse({ v: 2, duration: clampDuration(duration), format, mode: spec.mode, position: spec.position, theme, layers: [layer] });
}

const clampDuration = (d: number) => Math.max(0.6, Math.min(30, Number.isFinite(d) ? d : 3));

/**
 * Un gráfico del plan (spec v1 o escena v2) como escena v2 lista para dibujar, con la duración y el formato del
 * tramo. Devuelve null si no es válido.
 */
export function toMotionScene(graphic: unknown, ctx: Ctx): MotionScene | null {
  if (!graphic || typeof graphic !== "object") return null;
  const v = (graphic as { v?: unknown }).v;
  try {
    if (v === 2) {
      const parsed = sceneSchema.safeParse({ ...(graphic as object), duration: clampDuration(ctx.duration), format: ctx.format });
      return parsed.success ? parsed.data : null;
    }
    if (v === 1 && "template" in graphic) return sceneFromV1(graphic as GraphicSpec, ctx);
  } catch {
    return null;
  }
  return null;
}
