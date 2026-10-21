/**
 * Alternativas de b-roll: lectura de la respuesta de Pexels y búsqueda en la biblioteca del cliente.
 * Funciones puras (sin red ni base): las usan las fuentes de lib/video/broll.ts y las pruebas.
 */
import type { BrollOption, VideoFormat } from "./types";

/** Lo que usamos de un video de la API de Pexels (GET /videos/search). */
export type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  url: string;
  image?: string | null;
  duration: number;
  user?: { name?: string; url?: string } | null;
  video_files?: { id?: number; quality?: string | null; file_type?: string | null; width?: number | null; height?: number | null; link: string }[];
};

/**
 * Un video de Pexels como alternativa: el archivo para el render (MP4, el más chico que cubre 1080 en el lado
 * corto; si no hay, el más grande hasta 4K) y uno liviano para la vista previa. null si no tiene MP4 usable.
 */
export function mapPexelsVideo(video: PexelsVideo, format: VideoFormat): BrollOption | null {
  const files = (video.video_files ?? []).filter((f) => (f.file_type ?? "video/mp4") === "video/mp4" && f.width && f.height && /^https?:\/\//.test(f.link));
  if (!files.length || !video.duration) return null;
  const short = (f: (typeof files)[number]) => Math.min(f.width!, f.height!);
  const sorted = [...files].sort((a, b) => short(a) - short(b));
  const render = sorted.find((f) => short(f) >= 1080 && short(f) <= 2160) ?? [...sorted].reverse().find((f) => short(f) <= 2160) ?? sorted[0]!;
  const preview = sorted.find((f) => short(f) >= 360) ?? sorted[0]!;
  const portrait = video.height >= video.width;
  if (format === "9:16" && !portrait && video.width / video.height > 2.2) return null; // un panorama no se recorta bien a vertical
  return {
    source: "pexels",
    id: String(video.id),
    duration: video.duration,
    width: video.width,
    height: video.height,
    thumb: video.image ?? null,
    preview: preview.link,
    file: render.link,
    credit: { name: video.user?.name?.trim() || "Autor de Pexels", url: video.user?.url ?? "https://www.pexels.com", page: video.url },
  };
}

/** Lo que usamos de un video de la API de Pixabay (GET /api/videos/). */
export type PixabayVideo = {
  id: number;
  pageURL: string;
  duration: number;
  user?: string | null;
  user_id?: number | null;
  videos?: Partial<Record<"large" | "medium" | "small" | "tiny", { url?: string | null; width?: number | null; height?: number | null; thumbnail?: string | null } | null>>;
};

/**
 * Un video de Pixabay como alternativa: para el render, el más chico que cubre 1080 en el lado corto (si no hay,
 * el más grande); para la vista previa, uno liviano. Pixabay no filtra por orientación: lo hacemos aquí.
 */
export function mapPixabayVideo(video: PixabayVideo, format: VideoFormat): BrollOption | null {
  const files = (["tiny", "small", "medium", "large"] as const)
    .map((k) => video.videos?.[k])
    .filter((f): f is { url: string; width: number; height: number; thumbnail?: string | null } => Boolean(f?.url && f.width && f.height && /^https?:\/\//.test(f.url)));
  if (!files.length || !video.duration) return null;
  const short = (f: (typeof files)[number]) => Math.min(f.width, f.height);
  const sorted = [...files].sort((a, b) => short(a) - short(b));
  const render = sorted.find((f) => short(f) >= 1080 && short(f) <= 2160) ?? [...sorted].reverse().find((f) => short(f) <= 2160) ?? sorted[0]!;
  const preview = sorted.find((f) => short(f) >= 360) ?? sorted[0]!;
  const { width, height } = render;
  const portrait = height >= width;
  // En vertical se aceptan clips verticales o apaisados normales (se recortan al centro); en horizontal, solo horizontales.
  if (format === "9:16" && !portrait && width / height > 2.2) return null;
  if (format === "16:9" && portrait) return null;
  const name = video.user?.trim() || "Autor de Pixabay";
  return {
    source: "pixabay",
    id: String(video.id),
    duration: video.duration,
    width,
    height,
    thumb: files.find((f) => f.thumbnail)?.thumbnail ?? null,
    preview: preview.url,
    file: render.url,
    credit: { name, url: video.user_id ? `https://pixabay.com/users/${video.user_id}/` : "https://pixabay.com", page: video.pageURL },
  };
}

/** Minúsculas y sin tildes, para comparar palabras clave con etiquetas. */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .trim();
}

export type LibraryClip = { id: string; title: string; tags: string[]; fileKey: string; thumbKey: string | null; duration: number; width: number; height: number };

/** Qué tan bien un clip propio responde a las palabras clave (etiquetas valen más que el título). 0 = nada. */
export function libraryScore(clip: Pick<LibraryClip, "title" | "tags">, keywords: string[]): number {
  const wanted = keywords.map(normalizeWord).filter((w) => w.length >= 3);
  if (!wanted.length) return 0;
  const tags = clip.tags.map(normalizeWord);
  const title = normalizeWord(clip.title);
  let score = 0;
  for (const w of wanted) {
    const stem = w.slice(0, Math.max(4, w.length - 2));
    if (tags.some((t) => t === w || t.startsWith(stem) || w.startsWith(t.slice(0, Math.max(4, t.length - 2))))) score += 2;
    else if (title.split(" ").some((t) => t.length >= 3 && (t.startsWith(stem) || w.startsWith(t)))) score += 1;
  }
  return score;
}

export function libraryOption(clip: LibraryClip): BrollOption {
  return {
    source: "library",
    id: clip.id,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
    key: clip.fileKey,
    thumbKey: clip.thumbKey,
    title: clip.title,
  };
}
