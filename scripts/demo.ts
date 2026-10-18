/**
 * Datos de demostración: tres cuentas (Instagram, YouTube y TikTok) con 6 meses de contenido y métricas creíbles.
 * Sirve para mostrar el producto en una venta sin conectar cuentas reales, y para revisar pantallas.
 *
 *   pnpm demo cargar   → crea las cuentas demo y su contenido (borra la demo anterior si había)
 *   pnpm demo borrar   → borra todo lo de la demo (las cuentas reales no se tocan)
 *
 * Las cuentas demo llevan meta.demo = true: el cron no las sincroniza.
 * No se puede cargar la demo si ya hay una cuenta real conectada de esa red.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../lib/db";
import { encryptTokens } from "../lib/social/tokens";
import type { ContentType, Platform } from "../lib/social/types";

const db = getDb();
const DAY = 86_400_000;

// Generador determinista: la demo sale igual cada vez.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;
const logNormal = (median: number, spread = 0.7) => {
  const u = Math.max(1e-9, rand());
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(spread * z);
};

const hooks = [
  "3 errores que te hacen perder clientes en tu primera llamada",
  "Cómo grabo 10 videos en una sola tarde",
  "La pregunta que cambió mi forma de vender",
  "Por qué tus reels no pasan de 300 visualizaciones",
  "El guion de 30 segundos que más ventas me trajo",
  "Lo que nadie te dice de crecer en YouTube",
  "5 ganchos que puedes copiar hoy mismo",
  "Respondo la duda más común de mis alumnos",
  "Antes y después: cómo edito un video crudo",
  "La herramienta de IA que uso todos los días",
  "Cuánto gané con mi primer infoproducto",
  "Deja de publicar todos los días (haz esto en cambio)",
  "Así planeo un mes de contenido en 2 horas",
  "El error de precio que casi me quiebra",
  "Tutorial: subtítulos que retienen al espectador",
  "Mi plantilla de carrusel más guardada",
  "Cómo conseguí mis primeros 1,000 seguidores",
  "Por qué tu CTA no funciona",
  "Detrás de cámaras de mi estudio",
  "Lo que aprendí después de 100 videos",
  "Tres libros que cambiaron mi negocio",
  "La diferencia entre contenido viral y contenido que vende",
  "Cómo responder a un cliente que dice 'está caro'",
  "Mi rutina de mañana para crear sin bloqueo",
];

type Spec = { platform: Platform; handle: string; name: string; followers: number; perWeek: number; types: { type: ContentType; weight: number; median: number; duration: [number, number] }[] };
const specs: Spec[] = [
  {
    platform: "INSTAGRAM",
    handle: "marca.demo",
    name: "Marca Demo",
    followers: 48_200,
    perWeek: 5,
    types: [
      { type: "REEL", weight: 0.65, median: 9_000, duration: [18, 75] },
      { type: "CAROUSEL", weight: 0.3, median: 4_200, duration: [0, 0] },
      { type: "IMAGE", weight: 0.05, median: 2_100, duration: [0, 0] },
    ],
  },
  {
    platform: "YOUTUBE",
    handle: "@marcademo",
    name: "Marca Demo",
    followers: 21_700,
    perWeek: 2,
    types: [
      { type: "VIDEO", weight: 0.45, median: 6_500, duration: [420, 1_260] },
      { type: "SHORT", weight: 0.55, median: 3_800, duration: [20, 58] },
    ],
  },
  {
    platform: "TIKTOK",
    handle: "marcademo",
    name: "Marca Demo",
    followers: 35_900,
    perWeek: 4,
    types: [{ type: "VIDEO", weight: 1, median: 7_000, duration: [15, 70] }],
  },
];

function chooseType(spec: Spec) {
  let r = rand();
  for (const t of spec.types) {
    if ((r -= t.weight) <= 0) return t;
  }
  return spec.types[0]!;
}

/** Curva de crecimiento: qué parte de las views totales tiene una pieza a cierta edad. */
const growth = (ageDays: number) => 1 - Math.exp(-ageDays / 2.2) * 0.92 - 0.08 * Math.exp(-ageDays / 25);

async function clear() {
  const demo = await db.select({ id: schema.socialAccounts.id }).from(schema.socialAccounts).where(sql`(${schema.socialAccounts.meta} ->> 'demo') = 'true'`);
  for (const a of demo) {
    await db.delete(schema.contentItems).where(eq(schema.contentItems.socialAccountId, a.id)); // snapshots y retención caen en cascada
    await db.delete(schema.socialAccounts).where(eq(schema.socialAccounts.id, a.id));
  }
  return demo.length;
}

