import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { LibraryError } from "./library";

/**
 * Carpetas de la biblioteca (clips e imágenes): crear, renombrar, borrar y mover piezas entre carpetas.
 *
 * Reglas:
 * - El nombre es corto y no se repite entre hermanas (mismo padre), sin importar mayúsculas.
 * - Una carpeta no puede ir dentro de sí misma ni de una de sus hijas.
 * - Borrar una carpeta NUNCA borra piezas: sus piezas y sus subcarpetas pasan a la carpeta de arriba.
 * - Profundidad máxima de 4 niveles, para que la navegación siga siendo simple.
 */

export const MAX_FOLDERS = 300;
export const MAX_DEPTH = 4;
const MAX_NAME = 60;

export type FolderView = { id: string; name: string; parentId: string | null; clips: number };

/** Todas las carpetas con cuántas piezas tiene cada una (sin contar las de sus subcarpetas). */
export async function listFolders(): Promise<FolderView[]> {
  const db = getDb();
  const [folders, counts] = await Promise.all([
    db.select({ id: schema.libraryFolders.id, name: schema.libraryFolders.name, parentId: schema.libraryFolders.parentId }).from(schema.libraryFolders).orderBy(asc(schema.libraryFolders.name)).limit(MAX_FOLDERS),
    db.select({ folderId: schema.brollClips.folderId, n: sql<number>`count(*)::int` }).from(schema.brollClips).groupBy(schema.brollClips.folderId),
  ]);
  const byFolder = new Map(counts.map((c) => [c.folderId, Number(c.n)]));
  return folders.map((f) => ({ ...f, clips: byFolder.get(f.id) ?? 0 }));
}

