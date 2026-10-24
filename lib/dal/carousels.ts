import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getBrand } from "@/lib/ai/brand-context";
import { getDb, schema } from "@/lib/db";
import type { CarouselSlide } from "@/lib/db/schema";
import type { BrandLook, SlideIdentity } from "@/lib/carousels/theme";
import type { CarouselStatus } from "@/lib/carousels/labels";
import { carouselFilesReady } from "@/lib/carousels/files";
import { providersStatus, type ImageProvidersStatus } from "@/lib/carousels/images";
import { activeImageJob, imagesLast24h } from "@/lib/carousels/images/service";
import type { TemplateSpec } from "@/lib/carousels/template-spec";
import { getTemplate, latestStyleJob, listTemplates, type TemplateListItem } from "@/lib/carousels/templates";
import { workerStatus } from "@/lib/jobs";
import { activeAnimation } from "@/lib/carousels/animate";
import { copyOfCarousel, getCopyRow, latestCopyJob } from "@/lib/carousels/copy";
import { characterPhotos, type CharacterPhoto } from "@/lib/carousels/photos";
import type { CarouselCopyOptions } from "@/lib/db/schema";

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

// ─── Plantillas desde referencia ──────────────────────────────────────────

export type TemplateView = {
  id: string;
  name: string;
  status: "ANALYZING" | "READY" | "FAILED";
  source: string;
  referenceCount: number;
  spec: TemplateSpec | null;
  errorMessage: string | null;
  updatedAt: string;
  /** Trabajo de análisis en curso (o el último), para mostrar el progreso. */
  job: { id: string; status: string; progress: number; stage: string | null; errorMessage: string | null } | null;
};

async function toView(t: TemplateListItem): Promise<TemplateView> {
  const job = t.status === "ANALYZING" || t.status === "FAILED" ? await latestStyleJob(t.id) : null;
  const failedByJob = t.status === "ANALYZING" && (job?.status === "FAILED" || job?.status === "CANCELED");
  return {
    id: t.id,
    name: t.name,
    status: failedByJob ? "FAILED" : t.status,
    source: t.source,
    referenceCount: t.referenceCount,
    spec: t.spec,
    errorMessage: t.errorMessage ?? (failedByJob ? (job?.errorMessage ?? "El análisis se canceló.") : null),
    updatedAt: t.updatedAt.toISOString(),
    job,
  };
}

export async function listCarouselTemplates(onlyReady = false): Promise<TemplateView[]> {
  await getCurrentUser();
  const rows = await listTemplates(onlyReady);
  return Promise.all(rows.map(toView));
}

export async function getCarouselTemplate(id: string): Promise<TemplateView | null> {
  await getCurrentUser();
  if (!UUID.test(id)) return null;
  const row = await getTemplate(id);
  return row ? toView(row) : null;
}

// ─── Imágenes con IA ──────────────────────────────────────────────────────

export type CarouselImageState = {
  providers: ImageProvidersStatus;
  last24h: { chatgpt: number; openai: number };
  activeJobId: string | null;
  /** Video de un slide en curso (se puede salir y volver). */
  animation: { jobId: string; slideId: string } | null;
  /** Fotos del personaje de Mi marca, con sus rasgos (para elegir la referencia de la cara por slide). */
  photos: CharacterPhoto[];
  /** Carrusel copiado de otro: el @ del original (para avisar si se cuela). */
  copy: { id: string; handle: string | null; sourceUrl: string | null } | null;
  workerOnline: boolean;
  workerAutoStart: boolean;
  storageReady: boolean;
};

export async function getCarouselImageState(carouselId: string): Promise<CarouselImageState> {
  await getCurrentUser();
  const valid = UUID.test(carouselId);
  const [providers, last24h, active, worker, animation, photos, copy] = await Promise.all([
    providersStatus(),
    imagesLast24h(),
    valid ? activeImageJob(carouselId) : null,
    workerStatus(),
    valid ? activeAnimation(carouselId) : null,
    characterPhotos(),
    valid ? copyOfCarousel(carouselId) : null,
  ]);
  return {
    providers,
    last24h,
    activeJobId: active?.id ?? null,
    animation: animation ? { jobId: animation.id, slideId: animation.slideId } : null,
    photos,
    copy,
    workerOnline: worker.online,
    workerAutoStart: worker.autoStart,
    storageReady: carouselFilesReady(),
  };
}

/** Estado de la conexión de ChatGPT y de la API key de OpenAI, para Ajustes. */
export async function getImageKeysStatus() {
  const me = await getCurrentUser();
  const [providers, last24h, worker] = await Promise.all([providersStatus(), imagesLast24h(), workerStatus()]);
  const [login] = await getDb()
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "CODEX_LOGIN"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"])))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  return { isOwner: me.role === "OWNER", providers, last24h, loginJobId: login?.id ?? null, workerOnline: worker.online, workerAutoStart: worker.autoStart };
}

// ─── Copiar un carrusel ───────────────────────────────────────────────────

export type CopyView = {
  id: string;
  status: "ANALYZING" | "READY" | "FAILED";
  source: string;
  sourceUrl: string | null;
  referenceCount: number;
  options: CarouselCopyOptions;
  carouselId: string | null;
  errorMessage: string | null;
  /** Falló al bajar el link: se ofrece subir las imágenes. */
  linkFailed: boolean;
  job: { id: string; status: string; progress: number; stage: string | null; errorMessage: string | null } | null;
  workerOnline: boolean;
  workerAutoStart: boolean;
};

export async function getCopyView(id: string): Promise<CopyView | null> {
  await getCurrentUser();
  if (!UUID.test(id)) return null;
  const [row, job, worker] = await Promise.all([getCopyRow(id), latestCopyJob(id), workerStatus()]);
  if (!row) return null;
  const failedByJob = row.status === "ANALYZING" && (job?.status === "FAILED" || job?.status === "CANCELED");
  const status = failedByJob ? "FAILED" : row.status;
  const errorMessage = row.errorMessage ?? (failedByJob ? (job?.errorMessage ?? "La lectura se canceló.") : null);
  return {
    id: row.id,
    status,
    source: row.source,
    sourceUrl: row.sourceUrl,
    referenceCount: row.referenceCount,
    options: row.options,
    carouselId: row.carouselId,
    errorMessage,
    linkFailed: status === "FAILED" && row.source === "link",
    job,
    workerOnline: worker.online,
    workerAutoStart: worker.autoStart,
  };
}

/** Lo que necesita la pantalla de "Copiar un carrusel": fotos del personaje y plantillas para elegir. */
export async function getCopySetup() {
  await getCurrentUser();
  const [photos, templates, providers, last24h] = await Promise.all([characterPhotos(), listCarouselTemplates(true), providersStatus(), imagesLast24h()]);
  return { photos, templates, providers, last24h, storageReady: carouselFilesReady() };
}
