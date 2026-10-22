import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { LongVideoScreen } from "@/components/editor/clips/long-video-screen";
import { getLongVideo } from "@/lib/dal/clips";

export const metadata: Metadata = { title: "Clips" };

async function Content({ params }: { params: PageProps<"/editor/clips/[id]">["params"] }) {
  const { id } = await params;
  const video = await getLongVideo(id);
  if (!video) notFound();
  // Con cada cambio de estado (subiendo → buscando → listo) la pantalla arranca de cero con los datos nuevos.
  return <LongVideoScreen key={video.status} video={{ ...video, createdAt: video.createdAt.toISOString(), worker: { online: video.worker.online, autoStart: video.worker.autoStart, stuck: video.worker.stuck } }} />;
}

export default function LongVideoPage({ params }: PageProps<"/editor/clips/[id]">) {
  return (
    <>
      <ButtonLink href="/editor/clips" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a los videos largos
      </ButtonLink>
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <Content params={params} />
      </Suspense>
    </>
  );
}
