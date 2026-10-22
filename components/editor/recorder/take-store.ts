"use client";

import type { CaptionPresetKey, VideoFormat } from "@/lib/video/types";

/**
 * Tomas grabadas en el navegador, guardadas en IndexedDB hasta que terminan de subir. Así no se pierde una toma si se
 * cierra la pestaña, se corta la conexión o el teléfono se queda sin batería a mitad de la subida:
 *
 * - Mientras se graba, cada segundo de video (un "pedazo" de MediaRecorder) se guarda aparte. Si la pestaña se cierra
 *   a mitad de una toma, al volver se arma la toma con lo que alcanzó a grabarse (`recoverTakes`).
 * - Al terminar, los pedazos se unen en un solo archivo y la toma queda lista para subir.
 * - Cuando el Editor confirma que el archivo llegó entero, la toma se borra de este navegador.
 *
 * IndexedDB puede no estar (ventana privada de algunos navegadores) o quedarse sin espacio: todas las funciones
 * devuelven null o false en ese caso y la grabación sigue en memoria (se avisa en la pantalla).
 */

export type TakeSettings = { preset: CaptionPresetKey; brollMode: "auto" | "off"; autoExport: boolean };

export type TakeMeta = {
  id: string;
  scriptId: string | null;
  title: string;
  format: VideoFormat;
  /** Tipo sin códecs ("video/webm" o "video/mp4") y extensión del archivo que se sube. */
  mime: string;
  ext: "webm" | "mp4";
  createdAt: number;
  /** Segundos grabados (los mide la pantalla; 0 si se recuperó tras cerrar la pestaña). */
  duration: number;
  size: number;
  state: "recording" | "recorded";
  settings: TakeSettings;
  /** Proyecto del Editor ya reservado para esta toma (para retomar la subida con la misma ruta). */
  project?: { id: string; key: string; mode: "blob" | "local" };
  /** Se armó con los pedazos que quedaron al cerrarse la pestaña. */
  recovered?: boolean;
};

type TakeRecord = TakeMeta & { blob?: Blob };
type ChunkRecord = { takeId: string; seq: number; blob: Blob };

const DB_NAME = "content2-tomas";
const VERSION = 1;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("takes")) db.createObjectStore("takes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["takeId", "seq"] }).createIndex("byTake", "takeId");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, stores: string[], mode: IDBTransactionMode) {
  const t = db.transaction(stores, mode);
  const finished = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new DOMException("Abortada", "AbortError"));
  });
  return { t, finished };
}

/** Si el navegador deja guardar las tomas (y pide que no las borre si se queda sin espacio). */
export async function storageAvailable(): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    await navigator.storage?.persist?.();
  } catch {}
  return true;
}

export async function startTake(meta: TakeMeta): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    const { t, finished } = tx(db, ["takes"], "readwrite");
    t.objectStore("takes").put(meta satisfies TakeRecord);
    await finished;
    return true;
  } catch {
    return false;
  }
}

export async function addChunk(takeId: string, seq: number, blob: Blob): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    const { t, finished } = tx(db, ["chunks"], "readwrite");
    t.objectStore("chunks").put({ takeId, seq, blob } satisfies ChunkRecord);
    await finished;
    return true;
  } catch {
    return false;
  }
}

async function chunksOf(db: IDBDatabase, takeId: string): Promise<ChunkRecord[]> {
  const { t } = tx(db, ["chunks"], "readonly");
  const rows = (await done(t.objectStore("chunks").index("byTake").getAll(IDBKeyRange.only(takeId)))) as ChunkRecord[];
  return rows.sort((a, b) => a.seq - b.seq);
}

/**
 * Cierra la toma: une los pedazos en un solo archivo y los borra. `blob` es el archivo que ya está en memoria (si la
 * pantalla lo tiene); si no, se arma con los pedazos guardados.
 */
export async function finishTake(id: string, patch: Partial<TakeMeta>, blob?: Blob): Promise<TakeMeta | null> {
  const db = await open();
  if (!db) return null;
  try {
    const current = (await done(tx(db, ["takes"], "readonly").t.objectStore("takes").get(id))) as TakeRecord | undefined;
    if (!current) return null;
    const file = blob ?? new Blob((await chunksOf(db, id)).map((c) => c.blob), { type: current.mime });
    const next: TakeRecord = { ...current, ...patch, state: "recorded", size: file.size, blob: file };
    const { t, finished } = tx(db, ["takes", "chunks"], "readwrite");
    t.objectStore("takes").put(next);
    t.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await finished;
    const { blob: _omit, ...meta } = next;
    void _omit;
    return meta;
  } catch {
    return null;
  }
}

/** Tomas guardadas en este navegador (sin el archivo), de la más vieja a la más nueva. */
export async function listTakes(): Promise<TakeMeta[]> {
  const db = await open();
  if (!db) return [];
  try {
    const rows = (await done(tx(db, ["takes"], "readonly").t.objectStore("takes").getAll())) as TakeRecord[];
    return rows.map(({ blob: _b, ...meta }) => (void _b, meta)).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function getTakeFile(id: string): Promise<Blob | null> {
  const db = await open();
  if (!db) return null;
  try {
    const row = (await done(tx(db, ["takes"], "readonly").t.objectStore("takes").get(id))) as TakeRecord | undefined;
    return row?.blob ?? null;
  } catch {
    return null;
  }
}

export async function patchTake(id: string, patch: Partial<TakeMeta>): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const current = (await done(tx(db, ["takes"], "readonly").t.objectStore("takes").get(id))) as TakeRecord | undefined;
    if (!current) return;
    const { t, finished } = tx(db, ["takes"], "readwrite");
    t.objectStore("takes").put({ ...current, ...patch });
    await finished;
  } catch {}
}

export async function deleteTake(id: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const { t, finished } = tx(db, ["takes", "chunks"], "readwrite");
    t.objectStore("takes").delete(id);
    t.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await finished;
  } catch {}
}

/** Tomas que quedaron a mitad (se cerró la pestaña grabando): se arman con lo que alcanzó a guardarse. */
export async function recoverTakes(): Promise<number> {
  const db = await open();
  if (!db) return 0;
  let recovered = 0;
  for (const take of await listTakes()) {
    if (take.state !== "recording") continue;
    const parts = await chunksOf(db, take.id).catch(() => []);
    if (!parts.length) {
      await deleteTake(take.id);
      continue;
    }
    if (await finishTake(take.id, { recovered: true })) recovered++;
  }
  return recovered;
}
