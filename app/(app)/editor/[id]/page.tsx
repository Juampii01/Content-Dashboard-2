import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { ProjectScreen } from "@/components/editor/project-screen";
import { getBrand } from "@/lib/ai/brand-context";
import { getStyle, listTracks, signedBroll } from "@/lib/dal/editor-media";
import { getProject } from "@/lib/dal/video";
import { fileDriver } from "@/lib/storage";
import { brandGraphicLook } from "@/lib/video/graphics";

export const metadata: Metadata = { title: "Video" };

const DEFAULT_ACCENT = "#FFD84D";

async function Project({ params }: { params: PageProps<"/editor/[id]">["params"] }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const brand = await getBrand();
  const accent = [brand?.colors?.accent, brand?.colors?.primary].find((c) => c && /^#[0-9a-f]{6}$/i.test(c)) ?? DEFAULT_ACCENT;
  // Estilo y b-roll solo hacen falta en la revisión.
  const reviewing = project.status === "AWAITING_REVIEW" && project.plan;
  const styleId = project.plan?.style_id ?? project.styleId;
  const style = reviewing && styleId ? await getStyle(styleId) : null;
  const signed = reviewing ? await signedBroll(project.plan!.broll ?? []) : {};
  const tracks = reviewing ? await listTracks({ readyOnly: true }) : [];
  return (
    <ProjectScreen
      project={{
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        worker: { ...project.worker, lastSeen: project.worker.lastSeen },
        accent,
        uploadMode: fileDriver() === "blob" ? "blob" : "local",
      }}
      signedBroll={signed}
      graphicLook={brandGraphicLook(brand)}
      tracks={tracks.map((t) => ({ id: t.id, title: t.title, status: t.status, duration: t.duration, url: t.url }))}
      style={
        style?.status === "READY" && style.preset
          ? { id: style.id, name: style.name, zoom: style.preset.zoom, captions: style.preset.captions, focusY: Math.max(0.25, Math.min(0.6, style.metrics?.faces.center?.y ?? 0.42)) }
          : null
      }
    />
  );
}

export default function VideoProjectPage({ params }: PageProps<"/editor/[id]">) {
  return (
    <>
      <ButtonLink href="/editor" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver al Editor
      </ButtonLink>
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <Project params={params} />
      </Suspense>
    </>
  );
}
