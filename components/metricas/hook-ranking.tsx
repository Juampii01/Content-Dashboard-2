import Link from "next/link";
import { Section } from "@/components/ui/card";
import { formatCompact, formatMultiplier, formatNumber } from "@/lib/format";
import type { HookStat } from "@/lib/metrics/hooks";
import { ClassifyHooksButton } from "./classify-hooks-button";

/** "Qué ganchos te funcionan": rendimiento mediano por tipo de gancho, contra tu propia mediana. */
export function HookRanking({ stats, pending, classified, canClassify }: { stats: HookStat[]; pending: number; classified: number; canClassify: boolean }) {
  const max = Math.max(1.5, ...stats.map((s) => s.medianScore));
  const action = pending > 0 && canClassify ? <ClassifyHooksButton pending={pending} /> : null;

  return (
    <Section
      title="Qué ganchos te funcionan"
      description="Cada pieza se clasifica por su primera frase. La barra es la mediana de cuánto rindió cada tipo contra tu propia mediana (×1 = lo normal para ti)."
      actions={action}
    >
      {stats.length === 0 ? (
        <p className="text-sm text-muted">
          {classified === 0
            ? "Todavía no clasificamos los ganchos de tus piezas. Se hace solo después de cada sincronización, o puedes hacerlo ahora."
            : "Hacen falta al menos 3 piezas de un mismo tipo de gancho en los últimos 6 meses para comparar."}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {stats.map((s, i) => {
            const good = s.medianScore >= 1;
            return (
              <li key={s.type} className="grid grid-cols-[1.75rem_minmax(0,9rem)_1fr_auto] items-center gap-3 sm:grid-cols-[1.75rem_10rem_1fr_auto]">
                <span className="font-mono text-xs text-accent-glow">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate text-sm font-semibold text-white">
                  {s.label}
                  <span className="ml-1.5 text-xs font-normal text-muted">· {formatNumber(s.count)}</span>
                </span>
                <span className="relative h-2.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                  <span
                    className={good ? "absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent to-accent-hi" : "absolute inset-y-0 left-0 rounded-full bg-white/25"}
                    style={{ width: `${Math.max(4, (s.medianScore / max) * 100)}%` }}
                  />
                  <span className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${(1 / max) * 100}%` }} />
                </span>
                <span className={good ? "w-14 text-right text-sm font-bold tabular-nums text-white" : "w-14 text-right text-sm font-bold tabular-nums text-muted"}>
                  {formatMultiplier(s.medianScore)}
                </span>
                {s.example && (
                  <Link
                    href={`/metricas/${s.example.id}`}
                    className="col-span-3 col-start-2 -mt-1 truncate text-xs text-muted hover:text-text sm:col-span-2 sm:col-start-3"
                    title={s.example.text}
                  >
                    Mejor: “{s.example.text}” · {formatMultiplier(s.example.score)}
                    {s.medianViews != null ? ` · mediana ${formatCompact(s.medianViews)} vistas` : ""}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
