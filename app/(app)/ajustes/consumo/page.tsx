import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/feedback";
import { PRICES_CHECKED, PRICES_SOURCE } from "@/lib/ai/pricing";
import { getUsageView, USAGE_PERIODS } from "@/lib/dal/usage";
import { formatDate, formatDuration, formatNumber, formatPercent, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Consumo de IA" };

/** "claude-opus-5-5" → "Opus 5.5". */
function modelName(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : model;
}

/** Dólares con más decimales para montos chicos (un paso cuesta centavos). */
function usd(value: number): string {
  return value >= 1 ? formatUsd(value) : `USD ${formatNumber(value, { digits: 3 })}`;
}

async function UsageContent({ searchParams }: { searchParams: PageProps<"/ajustes/consumo">["searchParams"] }) {
  const params = await searchParams;
  const days = Number(Array.isArray(params.dias) ? params.dias[0] : params.dias) || 30;
  const view = await getUsageView(days);
  if (!view.allowed) return <Notice tone="warning">Solo el dueño de la cuenta ve el consumo de IA.</Notice>;
  const { totals, videos, steps } = view;
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Periodo" className="flex flex-wrap gap-2">
        {USAGE_PERIODS.map((d) => (
          <Link key={d} href={`/ajustes/consumo?dias=${d}`} className={cn("chip", d === view.days && "!border-white !bg-white !text-paper")} aria-current={d === view.days ? "page" : undefined}>
            Últimos {d} días
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-sm font-medium text-muted">Gasto de IA</p>
          <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-white">{formatUsd(totals.usd)}</p>
          <p className="mt-1.5 text-xs text-muted">{formatNumber(totals.calls)} llamadas a Claude</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-muted">Por modelo</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {totals.byModel.length ? (
              totals.byModel.map((m) => (
                <li key={m.model} className="flex justify-between gap-3">
                  <span className="truncate">{modelName(m.model)}</span>
                  <span className="font-mono text-white">{formatUsd(m.usd)}</span>
                </li>
              ))
            ) : (
              <li className="text-muted">Sin consumo en este periodo.</li>
            )}
          </ul>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-muted">Llamadas que fallaron</p>
          <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-white">{formatNumber(totals.failed)}</p>
          <p className="mt-1.5 text-xs text-muted">Cortadas o que no se pudieron leer. Anthropic igual las cobra y aquí se cuentan.</p>
        </div>
      </div>

      <Section title="Costo por video" description="Lo que gastó la IA en cada video del Editor en este periodo, y cuánto sale por minuto de video.">
        {videos.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Video</th>
                  <th className="py-2 pr-3 text-right font-medium">Duración</th>
                  <th className="py-2 pr-3 text-right font-medium">Llamadas</th>
                  <th className="py-2 pr-3 text-right font-medium">Gasto</th>
                  <th className="py-2 pr-3 text-right font-medium">Por minuto</th>
                  <th className="py-2 text-right font-medium">Último uso</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.videoId} className="border-b border-white/5 last:border-0">
                    <td className="max-w-[18rem] truncate py-2.5 pr-3">
                      <Link href={`/editor/${v.videoId}`} className="text-white hover:text-accent">
                        {v.title}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono">{formatDuration(v.durationSec)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono">{formatNumber(v.calls)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono font-semibold text-white">{usd(v.usd)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono">{v.usdPerMinute == null ? "—" : usd(v.usdPerMinute)}</td>
                    <td className="py-2.5 text-right text-muted">{formatDate(v.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Gauge className="h-5 w-5" aria-hidden />} title="Sin videos con IA en este periodo" description="Cuando edites un video con la IA, aquí vas a ver cuánto costó." />
        )}
      </Section>

      <Section title="Costo por paso" description="En qué se va el gasto: cada paso de la IA, cuántas veces se usó y cuánto cuesta en promedio.">
        {steps.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Paso</th>
                  <th className="py-2 pr-3 text-right font-medium">Llamadas</th>
                  <th className="py-2 pr-3 text-right font-medium">Gasto</th>
                  <th className="py-2 pr-3 text-right font-medium">Promedio</th>
                  <th className="py-2 text-right font-medium">Del total</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.label} className="border-b border-white/5 last:border-0">
                    <td className="py-2.5 pr-3">{s.label}</td>
                    <td className="py-2.5 pr-3 text-right font-mono">{formatNumber(s.calls)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono font-semibold text-white">{usd(s.usd)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono">{usd(s.avgUsd)}</td>
                    <td className="py-2.5 text-right font-mono">{formatPercent(s.share * 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Sin consumo en este periodo.</p>
        )}
      </Section>

      <p className="text-xs text-muted">
        Costos calculados con los precios oficiales de Anthropic revisados el {formatDate(`${PRICES_CHECKED}T12:00:00Z`, { withYear: true })} (
        <a href={PRICES_SOURCE} className="underline hover:text-white" target="_blank" rel="noreferrer">
          tabla de precios
        </a>
        ). Las imágenes de OpenAI se cobran aparte en tu cuenta de OpenAI y todavía no se cuentan aquí.
      </p>
    </div>
  );
}

export default function ConsumoPage({ searchParams }: PageProps<"/ajustes/consumo">) {
  return (
    <>
      <PageHeader
        eyebrow="Ajustes"
        title="¿Cuánto gasta la IA?"
        description="El consumo de Claude por video y por paso, para saber cuánto cuesta cada edición."
        icon={<Gauge className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<div aria-hidden className="skeleton h-96" />}>
        <UsageContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
