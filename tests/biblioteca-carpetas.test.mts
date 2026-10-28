/**
 * Carpetas de la biblioteca (lib/video/library-folders.ts): crear, anidar, renombrar, mover piezas y carpetas, y borrar
 * sin perder piezas.
 *   TEST_DATABASE_URL=postgres://... pnpm test:carpetas
 * Nunca la corras contra la base de un cliente: crea y borra carpetas y piezas de prueba.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba de las carpetas.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: url,
  DATABASE_URL_UNPOOLED: url,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  CRON_SECRET: "y".repeat(40),
  AI_FAKE: "1",
  NODE_ENV: "test",
});

const { getDb, schema } = await import("../lib/db");
const f = await import("../lib/video/library-folders");
const { LibraryError } = await import("../lib/video/library");
const { eq, inArray, sql } = await import("drizzle-orm");

let userId = "";
const clipIds: string[] = [];
const folderOf = async (id: string) => (await getDb().select({ folderId: schema.brollClips.folderId }).from(schema.brollClips).where(eq(schema.brollClips.id, id)))[0]?.folderId ?? null;

describe("carpetas de la biblioteca", () => {
  before(async () => {
    await getDb().execute(sql`delete from library_folders`);
    const [u] = await getDb().select({ id: schema.users.id }).from(schema.users).limit(1);
    if (u) userId = u.id;
    else {
      const [nu] = await getDb().insert(schema.users).values({ id: "prueba-carpetas", name: "Prueba", email: "carpetas@prueba.test" }).returning({ id: schema.users.id });
      userId = nu!.id;
    }
    const rows = await getDb()
      .insert(schema.brollClips)
      .values([1, 2, 3].map((i) => ({ title: `Clip ${i}`, fileKey: `editor/biblioteca/prueba-${i}/clip.mp4`, status: "READY" as const })))
      .returning({ id: schema.brollClips.id });
    clipIds.push(...rows.map((r) => r.id));
  });
  after(async () => {
    await getDb().delete(schema.brollClips).where(inArray(schema.brollClips.id, clipIds));
    await getDb().execute(sql`delete from library_folders`);
    await getDb().delete(schema.users).where(eq(schema.users.id, "prueba-carpetas"));
  });

  test("crea carpetas anidadas y no repite nombres entre hermanas", async () => {
    const oficina = await f.createFolder({ name: "  Oficina  ", parentId: null, userId });
    assert.equal(oficina.name, "Oficina");
    await f.createFolder({ name: "Noche", parentId: oficina.id, userId });
    await assert.rejects(f.createFolder({ name: "oficina", parentId: null, userId }), (e: unknown) => e instanceof LibraryError && /Ya hay una carpeta/.test(e.message));
    // El mismo nombre en otra carpeta sí se puede.
    await f.createFolder({ name: "Noche", parentId: null, userId });
    await assert.rejects(f.createFolder({ name: "   ", parentId: null, userId }), LibraryError);
  });

  test("mueve piezas y las cuenta por carpeta", async () => {
    const [oficina] = (await f.listFolders()).filter((x) => x.name === "Oficina");
    assert.equal(await f.moveClips([clipIds[0]!, clipIds[1]!], oficina!.id), 2);
    assert.equal(await folderOf(clipIds[0]!), oficina!.id);
    const after = await f.listFolders();
    assert.equal(after.find((x) => x.id === oficina!.id)?.clips, 2);
    assert.equal(await f.moveClips([clipIds[1]!], null), 1);
    assert.equal(await folderOf(clipIds[1]!), null);
  });

  test("una carpeta no puede ir dentro de sí misma ni de una hija", async () => {
    const all = await f.listFolders();
    const oficina = all.find((x) => x.name === "Oficina")!;
    const noche = all.find((x) => x.name === "Noche" && x.parentId === oficina.id)!;
    await assert.rejects(f.moveFolder(oficina.id, oficina.id), LibraryError);
    await assert.rejects(f.moveFolder(oficina.id, noche.id), LibraryError);
  });

  test("tiene un límite de profundidad", async () => {
    let parent: string | null = null;
    const made: string[] = [];
    for (let i = 0; i < f.MAX_DEPTH; i++) {
      const c = await f.createFolder({ name: `Nivel ${i}`, parentId: parent, userId });
      made.push(c.id);
      parent = c.id;
    }
    await assert.rejects(f.createFolder({ name: "Demasiado", parentId: parent, userId }), /niveles/);
    for (const id of made.reverse()) await f.deleteFolder(id);
  });

  test("borrar una carpeta no borra piezas: suben, igual que las subcarpetas (sin choques de nombre)", async () => {
    const all = await f.listFolders();
    const oficina = all.find((x) => x.name === "Oficina")!;
    const noche = all.find((x) => x.name === "Noche" && x.parentId === oficina.id)!;
    await f.moveClips([clipIds[2]!], noche.id);
    const out = await f.deleteFolder(oficina.id);
    assert.equal(out.moved, 1, "la pieza de Oficina sube a la raíz");
    assert.equal(await folderOf(clipIds[0]!), null);
    assert.equal(await folderOf(clipIds[2]!), noche.id, "la de la subcarpeta sigue en su subcarpeta");
    const now = await f.listFolders();
    const moved = now.find((x) => x.id === noche.id)!;
    assert.equal(moved.parentId, null);
    assert.equal(moved.name, "Noche (2)", "ya había otra «Noche» en la raíz");
    const left = await getDb().select().from(schema.brollClips).where(inArray(schema.brollClips.id, clipIds));
    assert.equal(left.length, 3, "no se borró ninguna pieza");
  });
});
