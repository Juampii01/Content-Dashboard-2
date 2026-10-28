/**
 * Videos dentro de una animación: un pedido con un video de la biblioteca pasa por el worker (hojas de cuadros), el
 * código recibe env.clips y la animación queda con sus hojas como imágenes y el clip en `clips`.
 *   TEST_DATABASE_URL=postgres://... pnpm test:videos-dentro   (usa el video de demostración del Estudio de esa base)
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
const PID = process.env.TEST_PROJECT_ID ?? "11111111-2222-4333-8444-555555555555";
const CLIP = "cccccccc-1111-4222-8333-444444444444";

describe("videos dentro de una animación", { skip: !url && "TEST_DATABASE_URL no está definida" }, async () => {
  if (!url) return;
  Object.assign(process.env, {
    DATABASE_URL: url,
    DATABASE_URL_UNPOOLED: url,
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(40),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CRON_SECRET: "y".repeat(40),
    APP_TIMEZONE: "America/Mexico_City",
    AI_FAKE: "1",
  });
  const { getDb, schema } = await import("../lib/db");
  const { eq, inArray, and, sql } = await import("drizzle-orm");
  const { startStudioRequest, taskClips } = await import("../lib/video/compos/flows");
  const { advanceWork } = await import("../lib/video/compos/work");
  const { composEnv } = await import("../lib/video/compos/schema");
  const db = getDb();
  const [project] = await db.select().from(schema.videoProjects).where(eq(schema.videoProjects.id, PID)).limit(1);
  if (!project) {
    test("sin el video de prueba", { skip: `no está el proyecto ${PID}` }, () => undefined);
    return;
  }
  const statusBefore = project.status;
  const budgetBefore = project.aiBudgetUsd;
  const made: string[] = [];
  await db.update(schema.videoProjects).set({ status: "AWAITING_REVIEW", aiBudgetUsd: 30 }).where(eq(schema.videoProjects.id, PID));
  await db.delete(schema.brollClips).where(eq(schema.brollClips.id, CLIP));
  await db.insert(schema.brollClips).values({ id: CLIP, kind: "video", title: "Web Vauren", status: "READY", fileKey: `editor/biblioteca/${CLIP}/clip.mp4`, duration: 10.7, width: 904, height: 744, tags: ["web"] } as never);

  after(async () => {
    if (made.length) {
      await db.delete(schema.composRequests).where(inArray(schema.composRequests.id, made));
      await db.delete(schema.jobs).where(and(eq(schema.jobs.type, "VIDEO_COMPOS"), inArray(sql`${schema.jobs.input}->>'workId'`, made)));
    }
    await db.delete(schema.brollClips).where(eq(schema.brollClips.id, CLIP));
    await db.update(schema.videoProjects).set({ status: statusBefore, aiBudgetUsd: budgetBefore }).where(eq(schema.videoProjects.id, PID));
  });

  test("solo videos de la biblioteca (por id): una imagen o uno que no existe no se aceptan", async () => {
    const ok = await taskClips([CLIP]);
    assert.equal(ok.length, 1);
    assert.equal(ok[0]!.key, `editor/biblioteca/${CLIP}/clip.mp4`);
    assert.match(ok[0]!.ref, /^v[0-9a-z]{1,20}$/);
    assert.match(ok[0]!.notes ?? "", /Web Vauren/);
    await assert.rejects(taskClips(["dddddddd-1111-4222-8333-444444444444"]), /no está disponible/);
    await assert.rejects(taskClips(["no-es-un-id"]), /hasta 2 videos/);
  });

  test("el pedido pasa por el worker, el código usa env.clip y la animación queda con sus hojas", async () => {
    const { workId, error } = await startStudioRequest(PID, { from_word: 2, to_word: 14, instruction: "Pon mi web dentro de una pantalla", replace: null, clips: [CLIP] }, null);
    made.push(workId);
    assert.equal(error, null);
    let r = await advanceWork(PID, { step: "compos", workId });
    assert.equal(r.next?.step, "compos-clips", "primero, las hojas de cuadros");
    const item = (r.next as { items: { ref: string; clipId: string; key: string }[] }).items[0]!;
    assert.equal(item.clipId, CLIP);
    assert.equal(item.key, `editor/biblioteca/${CLIP}/clip.mp4`);
    // Lo que devuelve el worker: 129 cuadros (10,7 s a 12 por segundo) en 9 hojas de 4×4 de 640×526.
    const sheets = Array.from({ length: 9 }, (_, n) => ({ key: `editor/${PID}/compos/clips/${item.ref}-0${n}.jpg`, width: 2560, height: 2104 }));
    r = await advanceWork(PID, { step: "compos-clips-done", workId, results: [{ ref: item.ref, clipId: CLIP, width: 904, height: 744, duration: 10.75, fps: 12, frames: 129, cols: 4, rows: 4, frameW: 640, frameH: 526, sheets }] });
    for (let i = 0; i < 12 && r.next?.step === "compos"; i++) r = await advanceWork(PID, { step: "compos", workId });
    const [row] = await db.select().from(schema.composRequests).where(eq(schema.composRequests.id, workId)).limit(1);
    const task = (row!.work as { tasks: { result?: Record<string, unknown>; error?: string; status: string }[] }).tasks[0]!;
    assert.ok(task.result, `la animación quedó escrita (${task.status}: ${task.error ?? ""})`);
    const comp = task.result as { code: string; clips: { id: string; library_id: string; sheets: string[]; frames: number }[]; images: { id: string; key: string; sheet?: boolean }[] };
    assert.match(comp.code, /env\.clip\(0, t\)/);
    assert.equal(comp.clips.length, 1);
    assert.equal(comp.clips[0]!.library_id, CLIP);
    assert.equal(comp.clips[0]!.frames, 129);
    assert.equal(comp.clips[0]!.sheets.length, 9);
    const sheetImages = comp.images.filter((g) => g.sheet);
    assert.deepEqual(sheetImages.map((g) => g.key), sheets.map((s) => s.key));
    assert.deepEqual(comp.clips[0]!.sheets, sheetImages.map((g) => g.id));
  });

  test("las hojas no van en env.assets y el clip sí va en env.clips", () => {
    const item = { id: "cmx", from_word: 0, to_word: 3, name: "x", code: "export default { render() {} };", params: [], source: "user", images: [{ id: "gv1s0", key: "k", width: 2560, height: 2104, prompt: "Cuadros", sheet: true }], clips: [{ id: "v1", library_id: CLIP, title: "Web", width: 904, height: 744, duration: 2, fps: 12, frames: 24, cols: 4, rows: 4, frameW: 640, frameH: 526, sheets: ["gv1s0"] }] };
    const env = composEnv({ item: item as never, start: 0, end: 2, timeline: { words: [] }, format: "9:16", brand: { accent: "#000000", bg: "#000000", surface: "#000000", text: "#ffffff", muted: "#999999", accentText: "#ffffff", font: "inter" } as never, face: { x: 0, y: 0, w: 10, h: 10 }, captionsVisible: false });
    assert.equal(env.assets.length, 0);
    assert.equal(env.clips?.[0]?.sheets[0], "gv1s0");
  });
});
