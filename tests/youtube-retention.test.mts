/**
 * "Dónde se fue la gente" con YouTube simulado (sin llamadas reales): curva bajo demanda, curvas en el sync,
 * subtítulos, explicación con IA simulada (AI_FAKE) y avisos de los trabajos de YouTube.
 * Necesita una base de prueba vacía con las migraciones aplicadas:
 *   TEST_DATABASE_URL=postgres://... pnpm test:youtube-db
 * Nunca la corras contra la base de un cliente: borra las tablas de redes y métricas.
 */
import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba de retención.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: url,
  DATABASE_URL_UNPOOLED: url,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  CRON_SECRET: "y".repeat(40),
  GOOGLE_CLIENT_ID: "g",
  GOOGLE_CLIENT_SECRET: "gs",
  AI_FAKE: "1",
});

// El contexto de marca llega a lib/auth (sesión) por el ranking de ganchos; aquí no hay pedido HTTP.
mock.module("next/navigation", { namedExports: { redirect: () => undefined, notFound: () => undefined } });
mock.module("next/headers", { namedExports: { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) } });

// ─── YouTube simulado ─────────────────────────────────────────────────────
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const videos = [
  { id: "vidNuevo0001", days: 1, duration: "PT5M" },
  { id: "vidReciente1", days: 10, duration: "PT10M" },
  { id: "vidShort0001", days: 20, duration: "PT40S" },
];
let relativeRejected = false;
const retentionCalls: { video: string; metrics: string }[] = [];

function curveRows() {
  const rows: number[][] = [];
  let r = 1;
  for (let i = 1; i <= 100; i++) {
    r -= i <= 5 ? 0.05 : 0.002;
    if (i > 40 && i <= 43) r -= 0.04;
    rows.push([i / 100, Number(r.toFixed(4)), i <= 5 ? 0.7 : 0.5]);
  }
  return rows;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const q = u.searchParams;
  if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/channels")) {
    return json({ items: [{ id: "UC123", snippet: { title: "Canal", customUrl: "@canal", publishedAt: "2020-01-01T00:00:00Z" }, statistics: { subscriberCount: "1200", videoCount: "3" }, contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] });
  }
  if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/playlistItems")) {
    return json({ items: videos.map((v) => ({ contentDetails: { videoId: v.id, videoPublishedAt: ago(v.days) } })) });
  }
  if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/videos")) {
    const ids = (q.get("id") ?? "").split(",");
    return json({ items: videos.filter((v) => ids.includes(v.id)).map((v) => ({ id: v.id, snippet: { title: `Video ${v.id}`, publishedAt: ago(v.days), thumbnails: {} }, contentDetails: { duration: v.duration }, statistics: { viewCount: "1000", likeCount: "10", commentCount: "2" }, status: { privacyStatus: "public" } })) });
  }
  if (u.hostname === "youtubeanalytics.googleapis.com") {
    const dims = q.get("dimensions");
    const metrics = q.get("metrics") ?? "";
    if (dims === "elapsedVideoTimeRatio") {
      const video = (q.get("filters") ?? "").replace("video==", "");
      retentionCalls.push({ video, metrics });
      assert.ok(!video.includes(","), "el reporte de retención acepta un solo video");
      if (relativeRejected && metrics.includes("relativeRetentionPerformance")) return json({ error: { code: 400, message: "Unknown identifier", errors: [{ reason: "badRequest" }] } }, 400);
      const withRel = metrics.includes("relativeRetentionPerformance");
      return json({
        columnHeaders: [{ name: "elapsedVideoTimeRatio" }, { name: "audienceWatchRatio" }, ...(withRel ? [{ name: "relativeRetentionPerformance" }] : [])],
        rows: curveRows().map((r) => (withRel ? r : r.slice(0, 2))),
      });
    }
    if (dims === "video") return json({ columnHeaders: [{ name: "video" }, { name: "views" }], rows: videos.map((v) => [v.id, 1000]) });
    if (dims === "video,creatorContentType") return json({ columnHeaders: [{ name: "video" }, { name: "creatorContentType" }, { name: "views" }], rows: [["vidShort0001", "SHORTS", 10]] });
    if (dims === "day") return json({ columnHeaders: [{ name: "day" }], rows: [] });
  }
  throw new Error(`Llamada no simulada: ${u.hostname}${u.pathname}`);
}) as typeof fetch;

const { getDb, schema } = await import("../lib/db");
const { encryptTokens } = await import("../lib/social/tokens");
const { syncAccount } = await import("../lib/social/sync/runner");
const { ensureRetention, explainRetention, saveTranscript, pieceTranscript } = await import("../lib/youtube/retention-service");
const { parseSubtitles } = await import("../lib/youtube/transcript");
const { jobNotification } = await import("../lib/notifications");
const { eq, sql } = await import("drizzle-orm");

const db = getDb();
let ytId = "";
const itemId = async (externalId: string) => (await db.select({ id: schema.contentItems.id }).from(schema.contentItems).where(eq(schema.contentItems.externalId, externalId)))[0]!.id;

before(async () => {
  await db.execute(sql`truncate social_accounts, content_items, metric_snapshots, account_snapshots, sync_runs, retention_curves, piece_transcripts, retention_insights, rate_limits, ai_usage cascade`);
  const [yt] = await db
    .insert(schema.socialAccounts)
    .values({ platform: "YOUTUBE", externalId: "UC123", handle: "@canal", ...encryptTokens("YOUTUBE", "yt-token", "yt-refresh"), accessTokenExpiresAt: new Date(Date.now() + 50 * 60_000), tokenIssuedAt: new Date(), scopes: [], meta: { uploadsPlaylistId: "UU123", channelPublishedAt: "2020-01-01T00:00:00Z" } })
    .returning();
  ytId = yt!.id;
});

