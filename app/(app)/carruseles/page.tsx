import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { GalleryHorizontalEnd, Palette, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/feedback";
import { CarouselCard } from "@/components/carruseles/carousel-card";
import { CustomTemplatesProvider } from "@/components/carruseles/custom-templates";
import { getCurrentUser } from "@/lib/auth";
import { countCarouselsByStatus, getCarouselLook, listCarouselTemplates, listCarousels } from "@/lib/dal/carousels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Carruseles" };

const tabs: { key: string; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "DRAFT", label: "Borradores" },
  { key: "READY", label: "Listos" },
  { key: "EXPORTED", label: "Exportados" },
  { key: "ARCHIVED", label: "Archivados" },
];

async function CarouselList({ searchParams }: { searchParams: PageProps<"/carruseles">["searchParams"] }) {
  const params = await searchParams;
  const status = typeof params.estado === "string" ? params.estado : "todos";
  const [me, items, counts, look, templates] = await Promise.all([getCurrentUser(), listCarousels(status), countCarouselsByStatus(), getCarouselLook(), listCarouselTemplates(true)]);
  const total = Object.entries(counts).filter(([k]) => k !== "ARCHIVED").reduce((a, [, n]) => a + n, 0);
  const cardLook = { colors: look.colors, fonts: look.fonts, identity: look.identity };

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const n = t.key === "todos" ? total : (counts[t.key] ?? 0);
          const active = status === t.key;
          return (
            <Link
              key={t.key}
              href={t.key === "todos" ? "/carruseles" : `/carruseles?estado=${t.key}`}
              aria-current={active ? "page" : undefined}
              className={cn("pill transition", active ? "!border-accent/60 !bg-accent/20 !text-white" : "hover:!text-white")}
            >
              {t.label} <span className="font-mono text-[10px] opacity-70">{n}</span>
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={<GalleryHorizontalEnd className="h-5 w-5" aria-hidden />}
          title={total === 0 ? "Todavía no tienes carruseles" : "No hay carruseles en este estado"}
          description={
            total === 0
              ? "Parte de un tema, de uno de tus guiones o de un texto que ya escribiste. Te devolvemos cada slide listo para editar y lo descargas en 1080 × 1350."
              : undefined
          }
          action={
            <ButtonLink href="/carruseles/nuevo" icon={<Plus className="h-4 w-4" aria-hidden />}>
              Nuevo carrusel
            </ButtonLink>
          }
        />
      ) : (
        <CustomTemplatesProvider templates={templates.flatMap((t) => (t.spec ? [{ id: t.id, name: t.name, spec: t.spec }] : []))}>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {items.map((c) => (
              <li key={c.id}>
                <CarouselCard item={{ ...c, updatedAt: c.updatedAt.toISOString() }} look={cardLook} canEdit={me.role !== "VIEWER"} />
              </li>
            ))}
          </ul>
        </CustomTemplatesProvider>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="aspect-[4/6]" />
      ))}
    </div>
  );
}

export default function CarruselesPage({ searchParams }: PageProps<"/carruseles">) {
  return (
    <>
      <PageHeader
        eyebrow="Carruseles"
        title="Carruseles listos para Instagram"
        description="De un tema, un guion o un texto a slides de 1080 × 1350 con tu marca. Editas cada slide y descargas todo en un ZIP."
        icon={<GalleryHorizontalEnd className="h-5 w-5" aria-hidden />}
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/carruseles/plantillas" variant="ghost" icon={<Palette className="h-4 w-4" aria-hidden />}>
              Plantillas
            </ButtonLink>
            <ButtonLink href="/carruseles/nuevo" icon={<Plus className="h-4 w-4" aria-hidden />}>
              Nuevo carrusel
            </ButtonLink>
          </div>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <CarouselList searchParams={searchParams} />
      </Suspense>
    </>
  );
}
