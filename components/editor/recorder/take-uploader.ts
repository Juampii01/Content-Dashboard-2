"use client";

import { useSyncExternalStore } from "react";
import { completeUploadAction, createProjectAction } from "../actions";
import { putFile } from "../upload-manager";
import { deleteTake, getTakeFile, listTakes, patchTake, type TakeMeta } from "./take-store";

/**
 * Cola de subidas de las tomas grabadas en el navegador. Una a la vez (con conexión lenta, dos en paralelo tardan lo
 * mismo y se cortan más), directo al almacenamiento privado como el resto del Editor (`putFile`: Vercel Blob con URL
 * firmada, en partes y con reintentos por parte si pesa más de 100 MB; disco local en desarrollo).
 *
 * Si la subida falla, se reintenta sola con espera creciente; sin conexión, espera a que vuelva. La toma sigue guardada
 * en IndexedDB hasta que el Editor confirma que el archivo llegó entero: si se cierra la pestaña, se retoma al volver.
 */
export type TakeUpload = {
  takeId: string;
  title: string;
  scriptId: string | null;
  status: "waiting" | "creating" | "uploading" | "finishing" | "retrying" | "offline" | "done" | "error";
  loaded: number;
  total: number;
  attempt: number;
  error?: string;
  /** Segundos hasta el próximo intento (cuando está reintentando). */
  retryIn?: number;
  projectId?: string;
};

const RETRY_SECONDS = [3, 8, 20, 45, 90, 180];
const uploads = new Map<string, TakeUpload>();
const listeners = new Set<() => void>();
let snapshot: TakeUpload[] = [];
let running = false;
const queue: string[] = [];

function emit() {
  snapshot = [...uploads.values()];
  for (const l of listeners) l();
}

function patch(takeId: string, next: Partial<TakeUpload>) {
  const current = uploads.get(takeId);
  if (!current) return;
  uploads.set(takeId, { ...current, ...next });
  emit();
}

export function useTakeUploads(): TakeUpload[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => EMPTY,
  );
}
const EMPTY: TakeUpload[] = [];

export function hasPendingTakeUploads(): boolean {
  return [...uploads.values()].some((u) => u.status !== "done" && u.status !== "error");
}

/** Pone una toma en la cola (si ya estaba, la vuelve a intentar). */
export function enqueueTake(take: Pick<TakeMeta, "id" | "title" | "scriptId" | "size">) {
  const current = uploads.get(take.id);
  // Ya está en camino (o terminó): solo se vuelve a poner en la cola una que falló.
  if (current && current.status !== "error") return;
  uploads.set(take.id, { takeId: take.id, title: take.title, scriptId: take.scriptId, status: "waiting", loaded: 0, total: take.size, attempt: 0, projectId: current?.projectId });
  emit();
  if (!queue.includes(take.id)) queue.push(take.id);
  void pump();
}

/** Retoma las tomas que quedaron guardadas sin subir (por ejemplo, al volver después de cerrar la pestaña). */
export async function resumePendingTakes(): Promise<TakeMeta[]> {
  const takes = (await listTakes()).filter((t) => t.state === "recorded");
  for (const t of takes) enqueueTake(t);
  return takes;
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      await uploadOne(id).catch((error: unknown) => {
        patch(id, { status: "error", error: error instanceof Error ? error.message : "La subida falló. Vuelve a intentarlo." });
      });
    }
  } finally {
    running = false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitOnline(): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener("online", () => resolve(), { once: true }));
}

/** El servidor ya no acepta esa ruta (el proyecto se borró o se reinició): hay que reservar otro. */
const projectGone = (message: string) => /ya no es válida|No encontramos ese proyecto|Vuelve a empezar/i.test(message);

async function reserveProject(meta: TakeMeta, file: Blob): Promise<NonNullable<TakeMeta["project"]>> {
  patch(meta.id, { status: "creating" });
  const result = await createProjectAction({
    title: meta.title.slice(0, 120) || "Toma sin título",
    fileName: `${meta.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "toma"}.${meta.ext}`,
    fileType: meta.mime,
    fileSize: file.size,
    format: meta.format,
    preset: meta.settings.preset,
    scriptId: meta.scriptId,
    styleId: null,
    brollMode: meta.settings.brollMode,
    autoExport: meta.settings.autoExport,
    origin: "recorder",
  });
  if (!result.ok || !result.data) throw new Error(result.ok ? "No pudimos preparar la subida." : result.error);
  const project = result.data;
  await patchTake(meta.id, { project });
  patch(meta.id, { projectId: project.id });
  return project;
}

