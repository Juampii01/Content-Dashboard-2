"use client";

import { ScaledThumbnail, type ThumbnailCanvasProps } from "./thumbnail-canvas";

/** Miniatura chica para la lista (la misma plantilla que el editor). */
export function PackageThumb(props: ThumbnailCanvasProps & { label: string }) {
  return <ScaledThumbnail {...props} />;
}
