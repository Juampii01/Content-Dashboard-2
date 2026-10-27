/**
 * Piezas largas y animaciones que se cortan (lib/video/compos/work.ts, long-cost.ts): el código se escribe en el worker
 * con un tope alto, una respuesta cortada nunca se repite igual (como mucho un reintento, con más espacio) y todo lo que
 * se cobra queda en api_usage y en lo usado del pedido.
 *
 * Con un simulador de la API de Anthropic (streaming, ANTHROPIC_BASE_URL): la app hace sus llamadas contra él y la
 * prueba hace de worker (pide la llamada con remoteCallBody, igual que /api/worker/projects/<id>/ia, y devuelve el
 * resultado con el paso "compos-ai-done").
 *   TEST_DATABASE_URL=postgres://... pnpm test:largas
 * Nunca la corras contra la base de un cliente: crea y borra un video de prueba y sus filas de api_usage.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba de las piezas largas.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: url,
  DATABASE_URL_UNPOOLED: url,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  CRON_SECRET: "y".repeat(40),
  APP_TIMEZONE: "America/Mexico_City",
  AI_FAKE: "0",
  NODE_ENV: "test",
  ANTHROPIC_API_KEY: "sk-ant-api03-prueba",
});

// ─── Simulador de la API (SSE) ─────────────────────────────────────────────

type Reply = { stop: "end_turn" | "max_tokens"; text: string; output: number };
const replies: Reply[] = [];
const seen: { max_tokens: number; model: string }[] = [];
const { createServer } = await import("node:http");
const sim = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sent = JSON.parse(body) as { max_tokens: number; model: string };
    seen.push({ max_tokens: sent.max_tokens, model: sent.model });
    const r = replies.shift() ?? { stop: "end_turn", text: "{}", output: 10 };
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: sent.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9000, output_tokens: 1, cache_read_input_tokens: 17000, cache_creation_input_tokens: 0 } } }) +
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: r.text } }) +
        ev("content_block_stop", { index: 0 }) +
        ev("message_delta", { delta: { stop_reason: r.stop, stop_sequence: null }, usage: { output_tokens: r.output } }) +
        ev("message_stop", {}),
    );
  });
});
await new Promise<void>((r) => sim.listen(0, r));
const BASE = `http://127.0.0.1:${(sim.address() as { port: number }).port}`;
process.env.ANTHROPIC_BASE_URL = BASE;

const { getDb, schema } = await import("../lib/db");
const { eq, inArray, sql } = await import("drizzle-orm");
const { advanceWork, newTask, newWorkId, remoteCallBody } = await import("../lib/video/compos/work");
const { requestEstimate } = await import("../lib/video/compos/requests");
const { fakeCode } = await import("../lib/video/compos/fake");
const { assemblePlan } = await import("../lib/video/plan");
const { costOf } = await import("../lib/ai/pricing");
const { longCodeCost, longCodeReserve, MAX_OUTPUT_TOKENS, workerMaxTokens } = await import("../lib/video/compos/long-cost");

type Work = import("../lib/video/compos/work").ComposWork;

const db = getDb();
const PID = "33333333-3333-4333-8333-333333333333";
const made: string[] = [];
let userId = "";

/** Un código válido (el de un ejemplo de calidad) en el JSON que devuelve Claude. */
const goodCode = JSON.stringify(fakeCode({ brief: "Una cifra grande que crece", said: "", base: null, request: null, attempt: 0, hasImage: false }));

const opus = (output: number) => costOf("claude-opus-5-5", { input: 9000, output, cacheRead: 17000, cacheWrite: 0 });

async function row(id: string) {
  const [r] = await db.select().from(schema.composRequests).where(eq(schema.composRequests.id, id));
  return { ...r!, work: r!.work as unknown as Work };
}

/** Un pedido del Estudio que ya está por escribir el código (sin plan ni revisión con cuadros). */
async function request(input: { long: boolean }): Promise<string> {
  const task = input.long
    ? newTask({ from_word: 0, to_word: 119, brief: "Pieza única para todo el video con dos escenas.", source: "user", request: "Animar todo" })
    : newTask({ from_word: 10, to_word: 20, brief: "Una cifra grande que crece", source: "user", request: "Una cifra grande" });
  task.status = "code";
  if (input.long) {
    task.long = true;
    task.scenes = [
      { title: "Inicio", start: 0, end: 30, brief: "Título grande" },
      { title: "Cierre", start: 30, end: 60, brief: "La cifra" },
    ];
  }
  const work: Work = { id: newWorkId(), mode: "request", tasks: [task], startedAt: new Date().toISOString(), spentAtStart: 0, lookRounds: 0, done: false, request: null };
  const reserved = requestEstimate({ plan: false, lookRounds: 0, longSeconds: input.long ? 60 : null });
  work.reservedUsd = reserved;
  work.usedUsd = 0;
  await db.insert(schema.composRequests).values({ id: work.id, projectId: PID, status: "running", work: work as unknown as Record<string, unknown>, reservedUsd: reserved, createdBy: userId });
  made.push(work.id);
  return work.id;
}

