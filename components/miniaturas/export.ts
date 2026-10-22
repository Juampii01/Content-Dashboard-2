"use client";

import { THUMB_HEIGHT, THUMB_MAX_BYTES, THUMB_WIDTH } from "@/lib/youtube/thumbnail-layout";
import { ensureThumbFonts } from "./thumbnail-canvas";

/**
 * Exportación en el navegador, igual que Carruseles: el mismo nodo de la vista previa (1280×720) se convierte a JPG
 * con modern-screenshot. YouTube acepta miniaturas de hasta 2 MB: si pasa, se baja la calidad hasta que entre.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: "image/jpeg" });
}

export async function captureThumbnail(node: HTMLElement): Promise<Blob> {
  await ensureThumbFonts();
  const { domToJpeg } = await import("modern-screenshot");
  let blob: Blob | null = null;
  for (const quality of [0.92, 0.85, 0.78, 0.7, 0.6]) {
    const url = await domToJpeg(node, { width: THUMB_WIDTH, height: THUMB_HEIGHT, scale: 1, quality, backgroundColor: "#050816", timeout: 20_000 });
    blob = dataUrlToBlob(url);
    if (blob.size < THUMB_MAX_BYTES) return blob;
  }
  return blob!;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "miniatura"
  );
}