after(async () => {
  globalThis.fetch = realFetch;
  await (globalThis as unknown as { pool?: { end(): Promise<void> } }).pool?.end();
});

describe("retención de YouTube", () => {
  test("el sync diario trae las curvas de los videos de más de 3 días, una llamada por video", async () => {
    const out = await syncAccount(ytId, "DAILY", 60_000);
    assert.equal(out.status, "SUCCEEDED", out.message);
    const curves = await db.select().from(schema.retentionCurves);
    assert.equal(curves.length, 2, "el video de ayer todavía no tiene curva");
    assert.deepEqual(retentionCalls.map((c) => c.video).sort(), ["vidReciente1", "vidShort0001"]);
    assert.ok(retentionCalls.every((c) => c.metrics === "audienceWatchRatio,relativeRetentionPerformance"));
    const curve = curves.find((c) => c.contentItemId)!;
    assert.equal(curve.points.length, 100);
    assert.equal(curve.points[0]!.relative, 0.7);
  });

  test("al abrir la pieza: curva fresca no vuelve a llamar; vieja se actualiza; nueva espera", async () => {
    const recent = await itemId("vidReciente1");
    retentionCalls.length = 0;
    assert.equal((await ensureRetention(recent)).status, "fresh");
    assert.equal(retentionCalls.length, 0);

    await db.update(schema.retentionCurves).set({ capturedAt: new Date(Date.now() - 5 * DAY) }).where(eq(schema.retentionCurves.contentItemId, recent));
    relativeRejected = true;
    assert.equal((await ensureRetention(recent)).status, "updated");
    // Si YouTube no acepta relativeRetentionPerformance, se pide solo audienceWatchRatio.
    assert.deepEqual(retentionCalls.map((c) => c.metrics), ["audienceWatchRatio,relativeRetentionPerformance", "audienceWatchRatio"]);
    const [curve] = await db.select().from(schema.retentionCurves).where(eq(schema.retentionCurves.contentItemId, recent));
    assert.equal(curve!.points[0]!.relative, undefined);
    relativeRejected = false;

    // Una sola consulta cada 6 horas por pieza, aunque se abra muchas veces.
    await db.update(schema.retentionCurves).set({ capturedAt: new Date(Date.now() - 5 * DAY) }).where(eq(schema.retentionCurves.contentItemId, recent));
    assert.equal((await ensureRetention(recent)).status, "throttled");

    assert.equal((await ensureRetention(await itemId("vidNuevo0001"))).status, "too-new");
  });

  test("subtítulos + explicación: cada caída con lo que se decía", async () => {
    const recent = await itemId("vidReciente1");
    const segments = parseSubtitles("1\n00:00:00,000 --> 00:00:20,000\nHola, hoy te cuento algo.\n\n2\n00:03:58,000 --> 00:04:20,000\nAhora un tramo larguísimo sobre la planilla de costos.\n");
    await saveTranscript({ contentItemId: recent, source: "subtitulos", segments, userId: null });
    const t = await pieceTranscript(recent);
    assert.equal(t?.source, "subtitulos");
    await explainRetention(recent, null as unknown as string);
    const [insight] = await db.select().from(schema.retentionInsights).where(eq(schema.retentionInsights.contentItemId, recent));
    assert.ok(insight, "se guarda la explicación");
    assert.equal(insight!.transcriptSource, "subtitulos");
    assert.equal(insight!.drops.length, insight!.explanation.drops.length);
    assert.ok(insight!.drops.some((d) => d.intro));
    assert.ok(insight!.drops.some((d) => !d.intro && d.startSec! > 230 && d.startSec! < 260), JSON.stringify(insight!.drops));
    assert.match(insight!.explanation.drops.find((d) => d.n === 2)!.why, /planilla/);
    // Cambiar la transcripción borra la explicación vieja.
    await saveTranscript({ contentItemId: recent, source: "youtube", segments, userId: null });
    assert.equal((await db.select().from(schema.retentionInsights)).length, 0);
  });
});

describe("avisos", () => {
  const base = { id: "j", status: "SUCCEEDED" as const, error_message: null, video_project_id: null, created_by: null, seconds: 90, project_title: null, carousel_title: null };
  test("miniaturas avisan solo con fondos; los recortes sueltos no", () => {
    const n = jobNotification({ ...base, type: "YT_THUMBNAILS", input: { packageId: "p1", concepts: [{ conceptId: "a" }] }, package_title: "Mi video" });
    assert.equal(n?.href, "/miniaturas/p1");
    assert.match(n!.body, /"Mi video"/);
    assert.equal(jobNotification({ ...base, type: "YT_THUMBNAILS", input: { packageId: null, concepts: [], photos: ["x"] } }), null);
    const t = jobNotification({ ...base, type: "YOUTUBE_TRANSCRIPT", status: "FAILED", error_message: "Este video no tiene subtítulos.", input: { contentItemId: "c1" } });
    assert.equal(t?.tone, "error");
    assert.equal(t?.href, "/metricas/c1");
    assert.equal(t?.emailable, false);
  });
});