async function uploadOne(takeId: string) {
  const meta = (await listTakes()).find((t) => t.id === takeId);
  const file = await getTakeFile(takeId);
  if (!meta || !file) {
    // Sin IndexedDB, la pantalla sube desde memoria con `uploadFromMemory`.
    const memory = pendingMemory.get(takeId);
    if (!memory) throw new Error("No encontramos esta toma en el navegador. Vuelve a grabarla.");
    return uploadWith(memory.meta, memory.file, true);
  }
  return uploadWith(meta, file, false);
}

const pendingMemory = new Map<string, { meta: TakeMeta; file: Blob }>();

/** Para cuando el navegador no deja guardar en IndexedDB: la toma se sube desde memoria (no cierres la pestaña). */
export function enqueueFromMemory(meta: TakeMeta, file: Blob) {
  pendingMemory.set(meta.id, { meta, file });
  enqueueTake({ ...meta, size: file.size });
}

async function uploadWith(meta: TakeMeta, file: Blob, memory: boolean) {
  let project = meta.project ?? null;
  patch(meta.id, { projectId: project?.id, total: file.size });
  let renewed = false;
  for (let attempt = 1; ; attempt++) {
    if (typeof navigator !== "undefined" && !navigator.onLine) patch(meta.id, { status: "offline", error: "Sin conexión: la subida sigue sola cuando vuelva." });
    await waitOnline();
    patch(meta.id, { status: "uploading", attempt, loaded: 0, error: undefined, retryIn: undefined });
    const controller = new AbortController();
    try {
      // Cada paso (reservar, subir, confirmar) va dentro del reintento: sin conexión, cualquiera puede fallar.
      project ??= await reserveProject(meta, file);
      patch(meta.id, { status: "uploading", projectId: project.id });
      await putFile({
        file: new File([file], `toma.${meta.ext}`, { type: meta.mime }),
        key: project.key,
        mode: project.mode,
        clientPayload: project.id,
        signal: controller.signal,
        onProgress: (loaded) => patch(meta.id, { loaded }),
      });
      patch(meta.id, { status: "finishing", loaded: file.size });
      const done = await completeUploadAction(project.id, {
        title: meta.title.slice(0, 120) || "Toma sin título",
        format: meta.format,
        preset: meta.settings.preset,
        scriptId: meta.scriptId,
        styleId: null,
        brollMode: meta.settings.brollMode,
        autoExport: meta.settings.autoExport,
      });
      if (!done.ok) throw new Error(done.error);
      patch(meta.id, { status: "done", projectId: project.id });
      if (memory) pendingMemory.delete(meta.id);
      else await deleteTake(meta.id);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("Subida cancelada.");
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const message = offline || error instanceof TypeError ? "Se cortó la conexión." : error instanceof Error ? error.message : "La subida falló.";
      if (project && projectGone(message) && !renewed) {
        // La ruta reservada venció: se reserva otra y se vuelve a intentar enseguida.
        renewed = true;
        project = null;
        await patchTake(meta.id, { project: undefined });
        continue;
      }
      if (offline) {
        // Sin conexión no cuenta como intento: espera a que vuelva.
        patch(meta.id, { status: "offline", error: "Sin conexión: la subida sigue sola cuando vuelva." });
        attempt--;
        continue;
      }
      if (attempt > RETRY_SECONDS.length) throw new Error(`${message.replace(/\.$/, "")}. Tu toma sigue guardada: toca «Reintentar».`);
      const wait = RETRY_SECONDS[attempt - 1]!;
      for (let s = wait; s > 0; s--) {
        patch(meta.id, { status: "retrying", error: message, retryIn: s });
        await sleep(1000);
      }
    }
  }
}

// Si se cierra la pestaña con una subida en curso, el navegador pregunta antes (la toma igual queda guardada).
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (hasPendingTakeUploads()) event.preventDefault();
  });
}
