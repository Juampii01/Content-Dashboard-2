/**
 * Prueba de las versiones del plan (lib/video/versions.ts): antes de un cambio de la IA queda el plan anterior, volver
 * a una versión guarda primero la actual, nada se borra y no se vuelve mientras la IA trabaja.
 *   TEST_DATABASE_URL=postgres://... pnpm test:versiones
 * Nunca la corras contra la base de un cliente: crea y borra un video de prueba.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba de las versiones.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: url,
  DATABASE_URL_UNPOOLED: url,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  CRON_SECRET: "y".repeat(40),
});

const { getDb, schema } = await import("../lib/db");
const { snapshotPlan, listVersions, restoreVersion } = await import("../lib/video/versions");
const { eq } = await import("drizzle-orm");
const { readFileSync } = await import("node:fs");

const ID = "55555555-5555-5555-5555-555555555555";
const planA = { version: 2, marca: "A", removals: [] };
const planB = { version: 2, marca: "B (la IA cortó casi todo)", removals: [[0, 500]] };
const planOf = async () => (await getDb().select({ plan: schema.videoProjects.plan }).from(schema.videoProjects).where(eq(schema.videoProjects.id, ID)))[0]!.plan as { marca: string };

describe("versiones del plan", () => {
  before(async () => {
    await getDb().delete(schema.videoProjects).where(eq(schema.videoProjects.id, ID));
    await getDb().insert(schema.videoProjects).values({ id: ID, title: "Prueba versiones", plan: planA, status: "AWAITING_REVIEW" });
  });
  after(async () => {
    await getDb().delete(schema.videoProjects).where(eq(schema.videoProjects.id, ID));
  });

  test("antes del cambio de la IA queda el plan que había (y no se repite si no cambió)", async () => {
    await snapshotPlan(ID, { label: "Antes de: acorta todo", source: "ia" });
    await snapshotPlan(ID, { label: "Antes de: otra vez", source: "ia" });
    const versions = await listVersions(ID);
    assert.equal(versions.length, 1);
    assert.equal(versions[0]!.label, "Antes de: acorta todo");
  });

  test("volver a una versión recupera el trabajo y guarda la actual (se puede deshacer)", async () => {
    await getDb().update(schema.videoProjects).set({ plan: planB }).where(eq(schema.videoProjects.id, ID));
    const [v] = await listVersions(ID);
    await restoreVersion(ID, v!.id, null);
    assert.equal((await planOf()).marca, "A");
    const versions = await listVersions(ID);
    assert.equal(versions.length, 2, "nada se borró");
    assert.match(versions[0]!.label, /Antes de volver/);
    // Y se puede volver a la de la IA.
    await restoreVersion(ID, versions[0]!.id, null);
    assert.equal((await planOf()).marca, "B (la IA cortó casi todo)");
  });

  test("no se vuelve mientras la IA o la exportación trabajan", async () => {
    await getDb().update(schema.videoProjects).set({ status: "PROCESSING" }).where(eq(schema.videoProjects.id, ID));
    const [v] = await listVersions(ID);
    await assert.rejects(restoreVersion(ID, v!.id, null), /Espera a que terminen/);
    await getDb().update(schema.videoProjects).set({ status: "AWAITING_REVIEW" }).where(eq(schema.videoProjects.id, ID));
  });

  test("el director guarda la versión antes de cada plan que escribe (único camino: saveDirector)", () => {
    const src = readFileSync(new URL("../lib/video/director/service.ts", import.meta.url), "utf8");
    assert.match(src, /if \(extra\.plan !== undefined\) \{[\s\S]*?snapshotPlan\(/);
    // Ninguna otra escritura del plan en el director fuera de saveDirector.
    const writes = [...src.matchAll(/\.set\(\{[^}]*\bplan\b/g)];
    assert.equal(writes.length, 0, "el director escribe el plan solo con saveDirector(…, { plan })");
  });
});
