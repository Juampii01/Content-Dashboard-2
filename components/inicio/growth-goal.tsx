import { Flame, TrendingUp } from "lucide-react";
import { Sparkline } from "@/components/ui/charts";
import { formatCompact, formatDate, formatNumber } from "@/lib/format";
import type { Growth } from "@/lib/dal/growth";
import { platformLabel } from "@/lib/social/types";
import { cn } from "@/lib/utils";
import { GoalDialog } from "./goal-dialog";

/**
 * "Tu camino a la meta": progreso hacia la meta de seguidores, proyección con el ritmo real
 * y constancia de publicación semana a semana. Todo con datos reales; si faltan, se dice.
 */
export function GrowthGoal({ growth, canEdit }: { growth: Growth; canEdit: boolean }) {
  const { goals, suggested, current, perDay, eta, neededPerWeek, weeks, streak, insight } = growth;
  const target = goals?.followers ?? suggested.followers;
  const weeklyTarget = goals?.weeklyPieces ?? suggested.weeklyPieces;
  const scopeLabel = !goals || goals.platform === "TOTAL" ? "en todas tus redes" : `en ${platformLabel[goals.platform]}`;
  const pct = current != null ? Math.min(100, (current / target) * 100) : 0;
  const perWeek = perDay != null ? Math.round(perDay * 7) : null;
  const reached = current != null && current >= target;
  const maxPieces = Math.max(weeklyTarget + 1, ...weeks.map((w) => w.pieces));
  const thisWeek = weeks.at(-1);

  return (
    <section className="card hero-panel grid gap-8 p-6 sm:p-8 xl:grid-cols-[1.25fr_1fr]" aria-labelledby="growth-title">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow mb-2">{goals ? "Tu meta" : "Ponte una meta"}</p>
            <h2 id="growth-title" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {reached ? `Llegaste a ${formatNumber(target)} seguidores` : `Tu camino a ${formatNumber(target)} seguidores`}
            </h2>
            <p className="mt-1 text-sm text-muted">{scopeLabel}</p>
          </div>
          {canEdit && <GoalDialog initial={goals ?? suggested} platforms={growth.platforms} label={goals ? "Cambiar meta" : "Definir mi meta"} variant={goals ? "subtle" : "primary"} />}
        </div>

        <div>
          <div className="mb-2 flex items-end justify-between gap-3">
            <span className="text-4xl font-bold tabular-nums tracking-tight text-white">{current == null ? "—" : formatNumber(current)}</span>
            <span className="font-mono text-sm text-accent-glow">{current == null ? "" : `${pct.toFixed(pct < 10 ? 1 : 0)} %`}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={current ?? 0} aria-label="Progreso hacia la meta">
            <div className="bar-shine h-full rounded-full bg-gradient-to-r from-accent to-accent-hi" style={{ width: `${Math.max(1.5, pct)}%` }} />
          </div>
          {growth.series.length > 7 && (
            <Sparkline className="mt-4" height={44} values={growth.series.map((p) => p.followers)} label={`Seguidores de los últimos ${growth.series.length} días`} />
          )}
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 p-4">
            <dt className="text-xs text-muted">Tu ritmo actual</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-lg font-bold tabular-nums text-white">
              {perWeek == null ? "—" : `${perWeek >= 0 ? "+" : ""}${formatCompact(perWeek)}`}
              <span className="text-xs font-normal text-muted">por semana</span>
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 p-4">
            <dt className="text-xs text-muted">{reached ? "Meta cumplida" : "Llegas aprox."}</dt>
            <dd className="mt-1 text-lg font-bold text-white">{reached ? "¡Pon la siguiente!" : eta ? formatDate(eta) : perWeek != null && perWeek <= 0 ? "Sin crecimiento" : "—"}</dd>
          </div>
          <div className="rounded-xl border border-white/10 p-4">
            <dt className="text-xs text-muted">{goals?.deadline ? `Para el ${formatDate(goals.deadline)}` : "Te faltan"}</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-white">
              {goals?.deadline && neededPerWeek != null ? (
                <>
                  +{formatCompact(neededPerWeek)} <span className="text-xs font-normal text-muted">por semana</span>
                </>
              ) : current != null ? (
                formatNumber(Math.max(0, target - current))
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        {goals?.deadline && neededPerWeek != null && perWeek != null && !reached && (
          <p className={cn("text-sm", perWeek >= neededPerWeek ? "text-success" : "text-warning")}>
            {perWeek >= neededPerWeek
              ? "Vas a buen ritmo para llegar a tiempo."
              : `Hoy creces ${formatCompact(Math.max(0, perWeek))} por semana: necesitas ${formatCompact(neededPerWeek)}. Sube la cantidad o repite lo que más te funcionó.`}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-white">Tu constancia</h3>
            <p className="text-sm text-muted">
              Piezas publicadas por semana · meta: {weeklyTarget}
            </p>
          </div>
          {streak > 0 && (
            <span className="pill inline-flex items-center gap-1.5 text-warning">
              <Flame className="h-3.5 w-3.5" aria-hidden /> {streak} {streak === 1 ? "semana" : "semanas"} seguidas
            </span>
          )}
        </div>
        <div className="relative flex h-36 items-end gap-1.5 sm:gap-2" role="img" aria-label={`Piezas por semana en las últimas 12 semanas: ${weeks.map((w) => w.pieces).join(", ")}`}>
          <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-accent-hi/50" style={{ bottom: `${(weeklyTarget / maxPieces) * 100}%` }} aria-hidden />
          {weeks.map((w) => (
            <div key={w.weekStart} className="flex h-full flex-1 flex-col justify-end" title={`Semana del ${formatDate(w.weekStart)}: ${w.pieces} piezas${w.followerGain != null ? `, ${w.followerGain >= 0 ? "+" : ""}${formatNumber(w.followerGain)} seguidores` : ""}`}>
              <div
                className={cn(
                  "rounded-t-md",
                  w.hitTarget ? "bg-gradient-to-t from-accent to-accent-hi" : "bg-white/15",
                  w.current && "outline outline-1 outline-offset-2 outline-accent-hi/60",
                )}
                style={{ height: `${Math.max(3, (w.pieces / maxPieces) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-placeholder">
          <span>{formatDate(weeks[0]!.weekStart)}</span>
          <span>esta semana</span>
        </div>
        {thisWeek && (
          <p className="text-sm text-text/90">
            Esta semana llevas <strong className="text-white">{thisWeek.pieces}</strong> de {weeklyTarget}
            {thisWeek.pieces >= weeklyTarget ? ". Cumpliste." : `: te ${weeklyTarget - thisWeek.pieces === 1 ? "falta 1" : `faltan ${weeklyTarget - thisWeek.pieces}`}.`}
          </p>
        )}
        {insight && (
          <p className="flex gap-2 rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm text-accent-glow">
            <TrendingUp className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            <span>
              Las semanas que publicaste {insight.target} o más piezas ganaste {formatCompact(insight.withTarget)} seguidores (mediana), contra{" "}
              {formatCompact(insight.withoutTarget)} cuando publicaste menos: ×{insight.ratio.toFixed(1)}.
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
