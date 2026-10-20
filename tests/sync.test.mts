/**
 * Prueba de la sincronización con las tres redes simuladas (sin llamadas reales).
 * Necesita una base de prueba vacía con las migraciones aplicadas:
 *   TEST_DATABASE_URL=postgres://... pnpm test:sync
 * Nunca la corras contra la base de un cliente: borra las tablas de redes y métricas.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba de sincronización.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: url,
  DATABASE_URL_UNPOOLED: url,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  CRON_SECRET: "y".repeat(40),
  INSTAGRAM_APP_ID: "ig",
  INSTAGRAM_APP_SECRET: "igs",
  GOOGLE_CLIENT_ID: "g",
  GOOGLE_CLIENT_SECRET: "gs",
  TIKTOK_CLIENT_KEY: "tt",
  TIKTOK_CLIENT_SECRET: "tts",
});

// ─── Redes simuladas ───────────────────────────────────────────────────────
const H = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H).toISOString();
let igMedia = Array.from({ length: 70 }, (_, i) => ({
  id: `179000000000000${String(i).padStart(2, "0")}`,
  caption: `Publicación ${i}`,
  media_type: i % 3 === 0 ? "CAROUSEL_ALBUM" : "VIDEO",
  media_product_type: i % 3 === 0 ? "FEED" : "REELS",
  permalink: `https://instagram.com/p/${i}`,
  thumbnail_url: `https://cdn.example/ig/${i}.jpg`,
  timestamp: ago(10 + i * 30),
  like_count: 100 + i,
  comments_count: 5,
}));
let igInsightsFail = new Set<string>();
let igReachNull = false;
let tokenMode: "ok" | "expired" = "ok";
let calls = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls++;
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (tokenMode === "expired" && u.hostname === "graph.instagram.com") {
    return json({ error: { code: 190, error_subcode: 463, message: "expired" } }, 400);
  }
  // Instagram
  if (u.hostname === "graph.instagram.com" && u.pathname.endsWith("/me/media")) {
    const after = Number(u.searchParams.get("after") ?? 0);
    const page = igMedia.slice(after, after + 50);
    const next = after + 50 < igMedia.length;
    return json({ data: page, paging: next ? { cursors: { after: String(after + 50) }, next: "x" } : {} });
  }
  if (u.hostname === "graph.instagram.com" && /\/\d+\/insights$/.test(u.pathname)) {
    const id = u.pathname.split("/").at(-2)!;
    if (igInsightsFail.has(id)) return json({ error: { code: 100, error_subcode: 2108006, message: "before conversion" } }, 400);
    const metrics = (u.searchParams.get("metric") ?? "").split(",");
    const n = Number(id.slice(-2));
    const value = (m: string) => (m === "views" ? 1000 * (n === 8 ? 20 : 1) + n : m === "ig_reels_avg_watch_time" ? 4500 : m === "reach" && igReachNull ? undefined : 50 + n);
    return json({ data: metrics.map((m) => ({ name: m, values: value(m) === undefined ? [] : [{ value: value(m) }] })) });
  }
  if (u.hostname === "graph.instagram.com" && u.pathname.endsWith("/me/insights")) {
    if (u.searchParams.get("metric") === "follows_and_unfollows") {
      return json({ data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: ["FOLLOWER"], value: 12 }, { dimension_values: ["NON_FOLLOWER"], value: 3 }] }] } }] });
    }
    return json({ data: ["reach", "views", "accounts_engaged", "total_interactions", "profile_links_taps"].map((name) => ({ name, total_value: { value: 400 } })) });
  }
  if (u.hostname === "graph.instagram.com" && u.pathname.endsWith("/me")) {
    return new Response(`{"user_id":17841400000000123,"username":"marca","name":"Marca","account_type":"MEDIA_CREATOR","followers_count":5230,"follows_count":10,"media_count":70}`, { status: 200 });
  }
  // TikTok
  if (u.hostname === "open.tiktokapis.com" && u.pathname === "/v2/video/list/") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { cursor?: number };
    const all = Array.from({ length: 25 }, (_, i) => ({ id: `tt${i}`, title: `TikTok ${i}`, create_time: Math.floor((Date.now() - (5 + i * 20) * H) / 1000), cover_image_url: `https://cdn.example/tt/${i}.jpg`, share_url: `https://tiktok.com/${i}`, duration: 30, view_count: 2000 + i, like_count: 90, comment_count: 4, share_count: 2 }));
    const start = body.cursor ? 20 : 0;
    return json({ data: { videos: all.slice(start, start + 20), cursor: 99, has_more: start === 0 }, error: { code: "ok" } });
  }
  if (u.hostname === "open.tiktokapis.com" && u.pathname === "/v2/user/info/") {
    return json({ data: { user: { open_id: "open-1", display_name: "Marca TT", username: "marcatt", follower_count: 900, following_count: 1, likes_count: 15000, video_count: 25 } }, error: { code: "ok" } });
  }
  throw new Error(`Llamada no simulada: ${u.hostname}${u.pathname}`);
}) as typeof fetch;

// ─── Prueba ────────────────────────────────────────────────────────────────
// Los módulos se importan después de preparar el entorno.
const { getDb, schema } = await import("../lib/db");
const { encryptTokens } = await import("../lib/social/tokens");
const { syncAccount } = await import("../lib/social/sync/runner");
const { eq, sql } = await import("drizzle-orm");

const db = getDb();
let igId = "";
let ttId = "";

before(async () => {
  await db.execute(sql`truncate social_accounts, content_items, metric_snapshots, account_snapshots, sync_runs, retention_curves cascade`);
  const [ig] = await db
    .insert(schema.socialAccounts)
    .values({ platform: "INSTAGRAM", externalId: "17841400000000123", handle: "marca", ...encryptTokens("INSTAGRAM", "ig-token", null), accessTokenExpiresAt: new Date(Date.now() + 50 * 86_400_000), tokenIssuedAt: new Date(), scopes: [] })
    .returning();
  const [tt] = await db
    .insert(schema.socialAccounts)
    .values({ platform: "TIKTOK", externalId: "open-1", handle: "marcatt", ...encryptTokens("TIKTOK", "tt-token", "tt-refresh"), accessTokenExpiresAt: new Date(Date.now() + 20 * H), refreshTokenExpiresAt: new Date(Date.now() + 300 * 86_400_000), tokenIssuedAt: new Date(), scopes: [] })
    .returning();
  igId = ig!.id;
  ttId = tt!.id;
});

after(async () => {
  globalThis.fetch = realFetch;
  await (globalThis as unknown as { pool?: { end(): Promise<void> } }).pool?.end();
});

describe("sincronización", () => {
  test("backfill de Instagram: todas las piezas, tipos, métricas y puntajes", async () => {
    igInsightsFail = new Set([igMedia[69]!.id]);
    const out = await syncAccount(igId, "BACKFILL", 120_000);
    assert.equal(out.status, "SUCCEEDED");
    const items = await db.select().from(schema.contentItems).where(eq(schema.contentItems.socialAccountId, igId));
    assert.equal(items.length, 70);
    const reel = items.find((i) => i.externalId === igMedia[1]!.id)!;
    assert.equal(reel.type, "REEL");
    assert.equal(reel.avgWatchSec, 4.5, "el tiempo medio viene en ms y se guarda en segundos");
    assert.equal(items.find((i) => i.externalId === igMedia[0]!.id)!.type, "CAROUSEL");
    assert.equal(items.find((i) => i.externalId === igMedia[69]!.id)!.insightsStatus, "NOT_SUPPORTED");
    const outlier = items.find((i) => i.externalId === igMedia[8]!.id)!;
    assert.ok((outlier.perfScore ?? 0) > 10, `la pieza viral tiene puntaje alto (${outlier.perfScore})`);
    const [account] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, igId));
    assert.ok(account!.backfillCompletedAt, "el backfill queda completo");
    const days = await db.select().from(schema.accountSnapshots).where(eq(schema.accountSnapshots.socialAccountId, igId));
    // 28 días de totales + la foto de hoy. "Hoy" se cuenta en APP_TIMEZONE: según la hora en que corre la prueba,
    // puede coincidir con el último día de totales (que la API da en UTC) y entonces es la misma fila.
    assert.ok(days.length === 28 || days.length === 29, `28 o 29 días guardados (${days.length})`);
    assert.ok(days.some((d) => d.followers != null), "la foto de hoy guarda los seguidores");
    assert.equal(days.find((d) => d.followers !== null)?.followers, 5230);
    assert.equal(days[0]!.follows, 12);
  });

  test("un dato que falta en la API no pisa el valor guardado", async () => {
    igReachNull = true;
    await syncAccount(igId, "MANUAL", 120_000);
    const [reel] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.externalId, igMedia[1]!.id));
    assert.equal(reel!.reach, 51, "el alcance anterior se conserva");
    igReachNull = false;
  });

  test("una pieza borrada en la red queda como no disponible, sin borrarse", async () => {
    const removed = igMedia[40]!.id;
    igMedia = igMedia.filter((m) => m.id !== removed);
    const out = await syncAccount(igId, "WEEKLY", 120_000);
    assert.equal(out.status, "SUCCEEDED");
    const [row] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.externalId, removed));
    assert.equal(row!.available, false);
    assert.ok(row!.unavailableSince);
    const [kept] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.externalId, igMedia[60]!.id));
    assert.equal(kept!.available, true, "las piezas viejas que siguen en la red no se marcan");
  });

  test("backfill cortado por tiempo se retoma desde el cursor", async () => {
    await db.execute(sql`truncate content_items, metric_snapshots, sync_runs cascade`);
    await db.update(schema.socialAccounts).set({ backfillCompletedAt: null }).where(eq(schema.socialAccounts.id, igId));
    // Presupuesto mínimo: procesa la primera página y se corta.
    const first = await syncAccount(igId, "BACKFILL", 15_000);
    assert.equal(first.status, "PARTIAL");
    const second = await syncAccount(igId, "BACKFILL", 120_000);
    assert.equal(second.status, "SUCCEEDED");
    const [{ count }] = (await db.execute<{ count: number }>(sql`select count(*)::int as count from content_items where social_account_id = ${igId}`)).rows as { count: number }[];
    assert.equal(count, 69);
  });

  test("TikTok: pagina, guarda y toma los seguidores", async () => {
    const out = await syncAccount(ttId, "BACKFILL", 120_000);
    assert.equal(out.status, "SUCCEEDED");
    const items = await db.select().from(schema.contentItems).where(eq(schema.contentItems.socialAccountId, ttId));
    assert.equal(items.length, 25);
    assert.equal(items[0]!.saves, null, "TikTok no da guardados: queda en null, no en 0");
    const [snap] = await db.select().from(schema.accountSnapshots).where(eq(schema.accountSnapshots.socialAccountId, ttId));
    assert.equal(snap!.followers, 900);
    assert.equal(snap!.totalLikes, 15000);
  });

  test("token vencido: la cuenta queda para reconectar y la sincronización falla con mensaje en español", async () => {
    tokenMode = "expired";
    const out = await syncAccount(igId, "MANUAL", 60_000);
    assert.equal(out.status, "FAILED");
    assert.match(out.message ?? "", /Vuelve a conectarla/);
    const [account] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, igId));
    assert.equal(account!.status, "EXPIRED");
    tokenMode = "ok";
  });

  test("dos sincronizaciones a la vez: la segunda se salta", async () => {
    await db.update(schema.socialAccounts).set({ status: "ACTIVE" }).where(eq(schema.socialAccounts.id, ttId));
    const [a, b] = await Promise.all([syncAccount(ttId, "MANUAL", 60_000), syncAccount(ttId, "MANUAL", 60_000)]);
    assert.deepEqual([a.status, b.status].sort(), ["SKIPPED", "SUCCEEDED"]);
    assert.ok(calls > 0);
  });
});
