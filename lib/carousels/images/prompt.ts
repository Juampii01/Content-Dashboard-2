/**
 * Prompt de imagen de un slide. Lo arma la app (no el worker) para que sea igual con cualquier proveedor.
 * Reglas de carrusel-creator-pro (motor/PROMPT_BASE.txt) que siguen sirviendo cuando la imagen no lleva texto:
 * nada inventado (ningún texto, cartel, pantalla con letras ni logo), una sola idea por imagen, aire donde va el texto
 * y el mismo estilo en todo el carrusel.
 */
import type { CarouselSlide } from "@/lib/db/schema";

export type ImagePromptInput = {
  scene: string;
  slide: Pick<CarouselSlide, "type" | "headline">;
  /** Dónde va el texto respecto de la imagen: debajo (foto arriba), encima (foto de fondo) o al lado. */
  textPlacement: "below" | "over" | "side" | "inside";
  brand: { niche: string | null; colors: { primary?: string; secondary?: string; accent?: string } | null; style?: string | null };
  withReference: boolean;
};

export function imagePrompt(input: ImagePromptInput): string {
  const colors = [input.brand.colors?.primary, input.brand.colors?.accent, input.brand.colors?.secondary].filter(Boolean).join(", ");
  const room =
    input.textPlacement === "over"
      ? "El texto va encima de la imagen: deja la mitad de abajo más limpia y oscura, sin detalles importantes."
      : input.textPlacement === "side"
        ? "La imagen va al lado del texto: el sujeto centrado, con aire alrededor."
        : "El texto va fuera de la imagen: el sujeto centrado, con aire alrededor (se puede recortar un poco arriba y abajo).";
  return [
    "Imagen para un slide de un carrusel de Instagram, formato vertical 4:5.",
    `ESCENA: ${input.scene.trim()}`,
    `Contexto (no lo escribas en la imagen): el slide dice "${input.slide.headline.trim().slice(0, 160)}".`,
    `ESTILO FIJO DE LA MARCA: ${input.brand.style?.trim() || "fotografía editorial realista, luz natural suave, composición limpia y premium, poca saturación"}${colors ? `; paleta que combine con ${colors}` : ""}${input.brand.niche ? `; nicho: ${input.brand.niche}` : ""}.`,
    room,
    "PROHIBIDO: cualquier texto, letra, número, palabra, cartel, rótulo, pantalla con letras, logo, marca de agua o firma. Sin personas reconocibles ni caras de famosos. Sin manos deformes ni dedos de más.",
    input.withReference ? "Te adjunto una imagen de este mismo carrusel: úsala solo como referencia de estilo (paleta, luz, tratamiento). No copies su contenido." : "",
    "Una sola idea visual, que se entienda en menos de un segundo.",
  ]
    .filter(Boolean)
    .join("\n");
}
