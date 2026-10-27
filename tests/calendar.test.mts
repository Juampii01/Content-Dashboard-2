/**
 * Prueba del Calendario: estados sincronizados con Guiones y vínculo automático con las piezas publicadas.
 * Necesita una base de prueba con las migraciones aplicadas:
 *   TEST_DATABASE_URL=postgres://... pnpm test:calendar
 * Nunca la corras contra la base de un cliente: borra el calendario, los guiones y las métricas.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL no está definida: se salta la prueba del calendario.");
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
});

const { getDb, schema } = await import("../lib/db");
const { encryptTokens } = await import("../lib/social/tokens");
const { autoLinkRecent, acceptSuggestion, rejectSuggestion, linkTarget, unlinkTarget, linkScore, assignPairs, candidatesForTarget } = await import("../lib/calendar/linking");
const { calendarStatusFromScript, scriptStatusFromCalendar, syncEntriesFromScript, syncScriptFromEntry } = await import("../lib/calendar/status");
const { addDays, todayIn, visibleRange, shiftAnchor } = await import("../lib/calendar/dates");
const { eq, sql } = await import("drizzle-orm");

const db = getDb();
const today = todayIn("America/Mexico_City");
/** Mediodía del día local `day` en Ciudad de México (UTC−6), para que la fecha local sea exactamente `day`. */
const at = (day: string, hour = 12) => new Date(`${day}T${String(hour + 6).padStart(2, "0")}:00:00Z`);

let igAccount = "";
let ttAccount = "";

async function item(platform: "INSTAGRAM" | "TIKTOK", externalId: string, text: string, day: string) {
  const [row] = await db
    .insert(schema.contentItems)
    .values({
      socialAccountId: platform === "INSTAGRAM" ? igAccount : ttAccount,
      platform,
      externalId,
      type: platform === "INSTAGRAM" ? "REEL" : "VIDEO",
      caption: platform === "INSTAGRAM" ? `${text} 👇\n\nGuárdalo y compártelo con alguien que lo necesite. #contenido #ventas` : null,
      title: platform === "TIKTOK" ? text : null,
      publishedAt: at(day),
      views: 12_000,
      perfScore: 2.4,
    })
    .returning({ id: schema.contentItems.id });
  return row!.id;
}

async function entry(opts: { title: string; hook?: string; day: string | null; status?: "IDEA" | "SCRIPTING" | "PRODUCTION" | "READY" | "PUBLISHED"; platforms: ("INSTAGRAM" | "TIKTOK" | "YOUTUBE")[]; scriptId?: string }) {
  const [row] = await db
    .insert(schema.calendarEntries)
    .values({ title: opts.title, hook: opts.hook ?? null, scheduledDate: opts.day, status: opts.status ?? "READY", format: "REEL", scriptId: opts.scriptId ?? null })
    .returning({ id: schema.calendarEntries.id });
  const targets = await db
    .insert(schema.calendarTargets)
    .values(opts.platforms.map((platform) => ({ entryId: row!.id, platform })))
    .returning({ id: schema.calendarTargets.id, platform: schema.calendarTargets.platform });
  return { id: row!.id, target: (p: string) => targets.find((t) => t.platform === p)!.id };
}

const target = async (id: string) => (await db.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, id)))[0]!;
const entryRow = async (id: string) => (await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, id)))[0]!;

before(async () => {
  await db.execute(sql`truncate social_accounts, content_items, calendar_entries, calendar_targets, scripts cascade`);
  const [ig] = await db
    .insert(schema.socialAccounts)
    .values({ platform: "INSTAGRAM", externalId: "ig-cal", handle: "marca", ...encryptTokens("INSTAGRAM", "t", null), scopes: [] })
    .returning();
  const [tt] = await db
    .insert(schema.socialAccounts)
    .values({ platform: "TIKTOK", externalId: "tt-cal", handle: "marca", ...encryptTokens("TIKTOK", "t", null), scopes: [] })
    .returning();
  igAccount = ig!.id;
  ttAccount = tt!.id;
});

beforeEach(async () => {
  await db.execute(sql`truncate content_items, calendar_entries, calendar_targets, scripts cascade`);
});

after(async () => {
  await (globalThis as unknown as { pool?: { end(): Promise<void> } }).pool?.end();
});

describe("fechas", () => {
  test("la grilla del mes empieza en lunes y cubre semanas completas", () => {
    const r = visibleRange("mes", "2026-10-18");
    assert.equal(r.from, "2026-09-28");
    assert.equal(r.to, "2026-11-01");
    assert.equal(r.days.length % 7, 0);
    assert.equal(visibleRange("semana", "2026-10-18").from, "2026-10-12");
    assert.equal(shiftAnchor("mes", "2026-01-31", 1), "2026-02-01");
    assert.equal(shiftAnchor("semana", "2026-10-18", -1), "2026-10-05");
  });
});

