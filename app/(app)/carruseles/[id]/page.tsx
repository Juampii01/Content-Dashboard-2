import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { CarouselEditor } from "@/components/carruseles/carousel-editor";
import { getCurrentUser } from "@/lib/auth";
import { getCarousel, getCarouselLook } from "@/lib/dal/carousels";
import { isTemplate } from "@/lib/carousels/theme";

export const metadata: Metadata = { title: "Carrusel" };

async function Editor({ params }: { params: PageProps<"/carruseles/[id]">["params"] }) {
  const { id } = await params;
  const [me, data, look] = await Promise.all([getCurrentUser(), getCarousel(id), getCarouselLook()]);
  if (!data) notFound();
  const { carousel: c, script } = data;
  return (
    <CarouselEditor
      key={c.id}
      carouselId={c.id}
      initial={{
        title: c.title,
        status: c.status,
        template: isTemplate(c.template) ? c.template : "editorial",
        theme: c.theme ?? {},
        slides: c.slides,
        caption: c.caption ?? "",
        hashtags: c.hashtags,
      }}
      look={{ colors: look.colors, fonts: look.fonts, identity: look.identity, bannedWords: look.bannedWords }}
      sourceText={c.sourceText}
      ctaKeyword={c.ctaKeyword}
      script={script}
      canEdit={me.role !== "VIEWER"}
    />
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-28" />
      <div className="flex gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="aspect-[4/5] w-[120px]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr_400px]">
        <Skeleton className="hidden h-96 lg:block" />
        <Skeleton className="h-[520px]" />
        <Skeleton className="aspect-[4/5]" />
      </div>
    </div>
  );
}

export default function CarouselPage({ params }: PageProps<"/carruseles/[id]">) {
  return (
    <>
      <ButtonLink href="/carruseles" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Carruseles
      </ButtonLink>
      <Suspense fallback={<EditorSkeleton />}>
        <Editor params={params} />
      </Suspense>
    </>
  );
}
