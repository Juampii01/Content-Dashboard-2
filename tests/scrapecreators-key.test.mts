/**
 * Prueba de la clave de ScrapeCreators (lib/scrapecreators/key.ts y /api/worker/scrapecreators): se guarda cifrada
 * con su propio contexto, se prueba sin red (ScrapeCreators simulado), se borra y el worker solo la recibe para un
 * trabajo en curso que baja links.
 *   TEST_DATABASE_URL=postgres://... pnpm test:scrapecreators
 * Nunca la corras contra la base de un cliente: borra la clave de ScrapeCreators guardada.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba de la clave de ScrapeCreators.");
  process.exit(0);
}
const WORKER_SECRET = "w".repeat(40);
Object.assign(process.env, {
  DATABASE_URL: url,
  DATABASE_URL_UNPOOLED: url,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  CRON_SECRET: "y".repeat(40),
  WORKER_SECRET,
  NODE_ENV: "test",
});

const { getDb, schema } = await import("../lib/db");
const { decryptSecret } = await import("../lib/crypto");
const key = await import("../lib/scrapecreators/key");
const { POST } = await import("../app/api/worker/scrapecreators/route");
const { eq, inArray } = await import("drizzle-orm");

// Clave falsa con la forma de una real: nunca una clave de verdad en las pruebas.
const FAKE_KEY = "prueba_FALSA_0123456789abcdef";
const calls: { url: string; key: string | null }[] = [];
function fakeApi(status = 200, body: unknown = { success: true, credits_remaining: 1234 }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), key: new Headers(init?.headers).get("x-api-key") });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const row = async () => (await getDb().select().from(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "SCRAPECREATORS")))[0];
const jobIds: string[] = [];
async function job(type: (typeof schema.jobTypeEnum.enumValues)[number], status: "RUNNING" | "SUCCEEDED" = "RUNNING") {
  const [j] = await getDb().insert(schema.jobs).values({ type, status, input: { url: "https://www.instagram.com/reel/PRUEBA/" } }).returning({ id: schema.jobs.id });
  jobIds.push(j.id);
  return j.id;
}
const ask = (jobId: string, secret = WORKER_SECRET) =>
  POST(new Request("http://localhost/api/worker/scrapecreators", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ jobId }) }));

describe("clave de ScrapeCreators", () => {
  beforeEach(async () => {
    calls.length = 0;
    await key.removeScrapeCreatorsKey();
  });
  after(async () => {
    await key.removeScrapeCreatorsKey();
    if (jobIds.length) await getDb().delete(schema.jobs).where(inArray(schema.jobs.id, jobIds));
  });

  test("guarda la clave cifrada con su contexto, solo con los últimos 4 a la vista", async () => {
    const saved = await key.saveScrapeCreatorsKey(`  SCRAPECREATORS_API_KEY="${FAKE_KEY}"  `, null, fakeApi());
    assert.deepEqual(saved, { label: "cdef", credits: 1234 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.scrapecreators.com/v1/account/credit-balance");
    assert.equal(calls[0].key, FAKE_KEY);
    const r = await row();
    assert.ok(r);
    assert.ok(!r.secretEnc.includes(FAKE_KEY), "nunca en texto plano");
    assert.equal(decryptSecret(r.secretEnc, "scrapecreators.api_key"), FAKE_KEY);
    assert.throws(() => decryptSecret(r.secretEnc, "anthropic.api_key"), "otro contexto no la descifra");
    assert.equal(await key.readScrapeCreatorsKey(), FAKE_KEY);
    assert.deepEqual({ ...(await key.scrapeCreatorsKeyStatus()), updatedAt: null }, { configured: true, label: "cdef", updatedAt: null });
  });

  test("reemplazar deja una sola fila con la clave nueva", async () => {
    await key.saveScrapeCreatorsKey(FAKE_KEY, null, fakeApi());
    await key.saveScrapeCreatorsKey("otra_clave_FALSA_9876543210", null, fakeApi());
    const rows = await getDb().select().from(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "SCRAPECREATORS"));
    assert.equal(rows.length, 1);
    assert.equal(await key.readScrapeCreatorsKey(), "otra_clave_FALSA_9876543210");
  });

  test("una clave que ScrapeCreators rechaza no se guarda", async () => {
    await assert.rejects(key.saveScrapeCreatorsKey(FAKE_KEY, null, fakeApi(401, { success: false })), /no aceptó esa clave/);
    assert.equal(await row(), undefined);
  });

  test("una clave con forma rara se frena sin llamar a ScrapeCreators", async () => {
    await assert.rejects(key.saveScrapeCreatorsKey("hola mundo!", null, fakeApi()), key.ScrapeCreatorsKeyError);
    assert.equal(calls.length, 0);
  });

  test("Probar usa la clave guardada y no gasta créditos (saldo de la cuenta)", async () => {
    await assert.rejects(key.testSavedScrapeCreatorsKey(fakeApi()), /Todavía no hay/);
    await key.saveScrapeCreatorsKey(FAKE_KEY, null, fakeApi());
    assert.equal(await key.testSavedScrapeCreatorsKey(fakeApi(200, { creditCount: 77 })), 77);
    assert.ok(calls.every((c) => c.url.endsWith("/v1/account/credit-balance")));
  });

  test("quitar la borra", async () => {
    await key.saveScrapeCreatorsKey(FAKE_KEY, null, fakeApi());
    await key.removeScrapeCreatorsKey();
    assert.equal(await row(), undefined);
    assert.equal(await key.readScrapeCreatorsKey(), null);
  });

  test("el worker la recibe solo para un trabajo en curso que baja links", async () => {
    const look = await job("VIDEO_LOOK");
    let res = await ask(look);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { apiKey: null }, "sin clave: null y el worker dice qué hacer");

    await key.saveScrapeCreatorsKey(FAKE_KEY, null, fakeApi());
    res = await ask(look);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { apiKey: FAKE_KEY });

    assert.equal((await ask(look, "z".repeat(40))).status, 401);
    assert.equal((await ask(await job("VIDEO_LOOK", "SUCCEEDED"))).status, 409);
    assert.equal((await ask(await job("CAROUSEL_IMAGES"))).status, 404);
    assert.equal((await ask("no-es-un-id")).status, 400);
  });
});
