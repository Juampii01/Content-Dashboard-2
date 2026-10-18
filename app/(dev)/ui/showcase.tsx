"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Download,
  Eye,
  Heart,
  Info,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Percent,
  Rows3,
  Share2,
  Timer,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { PlatformBadge, platformMeta, type PlatformKey } from "@/components/ui/platform";
import { DeltaBadge, OutlierBadge, StatusBadge, type StatusTone } from "@/components/ui/badges";
import { KpiCard } from "@/components/ui/stat";
import { DataTable, type DataTableColumn, type SortState } from "@/components/ui/data-table";
import { ChipGroup, RangeFilter, SearchInput, type NumericRange } from "@/components/ui/filters";
import { DateRangePicker, resolveDatePreset, type DateRangeValue } from "@/components/ui/date-range-picker";
import { SegmentedControl, Tabs } from "@/components/ui/tabs";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { DropdownMenu } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { Toaster, toast } from "@/components/ui/toast";
import { AreaChart, BarChart, Heatmap, LineChart, PLATFORM_CHART_COLORS } from "@/components/ui/charts";
import { UploadDropzone, type UploadStatus } from "@/components/ui/upload-dropzone";
import { MediaThumbCard, type MediaAspect } from "@/components/ui/media-thumb-card";
import {
  formatBytes,
  formatCompact,
  formatDate,
  formatDateRange,
  formatDuration,
  formatMultiplier,
  formatNumber,
  formatPercent,
  formatRelative,
  toDate,
} from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Datos de ejemplo (deterministas: lo mismo en servidor y navegador)  */
/* ------------------------------------------------------------------ */

const TODAY = new Date(2026, 9, 18);
const NOW = new Date(2026, 9, 18, 15, 30);

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ContentType = "reel" | "carrusel" | "post" | "video" | "short";
type ItemStatus = "publicado" | "no_disponible" | "en_revision";
type Item = {
  id: string;
  platform: PlatformKey;
  type: ContentType;
  caption: string;
  date: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  duration: number | null;
  status: ItemStatus;
  outlier: number | null;
  thumb: string | null;
};

const typeLabel: Record<ContentType, string> = { reel: "Reel", carrusel: "Carrusel", post: "Post", video: "Video", short: "Short" };
const statusMeta: Record<ItemStatus, { label: string; tone: StatusTone }> = {
  publicado: { label: "Publicado", tone: "success" },
  no_disponible: { label: "No disponible", tone: "warning" },
  en_revision: { label: "Sincronizando", tone: "info" },
};

const captions = [
  "3 errores que te hacen perder clientes en tu primer mes",
  "Cómo grabo 10 videos en una sola tarde (mi sistema completo)",
  "La pregunta que cambió mi forma de vender",
  "Por qué tus reels no pasan de 300 visualizaciones",
  "Mi rutina de contenido: de la idea al video publicado",
  "El guion de 30 segundos que más ventas me trajo",
  "Lo que nadie te dice de crecer en YouTube en 2026",
  "5 ganchos que puedes copiar hoy mismo",
  "Respondo la duda más común de mis alumnos",
  "Antes y después: cómo edito un video crudo",
  "La herramienta de IA que uso todos los días",
  "Cuánto gané con mi primer infoproducto",
  "Deja de publicar todos los días (haz esto en cambio)",
  "Así planeo un mes de contenido en 2 horas",
  "El error de precio que casi me quiebra",
  "Tutorial: subtítulos que retienen al espectador",
  "Q&A en vivo: marca personal desde cero",
  "Tres libros que cambiaron mi negocio",
  "Cómo conseguí mis primeros 1.000 seguidores",
  "La diferencia entre contenido viral y contenido que vende",
  "Detrás de cámaras de mi estudio",
  "Lo que aprendí después de 100 videos",
  "Mi plantilla de carrusel más guardada",
  "Por qué tu CTA no funciona",
];

