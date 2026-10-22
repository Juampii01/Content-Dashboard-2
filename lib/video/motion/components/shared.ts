/**
 * Piezas comunes de los componentes: registro, escalado si no entra, apilado vertical centrado y límites de texto.
 */
import { z } from "zod";
import { rgba } from "../color";
import type { Kit } from "../kit";
import type { Node, Shadow } from "../nodes";

export type ComponentDef<S extends z.ZodType = z.ZodType> = {
  label: string;
  /** Para qué sirve (lo lee la IA y la galería). */
  hint: string;
  props: S;
  /** Ejemplo de props (galería, pruebas y prompt). */
  example: z.input<S>;
  build: (p: z.output<S>, k: Kit) => Node[];
  /** Textos visibles (para revisar cifras y palabras prohibidas). */
  texts: (p: z.output<S>) => string[];
};

export function defineComponent<S extends z.ZodType>(def: ComponentDef<S>): ComponentDef<S> {
  return def;
}

export const str = (max: number) => z.string().trim().max(max);
export const req = (max: number) => z.string().trim().min(1, "Falta un texto.").max(max);

/** Escalas que se prueban si el componente no entra en su caja. */
const SHRINK = [1, 0.93, 0.86, 0.79, 0.72, 0.65, 0.58, 0.52];

/** Arma el componente a la escala más grande que entre en la caja del contenido. */
export function fitToRegion(k: Kit, make: (k: Kit) => { nodes: Node[]; height: number; width?: number }): Node[] {
  let last: Node[] = [];
  for (const sc of SHRINK) {
    const kk: Kit = { ...k, s: k.s * sc };
    const out = make(kk);
    last = out.nodes;
    if (out.height <= k.region.h + 0.5 && (out.width == null || out.width <= k.region.w + 0.5)) return out.nodes;
  }
  return last;
}

export type Block = { h: number; gap?: number; make: (top: number) => Node[] };

/** Apila bloques y los centra en la caja del contenido (ópticamente un poco arriba del centro). */
export function stack(k: Kit, blocks: Block[]): { nodes: Node[]; height: number } {
  const height = blocks.reduce((a, b, i) => a + b.h + (i ? (b.gap ?? 0) : 0), 0);
  let y = k.region.y + Math.max(0, (k.region.h - height) / 2) - (k.mode === "full" ? Math.min(30 * k.u, (k.region.h - height) * 0.08) : 0);
  const nodes: Node[] = [];
  blocks.forEach((b, i) => {
    if (i) y += b.gap ?? 0;
    nodes.push(...b.make(y));
    y += b.h;
  });
  return { nodes, height };
}

/** Sombra para textos sobre el video (se separan de la imagen sin cajas). */
export function textShadow(k: Kit): Shadow | undefined {
  return k.mode === "overlay" ? { color: rgba("#000000", 0.45), blur: 28 * k.u, y: 4 * k.u } : undefined;
}

export const cx = (k: Kit) => k.region.x + k.region.w / 2;
