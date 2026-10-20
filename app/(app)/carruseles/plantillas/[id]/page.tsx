import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { TemplateDetail } from "@/components/carruseles/template-detail";
import { getCurrentUser } from "@/lib/auth";
import { getCarouselLook, getCarouselTemplate } from "@/lib/dal/carousels";
import { workerStatus } from "@/lib/jobs";

export const metadata: Metadata = { title: "Plantilla" };

async function Detail({ params }: { params: PageProps<"/carruseles/plantillas/[id]">["params"] }) {
  const { id } = await params;
  const [me, template, look] = await Promise.all([getCurrentUser(), getCarouselTemplate(id), getCarouselLook()]);
  if (!template) notFound();
  const worker = template.status === "ANALYZING" ? await workerStatus() : { online: true, autoStart: false };
  return (
    <TemplateDetail
      key={`${template.id}-${template.status}`}
      template={template}
      look={{ colors: look.colors, fonts: look.fonts, identity: look.identity }}
      canEdit={me.role !== "VIEWER"}
      workerOnline={worker.online}
      workerAutoStart={worker.autoStart}
    />
  );
}

export default function TemplatePage({ params }: PageProps<"/carruseles/plantillas/[id]">) {
  return (
    <>
      <ButtonLink href="/carruseles/plantillas" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Plantillas
      </ButtonLink>
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            <Skeleton className="h-28" />
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="aspect-[4/5]" />
              ))}
            </div>
          </div>
        }
      >
        <Detail params={params} />
      </Suspense>
    </>
  );
}