export function cleanFolderName(raw: string): string {
  const name = String(raw ?? "")
    .replace(/[\u0000-\u001f/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
  if (!name) throw new LibraryError("Ponle un nombre a la carpeta.");
  return name;
}

/** Los ancestros de una carpeta (de la más cercana a la raíz), para validar ciclos y profundidad. */
async function ancestors(id: string | null): Promise<string[]> {
  if (!id) return [];
  const rows = await getDb().execute<{ id: string }>(sql`
    with recursive up(id, parent_id, depth) as (
      select id, parent_id, 1 from library_folders where id = ${id}
      union all
      select f.id, f.parent_id, up.depth + 1 from library_folders f join up on f.id = up.parent_id where up.depth < 50
    )
    select id from up order by depth`);
  return rows.rows.map((r) => r.id);
}

async function assertParent(parentId: string | null): Promise<void> {
  if (!parentId) return;
  const [p] = await getDb().select({ id: schema.libraryFolders.id }).from(schema.libraryFolders).where(eq(schema.libraryFolders.id, parentId)).limit(1);
  if (!p) throw new LibraryError("Esa carpeta ya no existe. Recarga la página.");
  if ((await ancestors(parentId)).length >= MAX_DEPTH) throw new LibraryError(`Las carpetas pueden ir hasta ${MAX_DEPTH} niveles adentro.`);
}

async function assertFreeName(name: string, parentId: string | null, exceptId?: string): Promise<void> {
  const sameParent = parentId ? eq(schema.libraryFolders.parentId, parentId) : isNull(schema.libraryFolders.parentId);
  const rows = await getDb()
    .select({ id: schema.libraryFolders.id })
    .from(schema.libraryFolders)
    .where(and(sameParent, sql`lower(${schema.libraryFolders.name}) = lower(${name})`));
  if (rows.some((r) => r.id !== exceptId)) throw new LibraryError(`Ya hay una carpeta «${name}» aquí.`);
}

export async function createFolder(input: { name: string; parentId: string | null; userId: string }): Promise<FolderView> {
  const name = cleanFolderName(input.name);
  await assertParent(input.parentId);
  await assertFreeName(name, input.parentId);
  const [{ n }] = (await getDb().select({ n: sql<number>`count(*)::int` }).from(schema.libraryFolders)) as [{ n: number }];
  if (Number(n) >= MAX_FOLDERS) throw new LibraryError(`Llegaste al máximo de ${MAX_FOLDERS} carpetas.`);
  const [row] = await getDb().insert(schema.libraryFolders).values({ name, parentId: input.parentId, createdBy: input.userId }).returning();
  return { id: row!.id, name: row!.name, parentId: row!.parentId, clips: 0 };
}

export async function renameFolder(id: string, rawName: string): Promise<void> {
  const name = cleanFolderName(rawName);
  const [f] = await getDb().select().from(schema.libraryFolders).where(eq(schema.libraryFolders.id, id)).limit(1);
  if (!f) throw new LibraryError("Esa carpeta ya no existe. Recarga la página.");
  await assertFreeName(name, f.parentId, id);
  await getDb().update(schema.libraryFolders).set({ name, updatedAt: new Date() }).where(eq(schema.libraryFolders.id, id));
}

/** Mueve una carpeta dentro de otra (o a la raíz con null). */
export async function moveFolder(id: string, parentId: string | null): Promise<void> {
  const [f] = await getDb().select().from(schema.libraryFolders).where(eq(schema.libraryFolders.id, id)).limit(1);
  if (!f) throw new LibraryError("Esa carpeta ya no existe. Recarga la página.");
  if (parentId === id || (parentId && (await ancestors(parentId)).includes(id))) throw new LibraryError("Una carpeta no puede ir dentro de sí misma.");
  await assertParent(parentId);
  await assertFreeName(f.name, parentId, id);
  await getDb().update(schema.libraryFolders).set({ parentId, updatedAt: new Date() }).where(eq(schema.libraryFolders.id, id));
}

/** Borra la carpeta. Lo que tenía (piezas y subcarpetas) pasa a la carpeta de arriba: nunca se borran piezas. */
export async function deleteFolder(id: string): Promise<{ moved: number }> {
  return getDb().transaction(async (tx) => {
    const [f] = await tx.select().from(schema.libraryFolders).where(eq(schema.libraryFolders.id, id)).limit(1);
    if (!f) return { moved: 0 };
    const moved = await tx.update(schema.brollClips).set({ folderId: f.parentId }).where(eq(schema.brollClips.folderId, id)).returning({ id: schema.brollClips.id });
    // Las subcarpetas suben un nivel; si choca el nombre con una de allá, se les agrega «(2)», «(3)»…
    const kids = await tx.select().from(schema.libraryFolders).where(eq(schema.libraryFolders.parentId, id));
    if (kids.length) {
      const siblings = await tx
        .select({ name: schema.libraryFolders.name })
        .from(schema.libraryFolders)
        .where(f.parentId ? eq(schema.libraryFolders.parentId, f.parentId) : isNull(schema.libraryFolders.parentId));
      const taken = new Set(siblings.map((s) => s.name.toLowerCase()).filter((n) => n !== f.name.toLowerCase()));
      for (const k of kids) {
        let name = k.name;
        for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${k.name} (${i})`.slice(0, MAX_NAME);
        taken.add(name.toLowerCase());
        await tx.update(schema.libraryFolders).set({ parentId: f.parentId, name, updatedAt: new Date() }).where(eq(schema.libraryFolders.id, k.id));
      }
    }
    await tx.delete(schema.libraryFolders).where(eq(schema.libraryFolders.id, id));
    return { moved: moved.length };
  });
}

/** Pone piezas en una carpeta (o en la raíz con null). */
export async function moveClips(ids: string[], folderId: string | null): Promise<number> {
  const list = [...new Set(ids)].slice(0, 200);
  if (!list.length) return 0;
  if (folderId) {
    const [f] = await getDb().select({ id: schema.libraryFolders.id }).from(schema.libraryFolders).where(eq(schema.libraryFolders.id, folderId)).limit(1);
    if (!f) throw new LibraryError("Esa carpeta ya no existe. Recarga la página.");
  }
  const rows = await getDb().update(schema.brollClips).set({ folderId, updatedAt: new Date() }).where(inArray(schema.brollClips.id, list)).returning({ id: schema.brollClips.id });
  return rows.length;
}

/** La carpeta y todas sus subcarpetas (para filtrar «lo que hay adentro», a cualquier nivel). */
export async function folderTree(id: string): Promise<string[]> {
  const rows = await getDb().execute<{ id: string }>(sql`
    with recursive down(id, depth) as (
      select id, 1 from library_folders where id = ${id}
      union all
      select f.id, down.depth + 1 from library_folders f join down on f.parent_id = down.id where down.depth < 50
    )
    select id from down`);
  return rows.rows.map((r) => r.id);
}
