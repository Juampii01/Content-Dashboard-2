import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarDays, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/feedback";
import { CalendarBoard } from "@/components/calendario/calendar-board";
import { parseFilters, type CreateDefaults } from "@/components/calendario/shared";
import { getCurrentUser } from "@/lib/auth";
import { isDay, todayIn, visibleRange, type CalendarView } from "@/lib/calendar/dates";
import { brandCanPlan } from "@/lib/calendar/plan";
import type { SourceKind } from "@/lib/calendar/service";
import { getBrandProfile } from "@/lib/dal/brand";
import { getCalendar, getPendingSuggestions, getSourcePrefill } from "@/lib/dal/calendar";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Calendario" };

type Params = Awaited<PageProps<"/calendario">["searchParams"]>;
import { FEATURES } from "@/lib/features";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const sourceParams: { param: string; kind: SourceKind; label: string; missing: string }[] = [
  { param: "guion", kind: "guion", label: "desde tu guion", missing: "No encontramos ese guion. Puede que se haya borrado." },
  { param: "carrusel", kind: "carrusel", label: "desde tu carrusel", missing: "No encontramos ese carrusel. Puede que se haya borrado." },
  ...(FEATURES.clone ? [{ param: "clon", kind: "clon" as const, label: "desde tu video con clon", missing: "No encontramos ese video con clon. Puede que se haya borrado." }] : []),
  { param: "video", kind: "editor", label: "desde tu video editado", missing: "No encontramos ese video del editor. Puede que se haya borrado." },
];

/** `?nuevo=1` abre "Nueva pieza"; con `&guion=<id>` (o carrusel, clon, video) la precarga desde esa fuente. */
async function createFromParams(params: Params): Promise<{ create: CreateDefaults | null; error: string | null }> {
  if (one(params.nuevo) !== "1") return { create: null, error: null };
  const date = isDay(one(params.dia)) ? one(params.dia) : isDay(one(params.fecha)) ? one(params.fecha) : null;
  const source = sourceParams.find((s) => one(params[s.param]));
  if (!source) return { create: { scheduledDate: date }, error: null };
  const prefill = await getSourcePrefill(source.kind, one(params[source.param]));
  if (!prefill) return { create: null, error: source.missing };
  return {
    create: {
      title: prefill.title,
      hook: prefill.hook,
      pillar: prefill.pillar,
      format: prefill.format,
      platforms: prefill.platforms,
      status: prefill.status,
      scheduledDate: date,
      scriptId: prefill.scriptId,
      scriptTitle: prefill.scriptTitle,
      carouselId: prefill.carouselId,
      cloneVideoId: prefill.cloneVideoId,
      videoProjectId: prefill.videoProjectId,
      source: source.kind,
      sourceLabel: source.label,
      existing: prefill.existing,
    },
    error: null,
  };
}

async function CalendarContent({ searchParams }: { searchParams: PageProps<"/calendario">["searchParams"] }) {
  const params = await searchParams;
  const me = await getCurrentUser();
  const today = todayIn(env().APP_TIMEZONE);
  const view: CalendarView = one(params.vista) === "semana" ? "semana" : "mes";
  const anchor = isDay(one(params.fecha)) ? one(params.fecha) : today;
  const range = visibleRange(view, anchor);

  const [data, suggestions, brand, fromParams] = await Promise.all([getCalendar(range.from, range.to), getPendingSuggestions(), getBrandProfile(), createFromParams(params)]);

  return (
    <CalendarBoard
      view={view}
      anchor={anchor}
      today={today}
      days={range.days}
      entries={data.entries}
      undated={data.undated}
      suggestions={suggestions}
      pillars={(brand?.pillars ?? []).map((p) => p.name).filter(Boolean)}
      canEdit={me.role !== "VIEWER"}
      canPlan={brandCanPlan(brand)}
      initialFilters={parseFilters(params)}
      create={fromParams.create}
      createError={fromParams.error}
    />
  );
}

function CalendarSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando el calendario">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="ml-auto h-9 w-72" />
      </div>
      <Skeleton className="h-14" />
      <div className="grid gap-4 xl:grid-cols-[13.5rem_minmax(0,1fr)]">
        <Skeleton className="hidden h-80 xl:block" />
        <Skeleton className="h-[640px]" />
      </div>
    </div>
  );
}

export default function CalendarioPage({ searchParams }: PageProps<"/calendario">) {
  return (
    <>
      <PageHeader
        eyebrow="Calendario"
        title="¿Qué vas a publicar y cuándo?"
        description="Planea tus piezas por semana o por mes, muévelas arrastrando y mira cómo rindió cada una cuando se publica."
        icon={<CalendarDays className="h-5 w-5" aria-hidden />}
        actions={
          <ButtonLink href="/calendario/semana" variant="ghost" icon={<Sparkles className="h-4 w-4" aria-hidden />}>
            Tu semana lista
          </ButtonLink>
        }
      />
      <Suspense fallback={<CalendarSkeleton />}>
        <CalendarContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
