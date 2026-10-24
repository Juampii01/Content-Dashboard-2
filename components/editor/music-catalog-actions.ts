"use server";

import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { importProviderTrack, JamendoError, musicProvider, MusicProviderError } from "@/lib/video/music-providers";
import type { ProviderTrack } from "@/lib/video/music-providers/types";

/**
 * Música de un catálogo externo con licencia comercial (hoy Jamendo, con el client_id del cliente): buscar desde la
 * Biblioteca del Estudio e importar una pista a la biblioteca de música (con su atribución).
 */
export type CatalogResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof MusicProviderError || error instanceof JamendoError) return { ok: false, error: error.message };
  console.error("[musica]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Algo salió mal con el catálogo de música. Prueba de nuevo." };
}

const querySchema = z.string().trim().max(80);

export async function searchCatalogMusicAction(query: string): Promise<CatalogResult<ProviderTrack[]>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const q = querySchema.safeParse(query);
  if (!q.success) return { ok: false, error: "La búsqueda es demasiado larga." };
  if (!(await allowAttempt(`music-search:${user.id}`, 60, 600))) return { ok: false, error: "Buscaste muchas veces seguidas. Espera unos minutos." };
  try {
    const provider = await musicProvider();
    if (!provider) return { ok: false, error: "Conecta Jamendo en Ajustes → Claves de servicios para buscar su música." };
    return { ok: true, data: await provider.search(q.data, { limit: 24 }) };
  } catch (error) {
    return fail(error);
  }
}

export async function importCatalogTrackAction(trackId: string): Promise<CatalogResult<{ id: string; title: string; duration: number | null; attribution: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!/^\d{1,12}$/.test(trackId)) return { ok: false, error: "Esa pista no es válida." };
  if (!(await allowAttempt(`music-import:${user.id}`, 30, 3600))) return { ok: false, error: "Agregaste muchas pistas seguidas. Espera un rato." };
  try {
    return { ok: true, data: await importProviderTrack(trackId, user.id) };
  } catch (error) {
    return fail(error);
  }
}