/** Hace de worker: pide la llamada (lo mismo que /api/worker/projects/<id>/ia), la hace contra el simulador y la devuelve. */
async function asWorker(workId: string, next: { step: string; taskId?: string; call?: string }) {
  assert.equal(next.step, "compos-ai");
  const req = await remoteCallBody(PID, { workId, taskId: next.taskId!, call: next.call! });
  const res = await fetch(`${BASE}/v1/messages`, { method: "POST", body: JSON.stringify({ ...req.body, stream: true }) });
  let text = "";
  let stop: string | null = null;
  const usage: Record<string, number> = {};
  for (const block of (await res.text()).split("\n\n")) {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    if (!data) continue;
    const e = JSON.parse(data.slice(5)) as { type: string; message?: { usage: Record<string, number> }; delta?: { text?: string; stop_reason?: string }; usage?: Record<string, number> };
    if (e.type === "message_start") Object.assign(usage, e.message!.usage);
    if (e.type === "content_block_delta") text += e.delta?.text ?? "";
    if (e.type === "message_delta") {
      stop = e.delta?.stop_reason ?? null;
      Object.assign(usage, e.usage);
    }
  }
  const r = await advanceWork(PID, { step: "compos-ai-done", workId, remote: { taskId: next.taskId!, call: next.call!, result: { stop_reason: stop, text, usage } } });
  return { req, r };
}

const usageRows = (workId: string) => db.select().from(schema.apiUsage).where(eq(schema.apiUsage.requestId, workId));

