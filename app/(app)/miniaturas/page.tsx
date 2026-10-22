import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ImagePlay, Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { PackageThumb } from "@/components/miniaturas/package-thumb";
import { getCurrentUser } from "@/lib/auth";
import { getBrandProfile } from "@/lib/dal/brand";
import { characterPhotos, listPackages } from "@/lib/dal/youtube";
import { formatRelative } from "@/lib/format";
import { thumbFileUrl } from "@/lib/youtube/files";
import { thumbColors, thumbFontFromBrand } from "@/lib/youtube/thumbnail-layout";

export const metadata: Metadata = { title: "Títulos y miniaturas" };

const SOURCE: Record<string, string> = { guion: "Desde un guion", video: "Desde un video del Editor", pieza: "Desde un video publicado", tema: "Desde un tema" };

async function List() {
  const [packages, user, brand, photos] = await Promise.all([listPackages(), getCurrentUser(), getBrandProfile(), characterPhotos()]);
  if (!packages.length) {
    return (
      <EmptyState
        icon={<ImagePlay className="h-5 w-5" aria-hidden />}
        title="Todavía no armaste títulos ni miniaturas"
        description="Parte de un guion, un video del Editor o un video ya publicado: te damos 8 a 10 títulos por ángulo y 3 miniaturas con tu foto y tus colores, listas para descargar."
        action={
          user.role !== "VIEWER" ? (
            <ButtonLink href="/miniaturas/nuevo" icon={<Plus className="h-4 w-4" aria-hidden />}>
              Crear títulos y miniaturas
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }
  const colors = thumbColors(brand?.colors ?? null);
  const font = thumbFontFromBrand(brand?.fonts?.heading);
  const photoUrl = new Map(photos.map((p) => [p.key, p.cutoutKey ? { url: thumbFileUrl(p.cutoutKey)!, cutout: true } : { url: thumbFileUrl(p.key)!, cutout: false }]));
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {packages.map((p) => {
        const c = p.concepts.find((x) => x.backgroundStatus === "ready") ?? p.concepts[0];
        return (
          <li key={p.id}>
            <Link href={`/miniaturas/${p.id}`} className="card card-lift flex h-full flex-col gap-3 p-4">
              {c && (
                <div className="overflow-hidden rounded-xl border border-white/10">
                  <PackageThumb
                    label={`Miniatura de ${p.title}`}
                    text={c.text}
                    highlight={c.highlight}
                    layout={c.layout}
                    font={c.font ?? font}
                    colors={colors}
                    backgroundUrl={thumbFileUrl(c.backgroundKey)}
                    photo={c.photoKey ? (photoUrl.get(c.photoKey) ?? null) : null}
                  />
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs text-muted">
                  {SOURCE[p.sourceKind] ?? ""} · {p.format === "SHORT" ? "Short" : "Video largo"}
                </p>
                <h3 className="line-clamp-2 font-semibold text-white">{p.selectedTitle ?? p.title}</h3>
                <span className="text-xs text-placeholder">Editado {formatRelative(p.updatedAt)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function ThumbnailsPage() {
  return (
    <>
      <PageHeader
        eyebrow="YouTube"
        title="Títulos y miniaturas"
        description="Lo primero que ve la gente antes de hacer clic. Títulos medidos para el teléfono y miniaturas con tu foto, tus colores y un texto que se lee en un segundo."
        icon={<ImagePlay className="h-5 w-5" aria-hidden />}
        actions={
          <ButtonLink href="/miniaturas/nuevo" icon={<Plus className="h-4 w-4" aria-hidden />}>
            Nuevo
          </ButtonLink>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <List />
      </Suspense>
    </>
  );
}
