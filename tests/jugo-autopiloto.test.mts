/**
 * Prueba de "Sacarle todo el jugo" y del autopiloto semanal.
 * - Sin base: elección de días libres, una vez por semana, presupuesto, hashtags medidos y texto del video editado.
 * - Con base de prueba (TEST_DATABASE_URL) y la IA simulada: armado del paquete del lunes (una sola vez), aprobar y
 *   descartar, y el paquete de un guion con su carrusel, textos, shorts y calendario.
 *   TEST_DATABASE_URL=postgres://... pnpm test:jugo
 * Nunca la corras contra la base de un cliente: borra guiones, carruseles, calendario y paquetes.
 */
import assert from "node:assert/strict";
import { before, describe, mock, test } from "node:test";
import { assignDays, pickFreeDays } from "../lib/calendar/free-days";
import { allowedDays, cronWeekDue, estimateWeekTokens, manualWeekFor, piecesWithinBudget, targetPieces, WEEKLY_TOKEN_BUDGET } from "../lib/autopilot/schedule";
import { cleanHashtags, editedTranscriptText, rankHashtags, wordCount } from "../lib/repurpose/text";

const TZ = "America/Mexico_City"; // UTC−6, sin horario de verano
/** Hora local de Ciudad de México → Date. */
const local = (day: string, hour: number, minute = 0) => new Date(new Date(`${day}T00:00:00Z`).getTime() + ((hour + 6) * 60 + minute) * 60_000);

describe("días libres", () => {
  test("toma los próximos días sin piezas, en orden", () => {
    const busy = { "2026-10-23": 2, "2026-10-25": 1 };
    assert.deepEqual(pickFreeDays({ from: "2026-10-23", count: 3, busy }), ["2026-10-24", "2026-10-26", "2026-10-27"]);
  });

  test("si no alcanzan los libres, usa los menos ocupados y nunca repite un día", () => {
    const busy = { "2026-10-23": 3, "2026-10-24": 1, "2026-10-25": 2 };
    const days = pickFreeDays({ from: "2026-10-23", count: 3, busy, until: "2026-10-25" });
    assert.deepEqual(days, ["2026-10-23", "2026-10-24", "2026-10-25"]);
    assert.deepEqual(pickFreeDays({ from: "2026-10-23", count: 2, busy, until: "2026-10-25" }), ["2026-10-24", "2026-10-25"]);
    assert.deepEqual(pickFreeDays({ from: "2026-10-23", count: 0, busy: {} }), []);
  });

  test("asigna respetando el día pedido si está libre; si no, el libre más cercano", () => {
    const allowed = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
    const busy = { "2026-10-28": 1 };
    const out = assignDays(["2026-10-28", "2026-10-30", "2026-10-30", "2026-10-26"], allowed, busy);
    assert.equal(out[1], "2026-10-30"); // pedido y libre
    assert.notEqual(out[0], "2026-10-28"); // pedido pero ocupado
    assert.ok(["2026-10-27", "2026-10-29"].includes(out[0]!));
    assert.equal(new Set(out).size, out.length); // una por día
    assert.ok(out.every((d) => d && allowed.includes(d))); // el lunes 26 no está permitido
  });

  test("con más piezas que días, las que sobran quedan sin fecha", () => {
    assert.deepEqual(assignDays(["2026-10-31", null, null], ["2026-10-31", "2026-11-01"], {}), ["2026-10-31", "2026-11-01", null]);
  });
});

