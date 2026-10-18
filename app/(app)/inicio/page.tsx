import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Flame, House, Palette, Plug, Trophy } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/card";
import { OutlierBadge } from "@/components/ui/badges";
import { PlatformBadge } from "@/components/ui/platform";
import { Skeleton } from "@/components/ui/feedback";
import { Kpis } from "@/components/metricas/kpis";
import { ContentGrid } from "@/components/metricas/content-grid";
import { getOverview, getRisingPieces, getTopPieces } from "@/lib/dal/metrics";
import { getFollowerSummary, getSetupProgress } from "@/lib/dal/home";
import { getGrowth } from "@/lib/dal/growth";
import { GrowthGoal } from "@/components/inicio/growth-goal";
import { Upcoming } from "@/components/inicio/upcoming";
import { upcomingEntries } from "@/lib/dal/calendar";
import { todayIn } from "@/lib/metrics/params";
import { WeeklyReport } from "@/components/inicio/weekly-report";
import { aiConfigured } from "@/lib/ai/client";
import { lastWeekStart, latestWeeklyReport } from "@/lib/home/weekly-report";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatCompact, formatMultiplier, formatNumber } from "@/lib/format";
import { typeLabel } from "@/lib/metrics/labels";
import { parseFilters } from "@/lib/metrics/params";
import { platformLabel } from "@/lib/social/types";

export const metadata: Metadata = { title: "Inicio" };

const steps = [
  { key: "connected", href: "/ajustes", icon: Plug, title: "Conecta tus redes", description: "Instagram, YouTube y TikTok. Con eso empiezan a llegar tus métricas." },
  { key: "brand", href: "/marca", icon: Palette, title: "Completa tu marca", description: "Tu tono, tu público y tu estilo. Todo lo que generes va a sonar a ti." },
  { key: "planned", href: "/calendario", icon: CalendarDays, title: "Planea tu primera pieza", description: "Pon en el calendario lo próximo que vas a publicar." },
] as const;

async function FirstSteps() {
  const progress = await getSetupProgress();
  const pending = steps.filter((s) => !progress[s.key]);
  if (pending.length === 0) return null;
  return (
    <Section title="Primeros pasos" description={`Te ${pending.length === 1 ? "falta 1 paso" : `faltan ${pending.length} pasos`} para dejar tu espacio listo.`}>
      <ol className="stagger grid gap-3 md:grid-cols-3">
        {pending.map(({ href, icon: Icon, title, description }, i) => (
          <li key={href}>
            <Link href={href} className="card card-lift group flex h-full flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="tile-icon h-10 w-10">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="font-mono text-xs font-semibold text-muted">0{i + 1}</span>
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted">{description}</p>
              <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-accent-hi">
                Empezar <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}

async function Week() {
  const progress = await getSetupProgress();
  if (!progress.connected) return null;
  const tz = env().APP_TIMEZONE;
  const week = parseFilters({ rango: "7d" }, tz);
  const month = parseFilters({ rango: "28d" }, tz);
  const [overview, rising, top, followers, growth, user] = await Promise.all([
    getOverview(week),
    getRisingPieces(),
    getTopPieces(month, 4),
    getFollowerSummary(),
    getGrowth(),
    getCurrentUser(),
  ]);
  const upcoming = await upcomingEntries(7, 6);
  const report = await latestWeeklyReport();

  return (
    <>
      <GrowthGoal growth={growth} canEdit={user.role !== "VIEWER"} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Upcoming entries={upcoming} today={todayIn(tz)} />
        </div>
        <Section title="Tus redes" description="Seguidores hoy y cambio en 7 días.">
          <ul className="flex flex-col gap-3">
            {followers.map((f) => (
              <li key={f.platform} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3">
                <span className="flex min-w-0 flex-col gap-1">
                  <PlatformBadge platform={f.platform} className="self-start" />
                  <span className="truncate text-xs text-muted">@{f.handle.replace(/^@/, "")}</span>
                </span>
                <span className="text-right">
                  <span className="block text-lg font-bold tabular-nums">{f.followers == null ? "—" : formatNumber(f.followers)}</span>
                  {f.change7d != null && (
                    <span className={f.change7d >= 0 ? "text-xs text-success" : "text-xs text-warning"}>
                      {f.change7d >= 0 ? "+" : ""}
                      {formatNumber(f.change7d)} en 7 días
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/metricas" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-hi hover:text-white">
            Ver todas las métricas <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Section>
      </div>

      {rising.length > 0 && (
        <Section title="Va camino a ser de lo mejor" description="Piezas recientes que en sus primeras 24 h ya duplican lo normal para ti.">
          <ul className="flex flex-col gap-2">
            {rising.map((p) => (
              <li key={p.id}>
                <Link href={`/metricas/${p.id}`} className="card card-lift flex items-center gap-3 p-4">
                  <Flame className="h-5 w-5 flex-none text-warning" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 font-medium text-white">{p.title}</span>
                    <span className="text-xs text-muted">
                      {platformLabel[p.platform]} · {typeLabel[p.type]} · {formatCompact(p.views)} visualizaciones
                    </span>
                  </span>
                  <span className="text-sm text-muted">{formatMultiplier(p.ratio24h)} a las 24 h</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <WeeklyReport report={report} expectedWeek={lastWeekStart(tz)} canGenerate={user.role !== "VIEWER" && aiConfigured()} />

      <Section title="Tu semana" description="Lo publicado en los últimos 7 días, contra los 7 días anteriores.">
        <Kpis current={overview.current} previous={overview.previous} />
      </Section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Section title="Lo que mejor te funcionó" description="Últimos 28 días, contra tu mediana de cada red y tipo." className="xl:col-span-3">
          {top.length > 0 ? (
            <ContentGrid rows={top.slice(0, 4)} layout="compact" />
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Trophy className="h-4 w-4 text-accent-hi" aria-hidden />
              Cuando tengas más piezas medidas, aquí aparecen las que rindieron por encima de tu promedio.
            </p>
          )}
        </Section>
      </div>
      {top.some((t) => (t.perfScore ?? 0) >= 1.5) && (
        <p className="text-xs text-muted">
          <OutlierBadge ratio={2} className="mr-1.5 align-middle" /> indica cuántas veces una pieza superó tu mediana de visualizaciones a los 7 días.
        </p>
      )}
    </>
  );
}

export default function InicioPage() {
  return (
    <>
      <PageHeader
        eyebrow="Inicio"
        title="Tu contenido, en un solo lugar"
        description="Cómo rinden tus redes esta semana, qué está funcionando y qué te falta para dejar todo listo."
        icon={<House className="h-5 w-5" aria-hidden />}
      />
      <div className="flex flex-col gap-6">
        <Suspense fallback={<Skeleton className="h-48" />}>
          <Week />
        </Suspense>
        <Suspense fallback={null}>
          <FirstSteps />
        </Suspense>
      </div>
    </>
  );
}
