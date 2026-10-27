import "server-only";
/**
 * Datos de demostración: tres cuentas (Instagram, YouTube y TikTok) con 6 meses de contenido y métricas creíbles.
 * Sirve para mostrar el producto en una venta sin conectar cuentas reales, y para revisar pantallas.
 * Se usa desde Ajustes (solo el dueño) o con `pnpm demo cargar | borrar`.
 *
 * Las cuentas demo llevan meta.demo = true: el cron no las sincroniza.
 * No se carga la demo de una red que ya tiene una cuenta real conectada.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { clearCarouselDemo, loadCarouselDemo } from "@/lib/carousels/demo";
import { addDays, todayIn } from "@/lib/calendar/dates";
import type { CalendarStatus, PlannedFormat } from "@/lib/calendar/labels";
import { env } from "@/lib/env";
import { encryptTokens } from "@/lib/social/tokens";
import type { ContentType, Platform } from "@/lib/social/types";

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

export async function clearDemo(): Promise<number> {
  const db = getDb();
  // Piezas de calendario de la demo (sus destinos caen en cascada). Las reales no se tocan.
  await db.delete(schema.calendarEntries).where(eq(schema.calendarEntries.demo, true));
  await clearCarouselDemo();
  const demo = await db.select({ id: schema.socialAccounts.id }).from(schema.socialAccounts).where(sql`(${schema.socialAccounts.meta} ->> 'demo') = 'true'`);
  for (const a of demo) {
    await db.delete(schema.contentItems).where(eq(schema.contentItems.socialAccountId, a.id)); // snapshots y retención caen en cascada
    await db.delete(schema.socialAccounts).where(eq(schema.socialAccounts.id, a.id));
  }
  return demo.length;
}

export async function loadDemo(): Promise<string[]> {
  const db = getDb();
  seed = 42;
  const loaded: string[] = [];
  await clearDemo();
  // Si ya hay alguna cuenta real (actual o con histórico), no se carga la demo: mezclar redes reales con
  // inventadas ensucia las medianas, el puntaje y lo que lee la IA.
  const [anyReal] = await db
    .select({ id: schema.socialAccounts.id })
    .from(schema.socialAccounts)
    .where(sql`coalesce(${schema.socialAccounts.meta} ->> 'demo', 'false') <> 'true'`)
    .limit(1);
  if (anyReal) return [];
  const now = Date.now();
  for (const spec of specs) {
    const [real] = await db
      .select({ id: schema.socialAccounts.id })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.platform, spec.platform), eq(schema.socialAccounts.current, true)));
    if (real) {
      // Ya hay una cuenta real conectada de esta red: no se mezcla con la demo.
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
      const isYtVideo = isYt && t.type === "VIDEO";
      items.push({
        socialAccountId: accountId,
        platform: spec.platform,
        externalId: `demo-${spec.platform.toLowerCase()}-${i}`,
        type: t.type,
        caption: isYt ? `${title}\n\nEn este video te cuento paso a paso cómo lo hago, con ejemplos reales.` : `${title} 👇\n\nGuárdalo para cuando lo necesites y comparte con alguien que lo necesita.`,
        title: isIg ? null : title,
        permalink: null,
        // Miniaturas abstractas propias (public/demo): sin fotos de terceros.
        thumbnailUrl: isYtVideo ? `/demo/h${(i % 8) + 1}.svg` : `/demo/v${(i % 12) + 1}.svg`,
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
    loaded.push(`${spec.platform}: ${saved.length} piezas`);
  }
  // Puntajes contra la mediana.
  const { recomputePerfScores } = await import("@/lib/social/sync/store");
  await recomputePerfScores();
  const planned = await loadDemoCalendar();
  if (planned) loaded.push(`Calendario: ${planned} piezas`);
  const { created } = await loadCarouselDemo();
  if (created) loaded.push(`Carruseles: ${created}`);
  return loaded;
}

// ─── Calendario de la demo ─────────────────────────────────────────────────

type DemoEntry = {
  title: string;
  hook?: string;
  pillar: string;
  format: PlannedFormat;
  status: CalendarStatus;
  date: string | null;
  time?: string | null;
  platforms: Platform[];
  notes?: string;
  link?: { platform: Platform; itemId: string; status: "LINKED" | "SUGGESTED"; score: number };
};

const demoPillars = ["Crecer en redes", "Vender con contenido", "Detrás de cámaras"];

const plannedFormatFor = (platform: Platform, type: ContentType): PlannedFormat =>
  type === "CAROUSEL" ? "CAROUSEL" : type === "IMAGE" ? "POST" : type === "SHORT" ? "SHORT" : type === "REEL" ? "REEL" : platform === "YOUTUBE" ? "VIDEO" : "REEL";

/**
 * Piezas de calendario creíbles para la demo: publicadas y vinculadas con piezas demo reales (con su métrica),
 * dos sugerencias por confirmar, lo próximo en distintos estados y redes, y unas ideas sin fecha.
 * Todas llevan `demo = true`: clearDemo las borra sin tocar las reales.
 */
