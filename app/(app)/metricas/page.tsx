import type { Metadata } from "next";
import { Suspense } from "react";
import { BarChart3, Plug, SearchX } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/card";
import { ModulePreview } from "@/components/shell/module-preview";
import { FiltersBar } from "@/components/metricas/filters-bar";
import { Kpis } from "@/components/metricas/kpis";
import { ViewsChart } from "@/components/metricas/views-chart";
import { PostingHeatmap } from "@/components/metricas/posting-heatmap";
import { ContentTable } from "@/components/metricas/content-table";
import { ContentGrid } from "@/components/metricas/content-grid";
import { Pagination } from "@/components/metricas/pagination";
import { HookRanking } from "@/components/metricas/hook-ranking";
import { aiConfigured } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth";
import { hookRanking } from "@/lib/metrics/hooks";
import { countByPlatform, getDailyViews, getOverview, getPostingHeatmap, listConnections, listContent, PAGE_SIZE } from "@/lib/dal/metrics";
import { env } from "@/lib/env";
import { formatDateRange, formatNumber } from "@/lib/format";
import { parseFilters } from "@/lib/metrics/params";

export const metadata: Metadata = { title: "Métricas" };

async function MetricsContent({ searchParams }: { searchParams: PageProps<"/metricas">["searchParams"] }) {
  const params = await searchParams;
  const [connections, stored] = await Promise.all([listConnections(), countByPlatform()]);
  // Sin conexiones pero con histórico guardado (por ejemplo, se desconectó todo): se muestra el histórico igual.
  if (connections.length === 0 && Object.keys(stored).length === 0) {
    return (
      <ModulePreview
        icon={<BarChart3 className="h-6 w-6" />}
        title="Conecta tus redes para ver tus métricas"
        description="Cuando conectes tus cuentas, cada reel, carrusel, video y short aparece aquí con sus números, y se actualiza solo varias veces al día."
        features={[
          "Visualizaciones, alcance, interacción, guardados y compartidos por pieza",
          "Qué piezas rinden por encima de tu promedio (y cuánto)",
          "Cuándo rinde mejor lo que publicas: día y hora",
          "Filtros por red, tipo, fechas, texto y rango de visualizaciones",
          "Tu histórico nunca se borra, aunque la red deje de mostrar la pieza",
        ]}
        action={
          <ButtonLink href="/ajustes" icon={<Plug className="h-4 w-4" aria-hidden />}>
            Conectar mis redes
          </ButtonLink>
        }
      />
    );
  }

  const filters = parseFilters(params, env().APP_TIMEZONE);
  const counts = stored;
  const [overview, daily, heatmap, content, hooks, user] = await Promise.all([
    getOverview(filters),
    getDailyViews(filters),
    getPostingHeatmap(filters),
    listContent(filters),
    hookRanking(filters.platforms.length === 1 ? filters.platforms[0]! : null),
    getCurrentUser(),
  ]);
  const importing = connections.some((c) => !c.backfillDone);
  const storedTotal = Object.values(stored).reduce((a, n) => a + (n ?? 0), 0);
  const onlyDateFilter = filters.platforms.length === 0 && filters.types.length === 0 && !filters.q && filters.minViews == null && filters.maxViews == null;

  return (
    <div className="flex flex-col gap-6">
      <FiltersBar filters={filters} counts={counts} />
      {importing && (
        <p className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent-glow" role="status">
          Estamos importando tu histórico. Los números se completan solos en los próximos minutos.
        </p>
      )}
      <Kpis current={overview.current} previous={overview.previous} />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          {Object.keys(daily.byPlatform).length > 0 ? (
            <ViewsChart data={daily} />
          ) : (
            <EmptyState title="Todavía no hay datos diarios" description="Los totales por día aparecen después de la primera sincronización completa." />
          )}
        </div>
        <div className="xl:col-span-2">
          {heatmap.pieces >= 8 ? (
            <PostingHeatmap values={heatmap.values} pieces={heatmap.pieces} />
          ) : (
            <EmptyState title="Faltan piezas para ver tus mejores horarios" description="Con 8 piezas o más de los últimos 6 meses, aquí ves qué días y horas rinden mejor." />
          )}
        </div>
      </div>

      <HookRanking stats={hooks.stats} pending={hooks.pending} classified={hooks.classified} canClassify={user.role !== "VIEWER" && aiConfigured()} />

      <Section
        title="Piezas"
        description={`${formatNumber(content.total)} ${content.total === 1 ? "pieza publicada" : "piezas publicadas"} · ${formatDateRange(filters.from, filters.to)}`}
      >
        {content.rows.length === 0 ? (
          onlyDateFilter && storedTotal > 0 && filters.preset !== "365d" ? (
            // Sin otros filtros: lo que falta es rango. Pasa mucho con quien publica poco.
            <EmptyState
              icon={<SearchX className="h-5 w-5" aria-hidden />}
              title="No publicaste en estas fechas"
              description={`Tienes ${formatNumber(storedTotal)} ${storedTotal === 1 ? "pieza guardada" : "piezas guardadas"} de otras fechas. Amplía el rango para verlas.`}
              action={
                <ButtonLink href="/metricas?rango=365d" variant="ghost">
                  Ver los últimos 12 meses
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState icon={<SearchX className="h-5 w-5" aria-hidden />} title="Ninguna pieza coincide con los filtros" description="Prueba con otro rango de fechas o quita algún filtro." />
          )
        ) : filters.view === "cuadricula" ? (
          <ContentGrid rows={content.rows} />
        ) : (
          <ContentTable rows={content.rows} filters={filters} />
        )}
        <div className="mt-5">
          <Pagination filters={filters} total={content.total} pageSize={PAGE_SIZE} />
        </div>
      </Section>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando métricas" className="flex flex-col gap-6">
      <div className="skeleton h-28" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
      <div className="skeleton h-72" />
      <div className="skeleton h-96" />
    </div>
  );
}

export default function MetricasPage({ searchParams }: PageProps<"/metricas">) {
  return (
    <>
      <PageHeader
        eyebrow="Métricas"
        title="¿Qué contenido te está funcionando?"
        description="Todas tus piezas de Instagram, YouTube y TikTok con sus números, comparadas contra tu propio promedio."
        icon={<BarChart3 className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<MetricsSkeleton />}>
        <MetricsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
