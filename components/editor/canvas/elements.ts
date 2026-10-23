/**
 * Lo que el lienzo de la revisión puede tocar, con nombres estables y sus textos editables. Sin React: lo usan la vista
 * previa (para armar los elementos del instante) y quien guarda los cambios (para saber qué se tocó).
 *
 * Ids: "graphic:<id del b-roll>", "effect:<id del efecto>", "caption:<id de la primera palabra del bloque>".
 */
import { FX_INFO, FX_MOVABLE, type FxKind } from "@/lib/video/fx/catalog";
import { isMotionScene, sceneFields, type BrollGraphic } from "@/lib/video/motion-graphics";
import type { CaptionBlock } from "@/lib/video/types";
import type { CanvasText } from "./transform-overlay";

export type CanvasTarget = { kind: "graphic"; key: string } | { kind: "effect"; key: string } | { kind: "caption"; key: string };

export const canvasId = (t: CanvasTarget) => `${t.kind}:${t.key}`;

export function parseCanvasId(id: string | null | undefined): CanvasTarget | null {
  if (!id) return null;
  const i = id.indexOf(":");
  const kind = id.slice(0, i);
  const key = id.slice(i + 1);
  if (!key || (kind !== "graphic" && kind !== "effect" && kind !== "caption")) return null;
  return { kind, key } as CanvasTarget;
}

/** Textos de un gráfico que se editan en el lugar (escenas v2; los v1 se editan en su editor). */
export function graphicCanvasTexts(graphic: BrollGraphic | null | undefined): CanvasText[] {
  if (!graphic || !isMotionScene(graphic)) return [];
  return sceneFields(graphic)
    .filter((f) => f.kind === "text")
    .slice(0, 12)
    .map((f) => ({ id: f.id, label: f.label || f.group, value: String(f.value), max: f.long ? 120 : 60 }));
}

/** Textos de un efecto: el principal, el rótulo chico y la lista, con los límites de su ficha. */
export function effectCanvasTexts(kind: FxKind, values: { text?: string; kicker?: string; items?: string[] }): CanvasText[] {
  const info = FX_INFO[kind];
  const out: CanvasText[] = [];
  if (info.text) out.push({ id: "text", label: info.text.label, value: values.text ?? "", max: info.text.max });
  if (info.kicker) out.push({ id: "kicker", label: info.kicker.label, value: values.kicker ?? "", max: info.kicker.max });
  if (info.items) {
    const items = values.items ?? [];
    for (let i = 0; i < info.items.count; i++) out.push({ id: `items.${i}`, label: `${info.items.label} ${i + 1}`, value: items[i] ?? "", max: info.items.max });
  }
  return out;
}

/** Palabras de un bloque de subtítulos, para corregirlas (la corrección vale para esa palabra del video). */
export function captionCanvasTexts(block: CaptionBlock): CanvasText[] {
  return block.words.map((w, i) => ({ id: String(w.id), label: `Palabra ${i + 1}`, value: w.text, max: 60 }));
}

export const movableEffectLabel = (kind: FxKind) => (FX_MOVABLE[kind] ? `${FX_INFO[kind].label} · ${FX_MOVABLE[kind]!.label}` : FX_INFO[kind].label);