async function load() {
  await clear();
  const now = Date.now();
  for (const spec of specs) {
    const [real] = await db
      .select({ id: schema.socialAccounts.id })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.platform, spec.platform), eq(schema.socialAccounts.current, true)));
    if (real) {
      console.log(`Se salta ${spec.platform}: ya hay una cuenta real conectada.`);
      continue;
    }
    const [account] = await db
      .insert(schema.socialAccounts)
      .values({
        platform: spec.platform,
        externalId: `demo-${spec.platform.toLowerCase()}`,
        handle: spec.handle,
        displayName: spec.name,
        ...encryptTokens(spec.platform, "demo", null),
        status: "ACTIVE",
        current: true,
        meta: { demo: true },
        backfillCompletedAt: new Date(),
        lastSyncedAt: new Date(now - 40 * 60_000),
      })
      .returning({ id: schema.socialAccounts.id });
    const accountId = account!.id;

    // Piezas de los últimos 180 días, en horarios con un patrón (mejor rendimiento martes y jueves de 18 a 21 h).
    const items: (typeof schema.contentItems.$inferInsert)[] = [];
    const total = Math.round((180 / 7) * spec.perWeek);
    for (let i = 0; i < total; i++) {
      const t = chooseType(spec);
      const day = Math.floor(rand() * 180);
      const hour = pick([8, 9, 12, 13, 18, 19, 20, 21]);
      const published = new Date(now - day * DAY);
      published.setUTCHours(hour + 6, Math.floor(rand() * 60), 0, 0);
      if (published.getTime() > now) published.setTime(now - 3 * 3_600_000);
      const ageDays = (now - published.getTime()) / DAY;
      const dow = published.getUTCDay();
      const timeBoost = (dow === 2 || dow === 4 ? 1.35 : 1) * (hour >= 18 ? 1.25 : 0.9);
      const viral = rand() < 0.07 ? 3 + rand() * 6 : 1;
      const finalViews = Math.round(logNormal(t.median, 0.55) * timeBoost * viral);
      const views = Math.round(finalViews * Math.max(0.05, growth(ageDays)));
      const er = 0.035 + rand() * 0.05;
      const likes = Math.round(views * er * 0.75);
      const comments = Math.round(views * er * 0.06);
      const shares = Math.round(views * er * (spec.platform === "TIKTOK" ? 0.12 : 0.09));
      const saves = spec.platform === "INSTAGRAM" ? Math.round(views * er * (t.type === "CAROUSEL" ? 0.35 : 0.12)) : null;
      const duration = t.duration[1] ? Math.round(t.duration[0] + rand() * (t.duration[1] - t.duration[0])) : null;
      const title = `${pick(hooks)}${rand() < 0.3 ? ` (parte ${1 + Math.floor(rand() * 3)})` : ""}`;
      const isIg = spec.platform === "INSTAGRAM";
      const isYt = spec.platform === "YOUTUBE";
      items.push({
        socialAccountId: accountId,
        platform: spec.platform,
        externalId: `demo-${spec.platform.toLowerCase()}-${i}`,
        type: t.type,
        caption: isYt ? `${title}\n\nEn este video te cuento paso a paso cómo lo hago, con ejemplos reales.` : `${title} 👇\n\nGuárdalo para cuando lo necesites y comparte con alguien que lo necesita.`,
        title: isIg ? null : title,
        permalink: null,
        thumbnailUrl: null,
        thumbnailSourceUrl: null,
        publishedAt: published,
        durationSec: duration,
        views,
        reach: isIg ? Math.round(views * (0.62 + rand() * 0.2)) : null,
        likes,
        comments,
        shares,
        saves,
        totalInteractions: isIg ? likes + comments + shares + (saves ?? 0) : null,
        follows: isIg ? Math.round(views * 0.002 * viral) : null,
        profileVisits: isIg ? Math.round(views * 0.012) : null,
        avgWatchSec: duration ? Math.round(duration * (0.35 + rand() * 0.3) * 10) / 10 : null,
        skipRate: isIg && t.type === "REEL" ? Math.round((28 + rand() * 30) * 10) / 10 : null,
        avgViewPercentage: isYt ? Math.round((t.type === "SHORT" ? 70 + rand() * 25 : 30 + rand() * 25) * 10) / 10 : null,
        watchTimeMinutes: isYt && duration ? Math.round(views * duration * 0.45) / 60 : null,
        subscribersGained: isYt ? Math.round(views * 0.003 * viral) : null,
        engagedViews: isYt ? Math.round(views * 0.8) : null,
        views24h: ageDays >= 1 ? Math.round(finalViews * growth(1)) : null,
        views72h: ageDays >= 3 ? Math.round(finalViews * growth(3)) : null,
        views7d: ageDays >= 7 ? Math.round(finalViews * growth(7)) : null,
        insightsStatus: ageDays < 1 && isIg ? "PENDING" : "OK",
        available: rand() > 0.02,
        unavailableSince: null,
        lastSeenAt: new Date(),
        metricsUpdatedAt: new Date(),
        raw: { demo: true, finalViews },
      });
    }
    const saved = await db.insert(schema.contentItems).values(items).returning({ id: schema.contentItems.id, publishedAt: schema.contentItems.publishedAt, raw: schema.contentItems.raw, type: schema.contentItems.type });

    // Fotos diarias de las piezas de los últimos 30 días (para las curvas de crecimiento y TikTok por día).
    const snaps: (typeof schema.metricSnapshots.$inferInsert)[] = [];
    for (const it of saved) {
      const finalViews = (it.raw as { finalViews: number }).finalViews;
      const age = (now - it.publishedAt.getTime()) / DAY;
      if (age > 40) continue;
      for (let d = Math.floor(age); d >= 0; d--) {
        const day = new Date(now - d * DAY).toISOString().slice(0, 10);
        const ageAt = age - d;
        if (ageAt < 0) continue;
        snaps.push({ contentItemId: it.id, capturedOn: day, ageHours: Math.round(ageAt * 24), views: Math.round(finalViews * Math.max(0.05, growth(ageAt))) });
      }
    }
    for (let i = 0; i < snaps.length; i += 1000) await db.insert(schema.metricSnapshots).values(snaps.slice(i, i + 1000)).onConflictDoNothing();

    // Totales diarios de la cuenta (180 días) con crecimiento de seguidores.
    const days: (typeof schema.accountSnapshots.$inferInsert)[] = [];
    let followers = Math.round(spec.followers * 0.78);
    for (let d = 180; d >= 0; d--) {
      const gained = Math.round(spec.followers * 0.0016 * (0.5 + rand()));
      const lost = Math.round(gained * (0.15 + rand() * 0.2));
      followers += gained - lost;
      const dayViews = Math.round(spec.followers * 0.32 * (0.6 + rand() * 0.9) * (d % 7 === 2 || d % 7 === 4 ? 1.3 : 1));
      days.push({
        socialAccountId: accountId,
        capturedOn: new Date(now - d * DAY).toISOString().slice(0, 10),
        followers,
        following: spec.platform === "INSTAGRAM" ? 412 : null,
        views: spec.platform === "TIKTOK" ? null : dayViews,
        reach: spec.platform === "INSTAGRAM" ? Math.round(dayViews * 0.55) : null,
        accountsEngaged: spec.platform === "INSTAGRAM" ? Math.round(dayViews * 0.04) : null,
        interactions: Math.round(dayViews * 0.05),
        profileLinksTaps: spec.platform === "INSTAGRAM" ? Math.round(dayViews * 0.002) : null,
        follows: spec.platform === "INSTAGRAM" ? gained : null,
        unfollows: spec.platform === "INSTAGRAM" ? lost : null,
        subscribersGained: spec.platform === "YOUTUBE" ? gained : null,
        subscribersLost: spec.platform === "YOUTUBE" ? lost : null,
        watchTimeMinutes: spec.platform === "YOUTUBE" ? Math.round(dayViews * 2.4) : null,
        totalLikes: spec.platform === "TIKTOK" ? 900_000 + (180 - d) * 3_100 : null,
      });
    }
    await db.insert(schema.accountSnapshots).values(days);

    // Retención de los videos de YouTube.
    if (spec.platform === "YOUTUBE") {
      const curves = saved
        .filter((s) => now - s.publishedAt.getTime() > 7 * DAY)
        .map((s) => {
          const short = s.type === "SHORT";
          const points = Array.from({ length: 21 }, (_, k) => {
            const at = k / 20;
            const ratio = short ? 1.05 - at * 0.35 : Math.max(0.12, 0.95 * Math.exp(-at * 1.6) + (at > 0.85 ? -0.05 : 0));
            return { at, ratio: Math.round(ratio * 1000) / 1000 };
          });
          return { contentItemId: s.id, points };
        });
      if (curves.length) await db.insert(schema.retentionCurves).values(curves);
    }
    console.log(`${spec.platform}: ${saved.length} piezas, ${snaps.length} fotos diarias.`);
  }
  // Puntajes contra la mediana.
  const { recomputePerfScores } = await import("../lib/social/sync/store");
  await recomputePerfScores();
}

const action = process.argv[2];
(async () => {
  if (action === "cargar") await load();
  else if (action === "borrar") console.log(`Demo borrada (${await clear()} cuentas).`);
  else {
    console.log("Uso: pnpm demo cargar | pnpm demo borrar");
    process.exit(1);
  }
  process.exit(0);
})().catch((error: unknown) => {
  console.error("Falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
