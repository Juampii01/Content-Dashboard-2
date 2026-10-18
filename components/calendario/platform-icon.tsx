import { cn } from "@/lib/utils";
import { platformLabel, type CalendarPlatform } from "@/lib/calendar/labels";

/**
 * Íconos mínimos de cada red, dibujados a mano (lucide no trae logos de marcas).
 * Son decorativos por defecto: el nombre de la red va en texto o en `title`.
 */
export function PlatformIcon({ platform, className, label = false }: { platform: CalendarPlatform; className?: string; label?: boolean }) {
  const common = { viewBox: "0 0 16 16", className: cn("h-3.5 w-3.5 flex-none", className), "aria-hidden": !label || undefined, role: label ? "img" : undefined, "aria-label": label ? platformLabel[platform] : undefined };
  if (platform === "INSTAGRAM") {
    return (
      <svg {...common} fill="none" stroke="#f0609a" strokeWidth="1.6">
        <rect x="2" y="2" width="12" height="12" rx="3.6" />
        <circle cx="8" cy="8" r="2.7" />
        <circle cx="11.6" cy="4.4" r="0.6" fill="#f0609a" stroke="none" />
      </svg>
    );
  }
  if (platform === "YOUTUBE") {
    return (
      <svg {...common}>
        <rect x="1.2" y="3.3" width="13.6" height="9.4" rx="3" fill="#ff4e4e" />
        <path d="M6.7 5.9v4.2L10.3 8z" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="#2ee6e0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.4 2.2v7.6a2.7 2.7 0 1 1-2.7-2.7" />
      <path d="M9.4 2.2c.3 1.8 1.6 3 3.4 3.1" />
    </svg>
  );
}
