import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { DeletePackageButton } from "@/components/miniaturas/delete-package-button";
import { PackageEditor, type EditorPackage, type EditorPhoto } from "@/components/miniaturas/package-editor";
import { aiConfigured } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth";
import { providersStatus } from "@/lib/carousels/images";
import { getBrandProfile } from "@/lib/dal/brand";
import { activePackageJob, characterPhotos, getPackage } from "@/lib/dal/youtube";
import { thumbFileUrl } from "@/lib/youtube/files";
import { thumbColors, thumbFontFromBrand } from "@/lib/youtube/thumbnail-layout";

export const metadata: Metadata = { title: "Títulos y miniaturas" };

const SOURCE: Record<string, string> = { guion: "Desde un guion", video: "Desde un video del Editor", pieza: "Desde un video publicado", tema: "Desde un tema" };

async function Editor({ params }: { params: PageProps<"/miniaturas/[id]">["params"] }) {
  const { id } = await params;
  const [pkg, user, brand, photos] = await Promise.all([getPackage(id), getCurrentUser(), getBrandProfile(), characterPhotos()]);
  if (!pkg) notFound();
  const [jobId, providers] = await Promise.all([activePackageJob(pkg.id), providersStatus()]);
  const editorPhotos: EditorPhoto[] = photos.map((p) => ({
    key: p.key,
    url: thumbFileUrl(p.key)!,
    cutoutUrl: thumbFileUrl(p.cutoutKey),
    cutoutStatus: p.cutoutStatus,
    error: p.error,
  }));
  const data: EditorPackage = {
    id: pkg.id,
    title: pkg.title,
    format: pkg.format,
    sourceLabel: SOURCE[pkg.sourceKind] ?? "",
    titles: pkg.titles,
    titleBasis: pkg.titleBasis ?? null,
    selectedTitle: pkg.selectedTitle,
    concepts: pkg.concepts.map((c) => ({ ...c, backgroundUrl: thumbFileUrl(c.backgroundKey) })),
  };
  const providerLabel = providers.preferred === "chatgpt" ? "tu ChatGPT" : providers.preferred === "openai-api" ? "tu API key de OpenAI" : null;
  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5">
            {data.sourceLabel} · {pkg.format === "SHORT" ? "Short" : "Video largo"}
          </p>
          <h1 className="text-2xl font-bold">{pkg.selectedTitle ?? pkg.title}</h1>
          <p className="mt-1 text-sm text-muted">Elige un título, ajusta la miniatura que más te guste y descárgala en JPG (menos de 2 MB, como pide YouTube).</p>
        </div>
        {user.role !== "VIEWER" && <DeletePackageButton id={pkg.id} />}
      </header>
      <PackageEditor
        pkg={data}
        photos={editorPhotos}
        colors={thumbColors(brand?.colors ?? null)}
        brandFont={thumbFontFromBrand(brand?.fonts?.heading)}
        provider={{ ready: Boolean(providers.preferred), label: providerLabel }}
        initialJobId={jobId}
        canEdit={user.role !== "VIEWER"}
        aiReady={aiConfigured()}
      />
    </>
  );
}

export default function PackagePage({ params }: PageProps<"/miniaturas/[id]">) {
  return (
    <>
      <ButtonLink href="/miniaturas" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Títulos y miniaturas
      </ButtonLink>
      <Suspense fallback={<Skeleton className="h-[640px]" />}>
        <Editor params={params} />
      </Suspense>
    </>
  );
}
