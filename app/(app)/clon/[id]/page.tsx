import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Languages, Video } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/feedback";
import { CloneVideoDetail } from "@/components/clon/video-detail";
import { getCurrentUser } from "@/lib/auth";
import { getCloneVideoDetail, toCloneVideoItem } from "@/lib/dal/clone";
import { blobConfigured } from "@/lib/storage/copy";

export const metadata: Metadata = { title: "Video con clon" };

async function Detail({ params }: { params: PageProps<"/clon/[id]">["params"] }) {
  const { id } = await params;
  const [me, detail] = await Promise.all([getCurrentUser(), getCloneVideoDetail(id)]);
  if (!detail) notFound();
  const { row, scriptTitle } = detail;

  return (
    <>
      <PageHeader
        eyebrow={row.kind === "translation" ? "Traducción con tu voz" : row.language ? "Video con clon en otro idioma" : "Video con clon"}
        title={row.title}
        icon={row.kind === "translation" ? <Languages className="h-5 w-5" aria-hidden /> : <Video className="h-5 w-5" aria-hidden />}
      />
      <CloneVideoDetail
        initial={toCloneVideoItem(row)}
        scriptText={row.scriptText}
        scriptTitle={scriptTitle}
        storageReady={blobConfigured()}
        canEdit={me.role !== "VIEWER"}
      />
    </>
  );
}

export default function CloneVideoPage({ params }: PageProps<"/clon/[id]">) {
  return (
    <>
      <ButtonLink href="/clon" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Videos con clon
      </ButtonLink>
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            <Skeleton className="h-32" />
            <Skeleton className="h-[420px]" />
          </div>
        }
      >
        <Detail params={params} />
      </Suspense>
    </>
  );
}
