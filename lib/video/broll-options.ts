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