function thumbFor(i: number, platform: PlatformKey) {
  const hues = { INSTAGRAM: 300, YOUTUBE: 8, TIKTOK: 178 };
  const h = hues[platform] + ((i * 23) % 40) - 20;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 90 160'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h} 70% 42%)'/><stop offset='1' stop-color='hsl(${(h + 60) % 360} 70% 14%)'/></linearGradient></defs><rect width='90' height='160' fill='url(%23g)'/><circle cx='${20 + ((i * 17) % 50)}' cy='${40 + ((i * 29) % 70)}' r='${18 + (i % 4) * 6}' fill='white' fill-opacity='0.12'/><rect x='12' y='118' width='${40 + (i % 3) * 12}' height='5' rx='2.5' fill='white' fill-opacity='0.35'/></svg>`;
  return `data:image/svg+xml;utf8,${svg.replace(/#/g, "%23").replace(/"/g, "'")}`;
}

const ITEMS: Item[] = (() => {
  const r = rng(42);
  const platforms: PlatformKey[] = ["INSTAGRAM", "YOUTUBE", "TIKTOK"];
  return captions.map((caption, i) => {
    const platform = platforms[i % 3];
    const type: ContentType =
      platform === "INSTAGRAM" ? (["reel", "carrusel", "reel", "post"] as const)[i % 4] : platform === "YOUTUBE" ? (i % 2 ? "short" : "video") : "video";
    const base = platform === "YOUTUBE" && type === "video" ? 8000 : 15000;
    const boost = i === 3 ? 6 : i === 10 ? 3.2 : 1;
    const views = Math.round(base * (0.3 + r() * 1.6) * boost);
    const date = new Date(TODAY);
    date.setDate(TODAY.getDate() - Math.round(i * 2.6 + r() * 2));
    return {
      id: `p${i + 1}`,
      platform,
      type,
      caption,
      date,
      views,
      likes: Math.round(views * (0.03 + r() * 0.05)),
      comments: Math.round(views * (0.002 + r() * 0.006)),
      shares: Math.round(views * (0.004 + r() * 0.01)),
      duration: type === "carrusel" || type === "post" ? null : type === "video" && platform === "YOUTUBE" ? 420 + Math.round(r() * 900) : 18 + Math.round(r() * 70),
      status: i === 7 ? "no_disponible" : i === 0 ? "en_revision" : "publicado",
      outlier: boost > 1 ? boost * 1.05 : null,
      thumb: i === 5 ? "/miniatura-que-no-existe.jpg" : thumbFor(i, platform),
    };
  });
})();

const DAYS = 28;
const DAY_LABELS = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(TODAY);
  d.setDate(TODAY.getDate() - (DAYS - 1 - i));
  return d;
});

const SERIES = (() => {
  const r = rng(7);
  const make = (base: number, growth: number, noise: number) =>
    DAY_LABELS.map((_, i) => Math.round(base * (1 + growth * i) * (1 - noise / 2 + r() * noise) * (i % 7 === 5 || i % 7 === 6 ? 0.82 : 1)));
  const ig = make(5200, 0.018, 0.35);
  const yt = make(3100, 0.006, 0.3);
  const tt = make(4300, 0.03, 0.5);
  tt[9] = null as unknown as number; // un día sin datos: la línea se corta
  return { ig, yt, tt };
})();

const HEATMAP = (() => {
  const r = rng(99);
  return Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const evening = Math.exp(-((h - 20) ** 2) / 8) * 1.0;
      const lunch = Math.exp(-((h - 13) ** 2) / 4) * 0.55;
      const night = h < 7 ? 0.04 : 0.12;
      const weekend = d >= 5 ? 1.25 : 1;
      return Math.round((evening + lunch + night) * weekend * 2400 * (0.75 + r() * 0.5));
    }),
  );
})();

/* ------------------------------------------------------------------ */
/* Vitrina                                                             */
/* ------------------------------------------------------------------ */

