"use client";

import { useSyncExternalStore } from "react";
import { putFile } from "../upload-manager";
import { completeLongUploadAction } from "./actions";

/**
 * Subidas de videos largos en curso, fuera de los componentes: si la persona va a otra sección de la app la subida
 * sigue (mientras la pestaña esté abierta) y la lista la muestra. Al terminar, se avisa a la app para encolar el análisis.
 */
export type LongUpload = { id: string; fileName: string; loaded: number; total: number; status: "uploading" | "finishing" | "done" | "error"; error?: string };

const uploads = new Map<string, LongUpload>();
const aborters = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let snapshot: LongUpload[] = [];
const EMPTY: LongUpload[] = [];

function emit() {
  snapshot = [...uploads.values()];
  for (const l of listeners) l();
}

function patch(id: string, next: Partial<LongUpload>) {
  const current = uploads.get(id);
  if (!current) return;
  uploads.set(id, { ...current, ...next });
  emit();
}

export function useLongUploads(): LongUpload[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => EMPTY,
  );
}

export function startLongUpload(input: { id: string; key: string; mode: "blob" | "local"; file: File; onDone?: () => void }) {
  const controller = new AbortController();
  aborters.set(input.id, controller);
  uploads.set(input.id, { id: input.id, fileName: input.file.name, loaded: 0, total: input.file.size, status: "uploading" });
  emit();
  let last = 0;
  putFile({
    file: input.file,
    key: input.key,
    mode: input.mode,
    clientPayload: `largo:${input.id}`,
    signal: controller.signal,
    onProgress: (loaded) => {
      const now = performance.now();
      if (now - last < 200 && loaded < input.file.size) return;
      last = now;
      patch(input.id, { loaded });
    },
  })
    .then(async () => {
      patch(input.id, { loaded: input.file.size, status: "finishing" });
      const result = await completeLongUploadAction(input.id);
      if (result.ok) {
        patch(input.id, { status: "done" });
        input.onDone?.();
      } else patch(input.id, { status: "error", error: result.error });
    })
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        uploads.delete(input.id);
        emit();
        return;
      }
      patch(input.id, { status: "error", error: error instanceof Error && /[áéíóú]|subida|archivo|conexión/i.test(error.message) ? error.message : "La subida falló. Vuelve a intentarlo." });
    })
    .finally(() => aborters.delete(input.id));
}

export function cancelLongUpload(id: string) {
  aborters.get(id)?.abort();
  uploads.delete(id);
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if ([...uploads.values()].some((u) => u.status === "uploading" || u.status === "finishing")) event.preventDefault();
  });
}