describe("estados sincronizados con el guion", () => {
  test("mapeo en ambos sentidos, solo hacia adelante", () => {
    assert.equal(calendarStatusFromScript("IDEA", "READY"), "PRODUCTION");
    assert.equal(calendarStatusFromScript("READY", "DRAFT"), "READY", "un guion que vuelve a borrador no baja la entrada");
    assert.equal(calendarStatusFromScript("IDEA", "ARCHIVED"), "IDEA");
    assert.equal(calendarStatusFromScript("PRODUCTION", "PUBLISHED"), "PUBLISHED");
    assert.equal(scriptStatusFromCalendar("DRAFT", "PUBLISHED"), "PUBLISHED");
    assert.equal(scriptStatusFromCalendar("IDEA", "PRODUCTION"), "READY");
    assert.equal(scriptStatusFromCalendar("RECORDED", "SCRIPTING"), "RECORDED");
    assert.equal(scriptStatusFromCalendar("ARCHIVED", "PUBLISHED"), "ARCHIVED", "un guion archivado no se toca");
  });

  test("cambiar el guion sube sus entradas y al revés", async () => {
    const [script] = await db.insert(schema.scripts).values({ title: "Guion", status: "DRAFT" }).returning();
    const e = await entry({ title: "Pieza", day: today, status: "IDEA", platforms: ["INSTAGRAM"], scriptId: script!.id });
    assert.equal(await syncEntriesFromScript(script!.id, "READY"), 1);
    assert.equal((await entryRow(e.id)).status, "PRODUCTION");
    assert.equal(await syncScriptFromEntry(script!.id, "READY"), "RECORDED");
  });
});

