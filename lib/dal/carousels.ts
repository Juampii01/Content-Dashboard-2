import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getBrand } from "@/lib/ai/brand-context";
import { getDb, schema } from "@/lib/db";
import type { CarouselSlide } from "@/lib/db/schema";
import type { BrandLook, SlideIdentity } from "@/lib/carousels/theme";
import type { CarouselStatus } from "@/lib/carousels/labels";

const UUID = /^[0-9a-f-]{36}$/i;

export type CarouselListItem = {
  id: string;
  title: string;
  status: CarouselStatus;
  template: string;
  theme: Record<string, string> | null;
  cover: CarouselSlide | null;
  slideCount: number;
  demo: boolean;
  updatedAt: Date;
};

export async function listCarousels(status: string | null): Promise<CarouselListItem[]> {
  await getCurrentUser();
  const where = status && status !== "todos" ? eq(schema.carousels.status, status as CarouselStatus) : ne(schema.carousels.status, "ARCHIVED");
  const rows = await getDb()
    .select({
      id: schema.carousels.id,
      title: schema.carousels.title,
      status: schema.carousels.status,
      template: schema.carousels.template,
      theme: schema.carousels.theme,
      cover: sql<CarouselSlide | null>`${schema.carousels.slides}->0`,
      slideCount: sql<number>`jsonb_array_length(${schema.carousels.slides})::int`,
      demo: schema.carousels.demo,
      updatedAt: schema.carousels.updatedAt,
    })
    .from(schema.carousels)
    .where(where)
    .orderBy(desc(schema.carousels.updatedAt))
    .limit(200);
  return rows;
}

export async function countCarouselsByStatus(): Promise<Record<string, number>> {
  await getCurrentUser();
  const rows = await getDb().select({ status: schema.carousels.status, n: sql<number>`count(*)::int` }).from(schema.carousels).groupBy(schema.carousels.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function getCarousel(id: string) {
  await getCurrentUser();
  if (!UUID.test(id)) return null;
  const [row] = await getDb().select().from(schema.carousels).where(eq(schema.carousels.id, id)).limit(1);
  if (!row) return null;
  const [script] = row.scriptId
    ? await getDb().select({ id: schema.scripts.id, title: schema.scripts.title }).from(schema.scripts).where(eq(schema.scripts.id, row.scriptId)).limit(1)
    : [];
  return { carousel: row, script: script ?? null };
}

/** URL de la foto de perfil de Instagram guardada por el sync (en `avatar_url`, o en `meta` si la red la manda ahí). */
export async function instagramAvatarSource(): Promise<string | null> {
  const [account] = await getDb()
    .select({ avatarUrl: schema.socialAccounts.avatarUrl, meta: schema.socialAccounts.meta })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.platform, "INSTAGRAM"), eq(schema.socialAccounts.current, true)))
    .limit(1);
  if (!account) return null;
  const fromMeta = account.meta?.profilePictureUrl ?? account.meta?.profile_picture_url;
  const url = account.avatarUrl ?? (typeof fromMeta === "string" ? fromMeta : null);
  return url && /^https:\/\//.test(url) ? url : null;
}

export type CarouselLook = BrandLook & {
  identity: SlideIdentity;
  bannedWords: string[];
  keywords: { keyword: string; offer: string }[];
};

/**
 * Lo que necesitan las plantillas: colores y fuentes de Mi marca, nombre y handle, y la foto de perfil.
 * La foto se sirve desde /api/carruseles/avatar (mismo origen) para que la exportación a imagen funcione.
 */
export async function getCarouselLook(): Promise<CarouselLook> {
  await getCurrentUser();
  const [brand, ig] = await Promise.all([
    getBrand(),
    getDb()
      .select({ handle: schema.socialAccounts.handle, displayName: schema.socialAccounts.displayName })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.platform, "INSTAGRAM"), eq(schema.socialAccounts.current, true)))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);
  const avatar = await instagramAvatarSource();
  const rawHandle = brand?.handle || ig?.handle || "";
  const handle = rawHandle ? `@${rawHandle.replace(/^@/, "")}` : "";
  const name = brand?.name || ig?.displayName || rawHandle.replace(/^@/, "") || "Tu marca";
  return {
    colors: brand?.colors ?? null,
    fonts: brand?.fonts ?? null,
    identity: { name, handle, avatarUrl: avatar ? `/api/carruseles/avatar?v=${encodeURIComponent(avatar.slice(-24))}` : null },
    bannedWords: brand?.bannedWords ?? [],
    keywords: (brand?.offers ?? []).filter((o) => o.keyword).map((o) => ({ keyword: o.keyword!, offer: o.name })),
  };
}

/** Guiones para elegir como origen de un carrusel (los más recientes, sin archivados). */
export async function listScriptsForCarousel(): Promise<{ id: string; title: string; beats: number }[]> {
  await getCurrentUser();
  const rows = await getDb()
    .select({ id: schema.scripts.id, title: schema.scripts.title, beats: sql<number>`coalesce(jsonb_array_length(${schema.scripts.content}->'beats'), 0)::int` })
    .from(schema.scripts)
    .where(ne(schema.scripts.status, "ARCHIVED"))
    .orderBy(desc(schema.scripts.updatedAt))
    .limit(50);
  return rows;
}
