"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2, PencilLine, Plus, ScanSearch, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Notice, Progress } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { SLIDE_TYPES, FONTS, type BrandLook, type SlideIdentity } from "@/lib/carousels/theme";
import { useJob } from "@/lib/carousels/use-job";
import type { TemplateView } from "@/lib/dal/carousels";
import { deleteTemplateAction, renameTemplateAction } from "./template-actions";
import { TemplatePreview } from "./template-preview";

type Look = BrandLook & { identity: SlideIdentity };

function Analyzing({ t, workerOnline, workerAutoStart }: { t: TemplateView; workerOnline: boolean; workerAutoStart: boolean }) {
  const router = useRouter();
  const done = useRef(false);
  const job = useJob(t.job?.id ?? null, (s) => {
    if ((s.status === "SUCCEEDED" || s.status === "FAILED" || s.status === "CANCELED") && !done.current) {
      done.current = true;
      if (s.status === "SUCCEEDED") toast.success("Estilo copiado. Ya puedes usar tu plantilla.");
      router.refresh();
    }
  });
  const queued = !job || job.status === "QUEUED";
  return (
    <div className="card flex flex-col gap-4 p-5 sm:p-6" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="tile-icon h-10 w-10">
          <ScanSearch className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-semibold text-white">Copiando el estilo</h2>
          <p className="text-sm text-muted">Medimos textos, colores y composición, y la IA arma la plantilla. Puedes salir: el trabajo sigue y lo ves aquí al volver.</p>
        </div>
      </div>
      <Progress value={job?.progress ?? t.job?.progress ?? 0} label={job?.stage ?? t.job?.stage ?? "En cola"} />
      {job?.retrying && <p className="text-xs text-warning">{job.retrying} Lo volvemos a intentar solo.</p>}
      {queued && !workerOnline && (
        <Notice tone="warning" title={workerAutoStart ? "Encendiendo el servicio de procesamiento" : "El servicio de procesamiento está apagado"}>
          {workerAutoStart ? "Suele tardar menos de un minuto." : "Tu plantilla está en cola y arranca apenas se encienda. Si en unos minutos no avanza, avísale a soporte."}
        </Notice>
      )}
    </div>
  );
}

export function TemplateDetail({ template: t, look, canEdit, workerOnline, workerAutoStart }: { template: TemplateView; look: Look; canEdit: boolean; workerOnline: boolean; workerAutoStart: boolean }) {
  const router = useRouter();
  const [colors, setColors] = useState<"referencia" | "marca">("referencia");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  const rename = () =>
    start(async () => {
      const res = await renameTemplateAction(t.id, name);
      if (!res.ok) return void toast.error(res.error);
      setEditing(false);
      toast.success("Nombre cambiado.");
    });
  const remove = () =>
    start(async () => {
      const res = await deleteTemplateAction(t.id);
      setConfirm(false);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Plantilla borrada.");
      router.push("/carruseles/plantillas");
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Nombre de la plantilla" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rename()} autoFocus className="!w-auto min-w-0 flex-1 text-lg font-semibold" />
              <Button size="sm" onClick={rename} disabled={pending || !name.trim()} icon={<Check className="h-3.5 w-3.5" aria-hidden />}>
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setName(t.name))}>
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">{t.name}</h1>
              {t.status === "READY" ? <StatusBadge tone="success">Lista</StatusBadge> : t.status === "ANALYZING" ? <StatusBadge tone="info">Copiando el estilo</StatusBadge> : <StatusBadge tone="danger">No se pudo</StatusBadge>}
              {canEdit && (
                <Button size="sm" variant="subtle" onClick={() => setEditing(true)} aria-label="Renombrar" className="!px-2">
                  <PencilLine className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </div>
          )}
          {t.spec?.notes && <p className="mt-1 text-sm text-muted">{t.spec.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {t.status === "READY" && canEdit && (
            <ButtonLink href={`/carruseles/nuevo?plantilla=${t.id}`} icon={<Plus className="h-4 w-4" aria-hidden />}>
              Crear carrusel con esta plantilla
            </ButtonLink>
          )}
          {canEdit && (
            <Button variant="subtle" onClick={() => setConfirm(true)} disabled={pending} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              Borrar
            </Button>
          )}
        </div>
      </div>

      {t.status === "ANALYZING" && <Analyzing t={t} workerOnline={workerOnline} workerAutoStart={workerAutoStart} />}

      {t.status === "FAILED" && (
        <div className="card flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-warning" aria-hidden />
            <div>
              <h2 className="font-semibold text-white">No pudimos copiar este estilo</h2>
              <p className="mt-1 text-sm text-muted">{t.errorMessage ?? "Prueba de nuevo con las imágenes del carrusel."}</p>
            </div>
          </div>
          {canEdit && (
            <div>
              <ButtonLink href="/carruseles/plantillas/nueva" icon={<ScanSearch className="h-4 w-4" aria-hidden />}>
                Probar con las imágenes
              </ButtonLink>
            </div>
          )}
        </div>
      )}

      {t.status === "READY" && t.spec && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Así se ve con otros textos. Los colores pueden ser los de la referencia o los de tu marca, y se cambian en cada carrusel.</p>
            <SegmentedControl
              label="Colores"
              size="sm"
              value={colors}
              onValueChange={setColors}
              options={[
                { value: "referencia", label: "Colores de la referencia" },
                { value: "marca", label: "Colores de mi marca" },
              ]}
            />
          </div>
          <TemplatePreview id={t.id} name={t.name} spec={t.spec} look={look} colors={colors} className="grid grid-cols-1 gap-4 sm:grid-cols-3" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-white">Lo que copiamos</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Titulares</dt>
                <dd className="text-white">{FONTS[t.spec.fonts.heading].label}</dd>
                <dt className="text-muted">Texto</dt>
                <dd className="text-white">{FONTS[t.spec.fonts.body].label}</dd>
                <dt className="text-muted">Colores</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {[t.spec.palette.bg, t.spec.palette.text, t.spec.palette.muted, t.spec.palette.accent].map((c, i) => (
                    <span key={i} className="flex items-center gap-1.5 rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      <span className="h-3 w-3 rounded-sm border border-white/20" style={{ background: c }} aria-hidden />
                      {c}
                    </span>
                  ))}
                </dd>
                <dt className="text-muted">Foto</dt>
                <dd className="text-white">{t.spec.usesPhoto ? "Sí: genera o sube una imagen por slide" : "No, solo texto"}</dd>
              </dl>
            </div>
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-white">Estructura de la referencia</h2>
              <ol className="flex flex-wrap gap-1.5">
                {t.spec.structure.map((s, i) => (
                  <li key={i} className="pill !text-[11px]">
                    <span className="font-mono opacity-70">{String(i + 1).padStart(2, "0")}</span> {SLIDE_TYPES[s.type]}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted">Al crear un carrusel puedes respetar esta estructura (cantidad y tipo de slides) o usar la tuya.</p>
            </div>
          </div>
        </>
      )}

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Borrar esta plantilla?"
        description="Los carruseles que la usan pasan a la plantilla Editorial (sus textos no cambian). No se puede deshacer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button className="!bg-none !bg-danger/80" onClick={remove} disabled={pending} icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}>
              Borrar
            </Button>
          </>
        }
      />
    </div>
  );
}
