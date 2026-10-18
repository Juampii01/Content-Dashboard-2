"use client";

import { SLIDE_HEIGHT, SLIDE_WIDTH, FONTS, type FontKey } from "@/lib/carousels/theme";

/**
 * Exportación en el navegador: cada slide (el mismo nodo React de la vista previa, a 1080×1350) se convierte
 * a JPG con modern-screenshot, y todo se empaqueta en un ZIP con fflate. No pasa por el servidor.
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Espera a que estén las fuentes de las plantillas (con tildes y ñ) antes de medir y capturar. */
export async function ensureFonts(font: FontKey): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const sample = "ÁÉÍÓÚáéíóúÑñÜü¿¡“”—0123456789";
  const families = new Set(['"Inter"', '"JetBrains Mono"', FONTS[font].family.split(",")[0]!, '"Montserrat Carrusel"', '"Playfair Carrusel"']);
  const loads: Promise<unknown>[] = [];
  for (const f of families) {
    for (const w of [400, 600, 700, 800, 900]) loads.push(document.fonts.load(`${w} 40px ${f}`, sample).catch(() => undefined));
  }
  loads.push(document.fonts.load(`italic 600 40px "Playfair Carrusel"`, sample).catch(() => undefined));
  await Promise.all(loads);
  await document.fonts.ready;
}

/**
 * Se eligió modern-screenshot sobre html-to-image: en la prueba los dos sacaron JPG fieles a la vista previa
 * (fuentes autoalojadas, tildes y ñ incluidas, diferencias de 1 px); modern-screenshot tiene
 * mantenimiento activo y html-to-image no saca versiones desde 2025.
 */
export async function captureSlide(node: HTMLElement, background: string): Promise<Uint8Array> {
  const { domToJpeg } = await import("modern-screenshot");
  const url = await domToJpeg(node, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT, scale: 1, quality: 0.93, backgroundColor: background, timeout: 20_000 });
  return dataUrlToBytes(url);
}

export async function buildZip(
  nodes: HTMLElement[],
  options: { background: string; captionText: string; onProgress?: (done: number, total: number) => void },
): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < nodes.length; i++) {
    files[`${String(i + 1).padStart(2, "0")}.jpg`] = await captureSlide(nodes[i]!, options.background);
    options.onProgress?.(i + 1, nodes.length);
  }
  files["caption.txt"] = strToU8(options.captionText.replace(/\n/g, "\r\n"));
  // Los JPG ya vienen comprimidos: se guardan sin volver a comprimir.
  const zip = zipSync(files, { level: 0 });
  return new Blob([zip as BlobPart], { type: "application/zip" });
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
      .replace(/ñ/g, "n")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "carrusel"
  );
}