export function UiShowcase() {
  // Filtros
  const [range, setRange] = useState<DateRangeValue>(() => resolveDatePreset("90d", TODAY));
  const [platforms, setPlatforms] = useState<PlatformKey[]>([]);
  const [types, setTypes] = useState<ContentType[]>([]);
  const [query, setQuery] = useState("");
  const [viewsRange, setViewsRange] = useState<NumericRange>({ min: null, max: null });
  const [order, setOrder] = useState("recientes");
  const [view, setView] = useState<"tabla" | "cuadricula">("tabla");
  const [sort, setSort] = useState<SortState>({ key: "date", direction: "desc" });
  const [loading, setLoading] = useState(false);

  // Capas
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);

  // Subida simulada
  const [upload, setUpload] = useState<{ status: UploadStatus; progress: number; name?: string }>({ status: "idle", progress: 0 });
  const uploadTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(uploadTimer.current), []);

  const filtered = useMemo(() => {
    const from = toDate(range.from)!;
    const to = toDate(range.to)!;
    to.setHours(23, 59, 59);
    const q = query.trim().toLowerCase();
    return ITEMS.filter(
      (item) =>
        item.date >= from &&
        item.date <= to &&
        (!platforms.length || platforms.includes(item.platform)) &&
        (!types.length || types.includes(item.type)) &&
        (!q || item.caption.toLowerCase().includes(q)) &&
        (viewsRange.min == null || item.views >= viewsRange.min) &&
        (viewsRange.max == null || item.views <= viewsRange.max),
    );
  }, [range, platforms, types, query, viewsRange]);

  const hasFilters = platforms.length > 0 || types.length > 0 || query !== "" || viewsRange.min != null || viewsRange.max != null;

  function clearFilters() {
    setPlatforms([]);
    setTypes([]);
    setQuery("");
    setViewsRange({ min: null, max: null });
  }

  function simulateLoading() {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1600);
  }

  function startUpload(file: File) {
    window.clearInterval(uploadTimer.current);
    setUpload({ status: "uploading", progress: 0, name: file.name });
    uploadTimer.current = window.setInterval(() => {
      setUpload((u) => {
        const next = Math.min(100, u.progress + 7 + Math.random() * 9);
        if (next >= 100) {
          window.clearInterval(uploadTimer.current);
          toast.success("Video subido", { description: `«${file.name}» ya está listo para editar.` });
          return { ...u, status: "done", progress: 100 };
        }
        return { ...u, progress: next };
      });
    }, 280);
  }

  const columns: DataTableColumn<Item>[] = [
    {
      key: "caption",
      header: "Pieza",
      accessor: (row) => row.caption,
      sticky: true,
      width: "320px",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-[27px] flex-none overflow-hidden rounded-md bg-white/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={row.thumb && !row.thumb.startsWith("/") ? row.thumb : thumbFor(99, row.platform)} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="line-clamp-1 font-medium text-white">{row.caption}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${platformMeta[row.platform].dot}`} />
              {platformMeta[row.platform].label} · {typeLabel[row.type]}
            </p>
          </div>
        </div>
      ),
    },
    { key: "date", header: "Fecha", accessor: (row) => row.date, firstDirection: "desc", cell: (row) => <span className="whitespace-nowrap text-muted">{formatDate(row.date)}</span> },
    {
      key: "views",
      header: "Visualizaciones",
      numeric: true,
      accessor: (row) => row.views,
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          {row.outlier && <OutlierBadge ratio={row.outlier} />}
          <span className="font-semibold text-white">{formatNumber(row.views)}</span>
        </span>
      ),
    },
    { key: "likes", header: "Me gusta", numeric: true, accessor: (row) => row.likes, cell: (row) => formatNumber(row.likes) },
    { key: "comments", header: "Comentarios", numeric: true, accessor: (row) => row.comments, cell: (row) => formatNumber(row.comments) },
    { key: "shares", header: "Compartidos", numeric: true, accessor: (row) => row.shares, cell: (row) => formatNumber(row.shares) },
    { key: "duration", header: "Duración", numeric: true, accessor: (row) => row.duration, cell: (row) => (row.duration == null ? <span className="text-placeholder">—</span> : formatDuration(row.duration)) },
    {
      key: "status",
      header: "Estado",
      accessor: (row) => statusMeta[row.status].label,
      cell: (row) => <StatusBadge tone={statusMeta[row.status].tone}>{statusMeta[row.status].label}</StatusBadge>,
    },
  ];

  const totals = filtered.reduce((acc, item) => ({ views: acc.views + item.views, likes: acc.likes + item.likes }), { views: 0, likes: 0 });

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <PageHeader
          eyebrow="Solo desarrollo · /ui"
          title="Sistema de diseño"
          description="Todos los componentes de components/ui con datos de ejemplo. Esta página no existe en producción."
          icon={<LayoutGrid className="h-5 w-5" />}
          actions={
            <Button variant="ghost" onClick={() => toast.info("Esto es un aviso de prueba")}>
              Probar aviso
            </Button>
          }
        />

        <Notice tone="warning" title="Datos ficticios">
          Los números, fechas y miniaturas de esta página son inventados para mostrar los componentes.
        </Notice>

        {/* KPIs */}
        <Section title="Métricas clave" description="KpiCard: valor con separador de miles o compacto, variación contra el periodo anterior y tendencia.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Visualizaciones"
              value={1248300}
              previous={1032000}
              format="compact"
              icon={<Eye className="h-4 w-4" />}
              trend={SERIES.ig.map((v, i) => v + SERIES.yt[i] + (SERIES.tt[i] ?? 0))}
            />
            <KpiCard label="Me gusta" value={58214} delta={-3.24} icon={<Heart className="h-4 w-4" />} trend={SERIES.yt} />
            <KpiCard label="Tasa de interacción" value={4.82} delta={0} format="percent" icon={<Percent className="h-4 w-4" />} trend={SERIES.tt} />
            <KpiCard label="Retención media" value={47} previous={null} format="duration" icon={<Timer className="h-4 w-4" />} />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Cargando…" value={null} loading trend={[1, 2]} />
            <KpiCard label="Abandono en 3 s" value={31.4} delta={-6.1} invertDelta format="percent" comparisonLabel="vs. 28 días anteriores" />
          </div>
        </Section>

        {/* Filtros + tabla / cuadrícula */}
        <Section
          title="Contenido"
          description="Barra de filtros (todo filtra de verdad), DataTable ordenable y vista de cuadrícula con MediaThumbCard."
          actions={
            <div className="flex items-center gap-2">
              <SegmentedControl
                label="Vista"
                value={view}
                onValueChange={setView}
                options={[
                  { value: "tabla", label: "Tabla", icon: <Rows3 className="h-4 w-4" /> },
                  { value: "cuadricula", label: "Cuadrícula", icon: <LayoutGrid className="h-4 w-4" /> },
                ]}
              />
              <DropdownMenu
                label="Más acciones"
                align="end"
                trigger={<MoreHorizontal className="h-4 w-4" />}
                items={[
                  { label: "Exportar CSV", icon: <Download className="h-4 w-4" />, onSelect: () => toast.success("Exportación lista") },
                  { label: "Simular carga", icon: <Timer className="h-4 w-4" />, onSelect: simulateLoading },
                  { label: "Compartir vista", icon: <Share2 className="h-4 w-4" />, hint: "⌘L", onSelect: () => toast.info("Enlace copiado") },
                  { label: "Editar columnas", icon: <Pencil className="h-4 w-4" />, disabled: true, onSelect: () => {} },
                  { type: "separator" },
                  { label: "Borrar filtros guardados", icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setDialogOpen(true) },
                ]}
              />
            </div>
          }
        >
          <div className="mb-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <DateRangePicker value={range} onChange={setRange} today={TODAY} />
              <SearchInput value={query} onChange={setQuery} placeholder="Buscar en el caption…" className="min-w-56 flex-1" />
              <Select aria-label="Ordenar por" value={order} onChange={(e) => setOrder(e.target.value)} className="!w-auto !py-2 text-sm">
                <option value="recientes">Más recientes</option>
                <option value="vistas">Más vistas</option>
                <option value="interaccion">Más interacción</option>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <ChipGroup
                label="Red"
                showLabel
                allLabel="Todas"
                value={platforms}
                onChange={setPlatforms}
                options={(Object.keys(platformMeta) as PlatformKey[]).map((p) => ({
                  value: p,
                  label: platformMeta[p].label,
                  icon: <span className={`h-2 w-2 rounded-full ${platformMeta[p].dot}`} />,
                  count: ITEMS.filter((i) => i.platform === p).length,
                }))}
              />
              <ChipGroup
                label="Tipo"
                showLabel
                value={types}
                onChange={setTypes}
                options={(Object.keys(typeLabel) as ContentType[]).map((t) => ({ value: t, label: typeLabel[t] }))}
              />
              <RangeFilter label="Visualizaciones" value={viewsRange} onChange={setViewsRange} className="w-64" />
              {hasFilters && (
                <Button variant="subtle" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
            </div>
            <p className="text-xs text-muted" aria-live="polite">
              {formatNumber(filtered.length)} piezas · {formatCompact(totals.views)} visualizaciones · {formatDateRange(range.from, range.to)}
            </p>
          </div>

          {view === "tabla" ? (
            <DataTable
              caption="Piezas de contenido"
              columns={columns}
              rows={filtered}
              getRowId={(row) => row.id}
              sort={sort}
              onSortChange={setSort}
              onRowClick={setSelected}
              loading={loading}
              maxHeight="520px"
              empty={
                <EmptyState
                  className="!border-0 !bg-transparent"
                  icon={<BarChart3 className="h-5 w-5" />}
                  title="No hay piezas con estos filtros"
                  description="Prueba con otro rango de fechas o quita algún filtro."
                  action={
                    <Button variant="ghost" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  }
                />
              }
            />
          ) : filtered.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {filtered.map((item) => (
                <MediaThumbCard
                  key={item.id}
                  src={item.thumb}
                  title={item.caption}
                  aspect="9:16"
                  platform={item.platform}
                  metric={{ value: formatCompact(item.views), label: "visualizaciones" }}
                  duration={item.duration}
                  badge={item.outlier ? <OutlierBadge ratio={item.outlier} /> : undefined}
                  meta={formatDate(item.date)}
                  onClick={() => setSelected(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No hay piezas con estos filtros" description="Prueba con otro rango de fechas o quita algún filtro." />
          )}
        </Section>

        {/* Gráficos */}
        <Section title="Gráficos" description="SVG propio: tooltip con mouse o flechas (enfoca el gráfico con Tab), tabla accesible con «Ver datos».">
          <Tabs
            label="Gráficos de ejemplo"
            items={[
              {
                value: "evolucion",
                label: "Evolución",
                icon: <BarChart3 className="h-4 w-4" />,
                content: (
                  <div className="grid gap-4">
                    <AreaChart
                      title="Visualizaciones por red"
                      description="Últimos 28 días · valor diario"
                      labels={DAY_LABELS.map((d) => formatDate(d, { withYear: false }))}
                      fullLabels={DAY_LABELS.map((d) => formatDate(d))}
                      series={[
                        { key: "ig", label: "Instagram", values: SERIES.ig, color: PLATFORM_CHART_COLORS.INSTAGRAM },
                        { key: "yt", label: "YouTube", values: SERIES.yt, color: PLATFORM_CHART_COLORS.YOUTUBE },
                        { key: "tt", label: "TikTok", values: SERIES.tt, color: PLATFORM_CHART_COLORS.TIKTOK },
                      ]}
                      height={280}
                    />
                    <div className="grid gap-4 lg:grid-cols-2">
                      <LineChart
                        title="Seguidores nuevos"
                        description="Una sola serie: sin leyenda, el título la nombra"
                        labels={DAY_LABELS.map((d) => formatDate(d, { withYear: false }))}
                        fullLabels={DAY_LABELS.map((d) => formatDate(d))}
                        series={[{ key: "f", label: "Seguidores nuevos", values: SERIES.ig.map((v) => Math.round(v / 40)) }]}
                        height={200}
                      />
                      <LineChart
                        title="Este periodo vs. anterior"
                        description="Comparación entre periodos en un solo eje"
                        labels={DAY_LABELS.map((_, i) => `Día ${i + 1}`)}
                        series={[
                          { key: "now", label: "Este periodo", values: SERIES.ig },
                          { key: "prev", label: "Periodo anterior", values: SERIES.ig.map((v, i) => Math.round(v * (0.8 + ((i * 7) % 10) / 50))), color: "var(--color-muted)" },
                        ]}
                        height={200}
                      />
                    </div>
                  </div>
                ),
              },
              {
                value: "redes",
                label: "Por red",
                content: (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <BarChart
                      title="Visualizaciones por red"
                      orientation="horizontal"
                      metricLabel="Visualizaciones"
                      data={[
                        { key: "ig", label: "Instagram", value: 612400, color: PLATFORM_CHART_COLORS.INSTAGRAM },
                        { key: "tt", label: "TikTok", value: 418900, color: PLATFORM_CHART_COLORS.TIKTOK },
                        { key: "yt", label: "YouTube", value: 217000, color: PLATFORM_CHART_COLORS.YOUTUBE },
                      ]}
                    />
                    <BarChart
                      title="Visualizaciones por tipo"
                      orientation="horizontal"
                      metricLabel="Visualizaciones"
                      data={[
                        { key: "reel", label: "Reels", value: 402000 },
                        { key: "short", label: "Shorts", value: 198500 },
                        { key: "video", label: "Videos de TikTok", value: 418900 },
                        { key: "yt", label: "Videos largos de YouTube", value: 18500 },
                        { key: "car", label: "Carruseles", value: 210400 },
                      ]}
                    />
                  </div>
                ),
              },
              {
                value: "dias",
                label: "Por día",
                content: (
                  <BarChart
                    title="Publicaciones con más alcance por día"
                    description="Columnas: solo se rotula el máximo; el resto, en el tooltip"
                    metricLabel="Visualizaciones"
                    data={DAY_LABELS.slice(-14).map((d, i) => ({ key: String(i), label: formatDate(d, { withYear: false }), value: SERIES.ig[i + 14] + SERIES.yt[i + 14] }))}
                  />
                ),
              },
              {
                value: "horarios",
                label: "Horarios",
                count: 168,
                content: <Heatmap title="¿Cuándo ve tu audiencia?" description="Visualizaciones por día y hora (hora local)" metricLabel="Visualizaciones" values={HEATMAP} />,
              },
              { value: "pronto", label: "Retención", disabled: true, content: null },
            ]}
          />
        </Section>

        {/* Insignias */}
        <Section title="Insignias" description="StatusBadge (icono + texto), DeltaBadge (flecha + signo + texto) y OutlierBadge.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="neutral">Idea</StatusBadge>
              <StatusBadge tone="info">En producción</StatusBadge>
              <StatusBadge tone="success">Publicado</StatusBadge>
              <StatusBadge tone="warning">No disponible</StatusBadge>
              <StatusBadge tone="danger">Error al renderizar</StatusBadge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DeltaBadge value={12.5} />
              <DeltaBadge value={-3.24} />
              <DeltaBadge value={0.01} />
              <DeltaBadge value={8} invert comparisonLabel="frente al periodo anterior" />
              <DeltaBadge value={148.3} size="md" />
              <OutlierBadge ratio={3.2} />
              <OutlierBadge ratio={12} />
              <PlatformBadge platform="TIKTOK" />
            </div>
          </div>
        </Section>

        {/* Capas */}
        <Section title="Capas y avisos" description="Dialog y Sheet con <dialog> nativo, Tooltip, DropdownMenu y Toast.">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setDialogOpen(true)}>Abrir diálogo</Button>
            <Button variant="ghost" onClick={() => setSelected(ITEMS[3])}>
              Abrir panel lateral
            </Button>
            <Tooltip content="Las métricas se actualizan una vez al día, a las 6:00.">
              <button type="button" className="tile-icon h-10 w-10" aria-label="Sobre las métricas">
                <Info className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip content="Descarga la tabla con los filtros actuales" side="bottom">
              <Button variant="ghost" icon={<Download className="h-4 w-4" />}>
                Exportar
              </Button>
            </Tooltip>
            <Button variant="subtle" onClick={() => toast.success("Cambios guardados")}>
              Aviso de éxito
            </Button>
            <Button variant="subtle" onClick={() => toast.error("No se pudo conectar con TikTok", { description: "Vuelve a conectar tu cuenta desde Ajustes." })}>
              Aviso de error
            </Button>
            <Button variant="subtle" onClick={() => ["Uno", "Dos", "Tres", "Cuatro"].forEach((n) => toast.info(`Aviso ${n.toLowerCase()}`))}>
              Cuatro avisos (máx. 3)
            </Button>
          </div>
        </Section>

        {/* Miniaturas */}
        <Section title="Miniaturas" description="MediaThumbCard en sus proporciones, con insignia de pieza destacada y reemplazo cuando la imagen no carga.">
          <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-4">
            {(
              [
                ["16:9", ITEMS[4], "Video de YouTube (16:9)"],
                ["1:1", ITEMS[0], "Post cuadrado (1:1)"],
                ["4:5", ITEMS[1], "Carrusel (4:5)"],
                ["9:16", ITEMS[5], "Imagen rota → reemplazo"],
              ] as [MediaAspect, Item, string][]
            ).map(([aspect, item, label]) => (
              <MediaThumbCard
                key={aspect}
                aspect={aspect}
                src={item.thumb}
                title={label}
                platform={item.platform}
                metric={{ value: formatCompact(item.views), label: "visualizaciones" }}
                duration={item.duration}
                badge={aspect === "16:9" ? <OutlierBadge ratio={3.2} /> : undefined}
                meta={formatRelative(item.date, NOW)}
              />
            ))}
          </div>
        </Section>

        {/* Subida */}
        <Section title="Subir archivos" description="UploadDropzone: valida tipo y tamaño; el progreso lo pone el padre (aquí, simulado).">
          <div className="grid gap-4 lg:grid-cols-2">
            <UploadDropzone
              accept={["video/mp4", "video/quicktime", ".mov", ".mp4"]}
              acceptLabel="un video MP4 o MOV"
              maxSize={2 * 1024 ** 3}
              status={upload.status}
              progress={upload.progress}
              fileName={upload.name}
              onFiles={([file]) => startUpload(file)}
              onCancel={() => {
                window.clearInterval(uploadTimer.current);
                setUpload({ status: "idle", progress: 0 });
                toast.info("Subida cancelada");
              }}
              title="Arrastra tu video crudo aquí"
            />
            <UploadDropzone accept={["image/*"]} acceptLabel="una imagen JPG o PNG" maxSize={8 * 1024 ** 2} multiple onFiles={(files) => toast.success(`${files.length} imagen(es) válidas`)} title="Fotos del personaje" error={null} />
          </div>
        </Section>

        {/* Formato */}
        <Section title="Formato" description="lib/format.ts: Intl con configuración «es».">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            {(
              [
                ["formatNumber(1234567)", formatNumber(1234567)],
                ["formatNumber(1234)", formatNumber(1234)],
                ["formatCompact(12400)", formatCompact(12400)],
                ["formatCompact(1250000)", formatCompact(1250000)],
                ["formatPercent(12.5, signed)", formatPercent(12.5, { signed: true })],
                ["formatMultiplier(3.2)", formatMultiplier(3.2)],
                ["formatDuration(47)", formatDuration(47)],
                ["formatDuration(754)", formatDuration(754)],
                ["formatDuration(3900)", formatDuration(3900)],
                ["formatBytes(2147483648)", formatBytes(2147483648)],
                ["formatDate(“2026-10-12”)", formatDate("2026-10-12")],
                ["formatDateRange(28 sept → 12 oct)", formatDateRange("2026-09-28", "2026-10-12")],
                ["formatRelative(-3 h)", formatRelative(new Date(NOW.getTime() - 3 * 3600e3), NOW)],
                ["formatRelative(-1 día)", formatRelative(new Date(NOW.getTime() - 26 * 3600e3), NOW)],
                ["formatRelative(-12 min)", formatRelative(new Date(NOW.getTime() - 12 * 60e3), NOW)],
                ["formatRelative(-20 días)", formatRelative(new Date(NOW.getTime() - 20 * 86400e3), NOW)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-white/[0.06] py-1.5">
                <dt className="font-mono text-xs text-muted">{k}</dt>
                <dd className="font-semibold text-white tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="¿Borrar los filtros guardados?"
        description="Se borran tus vistas guardadas de Métricas. Tus piezas y sus números no se tocan."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setDialogOpen(false);
                toast.success("Filtros guardados borrados");
              }}
            >
              Sí, borrar
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Puedes volver a guardarlos cuando quieras desde la barra de filtros.</p>
      </Dialog>

      <Sheet
        open={selected != null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.caption ?? ""}
        description={selected ? `${platformMeta[selected.platform].label} · ${typeLabel[selected.type]} · ${formatDate(selected.date)}` : undefined}
        footer={
          <Button variant="ghost" onClick={() => setSelected(null)}>
            Cerrar
          </Button>
        }
      >
        {selected && (
          <div className="flex flex-col gap-5">
            <div className="mx-auto w-40">
              <MediaThumbCard src={selected.thumb} title="Miniatura" platform={selected.platform} duration={selected.duration} badge={selected.outlier ? <OutlierBadge ratio={selected.outlier} /> : undefined} />
            </div>
            <dl className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Visualizaciones", formatNumber(selected.views)],
                  ["Me gusta", formatNumber(selected.likes)],
                  ["Comentarios", formatNumber(selected.comments)],
                  ["Compartidos", formatNumber(selected.shares)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="card p-3">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="mt-1 text-xl font-semibold text-white">{v}</dd>
                </div>
              ))}
            </dl>
            <StatusBadge tone={statusMeta[selected.status].tone}>{statusMeta[selected.status].label}</StatusBadge>
          </div>
        )}
      </Sheet>

      <Toaster />
    </div>
  );
}
