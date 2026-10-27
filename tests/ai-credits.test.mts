/**
 * Prueba de los créditos de IA del mes (lib/ai/credits.ts): aviso al 80 %, freno al 100 %, tope propio por persona y
 * tope de la instalación.
 *   TEST_DATABASE_URL=postgres://... pnpm test:creditos
 * Nunca la corras contra la base de un cliente: borra api_usage, los topes y los avisos de créditos.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba de los créditos.");
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
  AI_MONTHLY_CREDIT_USD: "10",
});

const { getDb, schema } = await import("../lib/db");
const { recordUsage } = await import("../lib/ai/usage");
const { checkCredit, creditState } = await import("../lib/ai/credits");
const { AiCreditError } = await import("../lib/ai/errors");
const { generateStructured } = await import("../lib/ai/client");
const { z } = await import("zod");
const { sql, like } = await import("drizzle-orm");

let userId = "";
const spend = (usd: number, who: string | null = userId) => recordUsage({ step: "prueba", model: "claude-opus-5-5", usage: {}, userId: who, costUsd: usd });
const ask = () => generateStructured({ feature: "prueba.creditos", context: "c", task: "t", schema: z.object({ ok: z.boolean() }), fake: () => ({ ok: true }), userId });

describe("créditos de IA del mes", () => {
  before(async () => {
    const [u] = await getDb().select({ id: schema.users.id }).from(schema.users).limit(1);
    assert.ok(u, "la base de prueba necesita al menos un usuario");
    userId = u.id;
  });
  beforeEach(async () => {
    const db = getDb();
    await db.execute(sql`delete from api_usage`);
    await db.execute(sql`delete from ai_credit_limits`);
    await db.delete(schema.notifications).where(like(schema.notifications.key, "creditos%"));
  });
  after(async () => {
    await getDb().execute(sql`delete from api_usage`);
    await getDb().execute(sql`delete from ai_credit_limits`);
  });

  test("debajo del 80 %: no avisa ni frena", async () => {
    await spend(5);
    await checkCredit({ userId });
    const notes = await getDb().select().from(schema.notifications).where(like(schema.notifications.key, "creditos%"));
    assert.equal(notes.length, 0);
  });

  test("al pasar el 80 % avisa una sola vez por mes", async () => {
    await spend(8.5);
    await checkCredit({ userId });
    await checkCredit({ userId });
    await new Promise((r) => setTimeout(r, 200));
    const notes = await getDb().select().from(schema.notifications).where(like(schema.notifications.key, "creditos-80:%"));
    assert.equal(notes.length, 1);
    assert.match(notes[0]!.title, /80 %/);
  });

  test("al 100 % frena antes de llamar a la IA y lo dice en español", async () => {
    await spend(10);
    await assert.rejects(ask(), (e: unknown) => e instanceof AiCreditError && /créditos de IA del mes/.test(e.userMessage));
    const calls = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from api_usage where step = 'prueba.creditos'`);
    assert.equal(Number(calls.rows[0]!.n), 0, "no se hizo la llamada");
  });

  test("un tope propio manda sobre el de por defecto", async () => {
    await getDb().insert(schema.aiCreditLimits).values({ id: userId, monthlyUsd: 50 });
    await spend(20);
    await checkCredit({ userId });
    const st = await creditState(userId);
    assert.equal(st.limit, 50);
    assert.deepEqual(await ask(), { ok: true });
  });

  test("el tope de la instalación frena aunque la persona tenga saldo (también lo que no tiene usuario)", async () => {
    await getDb().insert(schema.aiCreditLimits).values([{ id: userId, monthlyUsd: 100 }, { id: "installation", monthlyUsd: 3 }]);
    await spend(1);
    await spend(2.5, null);
    await assert.rejects(checkCredit({ userId }), (e: unknown) => e instanceof AiCreditError && /instalación/.test(e.userMessage));
  });

  test("lo del mes pasado no cuenta", async () => {
    await spend(30);
    await getDb().execute(sql`update api_usage set created_at = now() - interval '40 days'`);
    await checkCredit({ userId });
  });
});
