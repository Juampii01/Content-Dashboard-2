/**
 * «Animar todo» una sola vez por video (lib/video/compos/requests.ts): una pieza de todo el video no puede lanzarse
 * encima de otra que ya está en espera, en cola o corriendo. En producción se crearon tres en 70 s y se pagaron las tres.
 *   TEST_DATABASE_URL=postgres://... pnpm test:animar-todo
 * Nunca la corras contra la base de un cliente: crea y borra proyectos, pedidos y trabajos de prueba.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba de «Animar todo» una sola vez.");
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
const { enqueueRequest, activeLongRequest, cancelRequest, LONG_BUSY_MESSAGE } = await import("../lib/video/compos/requests");
const { eq, and, inArray } = await import("drizzle-orm");

let projectId = "";
let n = 0;
/** Un taller mínimo: una tarea, larga (pieza de todo el video) o no. */
const work = (long: boolean) => () =>
  ({ id: `prueba${Date.now().toString(36)}${n++}`, mode: "request", tasks: [{ id: `t${n}`, long, status: "plan", images: [] }], startedAt: new Date().toISOString(), spentAtStart: 0, lookRounds: 0, done: false }) as never;
const ask = (long: boolean, exclusiveLong = long) => enqueueRequest({ projectId, userId: null, cap: 50, spent: 0, needsPlan: true, longSeconds: long ? 60 : null, exclusiveLong, build: work(long) });
const live = async () =>
  getDb()
    .select({ id: schema.composRequests.id })
    .from(schema.composRequests)
    .where(and(eq(schema.composRequests.projectId, projectId), inArray(schema.composRequests.status, ["waiting", "queued", "running"])));

describe("«Animar todo» una sola vez por video", () => {
  before(async () => {
    const [p] = await getDb().insert(schema.videoProjects).values({ title: "Prueba animar todo", status: "AWAITING_REVIEW" }).returning({ id: schema.videoProjects.id });
    projectId = p!.id;
  });
  after(async () => {
    const db = getDb();
    await db.delete(schema.composRequests).where(eq(schema.composRequests.projectId, projectId));
    await db.delete(schema.jobs).where(eq(schema.jobs.videoProjectId, projectId));
    await db.delete(schema.videoProjects).where(eq(schema.videoProjects.id, projectId));
  });

  test("tres clics casi juntos crean una sola pieza y avisan en las otras dos", async () => {
    const out = await Promise.all([ask(true), ask(true), ask(true)]);
    const created = out.filter((r) => !r.busy && !r.error);
    const busy = out.filter((r) => r.busy);
    assert.equal(created.length, 1, "se crea una sola");
    assert.equal(busy.length, 2, "las otras dos no se crean");
    for (const b of busy) {
      assert.equal(b.error, LONG_BUSY_MESSAGE);
      assert.equal(b.workId, created[0]!.workId, "devuelve la que está en curso");
    }
    assert.equal((await live()).length, 1);
    const jobs = await getDb().select().from(schema.jobs).where(eq(schema.jobs.videoProjectId, projectId));
    assert.equal(jobs.length, 1, "un solo trabajo en la cola del worker");
    assert.equal(await activeLongRequest(projectId), created[0]!.workId);
  });

  test("una animación de un momento sí se puede pedir mientras corre la pieza larga", async () => {
    const r = await ask(false);
    assert.equal(r.busy, undefined);
    assert.equal(r.error, null);
  });

  test("con la cola llena (en espera) también se bloquea la segunda pieza", async () => {
    const r = await enqueueRequest({ projectId, userId: null, cap: 50, spent: 0, needsPlan: true, wait: true, exclusiveLong: true, build: work(true) });
    assert.equal(r.busy, true);
  });

  test("después de cancelar la pieza larga, se puede volver a pedir", async () => {
    const id = await activeLongRequest(projectId);
    assert.ok(id);
    assert.equal(await cancelRequest(projectId, id), true);
    assert.equal(await activeLongRequest(projectId), null);
    const r = await ask(true);
    assert.equal(r.busy, undefined);
    assert.equal(r.error, null);
  });
});
