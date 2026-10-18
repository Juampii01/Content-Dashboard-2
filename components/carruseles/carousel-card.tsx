"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarPlus, CopyPlus, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import { carouselStatusLabel, carouselStatusTone, type CarouselStatus } from "@/lib/carousels/labels";
import { isTemplate, resolveTheme, TEMPLATES, type BrandLook, type SlideIdentity } from "@/lib/carousels/theme";
import type { CarouselSlide } from "@/lib/db/schema";
import { deleteCarouselAction, duplicateCarouselAction } from "./actions";
import { ScaledSlide } from "./slide";

export type CarouselCardItem = {
  id: string;
  title: string;
  status: CarouselStatus;
  template: string;
  theme: Record<string, string> | null;
  cover: CarouselSlide | null;
  slideCount: number;
  demo: boolean;
  updatedAt: string;
};

/** Tarjeta de la lista: miniatura del slide 1 (la misma plantilla, escalada), estado, fecha y acciones. */
export function CarouselCard({ item, look, canEdit }: { item: CarouselCardItem; look: BrandLook & { identity: SlideIdentity }; canEdit: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const theme = resolveTheme(item.theme, look);
  const template = item.cover?.template && isTemplate(item.cover.template) ? item.cover.template : isTemplate(item.template) ? item.template : "editorial";

  function duplicate() {
    startTransition(async () => {
      const res = await duplicateCarouselAction(item.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Carrusel duplicado.");
      router.push(`/carruseles/${res.data}`);
    });
  }

  function remove() {
    setConfirm(false);
    startTransition(async () => {
      const res = await deleteCarouselAction(item.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Carrusel borrado.");
    });
  }

  return (
    <div className="card card-lift group flex h-full flex-col" aria-busy={pending}>
      <Link href={`/carruseles/${item.id}`} className="relative block overflow-hidden rounded-t-2xl border-b border-white/10">
        {item.cover ? (
          <ScaledSlide slide={item.cover} index={0} total={Math.max(1, item.slideCount)} template={template} theme={theme} identity={look.identity} label={`Portada: ${item.cover.headline}`} />
        ) : (
          <div className="grid aspect-[4/5] place-items-center text-sm text-muted">Sin slides</div>
        )}
        <span className="absolute top-2 right-2 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] font-bold text-white backdrop-blur">{item.slideCount} slides</span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={carouselStatusTone[item.status]}>{carouselStatusLabel[item.status]}</StatusBadge>
            {item.demo && (
              <StatusBadge tone="neutral" icon={null}>
                Ejemplo
              </StatusBadge>
            )}
          </div>
          <DropdownMenu
            label={`Acciones de ${item.title}`}
            align="end"
            className="[&>button]:!px-2 [&>button]:!py-1.5"
            trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
            items={[
              { label: "Editar", icon: <PencilLine className="h-4 w-4" />, onSelect: () => router.push(`/carruseles/${item.id}`) },
              { label: "Programar en Calendario", icon: <CalendarPlus className="h-4 w-4" />, onSelect: () => router.push(`/calendario?nuevo=1&carrusel=${item.id}`) },
              { label: "Duplicar", icon: <CopyPlus className="h-4 w-4" />, onSelect: duplicate, disabled: !canEdit },
              { type: "separator" },
              { label: "Borrar", icon: <Trash2 className="h-4 w-4" />, onSelect: () => setConfirm(true), disabled: !canEdit, danger: true },
            ]}
          />
        </div>
        <Link href={`/carruseles/${item.id}`} className="line-clamp-2 font-semibold text-white hover:text-accent-glow">
          {item.title}
        </Link>
        <span className="mt-auto text-xs text-placeholder">
          {isTemplate(item.template) ? TEMPLATES[item.template].label : "Editorial"} · Editado {formatRelative(item.updatedAt)}
        </span>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Borrar este carrusel?"
        description={`“${item.title}” se borra con sus slides y su caption. No se puede deshacer.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button className="!bg-none !bg-danger/80" onClick={remove} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              Borrar
            </Button>
          </>
        }
      />
    </div>
  );
}
