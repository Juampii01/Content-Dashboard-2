"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AlertTriangle, GalleryHorizontalEnd, Loader2, MoreHorizontal, PencilLine, Plus, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Progress } from "@/components/ui/feedback";
import { DropdownMenu } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import type { BrandLook, SlideIdentity } from "@/lib/carousels/theme";
import { useJob } from "@/lib/carousels/use-job";
import { formatRelative } from "@/lib/format";
import type { TemplateView } from "@/lib/dal/carousels";
import { deleteTemplateAction, renameTemplateAction } from "./template-actions";
import { SAMPLE_SLIDES, TemplatePreview } from "./template-preview";

type Look = BrandLook & { identity: SlideIdentity };

function Analyzing({ t }: { t: TemplateView }) {
  const router = useRouter();
  const done = useRef(false);
  const job = useJob(t.job?.id ?? null, (s) => {
    if ((s.status === "SUCCEEDED" || s.status === "FAILED") && !done.current) {
      done.current = true;
      router.refresh();
    }
  });
  const progress = job?.progress ?? t.job?.progress ?? 0;
  return (
    <div className="flex aspect-[4/5] flex-col items-center justify-center gap-4 bg-white/[0.02] p-6 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-accent-hi" aria-hidden />
      <div className="w-full">
        <Progress value={progress} label={job?.stage ?? t.job?.stage ?? "En cola"} />
      </div>
    </div>
  );
}

export function TemplatesList({ templates, look, canEdit }: { templates: TemplateView[]; look: Look; canEdit: boolean }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState<TemplateView | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<TemplateView | null>(null);
  const [pending, start] = useTransition();

  const rename = () =>
    start(async () => {
      if (!renaming) return;
      const res = await renameTemplateAction(renaming.id, name);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Nombre cambiado.");
      setRenaming(null);
    });
  const remove = () =>
    start(async () => {
      if (!deleting) return;
      const res = await deleteTemplateAction(deleting.id);
      setDeleting(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Plantilla borrada.", { description: res.data ? `${res.data === 1 ? "1 carrusel la usaba y pasó" : `${res.data} carruseles la usaban y pasaron`} a Editorial.` : undefined });
    });

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <li key={t.id} className="card card-lift flex flex-col overflow-hidden">
            <Link href={`/carruseles/plantillas/${t.id}`} className="block border-b border-white/10" aria-label={`Ver la plantilla ${t.name}`}>
              {t.status === "READY" && t.spec ? (
                <TemplatePreview id={t.id} name={t.name} spec={t.spec} look={look} slides={SAMPLE_SLIDES.slice(0, 2)} className="grid grid-cols-2 gap-2 p-3" />
              ) : t.status === "ANALYZING" ? (
                <Analyzing t={t} />
              ) : (
                <div className="flex aspect-[4/5] flex-col items-center justify-center gap-3 p-6 text-center">
                  <AlertTriangle className="h-6 w-6 text-warning" aria-hidden />
                  <p className="text-sm text-muted">{t.errorMessage ?? "No pudimos copiar este estilo."}</p>
                </div>
              )}
            </Link>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/carruseles/plantillas/${t.id}`} className="line-clamp-2 font-semibold text-white hover:text-accent-glow">
                  {t.name}
                </Link>
                {canEdit && (
                  <DropdownMenu
                    label={`Acciones de ${t.name}`}
                    align="end"
                    className="[&>button]:!px-2 [&>button]:!py-1.5"
                    trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
                    items={[
                      { label: "Usar en un carrusel nuevo", icon: <Plus className="h-4 w-4" />, onSelect: () => router.push(`/carruseles/nuevo?plantilla=${t.id}`), disabled: t.status !== "READY" },
                      { label: "Renombrar", icon: <PencilLine className="h-4 w-4" />, onSelect: () => (setName(t.name), setRenaming(t)) },
                      { type: "separator" },
                      { label: "Borrar", icon: <Trash2 className="h-4 w-4" />, onSelect: () => setDeleting(t), danger: true },
                    ]}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {t.status === "READY" ? (
                  <StatusBadge tone="success">Lista</StatusBadge>
                ) : t.status === "ANALYZING" ? (
                  <StatusBadge tone="info">Copiando el estilo</StatusBadge>
                ) : (
                  <StatusBadge tone="danger">No se pudo</StatusBadge>
                )}
                {t.spec?.usesPhoto && (
                  <StatusBadge tone="neutral" icon={null}>
                    Con foto
                  </StatusBadge>
                )}
              </div>
              {t.spec?.notes && <p className="line-clamp-2 text-xs text-muted">{t.spec.notes}</p>}
              <span className="mt-auto pt-1 text-xs text-placeholder" suppressHydrationWarning>
                {t.referenceCount ? `${t.referenceCount} slides de referencia · ` : ""}Editada {formatRelative(t.updatedAt)}
              </span>
            </div>
          </li>
        ))}
        {canEdit && (
          <li>
            <Link href="/carruseles/plantillas/nueva" className="flex h-full min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 p-6 text-center text-muted transition hover:border-white/35 hover:text-white">
              <span className="tile-icon h-11 w-11">
                <GalleryHorizontalEnd className="h-5 w-5" aria-hidden />
              </span>
              <span className="font-semibold">Copiar otro estilo</span>
              <span className="text-xs">Sube las imágenes de un carrusel o pega su link.</span>
            </Link>
          </li>
        )}
      </ul>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Renombrar plantilla"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={rename} disabled={pending || !name.trim()}>
              Guardar
            </Button>
          </>
        }
      >
        <Field label="Nombre" htmlFor="tpl-name">
          <Input id="tpl-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rename()} autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="¿Borrar esta plantilla?"
        description="Los carruseles que la usan pasan a la plantilla Editorial (sus textos no cambian). No se puede deshacer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button className="!bg-none !bg-danger/80" onClick={remove} disabled={pending} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              Borrar
            </Button>
          </>
        }
      />
    </>
  );
}
