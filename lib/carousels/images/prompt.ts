/**
 * Prompt de imagen de un slide. Lo arma la app (no el worker) para que sea igual con cualquier proveedor.
 * Reglas de carrusel-creator-pro (motor/PROMPT_BASE.txt y la orden `corregir`) que siguen sirviendo cuando la imagen
 * no lleva texto: nada inventado (ningún texto, cartel, pantalla con letras ni logo), una sola idea por imagen, aire
 * donde va el texto, el mismo estilo en todo el carrusel y, si sale el personaje, su cara exacta con una sola acción
 * de las manos.
 *
 * Orden de las imágenes adjuntas (lo respeta el worker): primero las fotos del personaje (si sale), después la
 * imagen a corregir (si es una corrección) y al final la referencia de estilo del carrusel (si hay).
 */
import type { CarouselSlide } from "@/lib/db/schema";

export type ImagePromptInput = {
  scene: string;
  slide: Pick<CarouselSlide, "type" | "headline">;
  /** Dónde va el texto respecto de la imagen: debajo (foto arriba), encima (foto de fondo) o al lado. */
  textPlacement: "below" | "over" | "side" | "inside";
  brand: { niche: string | null; colors: { primary?: string; secondary?: string; accent?: string } | null; style?: string | null };
  withReference: boolean;
  /** Sale el personaje de Mi marca: cuántas fotos suyas van adjuntas y qué pose pide el slide. */
  character?: { photos: number; pose: string } | null;
};

function photosLabel(n: number): string {
  return n <= 1 ? "la imagen 1" : n === 2 ? "las imágenes 1 y 2" : `las imágenes 1 a ${n}`;
}

function characterBlock(c: NonNullable<ImagePromptInput["character"]>): string[] {
  const which = photosLabel(c.photos);
  return [
    `PERSONAJE: el creador de la cuenta, el de ${which} (${c.photos > 1 ? "fotos suyas" : "una foto suya"}). Tiene que ser la MISMA persona, reconocible a primera vista: misma forma de la cara, ojos, cejas, nariz, boca, mandíbula, pelo, barba si tiene, tono de piel y edad. Nítido, bien iluminado y con la cara completa.`,
    "Las fotos son solo para su identidad: no copies ninguna foto tal cual (ni su fondo ni su encuadre).",
    `POSE: ${c.pose.trim().replace(/\.$/, "")}. Una sola acción con las manos; la mano que no hace falta no aparece. Nunca manos de más ni dedos raros.`,
    "Ropa: la de las fotos o una parecida, prolija. Una sola persona en la imagen: nadie más con cara reconocible.",
  ];
}

export function imagePrompt(input: ImagePromptInput): string {
  const colors = [input.brand.colors?.primary, input.brand.colors?.accent, input.brand.colors?.secondary].filter(Boolean).join(", ");
  const room =
    input.textPlacement === "over"
      ? "El texto va encima de la imagen: deja la mitad de abajo más limpia y oscura, sin detalles importantes."
      : input.textPlacement === "side"
        ? "La imagen va al lado del texto: el sujeto centrado, con aire alrededor."
        : "El texto va fuera de la imagen: el sujeto centrado, con aire alrededor (se puede recortar un poco arriba y abajo).";
  const character = input.character && input.character.photos > 0 ? input.character : null;
  return [
    "Imagen para un slide de un carrusel de Instagram, formato vertical 4:5.",
    `ESCENA: ${input.scene.trim()}`,
    `Contexto (no lo escribas en la imagen): el slide dice "${input.slide.headline.trim().slice(0, 160)}".`,
    ...(character ? characterBlock(character) : []),
    `ESTILO FIJO DE LA MARCA: ${input.brand.style?.trim() || "fotografía editorial realista, luz natural suave, composición limpia y premium, poca saturación"}${colors ? `; paleta que combine con ${colors}` : ""}${input.brand.niche ? `; nicho: ${input.brand.niche}` : ""}.`,
    room,
    character
      ? "PROHIBIDO: cualquier texto, letra, número, palabra, cartel, rótulo, pantalla con letras, logo, marca de agua o firma. Ninguna otra persona reconocible ni caras de famosos."
      : "PROHIBIDO: cualquier texto, letra, número, palabra, cartel, rótulo, pantalla con letras, logo, marca de agua o firma. Sin personas reconocibles ni caras de famosos. Sin manos deformes ni dedos de más.",
    input.withReference
      ? character
        ? "Después de las fotos del personaje va una imagen de este mismo carrusel: úsala solo como referencia de estilo (paleta, luz, tratamiento). La cara sale de las fotos, no de esa imagen."
        : "Te adjunto una imagen de este mismo carrusel: úsala solo como referencia de estilo (paleta, luz, tratamiento). No copies su contenido."
      : "",
    "Una sola idea visual, que se entienda en menos de un segundo.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Corregir la imagen de un slide (como `corregir` de carrusel-creator-pro): se edita la imagen actual con un único
 * cambio. Si sale el personaje, se vuelven a adjuntar sus fotos: sin ellas, la cara pierde parecido con cada edición.
 */
export function correctionPrompt(input: { instruction: string; character?: { photos: number } | null }): string {
  const photos = input.character?.photos ?? 0;
  const target = photos > 0 ? `la imagen ${photos + 1}` : "la imagen 1";
  return [
    `Edita ${target} (la imagen de un slide de un carrusel de Instagram, vertical 4:5).`,
    `Único cambio: ${input.instruction.trim().replace(/\.$/, "")}.`,
    "Mantén todo lo demás exactamente igual: composición, encuadre, luz, colores, fondo, pose y ropa.",
    photos > 0
      ? `La persona es la de ${photosLabel(photos)} (fotos suyas): su cara tiene que quedar exactamente como en esas fotos, nítida y con sus rasgos, aunque el resto no cambie.`
      : "",
    "No añadas ningún texto, letra, número, logo ni elemento nuevo que no pida el cambio.",
  ]
    .filter(Boolean)
    .join("\n");
}
