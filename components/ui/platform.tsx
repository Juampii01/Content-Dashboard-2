import { cn } from "@/lib/utils";

export type PlatformKey = "INSTAGRAM" | "YOUTUBE" | "TIKTOK";

export const platformMeta: Record<PlatformKey, { label: string; dot: string }> = {
  INSTAGRAM: { label: "Instagram", dot: "bg-instagram" },
  YOUTUBE: { label: "YouTube", dot: "bg-youtube" },
  TIKTOK: { label: "TikTok", dot: "bg-tiktok" },
};

/** Etiqueta de red: un punto de color y el nombre. El color solo distingue, el texto informa. */
export function PlatformBadge({ platform, className }: { platform: PlatformKey; className?: string }) {
  const meta = platformMeta[platform];
  return (
    <span className={cn("pill", className)}>
      <span aria-hidden className={cn("h-2 w-2 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}