async function loadDemoCalendar(): Promise<number> {
  const db = getDb();
  const tz = env().APP_TIMEZONE;
  const today = todayIn(tz);
  const recent = await db.execute<{ id: string; platform: Platform; type: ContentType; title: string | null; caption: string | null; day: string; hhmm: string }>(sql`
    select ci.id, ci.platform, ci.type, ci.title, ci.caption,
      to_char((ci.published_at at time zone ${tz})::date, 'YYYY-MM-DD') as day,
      to_char(ci.published_at at time zone ${tz}, 'HH24:MI') as hhmm
    from content_items ci join social_accounts sa on sa.id = ci.social_account_id
    where (sa.meta ->> 'demo') = 'true' and ci.available and ci.published_at > now() - interval '24 days'
      and ci.published_at < now() - interval '20 hours'
    order by ci.published_at desc
  `);
  const pieces = recent.rows;
  const text = (p: (typeof pieces)[number]) =>
    (p.title || p.caption?.split("\n")[0] || "")
      .replace(/\s*👇\s*$/, "")
      .replace(/\s*\(parte \d\)$/, "")
      .trim();
  const entries: DemoEntry[] = [];
  const used = new Set<string>();
  const usedText = new Set<string>();

  // Dos sugerencias "¿Es esta?": lo planeado decía algo parecido y se publicó un día después.
  const lower = (t: string) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  const rewordings = [(t: string) => `Versión corta: ${lower(t)}`, (t: string) => `Reel sobre ${lower(t)}`];
  for (const p of pieces.slice(0, 12)) {
    if (entries.length >= 2) break;
    if (usedText.has(text(p)) || p.type === "CAROUSEL") continue;
    used.add(p.id);
    usedText.add(text(p));
    entries.push({
      title: rewordings[entries.length]!(text(p)),
      pillar: demoPillars[entries.length % 3]!,
      format: plannedFormatFor(p.platform, p.type),
      status: "READY",
      date: addDays(p.day, -1),
      time: "19:00",
      platforms: [p.platform],
      link: { platform: p.platform, itemId: p.id, status: "SUGGESTED", score: entries.length ? 0.62 : 0.68 },
    });
  }

  // Lo ya publicado, vinculado con su pieza real: una por día como mucho y sin repetir textos.
  const days = new Set<string>();
  for (const p of pieces) {
    if (entries.filter((e) => e.link?.status === "LINKED").length >= 14) break;
    if (used.has(p.id) || usedText.has(text(p)) || days.has(p.day)) continue;
    used.add(p.id);
    usedText.add(text(p));
    days.add(p.day);
    entries.push({
      title: text(p),

      pillar: demoPillars[entries.length % 3]!,
      format: plannedFormatFor(p.platform, p.type),
      status: "PUBLISHED",
      date: p.day,
      time: `${p.hhmm.slice(0, 2)}:00`,
      platforms: [p.platform],
      link: { platform: p.platform, itemId: p.id, status: "LINKED", score: 0.8 + ((entries.length * 37) % 18) / 100 },
    });
  }

  // Lo que viene.
  const upcoming: DemoEntry[] = [
    { title: "Cómo respondo cuando me dicen “está caro”", hook: "Si te dicen “está caro”, no bajes el precio: haz esta pregunta.", pillar: "Vender con contenido", format: "REEL", status: "PRODUCTION", date: today, time: "19:00", platforms: ["INSTAGRAM", "TIKTOK"] },
    { title: "El guion de 30 segundos para cerrar ventas por DM", hook: "Este mensaje de 30 segundos me trajo más clientes que un año de anuncios.", pillar: "Vender con contenido", format: "REEL", status: "READY", date: addDays(today, 1), time: "18:30", platforms: ["INSTAGRAM", "TIKTOK"], notes: "Grabar con la luz de la ventana. CTA: comenta GUION." },
    { title: "Mi sistema para grabar un mes en una tarde", hook: "Grabo 30 videos en 4 horas. Este es el sistema exacto.", pillar: "Detrás de cámaras", format: "VIDEO", status: "PRODUCTION", date: addDays(today, 2), time: "10:00", platforms: ["YOUTUBE"] },
    { title: "5 ganchos de contraste para tu próximo reel", hook: "Guarda estos 5 ganchos: funcionan en cualquier nicho.", pillar: "Crecer en redes", format: "CAROUSEL", status: "SCRIPTING", date: addDays(today, 3), platforms: ["INSTAGRAM"] },
    { title: "Lo que nadie te dice de los primeros 1,000 seguidores", pillar: "Crecer en redes", format: "SHORT", status: "READY", date: addDays(today, 4), time: "18:00", platforms: ["YOUTUBE"] },
    { title: "Un día grabando contenido conmigo", pillar: "Detrás de cámaras", format: "REEL", status: "IDEA", date: addDays(today, 5), platforms: ["TIKTOK"] },
    { title: "Por qué tu CTA no convierte (y cómo arreglarlo)", hook: "Tu CTA no falla por el texto. Falla por el momento.", pillar: "Vender con contenido", format: "REEL", status: "SCRIPTING", date: addDays(today, 7), time: "19:00", platforms: ["INSTAGRAM", "TIKTOK"] },
    { title: "Plantilla: planea tu mes en 2 horas", pillar: "Crecer en redes", format: "CAROUSEL", status: "IDEA", date: addDays(today, 9), platforms: ["INSTAGRAM"] },
    { title: "Respuesta a la duda más común de mis alumnos", pillar: "Vender con contenido", format: "CLONE_VIDEO", status: "PRODUCTION", date: addDays(today, 11), time: "12:00", platforms: ["INSTAGRAM", "TIKTOK"] },
    { title: "Mi estudio por menos de 300 dólares", pillar: "Detrás de cámaras", format: "VIDEO", status: "IDEA", date: addDays(today, 13), platforms: ["YOUTUBE"] },
  ];
  const undated: DemoEntry[] = [
    { title: "Errores de edición que bajan tu retención", hook: "Si tu video pierde gente en el segundo 3, es por esto.", pillar: "Crecer en redes", format: "REEL", status: "IDEA", date: null, platforms: ["INSTAGRAM", "TIKTOK"] },
    { title: "Caso: de 0 a 10 clientes con contenido orgánico", pillar: "Vender con contenido", format: "VIDEO", status: "IDEA", date: null, platforms: ["YOUTUBE"] },
    { title: "Las 3 apps que uso para todo", pillar: "Detrás de cámaras", format: "CAROUSEL", status: "IDEA", date: null, platforms: ["INSTAGRAM"] },
  ];
  entries.push(...upcoming, ...undated);

  const positions = new Map<string, number>();
  for (const e of entries) {
    const key = e.date ?? "none";
    const position = positions.get(key) ?? 0;
    positions.set(key, position + 1);
    const [row] = await db
      .insert(schema.calendarEntries)
      .values({
        title: e.title,
        hook: e.hook ?? null,
        pillar: e.pillar,
        notes: e.notes ?? null,
        format: e.format,
        status: e.status,
        scheduledDate: e.date,
        scheduledTime: e.date ? (e.time ?? null) : null,
        position,
        source: "manual",
        demo: true,
      })
      .returning({ id: schema.calendarEntries.id });
    await db.insert(schema.calendarTargets).values(
      e.platforms.map((platform) => {
        const link = e.link?.platform === platform ? e.link : null;
        return {
          entryId: row!.id,
          platform,
          linkStatus: link?.status ?? ("NONE" as const),
          contentItemId: link?.itemId ?? null,
          linkScore: link ? Math.round(link.score * 100) / 100 : null,
          linkedAt: link?.status === "LINKED" ? new Date() : null,
        };
      }),
    );
  }
  return entries.length;
}

/** true si hay cuentas de demostración cargadas. */
export async function hasDemo(): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.socialAccounts.id })
    .from(schema.socialAccounts)
    .where(sql`(${schema.socialAccounts.meta} ->> 'demo') = 'true'`)
    .limit(1);
  return rows.length > 0;
}

