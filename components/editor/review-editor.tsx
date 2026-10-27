"use client";

import { Studio } from "./studio/studio";
import type { StudioProps } from "./studio/types";

/**
 * La revisión del Editor de video. Ahora es el Estudio (components/editor/studio): vista previa grande, línea de tiempo
 * editable, inspector, deshacer y atajos. Mismas props y mismo guardado que la revisión anterior.
 */
export function ReviewEditor(props: StudioProps) {
  return <Studio {...props} />;
}
