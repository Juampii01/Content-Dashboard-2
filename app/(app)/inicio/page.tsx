import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, FileText, Flame, House, Plug, Trophy } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { OutlierBadge } from "@/components/ui/badges";
import { PlatformBadge } from "@/components/ui/platform";
import { Skeleton } from "@/components/ui/feedback";
import { Kpis } from "@/components/metricas/kpis";
import { ContentGrid } from "@/components/metricas/content-grid";
import { getOverview, getRisingPieces, getTopPieces } from "@/lib/dal/metrics";
import { getActiveWork, getFollowerSummary, getSetupProgress, hasAnyConnection } from "@/lib/dal/home";
import { buildOnboarding } from "@/lib/home/onboarding";
import { OnboardingGuide } from "@/components/inicio/onboarding-guide";
import { EmptyState } from "@/components/ui/empty-state";
import { ActiveWork } from "@/components/inicio/active-work";
import { getGrowth } from "@/lib/dal/growth";
import { GrowthGoal } from "@/components/inicio/growth-goal";
import { Upcoming } from "@/components/inicio/upcoming";
import { upcomingEntries } from "@/lib/dal/calendar";
import { todayIn } from "@/lib/metrics/params";
import { WeeklyReport } from "@/components/inicio/weekly-report";
import { AskStrategistCard } from "@/components/estratega/ask-card";
import { WeekReadyBanner } from "@/components/autopiloto/week-banner";
import { aiConfigured } from "@/lib/ai/client";
import { lastWeekStart, latestWeeklyReport } from "@/lib/home/weekly-report";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatCompact, formatMultiplier, formatNumber } from "@/lib/format";
import { typeLabel } from "@/lib/metrics/labels";
import { parseFilters } from "@/lib/metrics/params";
import { platformLabel } from "@/lib/social/types";

export const metadata: Metadata = { title: "Inicio" };

/** Guía de primer uso: reemplaza al antiguo bloque "Primeros pasos". Se va sola al completar los cinco pasos. */
async function FirstSteps() {
  const [progress, user] = await Promise.all([getSetupProgress(), getCurrentUser()]);
  if (user.role === "VIEWER") return null;
  const onboarding = buildOnboarding(progress);
  if (!onboarding.visible) return null;
  return <OnboardingGuide onboarding={onboarding} canConnect={user.role === "OWNER"} />;
}

/** Sin redes: en lugar de un resumen vacío, qué falta y el botón para hacerlo. */
async function NoNetworks() {
  const [user, progress] = await Promise.all([getCurrentUser(), getSetupProgress()]);
  // Si la guía de primer uso está a la vista, ella ya pide conectar las redes: no se repite.
  if (user.role !== "VIEWER" && buildOnboarding(progress).visible) return null;
  return (
    <EmptyState
      icon={<BarChart3 className="h-6 w-6" aria-hidden />}
      title="Tu resumen de la semana aparece aquí"
      description={
        user.role === "OWNER"
          ? "Conecta Instagram, YouTube o TikTok y en unos minutos ves tus seguidores, lo que mejor te funcionó y cómo vas contra la semana anterior."
          : "Cuando el dueño de la cuenta conecte Instagram, YouTube o TikTok, aquí ves tus seguidores, lo que mejor te funcionó y cómo vas contra la semana anterior."
      }
      action={
        user.role === "OWNER" ? (
          <ButtonLink href="/ajustes" icon={<Plug className="h-4 w-4" aria-hidden />}>
            Conectar mis redes
          </ButtonLink>
        ) : undefined
      }
    />
  );
}

async function Working() {
  return <ActiveWork items={await getActiveWork()} />;
}

async function Week() {
  if (!(await hasAnyConnection())) return <NoNetworks />;
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

      {user.role !== "VIEWER" && <AskStrategistCard />}

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
        actions={
          <ButtonLink href="/inicio/informes" variant="ghost" icon={<FileText className="h-4 w-4" aria-hidden />}>
            Informe mensual
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-6">
        <Suspense fallback={null}>
          <FirstSteps />
        </Suspense>
        <Suspense fallback={null}>
          <WeekReadyBanner />
        </Suspense>
        <Suspense fallback={null}>
          <Working />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-48" />}>
          <Week />
        </Suspense>
      </div>
    </>
  );
}
