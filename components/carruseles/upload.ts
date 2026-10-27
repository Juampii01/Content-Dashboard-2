"use client";

/**
 * Subida de imágenes de Carruseles: antes de mandarla, el navegador la reduce (lado mayor `max` px, JPEG) para que
 * pese poco. La app comprueba el tipo real y el tamaño otra vez (ver /api/carruseles/subir).
 */
export async function downscaleImage(file: File, max: number, quality = 0.9): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    // Formato que el navegador no sabe dibujar: se manda tal cual y la app decide.
    return file;
  }
}

export async function uploadImage(url: string, blob: Blob): Promise<{ key: string; url: string | null }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: blob, headers: { "content-type": blob.type || "application/octet-stream" } });
  } catch {
    throw new Error("Se cortó la conexión mientras subíamos la imagen. Prueba de nuevo.");
  }
  const data = (await res.json().catch(() => ({}))) as { key?: string; url?: string | null; error?: string };
  if (!res.ok || !data.key) throw new Error(data.error ?? "No pudimos subir la imagen. Prueba de nuevo.");
  return { key: data.key, url: data.url ?? null };
}
