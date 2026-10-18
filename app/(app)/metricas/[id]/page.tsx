import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { OutlierBadge } from "@/components/ui/badges";
import { PlatformBadge } from "@/components/ui/platform";
import { KpiCard } from "@/components/ui/stat";
import { GrowthChart, RetentionChart } from "@/components/metricas/detail-charts";
import { PieceAnalysisPanel } from "@/components/metricas/piece-analysis";
import { aiConfigured } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth";
import { getContentDetail } from "@/lib/dal/metrics";
import { formatCompact, formatDate, formatDuration, formatMultiplier } from "@/lib/format";
import { typeLabel } from "@/lib/metrics/labels";
import { platformLabel } from "@/lib/social/types";

export const metadata: Metadata = { title: "Detalle de la pieza" };

async function Detail({ params }: { params: PageProps<"/metricas/[id]">["params"] }) {
  const { id } = await params;
  const [detail, user] = await Promise.all([getContentDetail(id), getCurrentUser()]);
  if (!detail) notFound();
  const { item, snapshots, retention, peerMedian7d, compareViews: compareValue } = detail;
  const ratio = compareValue != null && peerMedian7d ? compareValue / peerMedian7d : null;

  type Card = { label: string; value: number | null; format?: "number" | "compact" | "percent" | "duration" };
  const allCards: Card[] = [
    { label: "Visualizaciones", value: item.views, format: "number" },
    { label: "Alcance", value: item.reach, format: "number" },
    { label: "Tasa de interacción", value: item.engagementRate, format: "percent" },
    { label: "Me gusta", value: item.likes },
    { label: "Comentarios", value: item.comments },
    { label: "Compartidos", value: item.shares },
    { label: "Guardados", value: item.saves },
    { label: "Tiempo medio visto", value: item.avgWatchSec, format: "duration" },
    { label: "Porcentaje visto", value: item.avgViewPercentage, format: "percent" },
    { label: "Saltan en 3 s", value: item.skipRate, format: "percent" },
    { label: "Seguidores ganados", value: item.follows ?? item.subscribersGained },
    { label: "Visitas al perfil", value: item.profileVisits },
  ];
  const cards = allCards.filter((c) => c.value != null);

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-col gap-6 p-6 sm:flex-row">
        <div className="w-full max-w-[180px] flex-none overflow-hidden rounded-xl bg-white/5">
          {item.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnail} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="grid aspect-[9/16] place-items-center text-xs text-muted">Sin miniatura</div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <PlatformBadge platform={item.platform} />
            <span>{typeLabel[item.type]}</span>·<span>{formatDate(item.publishedAt)}</span>
            {item.durationSec ? <>·<span>{formatDuration(item.durationSec)}</span></> : null}
          </div>
          <h1 className="text-xl font-bold leading-snug sm:text-2xl">{item.title}</h1>
          {ratio != null && (
            <p className="flex items-center gap-2 text-sm">
              {ratio >= 1 ? <TrendingUp className="h-4 w-4 text-success" aria-hidden /> : <TrendingDown className="h-4 w-4 text-warning" aria-hidden />}
              {ratio >= 1.5 ? (
                <>
                  <OutlierBadge ratio={ratio} /> Rindió {formatMultiplier(ratio)} tu mediana de {typeLabel[item.type].toLowerCase()}s en {platformLabel[item.platform]} ({formatCompact(peerMedian7d)} a los 7 días).
                </>
              ) : (
                <span className="text-muted">
                  {ratio >= 1 ? "Rindió por encima" : "Rindió por debajo"} de tu mediana de {typeLabel[item.type].toLowerCase()}s en {platformLabel[item.platform]} ({formatCompact(peerMedian7d)} a los 7 días).
                </span>
              )}
            </p>
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <ButtonLink href={`/guiones/nuevo?desde=${item.id}`} icon={<FileText className="h-4 w-4" aria-hidden />}>
              Crear un guion parecido
            </ButtonLink>
            {item.permalink && (
              <ButtonLink href={item.permalink} variant="ghost" target="_blank" rel="noreferrer" icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
                Ver en {platformLabel[item.platform]}
              </ButtonLink>
            )}
          </div>
        </div>
      </div>

      {!item.available && <Notice tone="warning">Esta pieza ya no aparece en {platformLabel[item.platform]} (se borró o se archivó). Conservamos sus números.</Notice>}
      {item.insightsStatus === "PENDING" && <Notice>{platformLabel[item.platform]} todavía está calculando las estadísticas de esta pieza. Suelen llegar dentro de las 48 h.</Notice>}
      {item.insightsStatus === "NOT_SUPPORTED" && (
        <Notice tone="warning">{platformLabel[item.platform]} no da estadísticas detalladas para esta pieza (por ejemplo, si se publicó antes de pasar la cuenta a profesional).</Notice>
      )}

      <PieceAnalysisPanel
        id={item.id}
        analysis={item.aiAnalysis}
        analyzedAt={item.aiAnalyzedAt?.toISOString() ?? null}
        wentWell={ratio == null ? null : ratio >= 1}
        canEdit={user.role !== "VIEWER"}
        aiReady={aiConfigured()}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value} format={c.format ?? "number"} compare={false} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {snapshots.length >= 2 && <GrowthChart points={snapshots.map((s) => ({ day: s.day, views: s.views }))} />}
        {retention && retention.length > 2 && <RetentionChart points={retention} />}
      </div>

      {(item.views24h != null || item.views72h != null || item.views7d != null) && (
        <Section title="Visualizaciones a la misma edad" description="Para comparar esta pieza con otras de forma justa.">
          <dl className="grid grid-cols-3 gap-3">
            {[
              ["A las 24 h", item.views24h],
              ["A las 72 h", item.views72h],
              ["A los 7 días", item.views7d],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-white/10 p-4">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">{value == null ? "—" : formatCompact(value as number)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {item.caption && (
        <Section title="Texto de la publicación">
          <p className="whitespace-pre-line text-sm leading-relaxed text-text/90">{item.caption}</p>
        </Section>
      )}
    </div>
  );
}

export default function DetailPage({ params }: PageProps<"/metricas/[id]">) {
  return (
    <>
      <ButtonLink href="/metricas" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Métricas
      </ButtonLink>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Detail params={params} />
      </Suspense>
    </>
  );
}