describe("una vez por semana", () => {
  test("el lunes antes de las 9:00 todavía no; desde las 9:00, la semana que empieza ese lunes", () => {
    assert.equal(cronWeekDue(TZ, local("2026-10-26", 8, 59)), null);
    assert.equal(cronWeekDue(TZ, local("2026-10-26", 9, 0)), "2026-10-26");
  });

  test("se pone al día hasta el miércoles y desde el jueves espera al lunes", () => {
    assert.equal(cronWeekDue(TZ, local("2026-10-28", 23, 0)), "2026-10-26");
    assert.equal(cronWeekDue(TZ, local("2026-10-29", 10, 0)), null);
    assert.equal(cronWeekDue(TZ, local("2026-11-01", 10, 0)), null);
    // Domingo a las 23:30 en México ya es lunes en UTC: igual cuenta la hora de la marca.
    assert.equal(cronWeekDue(TZ, local("2026-11-01", 23, 30)), null);
  });

  test("el botón manual arma esta semana hasta el jueves y la próxima desde el viernes", () => {
    assert.equal(manualWeekFor("2026-10-22"), "2026-10-19"); // jueves
    assert.equal(manualWeekFor("2026-10-23"), "2026-10-26"); // viernes
  });

  test("solo se programan días desde mañana", () => {
    assert.deepEqual(allowedDays("2026-10-26", "2026-10-26"), ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    assert.equal(allowedDays("2026-10-26", "2026-10-23").length, 7);
    assert.deepEqual(allowedDays("2026-10-19", "2026-10-25"), []);
  });
});

describe("cuántas piezas y cuánto cuesta", () => {
  test("el ajuste manda; si no, la meta semanal; si no, 3; nunca más que los días ni que 7", () => {
    assert.equal(targetPieces(5, 2, 7), 5);
    assert.equal(targetPieces(null, 4, 7), 4);
    assert.equal(targetPieces(null, null, 7), 3);
    assert.equal(targetPieces(7, null, 3), 3);
    assert.equal(targetPieces(12, null, 7), 7);
  });

  test("el presupuesto recorta piezas antes de pasarse", () => {
    assert.ok(estimateWeekTokens(5) > estimateWeekTokens(3));
    assert.equal(piecesWithinBudget(5, 0), 5);
    const used = WEEKLY_TOKEN_BUDGET - estimateWeekTokens(2);
    assert.equal(piecesWithinBudget(5, used), 2);
    assert.equal(piecesWithinBudget(5, WEEKLY_TOKEN_BUDGET), 0);
  });
});

describe("textos", () => {
  test("hashtags: sin relleno, sin repetidos (ni por tildes) y con tope", () => {
    assert.deepEqual(cleanHashtags(["#fyp", "Clínica Dental", "#clinicadental", "#educación", "#educacion", "viral", "#a"], 5), ["#ClínicaDental", "#educación"]);
    assert.equal(cleanHashtags(["#uno", "#dos", "#tres", "#cuatro"], 3).length, 3);
  });

  test("hashtags medidos: solo los que se repiten, ordenados por rendimiento real", () => {
    const ranked = rankHashtags([
      { caption: "Uno #ventas #fyp", perfScore: 3 },
      { caption: "Dos #Ventas #negocios", perfScore: 1 },
      { caption: "Tres #negocios", perfScore: 0.8 },
      { caption: "Cuatro #solo", perfScore: 9 },
      { caption: "Sin medir #ventas", perfScore: null },
    ]);
    assert.deepEqual(ranked.map((r) => r.tag), ["#ventas", "#negocios"]);
    assert.equal(ranked[0]!.uses, 2);
    assert.equal(ranked[0]!.median, 2);
  });

  test("el texto del video editado no incluye lo que se cortó", () => {
    const words = ["Hola", "eh", "eh", "hoy", "te", "cuento", "algo", "."].map((text, id) => ({ id, text, start: id, end: id + 0.5 }));
    const transcript = { version: 1 as const, provider: "x", language: "es", duration: 8, words };
    assert.equal(editedTranscriptText(transcript, { removals: [{ from_word: 1, to_word: 2, reason: "filler", confidence: 1, source: "auto" }] }), "Hola hoy te cuento algo.");
    assert.equal(editedTranscriptText(null, null), "");
    assert.equal(wordCount("Hola, ¿qué tal? 3 cosas"), 4);
  });
});

// ─── Con base de prueba ────────────────────────────────────────────────────

const url = process.env.TEST_DATABASE_URL;
describe("con base de prueba", { skip: !url && "TEST_DATABASE_URL no está definida" }, () => {
  let db: Awaited<typeof import("../lib/db")>["getDb"] extends () => infer D ? D : never;
  let schema: typeof import("../lib/db/schema");
  let sql: typeof import("drizzle-orm").sql;
  let eq: typeof import("drizzle-orm").eq;
  const userId = "test-owner";

  before(async () => {
    // El contexto de marca llega a lib/auth (sesión) por el ranking de ganchos; aquí no hay pedido HTTP.
    mock.module("next/navigation", { namedExports: { redirect: () => undefined, notFound: () => undefined } });
    mock.module("next/headers", { namedExports: { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) } });
    Object.assign(process.env, {
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "x".repeat(40),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      CRON_SECRET: "y".repeat(40),
      APP_TIMEZONE: TZ,
      AI_FAKE: "1",
    });
    const dbMod = await import("../lib/db");
    db = dbMod.getDb();
    schema = dbMod.schema;
    ({ sql, eq } = await import("drizzle-orm"));
    await db.execute(sql`truncate weekly_packs, weekly_pack_items, repurpose_packs, calendar_entries, carousels, script_versions, scripts, notifications, autopilot_settings, ai_usage, rate_limits, brand_profile cascade`);
    await db.execute(sql`delete from team_members; delete from users`);
    await db.insert(schema.users).values({ id: userId, name: "Dueña", email: "duena@example.com" });
    await db.insert(schema.teamMembers).values({ userId, role: "OWNER" });
    await db.insert(schema.brandProfile).values({
      name: "Clínica Sonrisa",
      niche: "Marketing para clínicas dentales",
      pillars: [
        { name: "Teléfono y recepción", description: "Cómo se atiende", share: 50 },
        { name: "Casos de clientes", description: "Resultados", share: 50 },
      ],
      goals: { followers: 10_000, platform: "TOTAL", weeklyPieces: 4 },
    });
  });

  test("autopiloto apagado: el cron no arma nada", async () => {
    const { ensureWeeklyPack } = await import("../lib/autopilot/service");
    assert.equal(await ensureWeeklyPack(local("2026-10-26", 10)), null);
  });

  test("el lunes arma el paquete una sola vez, con guiones, carrusel y aviso", async () => {
    const { ensureWeeklyPack, saveAutopilotSettings } = await import("../lib/autopilot/service");
    await saveAutopilotSettings({ enabled: true, piecesPerWeek: null }, userId);
    assert.equal(await ensureWeeklyPack(local("2026-10-26", 8)), null); // antes de las 9:00
    const first = await ensureWeeklyPack(local("2026-10-26", 10));
    assert.equal(first?.status, "created");
    assert.equal(first?.weekStart, "2026-10-26");
    const second = await ensureWeeklyPack(local("2026-10-26", 11));
    assert.equal(second?.status, "exists");

    const packs = await db.select().from(schema.weeklyPacks);
    assert.equal(packs.length, 1);
    assert.equal(packs[0]!.status, "READY");
    const items = await db.select().from(schema.weeklyPackItems).where(eq(schema.weeklyPackItems.weekStart, "2026-10-26"));
    assert.equal(items.length, 4); // la meta semanal de la marca
    assert.ok(items.every((i) => i.genStatus === "ready"));
    assert.ok(items.every((i) => i.scheduledDate && i.scheduledDate > "2026-10-26" && i.scheduledDate <= "2026-11-01"));
    assert.equal(new Set(items.map((i) => i.scheduledDate)).size, items.length);
    assert.ok(items.some((i) => i.carouselId) && items.some((i) => i.scriptId));
    assert.ok(items.every((i) => (i.format === "CAROUSEL") === Boolean(i.carouselId)));
    assert.ok(items.every((i) => i.decision === "pending"));
    // Nada entra al calendario antes de aprobar.
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from calendar_entries`)).rows as [{ n: number }];
    assert.equal(n, 0);
    const notes = await db.select().from(schema.notifications);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.href, "/calendario/semana");
    assert.equal(notes[0]!.userId, userId);
  });

  test("aprobar deja la pieza en el calendario con su estado; descartar archiva el guion", async () => {
    const { approveItem, discardItem, restoreItem } = await import("../lib/autopilot/service");
    const items = await db.select().from(schema.weeklyPackItems).orderBy(schema.weeklyPackItems.position);
    const script = items.find((i) => i.scriptId)!;
    const carousel = items.find((i) => i.carouselId)!;
    const a = await approveItem(script.id, userId);
    const [entry] = await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, a.entryId));
    assert.equal(entry!.source, "autopiloto");
    assert.equal(entry!.status, "SCRIPTING"); // guion en borrador = "En guion"
    assert.equal(entry!.scriptId, script.scriptId);
    assert.equal(entry!.scheduledDate, script.scheduledDate);
    // Aprobar dos veces no duplica.
    assert.equal((await approveItem(script.id, userId)).entryId, a.entryId);
    const c = await approveItem(carousel.id, userId);
    const [centry] = await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, c.entryId));
    assert.equal(centry!.carouselId, carousel.carouselId);
    assert.equal(centry!.format, "CAROUSEL");

    await discardItem(script.id);
    const [s] = await db.select({ status: schema.scripts.status }).from(schema.scripts).where(eq(schema.scripts.id, script.scriptId!));
    assert.equal(s!.status, "ARCHIVED");
    assert.equal((await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, a.entryId))).length, 0);
    await restoreItem(script.id);
    const [s2] = await db.select({ status: schema.scripts.status }).from(schema.scripts).where(eq(schema.scripts.id, script.scriptId!));
    assert.equal(s2!.status, "DRAFT");
  });

  test("sacarle todo el jugo a un guion: carrusel, textos, shorts y calendario en días libres", async () => {
    const { createScript } = await import("../lib/scripts/service");
    const { loadSource } = await import("../lib/repurpose/source");
    const { runPack, schedulePack, startPack } = await import("../lib/repurpose/service");
    const scriptId = await createScript({ idea: "El error de la primera llamada", format: "REEL", objective: "seguidores", pillar: "Teléfono y recepción", offer: null, reference: null, referenceLabel: null, sourceContentItemId: null, sourceUrl: null, userId });
    const source = await loadSource("guion", scriptId);
    assert.ok(source && !source.blocked);
    const packId = await startPack(source!, userId);
    await runPack(packId, userId);
    const [pack] = await db.select().from(schema.repurposePacks).where(eq(schema.repurposePacks.id, packId));
    assert.equal(pack!.parts.carousel.status, "ready");
    assert.equal(pack!.parts.copy.status, "ready");
    assert.equal(pack!.parts.shorts.status, "ready");
    assert.ok(pack!.finishedAt);
    // Los hashtags de relleno que propuso la IA simulada (#fyp, #viral, #parati, #shorts) no pasan.
    const copy = pack!.parts.copy.data!;
    assert.ok(!copy.instagram.hashtags.some((t) => /fyp|viral/i.test(t)));
    assert.ok(copy.instagram.hashtags.length <= 5 && copy.youtube.hashtags.length <= 3);
    assert.ok(!copy.youtube.hashtags.includes("#shorts"));
    const shortIds = pack!.parts.shorts.scriptIds!;
    assert.ok(shortIds.length >= 2 && shortIds.length <= 3);
    const shorts = await db.select().from(schema.scripts).where(sql`${schema.scripts.id} in ${shortIds}`);
    assert.ok(shorts.every((s) => s.parentId === scriptId && s.status === "DRAFT" && (s.content?.hooks.length ?? 0) > 0));
    const [carousel] = await db.select().from(schema.carousels).where(eq(schema.carousels.id, pack!.parts.carousel.carouselId!));
    assert.equal(carousel!.scriptId, scriptId);
    assert.ok(carousel!.slides.length >= 3);

    const busyBefore = (await db.execute<{ d: string }>(sql`select to_char(scheduled_date, 'YYYY-MM-DD') as d from calendar_entries where scheduled_date is not null`)).rows.map((r) => r.d);
    const first = await schedulePack(packId, userId);
    assert.equal(first.created.length, 2 + shortIds.length); // guion de origen + carrusel + shorts
    const dates = first.created.map((c) => c.date);
    assert.equal(new Set(dates).size, dates.length);
    assert.ok(dates.every((d) => !busyBefore.includes(d)));
    const again = await schedulePack(packId, userId);
    assert.equal(again.created.length, 0);
    assert.equal(again.skipped, 2 + shortIds.length);
  });
});
