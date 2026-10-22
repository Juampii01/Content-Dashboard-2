import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Citrus, Clapperboard, FileText, GalleryHorizontalEnd, MessageSquareText, TrendingUp } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badges";
import { StartPackButton } from "@/components/jugo/start-button";
import { aiConfigured } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth";
import { getRepurposeSource, listPacks, listSourceSuggestions, type PackListItem, type SourceSuggestion } from "@/lib/dal/repurpose";
import { formatDate, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Sacarle todo el jugo" };
export const maxDuration = 300;

type Params = Awaited<PageProps<"/jugo">["searchParams"]>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const kindLabel = { video: "Video", guion: "Guion", pieza: "Pieza publicada" } as const;
const kindIcon = { video: Clapperboard, guion: FileText, pieza: TrendingUp } as const;

const outputs = [
  { icon: GalleryHorizontalEnd, title: "Un carrusel", text: "El borrador en Carruseles, con la ficha de textos lista." },
  { icon: MessageSquareText, title: "Los textos de cada red", text: "Caption de Instagram y TikTok, título y descripción de YouTube, con hashtags medidos." },
  { icon: FileText, title: "2 o 3 shorts", text: "Guiones nuevos en Guiones, cada uno con sus ganchos." },
];

function PackRow({ pack }: { pack: PackListItem }) {
  const Icon = kindIcon[pack.sourceKind];
  return (
    <li>
      <Link href={`/jugo/${pack.id}`} className="card card-lift flex items-center gap-3 p-4">
        <span className="tile-icon h-9 w-9 flex-none">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-white">{pack.title}</span>
          <span className="block text-xs text-muted">
            {kindLabel[pack.sourceKind]} · {formatDate(pack.createdAt)}
          </span>
        </span>
        {pack.generating ? (
          <StatusBadge tone="info">Generando</StatusBadge>
        ) : pack.failed ? (
          <StatusBadge tone="warning">{formatNumber(pack.failed)} por reintentar</StatusBadge>
        ) : (
          <StatusBadge tone="success">Listo</StatusBadge>
        )}
      </Link>
    </li>
  );
}

async function FromSource({ params }: { params: Params }) {
  const me = await getCurrentUser();
  const kind = one(params.video) ? "video" : one(params.guion) ? "guion" : "pieza";
  const id = one(params.video) || one(params.guion) || one(params.pieza);
  const source = await getRepurposeSource(kind, id);
  if (!source) {
    return (
      <EmptyState
        icon={<Citrus className="h-6 w-6" aria-hidden />}
        title="No encontramos ese contenido"
        description="Puede que se haya borrado. Elige otro video, guion o pieza para sacarle todo el jugo."
        action={<ButtonLink href="/jugo">Elegir otro</ButtonLink>}
      />
    );
  }
  const Icon = kindIcon[source.kind];
  const canEdit = me.role !== "VIEWER";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="section-shell flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="tile-icon h-10 w-10 flex-none">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="eyebrow mb-1">{source.detail}</p>
            <h2 className="text-lg font-semibold text-white">{source.title}</h2>
            <p className="mt-1 text-sm text-muted">
              {source.textOrigin} · {formatNumber(source.words)} palabras
            </p>
          </div>
        </div>
        <blockquote className="max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-relaxed whitespace-pre-line text-text/85">{source.text.slice(0, 1500)}{source.text.length > 1500 ? "…" : ""}</blockquote>
        {source.blocked ? (
          <Notice tone="warning">{source.blocked}</Notice>
        ) : source.words < 60 ? (
          <Notice>Tiene poco texto: los resultados van a ser más generales. Con un video editado o un guion completo salen mucho mejor.</Notice>
        ) : null}
        {!aiConfigured() && <Notice tone="warning">Falta configurar la IA en esta instalación. Avísale a soporte.</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <StartPackButton kind={source.kind} id={source.id} disabled={Boolean(source.blocked) || !aiConfigured()} />
          ) : (
            <p className="text-sm text-muted">Tu acceso es de solo lectura: pídele a quien administra la cuenta que lo genere.</p>
          )}
          <ButtonLink href={source.href} variant="subtle">
            Ver el original
          </ButtonLink>
        </div>
        <p className="text-xs text-muted">Tarda alrededor de un minuto. Puedes salir y volver: sigue solo.</p>
      </section>

      <aside className="flex flex-col gap-4">
        <div className="card p-5">
          <p className="eyebrow mb-3">Qué vas a recibir</p>
          <ul className="flex flex-col gap-3">
            {outputs.map(({ icon: OutIcon, title, text }) => (
              <li key={title} className="flex gap-3">
                <OutIcon className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold text-white">{title}</span>
                  <span className="block text-xs leading-relaxed text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        {source.previous.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="eyebrow">Ya le sacaste el jugo</p>
            <ul className="flex flex-col gap-2">
              {source.previous.map((p) => (
                <PackRow key={p.id} pack={p} />
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function SuggestionList({ title, items, empty }: { title: string; items: SourceSuggestion[]; empty: { text: string; href: string; label: string } }) {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <h3 className="font-semibold text-white">{title}</h3>
      {items.length ? (
        <ul className="flex flex-col gap-1">
          {items.map((s) => (
            <li key={s.id}>
              <Link href={`/jugo?${s.kind}=${s.id}`} className="group flex items-center gap-2 rounded-xl px-2 py-2 transition hover:bg-white/5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{s.title}</span>
                  <span className="block text-xs text-muted">{s.detail}</span>
                </span>
                <ArrowRight className="h-4 w-4 flex-none text-muted transition group-hover:translate-x-0.5 group-hover:text-accent-hi" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-3 text-sm text-muted">
          <p>{empty.text}</p>
          <ButtonLink href={empty.href} variant="ghost" size="sm">
            {empty.label}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

async function Overview() {
  const [suggestions, packs] = await Promise.all([listSourceSuggestions(), listPacks()]);
  return (
    <div className="flex flex-col gap-8">
      <Section title="¿De qué contenido sacamos más?" description="Elige un video terminado, un guion o una de tus piezas que mejor rindieron. También puedes empezar desde el botón “Sacarle todo el jugo” en cada una.">
        <div className="grid gap-4 lg:grid-cols-3">
          <SuggestionList title="Videos editados" items={suggestions.videos} empty={{ text: "Todavía no tienes videos editados.", href: "/editor/nuevo", label: "Editar un video" }} />
          <SuggestionList title="Guiones" items={suggestions.scripts} empty={{ text: "Todavía no tienes guiones.", href: "/guiones/nuevo", label: "Escribir un guion" }} />
          <SuggestionList title="Lo que mejor te funcionó" items={suggestions.pieces} empty={{ text: "Conecta tus redes para ver qué piezas rindieron más.", href: "/ajustes", label: "Conectar redes" }} />
        </div>
      </Section>
      {packs.length > 0 && (
        <Section title="Tus paquetes" description="Todo lo que ya le sacaste a tus contenidos.">
          <ul className="grid gap-3 md:grid-cols-2">
            {packs.map((p) => (
              <PackRow key={p.id} pack={p} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/jugo">["searchParams"] }) {
  const params = await searchParams;
  if (one(params.video) || one(params.guion) || one(params.pieza)) return <FromSource params={params} />;
  return <Overview />;
}

function JugoSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-96" />
      <Skeleton className="h-72" />
    </div>
  );
}

export default function JugoPage({ searchParams }: PageProps<"/jugo">) {
  return (
    <>
      <PageHeader
        eyebrow="Sacarle todo el jugo"
        title="Un contenido, todo el contenido"
        description="De un video editado, un guion o una pieza que ya publicaste salen un carrusel, los textos para cada red y 2 o 3 shorts nuevos, con tu marca."
        icon={<Citrus className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<JugoSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
