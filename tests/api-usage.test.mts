/**
 * Prueba del registro de consumo de IA (lib/ai/usage.ts y lib/ai/client.ts): cada llamada deja una fila en api_usage
 * con su paso, su usuario, su video, su duración, los cuatro tipos de tokens y el costo con los precios oficiales.
 *   TEST_DATABASE_URL=postgres://... pnpm test:consumo
 * Nunca la corras contra la base de un cliente: borra api_usage.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba del consumo.");
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
  ANTHROPIC_API_KEY: "sk-ant-api03-prueba",
});

// Simulador de la API de Anthropic (streaming): responde según la tarea, con un consumo conocido.
const { createServer } = await import("node:http");
const sim = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const task = JSON.stringify(JSON.parse(body).messages);
    const text = task.includes("ROTO") ? "esto no es json" : '{"ok":true}';
    const stop = task.includes("LARGO") ? "max_tokens" : "end_turn";
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 4000, cache_creation_input_tokens: 500 } } }) +
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) +
        ev("content_block_stop", { index: 0 }) +
        ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 300 } }) +
        ev("message_stop", {}),
    );
  });
});
await new Promise<void>((r) => sim.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(sim.address() as { port: number }).port}`;

const { getDb, schema } = await import("../lib/db");
const { recordUsage, withUsageScope } = await import("../lib/ai/usage");
const { generateStructured, withAiScope } = await import("../lib/ai/client");
const { costOf } = await import("../lib/ai/pricing");
const { z } = await import("zod");
const { eq, sql } = await import("drizzle-orm");

const VIDEO = "22222222-2222-2222-2222-222222222222";
let userId = "";

describe("registro de consumo (api_usage)", () => {
  before(async () => {
    const db = getDb();
    await db.execute(sql`delete from api_usage`);
    const [u] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    assert.ok(u, "la base de prueba necesita al menos un usuario");
    userId = u.id;
    await db.execute(sql`delete from video_projects where id = ${VIDEO}`);
    await db.insert(schema.videoProjects).values({ id: VIDEO, title: "Prueba", createdBy: userId, media: { duration: 90 } });
  });
  after(async () => {
    await getDb().execute(sql`delete from api_usage`);
    await getDb().execute(sql`delete from video_projects where id = ${VIDEO}`);
  });

  test("guarda los cuatro tokens, el costo oficial, el video, su duración y quien lo creó", async () => {
    await recordUsage({ step: "video.compos.codigo", model: "claude-opus-5-5", videoProjectId: VIDEO, usage: { input_tokens: 2000, output_tokens: 10_000, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1000 } });
    const [row] = await getDb().select().from(schema.apiUsage).where(eq(schema.apiUsage.step, "video.compos.codigo"));
    assert.equal(row!.inputTokens, 2000);
    assert.equal(row!.cacheReadTokens, 5000);
    assert.equal(row!.cacheWriteTokens, 1000);
    assert.equal(row!.outputTokens, 10_000);
    // Opus 5.5: 4 entrada, 20 salida, 0,20 lectura de caché y 8 escritura de 1 h por millón.
    assert.equal(row!.costUsd, (2000 * 4 + 10_000 * 20 + 5000 * 0.2 + 1000 * 8) / 1e6);
    assert.equal(row!.costUsd, costOf("claude-opus-5-5", { input: 2000, output: 10_000, cacheRead: 5000, cacheWrite: 1000 }));
    assert.equal(row!.videoDurationSec, 90);
    assert.equal(row!.userId, userId);
    assert.equal(row!.status, "ok");
  });

  test("el ámbito pone el pedido y el usuario a todo lo que se llama adentro", async () => {
    await withUsageScope({ videoProjectId: VIDEO, requestId: "w123", userId }, () =>
      recordUsage({ step: "video.compos.mirar", model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 50 }, status: "truncada" }),
    );
    const [row] = await getDb().select().from(schema.apiUsage).where(eq(schema.apiUsage.step, "video.compos.mirar"));
    assert.equal(row!.requestId, "w123");
    assert.equal(row!.videoId, VIDEO);
    assert.equal(row!.status, "truncada");
  });

  test("el cliente de Claude registra cada llamada por el mismo camino (respuesta simulada)", async () => {
    await withAiScope(VIDEO, () => generateStructured({ feature: "video.chat", context: "reglas", task: "hola", schema: z.object({ ok: z.boolean() }), fake: () => ({ ok: true }) }), { userId });
    const [row] = await getDb().select().from(schema.apiUsage).where(eq(schema.apiUsage.step, "video.chat"));
    assert.equal(row!.provider, "simulado");
    assert.equal(row!.videoId, VIDEO);
    assert.equal(row!.userId, userId);
    assert.ok(row!.costUsd > 0);
  });

  test("con la API real: registra la llamada que salió bien, la cortada y la que no se pudo leer", async () => {
    process.env.AI_FAKE = "0";
    try {
      const ask = (task: string) => generateStructured({ feature: "prueba.api", context: "reglas", task, schema: z.object({ ok: z.boolean() }), userId });
      assert.deepEqual(await ask("normal"), { ok: true });
      await assert.rejects(ask("LARGO"));
      await assert.rejects(ask("ROTO"));
    } finally {
      process.env.AI_FAKE = "1";
      sim.close();
    }
    const rows = await getDb().select().from(schema.apiUsage).where(eq(schema.apiUsage.step, "prueba.api"));
    assert.deepEqual(rows.map((r) => r.status).sort(), ["error_lectura", "ok", "truncada"]);
    for (const r of rows) {
      assert.equal(r.inputTokens, 1000);
      assert.equal(r.cacheReadTokens, 4000);
      assert.equal(r.cacheWriteTokens, 500);
      assert.equal(r.outputTokens, 300);
      assert.equal(r.costUsd, costOf("claude-sonnet-5-5", { input: 1000, output: 300, cacheRead: 4000, cacheWrite: 500 }));
    }
  });

  test("si no se puede guardar, no rompe la llamada", async () => {
    await recordUsage({ step: "x", model: "claude-haiku-5-5", videoProjectId: "no-es-un-uuid", usage: {} });
  });
});
