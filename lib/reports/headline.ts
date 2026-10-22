import { formatCompact, formatPercent } from "@/lib/format";
import { addMonths, monthLabel } from "./month";
import type { Pair } from "./types";

/**
 * Frase principal del informe, armada con las cifras calculadas (no por la IA): es lo primero que lee un sponsor
 * y nunca puede contradecir las tarjetas de abajo.
 */
export function factHeadline(input: { month: string; partial: boolean; followersGained: Pair; views: Pair }): string {
  const label = monthLabel(input.month, { withYear: false });
  const prev = monthLabel(addMonths(input.month, -1), { lower: true, withYear: false });
  const parts: string[] = [];
  const gained = input.followersGained.current;
  if (gained != null) parts.push(`${gained >= 0 ? "+" : "−"}${formatCompact(Math.abs(gained))} seguidores`);
  const views = input.views.current;
  if (views != null) {
    let text = `${formatCompact(views)} visualizaciones de lo publicado`;
    const before = input.views.previous;
    if (before != null && before > 0) {
      const change = ((views - before) / before) * 100;
      text += Math.abs(change) < 1 ? `, igual que ${prev}` : `, ${formatPercent(Math.abs(change), { digits: 0 })} ${change > 0 ? "más" : "menos"} que ${prev}`;
    }
    parts.push(text);
  }
  if (!parts.length) return `${label}: sin datos suficientes de tus redes para este mes.`;
  return `${label} ${input.partial ? "va" : "cerró"} con ${parts.join(" y ")}.`;
}
