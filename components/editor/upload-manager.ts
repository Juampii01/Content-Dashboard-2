"use client";

import { useSyncExternalStore } from "react";
import { completeUploadAction } from "./actions";
import type { Brief } from "@/lib/video/director/types";
import type { CaptionPresetKey, VideoFormat } from "@/lib/video/types";

/**
 * Subidas en curso, fuera de los componentes: si la persona navega a otra sección de la app,
 * la subida sigue (el módulo vive mientras la pestaña esté abierta) y la lista del Editor la muestra.
 * El archivo va directo del navegador al almacenamiento (Vercel Blob con URL firmada, o disco local en desarrollo).
 * Cuando la subida terminó y la persona ya tocó "Procesar", se avisa a la app para que encole el análisis.
 */
export type Settings = {
  title: string;
  format: VideoFormat;
  preset: CaptionPresetKey;
  scriptId: string | null;
  styleId?: string | null;
  brollMode?: "auto" | "off";
  autoExport?: boolean;
  /** Brief para el director de edición (opcional) y tope de IA del video. */
  brief?: Brief | null;
  budgetUsd?: number;
};

export type UploadState = {
  projectId: string;
  fileName: string;
  loaded: number;
  total: number;
  status: "uploading" | "uploaded" | "finishing" | "done" | "error";
  error?: string;
  /** El archivo terminó de subir (aunque después haya fallado el aviso a la app). */
  complete: boolean;
  /** La persona ya tocó "Procesar": al terminar la subida se encola solo. */
  submit: Settings | null;
};

const uploads = new Map<string, UploadState>();
const aborters = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let snapshot: UploadState[] = [];

function emit() {
  snapshot = [...uploads.values()];
  for (const l of listeners) l();
}

function patch(projectId: string, next: Partial<UploadState>) {
  const current = uploads.get(projectId);
  if (!current) return;
  uploads.set(projectId, { ...current, ...next });
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUploads(): UploadState[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}
const EMPTY: UploadState[] = [];

export function useUpload(projectId: string): UploadState | undefined {
  return useUploads().find((u) => u.projectId === projectId);
}

function uploadLocal(file: File, key: string, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/editor/files/${key}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = "La subida se cortó. Vuelve a intentarlo.";
        try {
          message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
        } catch {}
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Se perdió la conexión durante la subida. Vuelve a intentarlo."));
    xhr.onabort = () => reject(new DOMException("Cancelada", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

async function uploadBlob(file: File, key: string, projectId: string, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  const { uploadPresigned } = await import("@vercel/blob/client");
  await uploadPresigned(key, file, {
    access: "private",
    handleUploadUrl: "/api/editor/upload",
    clientPayload: projectId,
    contentType: file.type || undefined,
    // Más de 100 MB: en partes, en paralelo y con reintentos por parte (archivos de varios GB).
    multipart: file.size > 100 * 1024 * 1024,
    abortSignal: signal,
    onUploadProgress: (e) => onProgress(e.loaded),
  });
}

/**
 * Sube un archivo directo al almacenamiento (sin pasar por la app). Lo usan también los estilos
 * (`clientPayload` = "estilo:<id>") y la biblioteca de b-roll ("clip:<id>").
 */
export function putFile(input: { file: File; key: string; mode: "blob" | "local"; clientPayload: string; signal: AbortSignal; onProgress: (loaded: number) => void }): Promise<void> {
  return input.mode === "blob"
    ? uploadBlob(input.file, input.key, input.clientPayload, input.signal, input.onProgress)
    : uploadLocal(input.file, input.key, input.signal, input.onProgress);
}

async function finish(projectId: string) {
  const state = uploads.get(projectId);
  if (!state || state.status !== "uploaded" || !state.submit) return;
  patch(projectId, { status: "finishing" });
  const result = await completeUploadAction(projectId, state.submit);
  if (result.ok) patch(projectId, { status: "done" });
  else patch(projectId, { status: "error", error: result.error });
}

export function startUpload(input: { file: File; projectId: string; key: string; mode: "blob" | "local" }) {
  const { file, projectId, key, mode } = input;
  aborters.get(projectId)?.abort();
  const controller = new AbortController();
  aborters.set(projectId, controller);
  uploads.set(projectId, { projectId, fileName: file.name, loaded: 0, total: file.size, status: "uploading", complete: false, submit: uploads.get(projectId)?.submit ?? null });
  emit();
  let last = 0;
  const onProgress = (loaded: number) => {
    const now = performance.now();
    if (now - last < 150 && loaded < file.size) return;
    last = now;
    patch(projectId, { loaded });
  };
  const run = mode === "blob" ? uploadBlob(file, key, projectId, controller.signal, onProgress) : uploadLocal(file, key, controller.signal, onProgress);
  run
    .then(() => {
      patch(projectId, { loaded: file.size, status: "uploaded", complete: true });
      return finish(projectId);
    })
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        uploads.delete(projectId);
        emit();
        return;
      }
      patch(projectId, { status: "error", error: error instanceof Error && /[áéíóú]|subida|archivo|conexión/i.test(error.message) ? error.message : "La subida falló. Vuelve a intentarlo." });
    })
    .finally(() => aborters.delete(projectId));
}

/** La persona tocó "Procesar": si la subida ya terminó, se encola ya; si no, apenas termine. */
export async function submitUpload(projectId: string, settings: Settings): Promise<{ ok: boolean; error?: string }> {
  const state = uploads.get(projectId);
  if (!state) return { ok: false, error: "No encontramos la subida. Vuelve a elegir el archivo." };
  patch(projectId, { submit: settings, error: undefined, ...(state.complete ? { status: "uploaded" as const } : {}) });
  await finish(projectId);
  const after = uploads.get(projectId);
  return after?.status === "error" ? { ok: false, error: after.error } : { ok: true };
}

export function cancelUpload(projectId: string) {
  aborters.get(projectId)?.abort();
  uploads.delete(projectId);
  emit();
}

export function hasActiveUploads(): boolean {
  return [...uploads.values()].some((u) => u.status === "uploading" || u.status === "finishing");
}

// Si se cierra la pestaña con una subida en curso, el navegador pregunta antes.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (hasActiveUploads()) {
      event.preventDefault();
    }
  });
}
