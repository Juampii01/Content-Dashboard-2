"use client";

/**
 * Subida directa del video del reel al almacenamiento (sin pasar por la app), a la ruta del estilo que crea la copia.
 * Es el mismo camino que usan los estilos del Editor (`clientPayload` = "estilo:<id>"); se repite aquí en pocas
 * líneas para no importar componentes internos del Editor.
 */
export function uploadReel(input: { file: File; key: string; styleId: string; mode: "blob" | "local"; signal: AbortSignal; onProgress: (loaded: number) => void }): Promise<void> {
  return input.mode === "blob" ? uploadBlob(input) : uploadLocal(input);
}

async function uploadBlob({ file, key, styleId, signal, onProgress }: Parameters<typeof uploadReel>[0]): Promise<void> {
  const { uploadPresigned } = await import("@vercel/blob/client");
  await uploadPresigned(key, file, {
    access: "private",
    handleUploadUrl: "/api/editor/upload",
    clientPayload: `estilo:${styleId}`,
    contentType: file.type || undefined,
    multipart: file.size > 100 * 1024 * 1024,
    abortSignal: signal,
    onUploadProgress: (e) => onProgress(e.loaded),
  });
}

function uploadLocal({ file, key, signal, onProgress }: Parameters<typeof uploadReel>[0]): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/editor/files/${key}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = "La subida se cortó. Vuelve a intentarlo.";
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
      } catch {}
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Se perdió la conexión durante la subida. Vuelve a intentarlo."));
    xhr.onabort = () => reject(new DOMException("Cancelada", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
