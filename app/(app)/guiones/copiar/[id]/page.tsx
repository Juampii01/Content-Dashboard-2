import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Link2, Upload } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { ButtonLink } from "@/components/ui/button";
import { Notice, Progress, Skeleton } from "@/components/ui/feedback";
import { Steps, type StepState } from "@/components/ui/steps";
import { CopyAutoRefresh, DeleteCopyButton, RetryCopyButton } from "@/components/guiones/copy-controls";
import { CopyReelResult } from "@/components/guiones/copy-reel-result";
import { getCurrentUser } from "@/lib/auth";
import { getCopy, type CopyView } from "@/lib/dal/reel-copies";
import { formatDate } from "@/lib/format";
import { copyStatusLabel } from "@/lib/scripts/reel-copy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Copia este reel" };

const tone = { UPLOADING: "neutral", ANALYZING: "info", WRITING: "info", READY: "success", FAILED: "danger" } as const;

/** Las tareas del análisis, en el orden en que avanzan (la etapa del trabajo dice dónde va). */
const TASKS = [
  { label: "Bajar el video", until: 15 },
  { label: "Transcribir y medir la edición", until: 75 },
  { label: "Analizar la estructura", until: 85 },
  { label: "Escribir tu versión con tu voz", until: 100 },
];

function steps(copy: CopyView): { id: string; label: string; state: StepState }[] {
  const s = copy.status;
  return [
    { id: "reel", label: "El reel", state: "done" },
    { id: "version", label: "Tu versión", state: "done" },
    { id: "analisis", label: "Analizamos", state: s === "READY" ? "done" : s === "FAILED" ? "active" : "active" },
    { id: "resultado", label: "Tu guion y tu estilo", state: s === "READY" ? "done" : "pending" },
  ];
}

function Working({ copy }: { copy: CopyView }) {
  const progress = copy.status === "WRITING" ? Math.max(80, copy.job?.progress ?? 80) : (copy.job?.progress ?? 0);
  const stage = copy.status === "WRITING" ? "Escribiendo tu versión" : (copy.job?.stage ?? "En cola");
  return (
    <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="copy-working-title">
      <CopyAutoRefresh />
      <div>
        <p className="eyebrow mb-1.5">Paso 3</p>
        <h2 id="copy-working-title" className="text-lg font-semibold">
          Estamos analizando el reel
        </h2>
        <p className="mt-1 text-sm text-muted">Suele tardar uno o dos minutos. Puedes salir y volver: te avisamos cuando esté lista.</p>
      </div>
      <Progress value={progress} label={stage} />
      <ol className="flex flex-col gap-2">
        {TASKS.map((t, i) => {
          const from = i === 0 ? 0 : TASKS[i - 1]!.until;
          const done = progress >= t.until;
          const active = !done && progress >= from;
          return (
            <li key={t.label} className={cn("flex items-center gap-2.5 text-sm", done ? "text-white" : active ? "text-accent-glow" : "text-muted")}>
              <span className={cn("grid h-5 w-5 flex-none place-items-center rounded-full border", done ? "border-accent-hi bg-accent-hi text-bg" : active ? "animate-ping-soft border-accent-hi" : "border-white/20")} aria-hidden>
                {done && <Check className="h-3 w-3" />}
              </span>
              {t.label}
              <span className="sr-only">{done ? "(listo)" : active ? "(en curso)" : "(pendiente)"}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">El video se usa solo para este análisis y se borra apenas terminamos de medirlo. No lo guardamos ni lo volvemos a mostrar.</p>
    </section>
  );
}

function Failed({ copy, canEdit }: { copy: CopyView; canEdit: boolean }) {
  // Si el link no se pudo bajar (Instagram suele pedir sesión), la salida es subir el archivo.
  const linkFailed = copy.sourceKind === "link" && /bajar|link|descarga/i.test(copy.errorMessage ?? "");
  return (
    <section className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="copy-failed-title">
      <h2 id="copy-failed-title" className="text-lg font-semibold">
        No pudimos copiar este reel
      </h2>
      <Notice tone="danger">{copy.errorMessage ?? "Algo falló al analizar el video. Vuelve a intentarlo; si sigue pasando, avísale a soporte."}</Notice>
      {linkFailed && (
        <p className="text-sm text-muted">
          Instagram y TikTok a veces piden iniciar sesión para bajar un video. Descárgalo desde la app (o con la opción «Guardar») y súbelo: el resto es igual.
        </p>
      )}
      {canEdit && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {linkFailed && (
            <ButtonLink href="/guiones/copiar?origen=archivo" icon={<Upload className="h-4 w-4" aria-hidden />}>
              Subir el archivo
            </ButtonLink>
          )}
          {copy.canRetry && <RetryCopyButton id={copy.id} />}
          <DeleteCopyButton id={copy.id} ready={false} />
        </div>
      )}
    </section>
  );
}

async function CopyScreen({ params }: { params: PageProps<"/guiones/copiar/[id]">["params"] }) {
  const { id } = await params;
  const [me, copy] = await Promise.all([getCurrentUser(), getCopy(id)]);
  if (!copy) notFound();
  const canEdit = me.role !== "VIEWER";
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusBadge tone={tone[copy.status]}>{copyStatusLabel[copy.status]}</StatusBadge>
            <span>Creada el {formatDate(copy.createdAt)}</span>
            {copy.sourceUrl && (
              <a href={copy.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent-hi hover:underline">
                <Link2 className="h-3.5 w-3.5" aria-hidden /> Link original{copy.platform ? ` de ${copy.platform}` : ""}
              </a>
            )}
          </div>
          <h1 className="text-2xl font-bold">Copia este reel</h1>
          <p className="mt-1 text-sm text-muted">{copy.topic ? `Tu tema: ${copy.topic}` : "Tema: elegido según tu marca"}</p>
        </div>
        {copy.status === "READY" && canEdit && <DeleteCopyButton id={copy.id} ready />}
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <Steps steps={steps(copy)} />
        </aside>
        <div className="min-w-0">
          {(copy.status === "ANALYZING" || copy.status === "WRITING") && <Working copy={copy} />}
          {copy.status === "UPLOADING" && (
            <section className="card flex flex-col gap-3 p-5 sm:p-6">
              <h2 className="text-lg font-semibold">La subida no terminó</h2>
              <p className="text-sm text-muted">El archivo no llegó completo. Empieza de nuevo y deja la pestaña abierta mientras se sube.</p>
              {canEdit && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <ButtonLink href="/guiones/copiar?origen=archivo" icon={<Upload className="h-4 w-4" aria-hidden />}>
                    Subir de nuevo
                  </ButtonLink>
                  <DeleteCopyButton id={copy.id} ready={false} />
                </div>
              )}
            </section>
          )}
          {copy.status === "FAILED" && <Failed copy={copy} canEdit={canEdit} />}
          {copy.status === "READY" && <CopyReelResult copy={copy} canEdit={canEdit} />}
        </div>
      </div>
    </div>
  );
}

export default function CopyPage({ params }: PageProps<"/guiones/copiar/[id]">) {
  return (
    <>
      <ButtonLink href="/guiones/copiar" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Copia este reel
      </ButtonLink>
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16" />
            <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
              <Skeleton className="h-48" />
              <Skeleton className="h-96" />
            </div>
          </div>
        }
      >
        <CopyScreen params={params} />
      </Suspense>
    </>
  );
}
