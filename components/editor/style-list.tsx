"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Film, Link2, MoreHorizontal, Palette, PencilLine, RefreshCcw, Trash2, Upload } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/badges";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Progress } from "@/components/ui/feedback";
import { DropdownMenu } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import { describePreset, type StyleMetrics, type StylePreset } from "@/lib/video/style";
import { cn } from "@/lib/utils";
import { deleteStyleAction, renameStyleAction, retryStyleAction } from "./media-actions";
import { useAutoRefresh } from "./use-auto-refresh";

export type StyleItem = {
  id: string;
  name: string;
  status: "UPLOADING" | "ANALYZING" | "READY" | "FAILED";
  sourceKind: "upload" | "link";
  sourceUrl: string | null;
  sourceName: string | null;
  thumbUrl: string | null;
  metrics: StyleMetrics | null;
  preset: StylePreset | null;
  errorMessage: string | null;
  job: { progress: number; stage: string | null; status: string } | null;
  updatedAt: string;
};

const statusLabel: Record<StyleItem["status"], string> = { UPLOADING: "Subida incompleta", ANALYZING: "Analizando", READY: "Listo", FAILED: "Con error" };
const statusTone: Record<StyleItem["status"], StatusTone> = { UPLOADING: "neutral", ANALYZING: "info", READY: "success", FAILED: "danger" };

/** Estilos guardados: se actualizan solos mientras alguno se analiza. */
export function StyleList({ styles, canEdit }: { styles: StyleItem[]; canEdit: boolean }) {
  useAutoRefresh(styles.some((s) => s.status === "ANALYZING"));
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {styles.map((s) => (
        <li key={s.id}>
          <StyleCard style={s} canEdit={canEdit} />
        </li>
      ))}
    </ul>
  );
}

function StyleCard({ style, canEdit }: { style: StyleItem; canEdit: boolean }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(style.name);
  const [pending, start] = useTransition();
  const vertical = (style.metrics?.aspect ?? "9:16") !== "16:9";
  const facts = style.preset ? describePreset(style.preset) : [];

  return (
    <article className="card flex h-full flex-col overflow-hidden">
      <div className="flex gap-4 p-4">
        <Link
          href={`/editor/estilos/${style.id}`}
          className={cn("relative flex-none overflow-hidden rounded-xl border border-white/10 bg-black/40", vertical ? "aspect-[9/16] w-20" : "aspect-video w-32")}
          aria-label={`Ver el estilo ${style.name}`}
        >
          {style.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={style.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="grid h-full w-full place-items-center text-placeholder">
              <Palette className="h-6 w-6" aria-hidden />
            </span>
          )}
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <StatusBadge tone={statusTone[style.status]}>{statusLabel[style.status]}</StatusBadge>
            {canEdit && (
              <DropdownMenu
                label={`Opciones de ${style.name}`}
                align="end"
                trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
                items={[
                  { label: "Renombrar", icon: <PencilLine className="h-4 w-4" aria-hidden />, onSelect: () => setRenaming(true) },
                  { label: "Borrar", icon: <Trash2 className="h-4 w-4" aria-hidden />, onSelect: () => setConfirm(true), danger: true },
                ]}
              />
            )}
          </div>
          <h3 className="line-clamp-2 font-semibold text-white">
            <Link href={`/editor/estilos/${style.id}`} className="hover:underline">
              {style.name}
            </Link>
          </h3>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted">
            {style.sourceKind === "link" ? <Link2 className="h-3.5 w-3.5 flex-none" aria-hidden /> : <Upload className="h-3.5 w-3.5 flex-none" aria-hidden />}
            <span className="truncate">{style.sourceKind === "link" ? `Link de ${style.sourceName ?? "la web"}` : (style.sourceName ?? "Video subido")}</span>
          </p>
          {style.status === "ANALYZING" && <Progress value={style.job?.progress ?? 0} label={style.job?.stage ?? "En cola"} />}
          {style.status === "FAILED" && <p className="line-clamp-3 text-xs text-danger">{style.errorMessage ?? "No pudimos analizar el video."}</p>}
          {style.status === "UPLOADING" && <p className="text-xs text-muted">La subida no terminó. Bórralo y vuelve a crearlo.</p>}
        </div>
      </div>
      {facts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-4 pb-4" aria-label="Cómo se aplica">
          {facts.map((f) => (
            <li key={f} className="pill text-[11px]">
              {f}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
        <span className="text-xs text-placeholder">{formatRelative(style.updatedAt)}</span>
        <div className="flex gap-2">
          {style.status === "FAILED" && canEdit && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden />}
              onClick={() =>
                start(async () => {
                  const r = await retryStyleAction(style.id);
                  if (!r.ok) toast.error(r.error);
                  else router.refresh();
                })
              }
            >
              Reintentar
            </Button>
          )}
          {style.status === "READY" && (
            <>
              <ButtonLink href={`/editor/estilos/${style.id}`} size="sm" variant="ghost" icon={<Film className="h-3.5 w-3.5" aria-hidden />}>
                Ver
              </ButtonLink>
              {canEdit && (
                <ButtonLink href={`/editor/nuevo?estilo=${style.id}`} size="sm" icon={<Clapperboard className="h-3.5 w-3.5" aria-hidden />}>
                  Usar
                </ButtonLink>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Renombrar el estilo"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending || !name.trim()}
              onClick={() =>
                start(async () => {
                  const r = await renameStyleAction(style.id, name);
                  if (!r.ok) toast.error(r.error);
                  else {
                    setRenaming(false);
                    router.refresh();
                  }
                })
              }
            >
              Guardar
            </Button>
          </>
        }
      >
        <label htmlFor={`rename-${style.id}`} className="sr-only">
          Nombre del estilo
        </label>
        <Input id={`rename-${style.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
      </Dialog>

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Borrar este estilo?"
        description="Los videos que ya editaste con él no cambian. No se puede deshacer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending}
              className="!bg-danger/90 ![background-image:none]"
              onClick={() =>
                start(async () => {
                  const r = await deleteStyleAction(style.id);
                  if (!r.ok) toast.error(r.error);
                  else {
                    setConfirm(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Borrando…" : "Borrar estilo"}
            </Button>
          </>
        }
      />
    </article>
  );
}
