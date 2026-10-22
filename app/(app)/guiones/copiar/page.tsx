import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Copy } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badges";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { CopyReelFlow } from "@/components/guiones/copy-reel-flow";
import { aiConfigured } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth";
import { brandIsReady, getBrandProfile } from "@/lib/dal/brand";
import { listCopies } from "@/lib/dal/reel-copies";
import { formatDate } from "@/lib/format";
import { copyStatusLabel } from "@/lib/scripts/reel-copy";

export const metadata: Metadata = { title: "Copia este reel" };

/**
 * /guiones/copiar — parámetros para integrar con otros módulos:
 * - `?link=<url>`: precarga el link del reel, TikTok o short (por ejemplo, desde una pieza de referencia).
 * - `?origen=archivo`: abre directamente la opción de subir el archivo (cuando el link no se pudo bajar).
 * - `?tema=<texto>`: precarga el tema de la versión propia.
 */
async function Flow({ searchParams }: { searchParams: PageProps<"/guiones/copiar">["searchParams"] }) {
  const params = await searchParams;
  const [me, brand] = await Promise.all([getCurrentUser(), getBrandProfile()]);
  const link = typeof params.link === "string" ? params.link.slice(0, 600) : "";
  const topic = typeof params.tema === "string" ? params.tema.slice(0, 300) : "";
  return (
    <CopyReelFlow
      key={`${params.origen ?? ""}|${link}|${topic}`}
      pillars={brand?.pillars.map((p) => p.name) ?? []}
      aiReady={aiConfigured()}
      brandReady={brandIsReady(brand)}
      canEdit={me.role !== "VIEWER"}
      initialLink={link}
      initialTopic={topic}
      initialSource={params.origen === "archivo" ? "upload" : "link"}
    />
  );
}

const tone = { UPLOADING: "neutral", ANALYZING: "info", WRITING: "info", READY: "success", FAILED: "danger" } as const;

async function History() {
  const copies = await listCopies();
  if (!copies.length) return null;
  return (
    <section aria-labelledby="copies-title" className="mt-10 flex flex-col gap-3">
      <h2 id="copies-title" className="text-base font-semibold">
        Tus copias
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {copies.map((c) => (
          <li key={c.id}>
            <Link href={`/guiones/copiar/${c.id}`} className="card card-lift flex h-full flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <StatusBadge tone={tone[c.status]}>{copyStatusLabel[c.status]}</StatusBadge>
                <span>{c.platform ? `De ${c.platform}` : "Video subido"}</span>
                <span>· {formatDate(c.createdAt)}</span>
              </div>
              <p className="line-clamp-2 font-semibold text-white">{c.scriptTitle ?? c.topic ?? "Tema elegido según tu marca"}</p>
              {(c.status === "ANALYZING" || c.status === "WRITING") && <p className="text-xs text-muted">{c.job?.stage ?? "En cola"}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CopyReelPage({ searchParams }: PageProps<"/guiones/copiar">) {
  return (
    <>
      <ButtonLink href="/guiones" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Guiones
      </ButtonLink>
      <PageHeader
        eyebrow="Copia este reel"
        title="Haz tu versión de un video que funcionó"
        description="Pega el link de un reel, TikTok o short viral. Te devolvemos su estructura, un guion nuevo sobre tu tema con tu voz y su estilo de edición listo para usar."
        icon={<Copy className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Flow searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <History />
      </Suspense>
    </>
  );
}
