"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangle, Images, RotateCcw, ScanText } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice, Progress } from "@/components/ui/feedback";
import { Steps } from "@/components/ui/steps";
import { toast } from "@/components/ui/toast";
import { useJob } from "@/lib/carousels/use-job";
import type { CopyView } from "@/lib/dal/carousels";
import { analyzeCopyAction, switchToUploadsAction } from "./copy-actions";
import { PICK_MIN, ReferencePicker, uploadPicked, type PickedImage } from "./reference-picker";

const STAGES = [
  { at: 0, label: "Bajando el carrusel" },
  { at: 25, label: "Midiendo el diseño" },
  { at: 50, label: "Leyendo cada slide y escribiendo tu versión" },
];

/** Progreso real de la copia (se puede salir y volver). Si Instagram no deja bajar el link, se ofrece subir los slides. */
export function CopyProgress({ copy, canEdit }: { copy: CopyView; canEdit: boolean }) {
  const router = useRouter();
  const done = useRef(false);
  const [files, setFiles] = useState<PickedImage[]>([]);
  const [busy, setBusy] = useState<{ done: number; total: number; label: string } | null>(null);
  const job = useJob(copy.status === "ANALYZING" ? (copy.job?.id ?? null) : null, (s) => {
    if (done.current) return;
    if (s.status === "SUCCEEDED") {
      done.current = true;
      const carouselId = typeof s.output.carouselId === "string" ? s.output.carouselId : null;
      toast.success("Tu versión está lista. Revisa la ficha.");
      if (carouselId) router.push(`/carruseles/${carouselId}?copiado=1`);
      else router.refresh();
    } else if (s.status === "FAILED" || s.status === "CANCELED") {
      done.current = true;
      router.refresh();
    }
  });

  const waitingUpload = copy.status === "ANALYZING" && copy.source === "upload" && !copy.job;
  const failed = copy.status === "FAILED";
  const progress = job?.progress ?? copy.job?.progress ?? 0;
  const queued = !job || job.status === "QUEUED";

  async function sendUploads() {
    setBusy({ done: 0, total: files.length, label: "Preparando" });
    try {
      if (copy.source === "link" || failed) {
        const switched = await switchToUploadsAction(copy.id);
        if (!switched.ok) throw new Error(switched.error);
      }
      const keys = await uploadPicked(files, (n) => `/api/carruseles/subir?tipo=copia&copia=${copy.id}&n=${n}`, (d, t) => setBusy({ done: d, total: t, label: d < t ? `Subiendo ${d + 1} de ${t}` : "Empezando a leer" }));
      const res = await analyzeCopyAction(copy.id, keys);
      if (!res.ok) throw new Error(res.error);
      router.refresh();
    } catch (e) {
      setBusy(null);
      toast.error(e instanceof Error ? e.message : "No pudimos subir los slides.");
    }
  }

  const steps = [
    { id: "original", label: "El original", state: "done" as const },
    { id: "version", label: "Tu versión", state: "done" as const },
    { id: "copiar", label: failed ? "No se pudo copiar" : "Leyendo y escribiendo", state: "active" as const },
    { id: "revisar", label: "Revisar la ficha", state: "pending" as const },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <Steps steps={steps} />
      </div>
      <div className="flex min-w-0 flex-col gap-5" aria-live="polite">
        {failed ? (
          <div className="card flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="tile-icon h-10 w-10 flex-none !text-warning">
                <AlertTriangle className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-semibold text-white">{copy.linkFailed ? "Instagram no nos dejó bajar ese carrusel" : "No pudimos copiar el carrusel"}</h2>
                <p className="mt-1 text-sm text-muted">{copy.errorMessage ?? "Algo falló. Prueba de nuevo."}</p>
              </div>
            </div>
            {canEdit && (
              <div className="flex flex-col gap-3 rounded-xl border border-white/10 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Images className="h-4 w-4 text-accent-hi" aria-hidden />
                  Sube los slides y seguimos con lo que elegiste
                </p>
                <p className="text-xs text-muted">Descárgalos desde Instagram (o haz una captura de cada slide) y súbelos en orden. Se usan solo para leerlos y se borran al terminar.</p>
                <ReferencePicker files={files} onChange={setFiles} disabled={Boolean(busy)} />
                {busy && <Progress value={(busy.done / Math.max(1, busy.total)) * 100} label={busy.label} />}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void sendUploads()} disabled={files.length < PICK_MIN || Boolean(busy)} icon={<ScanText className="h-4 w-4" aria-hidden />}>
                    {busy ? "Subiendo…" : "Leer estos slides"}
                  </Button>
                  <ButtonLink href="/carruseles/copiar" variant="ghost" icon={<RotateCcw className="h-4 w-4" aria-hidden />}>
                    Empezar de nuevo
                  </ButtonLink>
                </div>
              </div>
            )}
          </div>
        ) : waitingUpload ? (
          <div className="card flex flex-col gap-4 p-5 sm:p-6">
            <h2 className="font-semibold text-white">Faltan los slides</h2>
            <p className="text-sm text-muted">La subida se cortó antes de terminar. Vuelve a elegir los slides del carrusel.</p>
            {canEdit && (
              <>
                <ReferencePicker files={files} onChange={setFiles} disabled={Boolean(busy)} />
                {busy && <Progress value={(busy.done / Math.max(1, busy.total)) * 100} label={busy.label} />}
                <div>
                  <Button onClick={() => void sendUploads()} disabled={files.length < PICK_MIN || Boolean(busy)} icon={<ScanText className="h-4 w-4" aria-hidden />}>
                    {busy ? "Subiendo…" : "Leer estos slides"}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="card flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="tile-icon h-10 w-10 flex-none">
                <ScanText className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-semibold text-white">Leyendo el original</h2>
                <p className="text-sm text-muted">{copy.sourceUrl ? copy.sourceUrl : `${copy.referenceCount} slides subidos`}</p>
              </div>
            </div>
            <Progress value={progress} label={job?.stage ?? copy.job?.stage ?? "En cola"} />
            <ol className="flex flex-col gap-1.5 text-sm">
              {STAGES.filter((s) => copy.options.design === "original" || s.at !== 25)
                .filter((s) => copy.source === "link" || s.at !== 0)
                .map((s) => (
                  <li key={s.at} className={progress >= s.at ? "text-white" : "text-muted"}>
                    <span className="mr-2 font-mono text-[11px] text-accent-glow">{progress > s.at + 20 ? "✓" : "·"}</span>
                    {s.label}
                  </li>
                ))}
            </ol>
            {job?.retrying && <p className="text-xs text-warning">{job.retrying} Lo volvemos a intentar solo.</p>}
            {queued && !copy.workerOnline && (
              <Notice tone="warning" title={copy.workerAutoStart ? "Encendiendo el servicio de procesamiento" : "El servicio de procesamiento está apagado"}>
                {copy.workerAutoStart ? "Suele tardar menos de un minuto." : "Tu copia está en cola y arranca apenas se encienda. Si en unos minutos no avanza, avísale a soporte."}
              </Notice>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
