"use client";

import type { CarouselSlide } from "@/lib/db/schema";
import { customRef, resolveTheme, type BrandLook, type SlideIdentity } from "@/lib/carousels/theme";
import { referencePalette, type TemplateSpec } from "@/lib/carousels/template-spec";
import { CustomTemplatesProvider } from "./custom-templates";
import { ScaledSlide } from "./slide";

/** Textos de muestra para ver una plantilla (nunca los del original). */
export const SAMPLE_SLIDES: CarouselSlide[] = [
  { id: "m1", type: "cover", kicker: "Guárdalo", headline: "Tres hábitos que ordenan tu semana", highlight: "ordenan", body: "", cta: "", template: null },
  { id: "m2", type: "item", kicker: "Hábito 1", headline: "Elige una sola prioridad por día", highlight: "una sola", body: "Lo demás puede esperar. Termina eso antes de abrir otra pestaña.", cta: "", template: null },
  { id: "m3", type: "cta", kicker: "Para seguir", headline: "¿Quieres la plantilla completa?", highlight: "plantilla", body: "Te la mando gratis por mensaje directo.", cta: "Comenta PLAN", template: null },
];

/**
 * Vista de una plantilla propia con textos de muestra: portada, un slide de contenido y el cierre.
 * `colors`: los de la referencia o los de Mi marca.
 */
export function TemplatePreview({
  id,
  name,
  spec,
  look,
  colors = "referencia",
  slides = SAMPLE_SLIDES,
  className,
}: {
  id: string;
  name: string;
  spec: TemplateSpec;
  look: BrandLook & { identity: SlideIdentity };
  colors?: "referencia" | "marca";
  slides?: CarouselSlide[];
  className?: string;
}) {
  const theme = resolveTheme({ palette: colors }, look, { palette: referencePalette(spec), font: spec.fonts.heading });
  const ref = customRef(id);
  return (
    <CustomTemplatesProvider templates={[{ id, name, spec }]}>
      <div className={className}>
        {slides.map((s, i) => (
          <div key={s.id} className="overflow-hidden rounded-xl border border-white/10 shadow-[0_16px_40px_rgba(0,6,30,0.45)]">
            <ScaledSlide slide={s} index={i === slides.length - 1 && slides.length > 1 ? 6 : i} total={7} template={ref} theme={theme} identity={look.identity} label={`${name}: slide de muestra ${i + 1}`} />
          </div>
        ))}
      </div>
    </CustomTemplatesProvider>
  );
}