describe("vínculo con las piezas publicadas", () => {
  test("puntaje: 0,6 × similitud + 0,4 × cercanía", () => {
    assert.equal(linkScore(1, 0), 1);
    assert.equal(linkScore(1, 3), 0.7);
    assert.equal(linkScore(0.5, 1), 0.6);
    assert.equal(linkScore(1, 4), 0.6, "fuera de la ventana la fecha no suma");
  });

  test("asignación: cada pieza y cada destino una sola vez, el mejor primero", () => {
    const chosen = assignPairs([
      { targetId: "a", itemId: "1", score: 0.9, similarity: 0.9 },
      { targetId: "b", itemId: "1", score: 0.8, similarity: 0.8 },
      { targetId: "b", itemId: "2", score: 0.6, similarity: 0.5 },
      { targetId: "c", itemId: "3", score: 0.55, similarity: 0.1 },
    ]);
    assert.deepEqual(chosen.map((c) => `${c.targetId}${c.itemId}`), ["a1", "b2"], "con similitud menor a 0,2 no se sugiere");
  });

  test("mismo texto y fecha cercana: se vincula solo y la entrada y el guion pasan a publicados", async () => {
    const [script] = await db.insert(schema.scripts).values({ title: "Guion", status: "READY" }).returning();
    const e = await entry({ title: "3 errores que te hacen perder clientes", day: addDays(today, -2), platforms: ["INSTAGRAM", "TIKTOK"], scriptId: script!.id });
    const ig = await item("INSTAGRAM", "ig1", "3 errores que te hacen perder clientes", addDays(today, -1));
    const out = await autoLinkRecent();
    assert.equal(out.linked, 1);
    const t = await target(e.target("INSTAGRAM"));
    assert.equal(t.linkStatus, "LINKED");
    assert.equal(t.contentItemId, ig);
    assert.ok((t.linkScore ?? 0) >= 0.75);
    assert.equal((await target(e.target("TIKTOK"))).linkStatus, "NONE", "TikTok todavía no se publicó");
    assert.equal((await entryRow(e.id)).status, "PUBLISHED");
    const [s] = await db.select().from(schema.scripts).where(eq(schema.scripts.id, script!.id));
    assert.equal(s!.status, "PUBLISHED");
  });

  test("texto parecido o fecha lejana: queda como sugerencia", async () => {
    const e = await entry({ title: "El guion de 30 segundos que vende", hook: "Este guion de 30 segundos me trajo más ventas", day: addDays(today, -4), platforms: ["INSTAGRAM"] });
    await item("INSTAGRAM", "ig2", "El guion de 30 segundos que más ventas me trajo", addDays(today, -1));
    const out = await autoLinkRecent();
    assert.equal(out.linked, 0);
    const t = await target(e.target("INSTAGRAM"));
    assert.equal(t.linkStatus, "SUGGESTED");
    assert.ok((t.linkScore ?? 0) >= 0.5 && (t.linkScore ?? 1) < 0.75, `puntaje ${t.linkScore}`);
  });

  test("sin relación, de otra red, fuera de la ventana o en estado temprano: no pasa nada", async () => {
    const far = await entry({ title: "Cómo grabo 10 videos en una tarde", day: addDays(today, -10), platforms: ["INSTAGRAM"] });
    const other = await entry({ title: "Mi rutina de mañana", day: today, platforms: ["INSTAGRAM"] });
    const early = await entry({ title: "Cómo grabo 10 videos en una tarde", day: addDays(today, -1), status: "PRODUCTION", platforms: ["INSTAGRAM"] });
    const wrongNet = await entry({ title: "Cómo grabo 10 videos en una tarde", day: addDays(today, -1), platforms: ["YOUTUBE"] });
    await item("INSTAGRAM", "ig3", "Cómo grabo 10 videos en una sola tarde", addDays(today, -1));
    await autoLinkRecent();
    for (const [e, p] of [[far, "INSTAGRAM"], [other, "INSTAGRAM"], [early, "INSTAGRAM"], [wrongNet, "YOUTUBE"]] as const) {
      assert.equal((await target(e.target(p))).linkStatus, "NONE");
    }
  });

  test("una pieza ya vinculada no se sugiere a otra entrada", async () => {
    const a = await entry({ title: "Por qué tu CTA no funciona", day: addDays(today, -1), platforms: ["TIKTOK"] });
    await autoLinkRecent();
    const tt = await item("TIKTOK", "tt1", "Por qué tu CTA no funciona", addDays(today, -1));
    await linkTarget(a.target("TIKTOK"), tt);
    const b = await entry({ title: "Por qué tu CTA no funciona (parte 2)", day: addDays(today, -1), platforms: ["TIKTOK"] });
    await autoLinkRecent();
    assert.equal((await target(b.target("TIKTOK"))).linkStatus, "NONE");
    await assert.rejects(() => linkTarget(b.target("TIKTOK"), tt), /ya está vinculada/);
  });

  test("aceptar, descartar y desvincular", async () => {
    const e = await entry({ title: "Tres libros que cambiaron mi negocio", day: addDays(today, -3), platforms: ["INSTAGRAM"] });
    const first = await item("INSTAGRAM", "ig4", "Tres libros que me cambiaron el negocio", addDays(today, -1));
    await autoLinkRecent();
    const id = e.target("INSTAGRAM");
    assert.equal((await target(id)).linkStatus, "SUGGESTED");

    await rejectSuggestion(id);
    let t = await target(id);
    assert.equal(t.linkStatus, "NONE");
    assert.deepEqual(t.rejectedItemIds, [first]);
    await autoLinkRecent();
    assert.equal((await target(id)).linkStatus, "NONE", "una pieza descartada no se vuelve a sugerir");

    const second = await item("INSTAGRAM", "ig5", "Tres libros que cambiaron mi negocio para siempre", addDays(today, -4));
    await autoLinkRecent({ suggestOnly: true });
    t = await target(id);
    assert.equal(t.linkStatus, "SUGGESTED");
    assert.equal(t.contentItemId, second);
    await acceptSuggestion(id);
    assert.equal((await target(id)).linkStatus, "LINKED");
    assert.equal((await entryRow(e.id)).status, "PUBLISHED");

    const candidates = await candidatesForTarget(id);
    assert.ok(!candidates.some((c) => c.id === second), "la pieza vinculada no aparece como candidata");

    await unlinkTarget(id);
    t = await target(id);
    assert.equal(t.linkStatus, "NONE");
    assert.deepEqual(t.rejectedItemIds.sort(), [first, second].sort());
    await autoLinkRecent();
    assert.equal((await target(id)).linkStatus, "NONE", "lo desvinculado no se vuelve a unir solo");
  });

  test("dos entradas compiten por la misma pieza: gana la de mayor puntaje", async () => {
    const close = await entry({ title: "Lo que aprendí después de 100 videos", day: addDays(today, -1), platforms: ["INSTAGRAM"] });
    const far = await entry({ title: "Lo que aprendí después de 100 videos", day: addDays(today, -4), platforms: ["INSTAGRAM"] });
    await item("INSTAGRAM", "ig6", "Lo que aprendí después de 100 videos", addDays(today, -1));
    await autoLinkRecent();
    assert.equal((await target(close.target("INSTAGRAM"))).linkStatus, "LINKED");
    assert.equal((await target(far.target("INSTAGRAM"))).linkStatus, "NONE");
  });
});
