/**
 * Capas: lo que se superpone en el video final (b-roll, gráficos, efectos y transiciones) se dibuja en un orden
 * explícito, igual en la vista previa y en el render. Cada elemento tiene `layer` (entero, opcional: sin el campo, 0);
 * con la misma capa, va arriba la transición, después el efecto y abajo el b-roll, y entre iguales el que empieza
 * después (como se dibujaba antes de las capas, así los planes viejos se ven igual).
 *
 * Los efectos y las transiciones se dibujan sobre el cuadro del video (la persona): son opacos y tapan lo que tienen
 * debajo mientras duran. Un gráfico o un b-roll encima de un efecto se ve sobre el efecto. Sin servidor.
 */

/** Tipo de capa visual (desempata con la misma `layer`). */
export type LayerKind = "broll" | "fx" | "transition";
const RANK: Record<LayerKind, number> = { broll: 0, fx: 1, transition: 2 };

export type Stackable = { key: string; kind: LayerKind; layer?: number; start: number };

export const layerOf = (x: { layer?: number }) => x.layer ?? 0;

/** De abajo hacia arriba: el orden en que se dibujan. */
export function stackSort<T extends Stackable>(items: T[]): T[] {
  return [...items].sort((a, b) => layerOf(a) - layerOf(b) || RANK[a.kind] - RANK[b.kind] || a.start - b.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Posición de cada elemento en el orden de dibujo (0 = abajo), por su clave. */
export function stackIndex(items: Stackable[]): Map<string, number> {
  return new Map(stackSort(items).map((x, i) => [x.key, i]));
}

/** Claves de la vista previa y del render: "b:" b-roll, "f:" efecto, "t:" transición. */
export const layerKey = (kind: LayerKind, id: string) => `${kind === "broll" ? "b" : kind === "fx" ? "f" : "t"}:${id}`;

/**
 * Carriles de una pista (0 = arriba = lo que se dibuja encima): de arriba hacia abajo, cada bloque va un carril por
 * debajo del más bajo de los de arriba que se le pisan. Devuelve el carril de cada bloque y cuántos carriles hay.
 */
export function laneLayout<T extends { key: string; start: number; end: number; z: number }>(blocks: T[]): { lanes: Map<string, number>; count: number } {
  const lanes = new Map<string, number>();
  const placed: T[] = [];
  let count = 1;
  for (const b of [...blocks].sort((x, y) => y.z - x.z || x.start - y.start)) {
    let lane = 0;
    for (const o of placed) if (o.start < b.end - 0.001 && b.start < o.end - 0.001) lane = Math.max(lane, lanes.get(o.key)! + 1);
    lanes.set(b.key, lane);
    placed.push(b);
    count = Math.max(count, lane + 1);
  }
  return { lanes, count };
}

/**
 * Pone `key` en otro lugar del orden: justo encima de `below` (o abajo de todo si es null). Devuelve las capas nuevas
 * de todos (enteros desde 0, en el mismo orden de antes para los demás).
 */
export function restack(items: Stackable[], key: string, below: string | null): Map<string, number> {
  const order = stackSort(items).filter((x) => x.key !== key);
  const me = items.find((x) => x.key === key);
  if (!me) return new Map(order.map((x, i) => [x.key, i]));
  const at = below == null ? 0 : order.findIndex((x) => x.key === below) + 1;
  order.splice(Math.max(0, at), 0, me);
  return new Map(order.map((x, i) => [x.key, i]));
}
