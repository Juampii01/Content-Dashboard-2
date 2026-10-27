import Link from "next/link";
import { ArrowRight, CalendarCheck2, CircleAlert, CircleCheck, Clapperboard, FileText, GalleryHorizontal, Lightbulb, PenLine, UserRound } from "lucide-react";
import { Section } from "@/components/ui/card";
import { DeltaBadge, OutlierBadge } from "@/components/ui/badges";
import { MediaThumbCard } from "@/components/ui/media-thumb-card";
import { PlatformBadge } from "@/components/ui/platform";
import type { ReportListItem } from "@/lib/dal/reports";
import { formatBytes, formatCompact, formatDate, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import { aspectFor } from "@/lib/metrics/labels";
import { reportColors } from "@/lib/reports/colors";
import { addMonths, change, monthLabel } from "@/lib/reports/month";
import type { MonthlyReportData, Pair, ReportPiece } from "@/lib/reports/types";
import { GenerateReportButton, PdfLinks, SendReportButton } from "./report-actions";
import { FEATURES } from "@/lib/features";

const signed = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatNumber(Math.abs(v))}`);

function Figure({ label, value, pair, sub }: { label: string; value: string; pair?: Pair; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-white/65">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-white tabular-nums sm:text-[1.75rem]">{value}</p>
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-white/60">
        {pair && <DeltaBadge value={change(pair)} comparisonLabel="frente al mes anterior" />}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

/** Vista previa del informe guardado: lo mismo que el PDF, con el estilo de la app. */
export function ReportPreview({
  report,
  canEdit,
  recipients,
  emailConfigured,
}: {
  report: ReportListItem & { data: MonthlyReportData };
  canEdit: boolean;
  recipients: string[];
  emailConfigured: boolean;
}) {
  const { data } = report;
  const colors = reportColors(data.brand);
  const t = data.totals;
  const prevLabel = monthLabel(addMonths(data.month, -1), { lower: true, withYear: false });
  const nextLabel = monthLabel(addMonths(data.month, 1), { lower: true, withYear: false });

  return (
    <div className="flex flex-col gap-6">
      {/* Portada */}
      <section
        aria-label={`Informe de ${monthLabel(data.month, { lower: true })}`}
        className="relative overflow-hidden rounded-2xl border border-line p-6 sm:p-8"
        style={{ background: `radial-gradient(120% 90% at 100% 0%, ${colors.accent}33, transparent 60%), ${colors.cover}` }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-xs font-bold text-white" style={{ background: colors.accent }} aria-hidden>
              {data.brand.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{data.brand.name}</span>
            {data.brand.handle && <span className="truncate font-normal text-white/60">{data.brand.handle}</span>}
          </p>
          <p className="eyebrow !text-white/60">Informe mensual</p>
        </div>

        <h2 className="mt-8 text-4xl font-bold tracking-tight text-white sm:text-5xl">{monthLabel(data.month)}</h2>
        {data.partial && <p className="pill mt-3 !border-white/25 !text-white/75">Avance · datos hasta el {formatDate(data.to)}</p>}
        {data.summary && <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/85 sm:text-lg">{data.summary.headline}</p>}

        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/15 pt-6 lg:grid-cols-4">
          <Figure label="Seguidores al cierre" value={formatNumber(t.followers)} sub={t.followersGained.current == null ? undefined : `${signed(t.followersGained.current)} en el mes`} />
          <Figure label="Visualizaciones" value={formatCompact(t.views.current)} pair={t.views} />
          <Figure label="Interacciones" value={formatCompact(t.interactions.current)} pair={t.interactions} />
          <Figure label="Publicaciones" value={formatNumber(t.pieces.current)} pair={t.pieces} />
        </div>
      </section>

      {/* Acciones */}
      <div className="card flex flex-col gap-4 p-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 text-sm text-muted">
          <p className="flex items-center gap-2 font-semibold text-white">
            <FileText className="h-4 w-4 flex-none text-accent-hi" aria-hidden />
            PDF de {formatBytes(report.pdfBytes)}
          </p>
          <p className="mt-1" suppressHydrationWarning>
            Generado {formatRelative(report.updatedAt)}
            {report.sentAt ? ` · enviado ${formatRelative(report.sentAt)} a ${report.sentTo.length === 1 ? "1 persona" : `${report.sentTo.length} personas`}` : " · todavía no se envió"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PdfLinks month={data.month} />
          {canEdit && <SendReportButton month={data.month} recipients={recipients} emailConfigured={emailConfigured} />}
          {canEdit && <GenerateReportButton month={data.month} label="Volver a generar" variant="ghost" />}
        </div>
      </div>

      {/* Resumen con IA */}
      {data.summary ? (
        <Section title="Resumen del mes" description={`Escrito por la IA con tus números de ${monthLabel(data.month, { lower: true, withYear: false })}, contra ${prevLabel}.`}>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-white">Logros</h3>
              <ul className="space-y-2">
                {data.summary.wins.map((w, i) => (
                  <li key={i} className="flex gap-2 text-sm text-text/90">
                    <CircleCheck className="mt-0.5 h-4 w-4 flex-none text-success" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-white">A vigilar</h3>
              <ul className="space-y-2">
                {data.summary.watch.map((w, i) => (
                  <li key={i} className="flex gap-2 text-sm text-text/90">
                    <CircleAlert className="mt-0.5 h-4 w-4 flex-none text-warning" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <h3 className="mt-6 mb-2 text-sm font-semibold text-white">Ideas para {nextLabel}</h3>
          <ul className="grid gap-3 md:grid-cols-3">
            {data.summary.ideas.map((idea, i) => (
              <li key={i}>
                <Link
                  href={`/guiones/nuevo?idea=${encodeURIComponent(`${idea.title}. Gancho: ${idea.hook}`)}`}
                  className="group flex h-full flex-col gap-1 rounded-xl border border-white/10 p-4 transition hover:border-line-strong hover:bg-white/[0.03]"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Lightbulb className="h-4 w-4 flex-none text-accent-hi" aria-hidden />
                    {idea.title}
                  </span>
                  <span className="text-sm text-text/90">“{idea.hook}”</span>
                  <span className="text-xs text-muted">{idea.why}</span>
                  <span className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-semibold text-accent-hi">
                    Escribir guion <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <Section title="Resumen del mes">
          <p className="text-sm text-muted">Este informe salió sin resumen con IA (no estaba configurada o no había datos). Las cifras están completas en el PDF.</p>
        </Section>
      )}

      {/* Por red */}
      <Section title="Por red" description={`Cada red contra ${prevLabel}. Las visualizaciones son las de lo publicado en el mes.`}>
        {data.platforms.length === 0 ? (
          <p className="text-sm text-muted">No había redes conectadas en este mes.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {data.platforms.map((p) => (
              <li key={p.platform} className="flex flex-col gap-4 rounded-xl border border-white/10 p-4">
                <div className="flex items-center justify-between gap-2">
                  <PlatformBadge platform={p.platform} />
                  <span className="truncate text-xs text-muted">{p.handle.startsWith("@") ? p.handle : `@${p.handle}`}</span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Stat label="Seguidores" value={formatNumber(p.followers)} sub={p.followersGained.current == null ? "sin dato de variación" : `${signed(p.followersGained.current)} en el mes`} />
                  <Stat label="Visualizaciones" value={formatCompact(p.views.current)} pair={p.views} />
                  <Stat label="Interacciones" value={formatCompact(p.interactions.current)} pair={p.interactions} />
                  <Stat label="Publicaciones" value={formatNumber(p.pieces.current)} pair={p.pieces} />
                </dl>
                {p.notes.length > 0 && (
                  <ul className="border-t border-white/10 pt-3 text-xs leading-relaxed text-muted">
                    {p.notes.map((n) => (
                      <li key={n}>· {n}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Mejores piezas */}
      <Section title="Mejores piezas" description="Las que más superaron tu mediana de su red y formato.">
        {data.top.length === 0 ? (
          <p className="text-sm text-muted">No hubo publicaciones en este mes.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            {data.top.map((p) => (
              <li key={p.id}>
                <PieceCard piece={p} />
              </li>
            ))}
          </ul>
        )}
        {data.worst && (
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/[0.06] p-4 sm:flex-row sm:items-start">
            <CircleAlert className="h-5 w-5 flex-none text-warning" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">La que menos funcionó: <span className="font-normal text-text/90">{data.worst.title}</span></p>
              <p className="mt-1 text-sm text-muted">{data.summary?.worstLesson ?? data.worst.lessons[0] ?? "Revisa el gancho y los primeros segundos: es donde se decide si la gente se queda."}</p>
            </div>
          </div>
        )}
      </Section>

      {/* Constancia y producción */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Constancia" description={`Meta de ${data.consistency.weeklyTarget} piezas por semana.`}>
          <dl className="grid grid-cols-3 gap-4">
            <Stat label="Planeadas" value={formatNumber(data.consistency.planned)} icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />} />
            <Stat label="Publicadas de lo planeado" value={data.consistency.planned ? formatPercent((100 * data.consistency.plannedPublished) / data.consistency.planned, { digits: 0 }) : "—"} />
            <Stat label="Publicadas en total" value={formatNumber(data.consistency.published)} />
          </dl>
          <ol className="mt-5 flex flex-col gap-2" aria-label="Piezas por semana">
            {data.consistency.weeks.map((w) => (
              <li key={w.weekStart} className="flex items-center gap-3 text-sm">
                <span className="w-24 flex-none text-xs text-muted">
                  {Number(w.weekStart.slice(8))}–{Number(w.weekEnd.slice(8))} {monthLabel(data.month, { lower: true, withYear: false }).slice(0, 3)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                  <span className={w.hit ? "block h-full rounded-full bg-accent-hi" : "block h-full rounded-full bg-white/30"} style={{ width: `${Math.min(100, (100 * w.pieces) / Math.max(1, w.target))}%` }} />
                </span>
                <span className="w-16 flex-none text-right font-mono text-xs tabular-nums text-text">
                  {w.pieces}/{w.target}
                </span>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Producción en la app" description="Lo que hiciste este mes con Content Studio.">
          <dl className="grid grid-cols-2 gap-4">
            <Stat label="Guiones" value={formatNumber(data.production.scripts)} icon={<PenLine className="h-4 w-4" aria-hidden />} />
            <Stat label="Videos editados" value={formatNumber(data.production.videosEdited)} icon={<Clapperboard className="h-4 w-4" aria-hidden />} />
            <Stat label="Carruseles" value={formatNumber(data.production.carouselsCreated)} icon={<GalleryHorizontal className="h-4 w-4" aria-hidden />} sub={data.production.carouselsExported ? `${data.production.carouselsExported} exportados` : undefined} />
            {FEATURES.clone && <Stat label="Videos con clon" value={formatNumber(data.production.cloneVideos)} icon={<UserRound className="h-4 w-4" aria-hidden />} />}
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, pair, sub, icon }: { label: string; value: string; pair?: Pair; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        {icon && <span className="text-accent-hi">{icon}</span>}
        {label}
      </dt>
      <dd className="mt-1 text-xl font-semibold text-white tabular-nums">{value}</dd>
      {(pair || sub) && (
        <dd className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {pair && (change(pair) == null ? <span className="text-placeholder">sin dato anterior</span> : <DeltaBadge value={change(pair)} comparisonLabel="frente al mes anterior" />)}
          {sub && <span>{sub}</span>}
        </dd>
      )}
    </div>
  );
}

function PieceCard({ piece }: { piece: ReportPiece }) {
  return (
    <MediaThumbCard
      src={piece.thumbnail}
      title={piece.title}
      aspect={aspectFor(piece.platform, piece.type) === "16:9" ? "16:9" : "9:16"}
      platform={piece.platform}
      metric={piece.views != null ? { value: formatCompact(piece.views), label: "visualizaciones" } : undefined}
      badge={piece.perfScore != null && piece.perfScore >= 1.2 ? <OutlierBadge ratio={piece.perfScore} /> : undefined}
      meta={formatDate(piece.publishedAt)}
      href={`/metricas/${piece.id}`}
    />
  );
}
