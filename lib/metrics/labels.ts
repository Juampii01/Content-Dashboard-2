import type { ContentType, Platform } from "@/lib/social/types";

export const typeLabel: Record<ContentType, string> = { REEL: "Reel", CAROUSEL: "Carrusel", IMAGE: "Publicación", VIDEO: "Video", SHORT: "Short" };
export const platformTypes: Record<Platform, ContentType[]> = {
  INSTAGRAM: ["REEL", "CAROUSEL", "IMAGE", "VIDEO"],
  YOUTUBE: ["VIDEO", "SHORT"],
  TIKTOK: ["VIDEO"],
};

/** Proporción de la miniatura según red y tipo. */
export function aspectFor(platform: Platform, type: ContentType): "9:16" | "4:5" | "16:9" | "1:1" {
  if (platform === "YOUTUBE" && type === "VIDEO") return "16:9";
  if (type === "IMAGE" || type === "CAROUSEL") return "4:5";
  return "9:16";
}
