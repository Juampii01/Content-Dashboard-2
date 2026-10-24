"use client";

import { ScanText, UserRound } from "lucide-react";
import type { CarouselSlide } from "@/lib/db/schema";

/**
 * Lo que tenía este slide en el carrusel copiado: su texto (leído letra por letra) y cómo estaba armado. Las imágenes
 * del original no se guardan: solo esto, para comparar con tu versión y comprobar las cifras.
 */
export function OriginalPanel({ original, index }: { original: NonNullable<CarouselSlide["original"]>; index: number }) {
  return (
    <details className="group rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-white">
        <span className="flex items-center gap-2">
          <ScanText className="h-4 w-4 text-accent-hi" aria-hidden />
          Slide {index + 1} del original
        </span>
        <span className="text-xs font-normal text-muted group-open:hidden">Ver qué decía</span>
      </summary>
      <div className="mt-3 flex flex-col gap-2 text-sm">
        <p className="eyebrow">Texto</p>
        <p className="rounded-lg bg-black/25 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-line text-muted">{original.text || "(sin texto)"}</p>
        {original.visual && (
          <>
            <p className="eyebrow mt-1">Cómo se veía</p>
            <p className="text-xs text-muted">{original.visual}</p>
          </>
        )}
        {original.person && (
          <p className="flex items-center gap-1.5 text-xs text-accent-glow">
            <UserRound className="h-3.5 w-3.5" aria-hidden /> Mostraba a una persona.
          </p>
        )}
      </div>
    </details>
  );
}