describe("piezas largas: el código se escribe entero y una respuesta cortada no se repite igual", () => {
  before(async () => {
    const [u] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    assert.ok(u, "la base de prueba necesita al menos un usuario");
    userId = u.id;
    await db.execute(sql`delete from video_projects where id = ${PID}`);
    // 120 palabras en 60 s.
    const words = Array.from({ length: 120 }, (_, i) => ({ id: i, text: i % 7 === 3 ? "45%" : `palabra${i}`, start: i * 0.5, end: i * 0.5 + 0.42 }));
    const plan = assemblePlan({ ai: null, candidates: [], words, duration: 60, format: "9:16", preset: "clasico", corrections: {}, offScript: [] });
    await db.insert(schema.videoProjects).values({
      id: PID,
      title: "piezas-largas-test",
      createdBy: userId,
      status: "AWAITING_REVIEW",
      aiBudgetUsd: 20,
      media: { duration: 60, width: 1080, height: 1920, fps: 30 },
      transcript: { version: 1, provider: "prueba", language: "es", duration: 60, words },
      plan,
    } as typeof schema.videoProjects.$inferInsert);
  });
  after(async () => {
    if (made.length) {
      await db.delete(schema.apiUsage).where(inArray(schema.apiUsage.requestId, made));
      await db.delete(schema.composRequests).where(inArray(schema.composRequests.id, made));
    }
    await db.execute(sql`delete from video_projects where id = ${PID}`);
    sim.close();
  });

  test("los números: una pieza de 60 s espera ~38 mil tokens y reserva lo peor (su tope de 64 mil)", () => {
    assert.equal(workerMaxTokens(60), 64_000);
    assert.equal(workerMaxTokens(180), MAX_OUTPUT_TOKENS);
    assert.ok(longCodeCost(60) > 0.7 && longCodeCost(60) < 0.9, `60 s: USD ${longCodeCost(60)}`);
    assert.ok(longCodeReserve(60) > longCodeCost(60));
    // La reserva de un pedido de pieza larga ya no es la de una animación corta (USD 0,40 de código).
    assert.ok(requestEstimate({ plan: true, lookRounds: 1, longSeconds: 60 }) > requestEstimate({ plan: true, lookRounds: 1 }) + 1);
  });

  test("una animación corta que se corta en la app pasa al worker con más espacio y termina completa", async () => {
    const id = await request({ long: false });
    seen.length = 0;
    replies.push({ stop: "max_tokens", text: '{"name":"Cifra","code":"export default {', output: 32_000 });
    const first = await advanceWork(PID, { step: "compos", workId: id });
    assert.equal(first.next?.step, "compos", "la llamada cortada no termina la tarea");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.max_tokens, 32_000, "en la app, el tope de siempre");
    let r = await row(id);
    assert.equal(r.work.tasks[0]!.remote, true);
    assert.equal(r.work.tasks[0]!.status, "code");
    assert.ok(Math.abs((r.work.usedUsd ?? 0) - opus(32_000)) < 0.002, "lo cortado se carga al pedido");

    // El siguiente paso no llama en la app: le pide la llamada al worker, con la reserva ampliada para pagarla.
    const second = await advanceWork(PID, { step: "compos", workId: id });
    assert.equal(seen.length, 1);
    r = await row(id);
    assert.ok(r.reservedUsd > requestEstimate({ plan: false, lookRounds: 0 }), `reserva ${r.reservedUsd}`);
    replies.push({ stop: "end_turn", text: goodCode, output: 41_000 });
    const { req, r: done } = await asWorker(id, second.next as { step: string; taskId: string; call: string });
    assert.equal((req.body as { max_tokens: number }).max_tokens, 64_000);
    assert.equal((req.body as { model: string }).model, "claude-opus-5-5");
    assert.equal(done.next?.step, "compos");

    r = await row(id);
    const task = r.work.tasks[0]!;
    assert.equal(task.status, "done", task.error ?? "");
    assert.ok(task.result?.checked, "el código pasó la validación");
    assert.equal(task.remoteCall, null);
    // El consumo: las dos llamadas en api_usage, con su estado y el costo oficial, y lo mismo en lo usado del pedido.
    const rows = await usageRows(id);
    assert.deepEqual(rows.map((x) => x.status).sort(), ["ok", "truncada"]);
    const ok = rows.find((x) => x.status === "ok")!;
    assert.equal(ok.step, "video.compos.codigo");
    assert.equal(ok.outputTokens, 41_000);
    assert.equal(ok.costUsd, opus(41_000));
    assert.equal(ok.videoId, PID);
    assert.equal(ok.userId, userId);
    assert.ok(Math.abs((r.work.usedUsd ?? 0) - (opus(32_000) + opus(41_000))) < 0.002, `usado ${r.work.usedUsd}`);
    assert.equal((await advanceWork(PID, { step: "compos", workId: id })).finished, true);
    assert.equal((await row(id)).status, "done");
  });

  test("una pieza larga va directo al worker; si se corta, un solo reintento con el máximo del modelo", async () => {
    const id = await request({ long: true });
    seen.length = 0;
    const first = await advanceWork(PID, { step: "compos", workId: id });
    assert.equal(seen.length, 0, "no se llama en la app (pasaría los 13 minutos)");
    replies.push({ stop: "max_tokens", text: '{"name":"Pieza","code":"', output: 64_000 });
    const a = await asWorker(id, first.next as { step: string; taskId: string; call: string });
    assert.equal((a.req.body as { max_tokens: number }).max_tokens, 64_000);
    assert.equal((await row(id)).work.tasks[0]!.status, "code");

    const second = await advanceWork(PID, { step: "compos", workId: id });
    replies.push({ stop: "end_turn", text: goodCode, output: 90_000 });
    const b = await asWorker(id, second.next as { step: string; taskId: string; call: string });
    assert.equal((b.req.body as { max_tokens: number }).max_tokens, MAX_OUTPUT_TOKENS, "el reintento tiene más espacio");
    const r = await row(id);
    const task = r.work.tasks[0]!;
    assert.equal(task.status, "done", task.error ?? "");
    assert.equal(task.result?.long, true);
    assert.equal(task.result?.scenes?.length, 2);
    assert.ok(task.result?.checked);
    const rows = await usageRows(id);
    assert.deepEqual(rows.map((x) => x.status).sort(), ["ok", "truncada"]);
    assert.ok(Math.abs((r.work.usedUsd ?? 0) - (opus(64_000) + opus(90_000))) < 0.002, "el tope refleja el costo real");
    assert.ok(r.reservedUsd >= (r.work.usedUsd ?? 0), "la reserva cubre lo gastado");
  });

  test("si se corta también con el máximo, queda sin hacer con el motivo y no se llama otra vez", async () => {
    const id = await request({ long: true });
    seen.length = 0;
    const first = await advanceWork(PID, { step: "compos", workId: id });
    replies.push({ stop: "max_tokens", text: "{", output: 64_000 });
    await asWorker(id, first.next as { step: string; taskId: string; call: string });
    const second = await advanceWork(PID, { step: "compos", workId: id });
    replies.push({ stop: "max_tokens", text: "{", output: MAX_OUTPUT_TOKENS });
    await asWorker(id, second.next as { step: string; taskId: string; call: string });
    const r = await row(id);
    assert.equal(r.work.tasks[0]!.status, "failed");
    assert.match(r.work.tasks[0]!.error ?? "", /más larga de lo que la IA puede escribir/);
    assert.equal(seen.length, 2, "dos llamadas en total: la primera y un solo reintento");
    assert.equal((await advanceWork(PID, { step: "compos", workId: id })).finished, true);
    assert.equal(seen.length, 2);
    assert.equal((await row(id)).status, "failed");
    assert.equal((await usageRows(id)).filter((x) => x.status === "truncada").length, 2);
  });

  test("sin tope para pagar lo que pide la pieza, no se llama y se dice cuánto cuesta", async () => {
    const id = await request({ long: true });
    await db.update(schema.videoProjects).set({ aiBudgetUsd: 1 }).where(eq(schema.videoProjects.id, PID));
    await db.update(schema.composRequests).set({ reservedUsd: 0.2, work: sql`jsonb_set(work, '{reservedUsd}', '0.2')` }).where(eq(schema.composRequests.id, id));
    seen.length = 0;
    try {
      await advanceWork(PID, { step: "compos", workId: id });
    } finally {
      await db.update(schema.videoProjects).set({ aiBudgetUsd: 20 }).where(eq(schema.videoProjects.id, PID));
    }
    const r = await row(id);
    assert.equal(r.work.tasks[0]!.status, "failed");
    assert.match(r.work.tasks[0]!.error ?? "", /No alcanza el tope de IA/);
    assert.equal(seen.length, 0);
  });
});
