/**
 * Tu personaje en los slides: qué foto de Mi marca se usa como referencia de la cara en cada slide.
 * Sin dependencias de servidor (lo usa el editor para mostrar cuál se va a elegir y el servicio de imágenes).
 *
 * Cómo se elige: cada foto tiene sus rasgos (ángulo, expresión, encuadre y mirada, leídos una vez con Claude) y
 * cada slide pide una pose en texto ("de perfil, mirando a lo lejos, pensativo"). Se puntúa cada foto contra la pose
 * y se manda primero la que mejor encaja, más otra distinta para fijar la identidad (con una sola foto, la cara se
 * parece menos). Si la persona elige una foto a mano en el slide, esa va primero.
 */
export type PhotoAngle = "frontal" | "three_quarter" | "profile";
export type PhotoExpression = "smile" | "serious" | "surprised" | "thinking" | "neutral";
export type PhotoFraming = "close" | "medium" | "wide";
export type PhotoGaze = "camera" | "away";

export type PhotoTraits = { angle: PhotoAngle; expression: PhotoExpression; framing: PhotoFraming; gaze: PhotoGaze; quality: number };
export type CharacterPhoto = { key: string; url: string | null; traits: PhotoTraits | null };

export const ANGLE_LABEL: Record<PhotoAngle, string> = { frontal: "De frente", three_quarter: "Tres cuartos", profile: "De perfil" };
export const EXPRESSION_LABEL: Record<PhotoExpression, string> = { smile: "sonriendo", serious: "serio", surprised: "sorprendido", thinking: "pensativo", neutral: "neutro" };
export const FRAMING_LABEL: Record<PhotoFraming, string> = { close: "primer plano", medium: "plano medio", wide: "cuerpo entero" };

export function traitsLabel(t: PhotoTraits | null): string {
  if (!t) return "Sin analizar";
  return `${ANGLE_LABEL[t.angle]} · ${EXPRESSION_LABEL[t.expression]} · ${FRAMING_LABEL[t.framing]}`;
}

/** Fotos que se mandan como referencia de la cara (la primera es la que más pesa). */
export const MAX_REFERENCE_PHOTOS = 2;

/**
 * Poses de respaldo, rotando, para que no se repitan entre slides seguidos (como la lista MANOS de
 * carrusel-creator-pro): una sola acción con las manos por slide.
 */
export const DEFAULT_POSES = [
  "de frente, mirando a cámara con una sonrisa segura, señala con el índice el elemento principal",
  "tres cuartos, presenta el elemento principal con la mano abierta, gesto amable",
  "de frente, brazos cruzados, expresión firme y segura",
  "tres cuartos, mano en la barbilla, pensativo, mirando hacia el elemento principal",
  "de frente, sostiene el elemento principal en la palma de la mano, sorprendido",
  "de frente, señala a cámara con el índice, sonrisa cómplice",
  "plano medio, las dos manos apoyadas en la mesa, mirando a cámara, serio",
  "de perfil, mirando a lo lejos, expresión tranquila",
] as const;

export function defaultPose(index: number): string {
  return DEFAULT_POSES[((index % DEFAULT_POSES.length) + DEFAULT_POSES.length) % DEFAULT_POSES.length]!;
}

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lo que pide la pose del slide, leído del texto (en español). null = no lo dice. */
export function wantedTraits(pose: string | null | undefined): Partial<Omit<PhotoTraits, "quality">> {
  const p = fold(pose ?? "");
  const out: Partial<Omit<PhotoTraits, "quality">> = {};
  if (/perfil|de lado|de costado/.test(p)) out.angle = "profile";
  else if (/tres cuartos|3\/4|ligeramente girad|medio girad|girad[oa]/.test(p)) out.angle = "three_quarter";
  else if (/de frente|frontal|a camara|a la camara/.test(p)) out.angle = "frontal";
  if (/sonr|feliz|alegr|riendo|rie\b|cómplice|complice|entusias/.test(p)) out.expression = "smile";
  else if (/sorprend|asombr|impact|boca abierta|incredul/.test(p)) out.expression = "surprised";
  else if (/pensativ|duda|barbilla|reflexi|piensa|curios/.test(p)) out.expression = "thinking";
  else if (/seri|firme|segur|decidid|concentrad|desafiant/.test(p)) out.expression = "serious";
  if (/primer plano|primerisimo|close|cara cerca|retrato cercano/.test(p)) out.framing = "close";
  else if (/cuerpo entero|plano general|de pie completo|plano abierto/.test(p)) out.framing = "wide";
  else if (/plano medio|cintura|medio cuerpo/.test(p)) out.framing = "medium";
  if (/a camara|a la camara|mira(ndo)? al frente|mirada directa/.test(p)) out.gaze = "camera";
  else if (/a lo lejos|hacia (un lado|arriba|abajo|el elemento|la pantalla)|mirando (la|el|hacia)|fuera de camara/.test(p)) out.gaze = "away";
  return out;
}

const ANGLE_NEAR: Record<PhotoAngle, PhotoAngle[]> = { frontal: ["three_quarter"], three_quarter: ["frontal", "profile"], profile: ["three_quarter"] };

/** Puntaje de una foto para una pose (más alto = mejor). Las fotos sin analizar valen lo mismo entre sí. */
export function scorePhoto(traits: PhotoTraits | null, wanted: Partial<Omit<PhotoTraits, "quality">>): number {
  if (!traits) return 0.5;
  let score = traits.quality * 0.6;
  if (wanted.angle) score += traits.angle === wanted.angle ? 3 : ANGLE_NEAR[wanted.angle].includes(traits.angle) ? 1.2 : 0;
  else score += traits.angle === "frontal" ? 0.8 : traits.angle === "three_quarter" ? 0.6 : 0; // sin pedido, la cara se ve mejor de frente
  if (wanted.expression) score += traits.expression === wanted.expression ? 2 : traits.expression === "neutral" ? 0.6 : 0;
  if (wanted.framing) score += traits.framing === wanted.framing ? 1 : 0;
  else score += traits.framing === "close" ? 0.4 : 0; // un primer plano trae más detalle de la cara
  if (wanted.gaze) score += traits.gaze === wanted.gaze ? 0.8 : 0;
  return score;
}

/**
 * Fotos de referencia para un slide, en orden. `chosen` es la que eligió la persona (va primera si existe).
 * `slideIndex` desempata para que los slides seguidos no usen siempre la misma foto.
 */
export function pickPhotos(photos: CharacterPhoto[], pose: string | null | undefined, slideIndex: number, chosen?: string | null, max = MAX_REFERENCE_PHOTOS): string[] {
  if (!photos.length) return [];
  const wanted = wantedTraits(pose);
  const ranked = photos
    .map((p, i) => ({ key: p.key, score: scorePhoto(p.traits, wanted), tie: (i - slideIndex + photos.length * 10) % photos.length }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .map((p) => p.key);
  const first = chosen && photos.some((p) => p.key === chosen) ? chosen : ranked[0]!;
  return [first, ...ranked.filter((k) => k !== first)].slice(0, Math.max(1, max));
}
