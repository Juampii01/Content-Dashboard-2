import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { fileDriver, workerTransfer } from "@/lib/storage";
import { writeLocal } from "@/lib/storage/files";
import { jamendoProvider, JamendoError } from "./jamendo";
import { attributionText, type MusicProvider } from "./types";

export { JamendoError } from "./jamendo";

/**
 * Catálogos externos de música: la clave del cliente (cifrada como las demás), el proveedor listo para buscar y la
 * importación de una pista a la biblioteca (se baja una vez a su almacenamiento privado, con su atribución).
 */
const CONTEXT = "jamendo.client_id";
const MAX_BYTES = 40 * 1024 * 1024;

export class MusicProviderError extends Error {}

export async function jamendoKeyStatus(): Promise<{ configured: boolean; label: string | null; updatedAt: Date | null }> {
  const [row] = await getDb().select().from(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "JAMENDO")).limit(1);
  return { configured: Boolean(row), label: row?.label ?? null, updatedAt: row?.updatedAt ?? null };
}

async function readClientId(): Promise<string | null> {
  const [row] = await getDb().select().from(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "JAMENDO")).limit(1);
  return row ? decryptSecret(row.secretEnc, CONTEXT) : null;
}

/** Guarda el client_id después de probarlo con una búsqueda real. */
export async function saveJamendoKey(clientId: string, userId: string): Promise<{ label: string }> {
  const id = clientId.trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(id)) throw new MusicProviderError("El client_id de Jamendo son letras y números (está en devportal.jamendo.com → tus aplicaciones).");
  try {
    await jamendoProvider(id).search("", { limit: 1 });
  } catch (error) {
    throw new MusicProviderError(error instanceof JamendoError ? error.message : "No pudimos validar el client_id con Jamendo.");
  }
  const label = id.slice(-4);
  const values = { secretEnc: encryptSecret(id, CONTEXT), label, updatedBy: userId, updatedAt: new Date() };
  await getDb().insert(schema.serviceCredentials).values({ provider: "JAMENDO", ...values }).onConflictDoUpdate({ target: schema.serviceCredentials.provider, set: values });
  return { label };
}

export async function removeJamendoKey(): Promise<void> {
  await getDb().delete(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "JAMENDO"));
}

/** El catálogo listo para usar, o null si el cliente no guardó su clave. */
export async function musicProvider(): Promise<MusicProvider | null> {
  const id = await readClientId();
  return id ? jamendoProvider(id) : null;
}

/**
 * Importa una pista del catálogo a la biblioteca de música (queda lista para elegir en el Estudio). Si ya estaba, la
 * devuelve. La licencia y la descarga se vuelven a pedir al catálogo (no se confía en lo que manda el navegador).
 */
export async function importProviderTrack(trackId: string, userId: string): Promise<{ id: string; title: string; duration: number | null; attribution: string }> {
  const provider = await musicProvider();
  if (!provider) throw new MusicProviderError("Conecta Jamendo en Ajustes → Claves de servicios para usar su música.");
  const [existing] = await getDb()
    .select()
    .from(schema.musicTracks)
    .where(and(eq(schema.musicTracks.source, provider.id), eq(schema.musicTracks.externalId, trackId)))
    .limit(1);
  if (existing?.status === "READY") return { id: existing.id, title: existing.title, duration: existing.duration, attribution: existing.attribution ?? "" };
  if (!fileDriver()) throw new MusicProviderError("Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte.");
  const track = await provider.get(trackId).catch((error) => {
    throw new MusicProviderError(error instanceof Error ? error.message : "No pudimos leer esa pista.");
  });
  if (!track) throw new MusicProviderError("Esa pista no se puede usar en videos de una marca (su licencia no lo permite o no se puede descargar).");
  const res = await fetch(track.downloadUrl, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok || !res.body) throw new MusicProviderError("No pudimos bajar la pista. Prueba de nuevo.");
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new MusicProviderError("La pista pesa demasiado.");
  const id = randomUUID();
  const key = `editor/musica/${id}/pista.mp3`;
  let size: number;
  if (fileDriver() === "local") {
    size = await writeLocal(key, res.body, MAX_BYTES);
  } else {
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new MusicProviderError("La pista pesa demasiado.");
    const put = await workerTransfer(key, "put", "audio/mpeg");
    const up = await fetch(put.url, { method: "PUT", headers: put.headers, body: bytes });
    if (!up.ok) throw new MusicProviderError("No pudimos guardar la pista. Prueba de nuevo.");
    size = bytes.length;
  }
  const attribution = attributionText(track, provider.label);
  await getDb().insert(schema.musicTracks).values({
    id,
    title: `${track.title} · ${track.artist}`.slice(0, 120),
    status: "READY",
    fileKey: key,
    fileName: `${track.title}.mp3`.slice(0, 200),
    fileBytes: size,
    duration: track.duration || null,
    source: provider.id,
    externalId: track.id,
    attribution,
    licenseUrl: track.license.url,
    createdBy: userId,
  });
  return { id, title: `${track.title} · ${track.artist}`.slice(0, 120), duration: track.duration || null, attribution };
}
