"use server";

import { z } from "zod";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import { signBrollOptions, type SignedOption } from "@/lib/dal/editor-media";
import { readBytes, readUrl } from "@/lib/storage";
import { loadClip, pieceOf, readyPieces, searchLibrary } from "@/lib/video/library";
import { mentionSlug, pieceOption } from "@/lib/video/library-ficha";
import type { RefImage } from "@/lib/video/compos/schema";
import { RefError, saveRefImage } from "@/lib/video/refs";
import { loadProject } from "@/lib/video/service";

/**
 * Nombrar algo de la biblioteca con @ en el chat del video (y en los pedidos con adjuntos): el autocompletado y, al
 * elegir, el adjunto listo. Un video llega como material (para ponerlo de b-roll) y con sus hojas de cuadros copiadas a
 * las referencias del proyecto (para usarlo como referencia de estilo: Claude las mira); una imagen, copiada a las
 * referencias (de estilo o para usar dentro de una animación) y como b-roll fijo. Así las referencias siguen siendo
 * solo del proyecto (`editor/<proyecto>/refs/`), como las que se suben.
 */
type Fail = { ok: false; error: string };

export type LibraryPick = { id: string; kind: "video" | "image"; title: string; slug: string; duration: number | null; thumbUrl: string | null; hasFicha: boolean; summary: string | null };

/** Lo listo de la biblioteca para el autocompletado (lo que coincide con lo escrito, o lo último). */
export async function libraryPickerAction(query: string): Promise<{ ok: true; items: LibraryPick[] } | Fail> {
  await getCurrentUser();
  const q = z.string().max(60).safeParse(query);
  if (!q.success) return { ok: false, error: "Búsqueda no válida." };
  const pieces = await readyPieces();
  let list = pieces;
  if (q.data.trim().length >= 2) {
    const ids = await searchLibrary(q.data.replace(/-/g, " "), { readyOnly: true, limit: 12 });
    const byId = new Map(pieces.map((p) => [p.id, p]));
    list = ids.map((id) => byId.get(id)).filter((p): p is (typeof pieces)[number] => Boolean(p));
  }
  const items = await Promise.all(
    list.slice(0, 12).map(async (p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      slug: mentionSlug(p.title),
      duration: p.kind === "video" ? p.duration : null,
      thumbUrl: p.thumbKey ? await readUrl(p.thumbKey).catch(() => null) : null,
      hasFicha: Boolean(p.ficha),
      summary: p.ficha?.description.slice(0, 140) ?? null,
    })),
  );
  return { ok: true, items };
}

export type LibraryAttachment = {
  libraryId: string;
  kind: "video" | "image";
  name: string;
  duration: number | null;
  /** Para ponerlo como b-roll (video, o imagen fija). */
  clip: SignedOption;
  /** Video: sus hojas de cuadros; imagen: la imagen. Ya copiadas a las referencias del proyecto. */
  refs: Omit<RefImage, "use" | "note">[];
};

export async function mentionLibraryAction(projectId: string, clipId: string): Promise<{ ok: true; attachment: LibraryAttachment } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(clipId).success) return { ok: false, error: "Datos no válidos." };
  const [project, row] = await Promise.all([loadProject(projectId), loadClip(clipId)]);
  if (!project) return { ok: false, error: "No encontramos ese video." };
  if (!row || row.status !== "READY") return { ok: false, error: "Esa pieza de tu biblioteca todavía no está lista." };
  const piece = pieceOf(row);
  const sources = piece.kind === "image" ? [piece.fileKey] : (row.fichaSheets ?? []).map((s) => s.key).slice(0, 2);
  const refs: Omit<RefImage, "use" | "note">[] = [];
  try {
    for (const key of sources) refs.push(await saveRefImage(projectId, await readBytes(key, 12 * 1024 * 1024)));
  } catch (error) {
    if (error instanceof RefError) return { ok: false, error: error.message };
    console.error("[biblioteca] mención:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos preparar esa pieza. Prueba de nuevo." };
  }
  const [clip] = await signBrollOptions([pieceOption(piece)]);
  if (!clip) return { ok: false, error: "No pudimos preparar esa pieza." };
  return { ok: true, attachment: { libraryId: piece.id, kind: piece.kind, name: piece.title.slice(0, 80), duration: piece.kind === "video" ? piece.duration : null, clip, refs } };
}
