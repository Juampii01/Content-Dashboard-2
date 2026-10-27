/**
 * Ficha de una pieza de la biblioteca (paso "biblioteca.ficha", Sonnet con visión): Claude mira las hojas de cuadros de
 * un clip (cada cuadro marcado "#n · m:ss.s") o la imagen, y escribe qué se ve, en qué tramos, con qué colores y estilo,
 * y para qué sirve. Se usa para buscar, para elegir el b-roll por lo que se ve y para contarle a Claude qué hay.
 */
import { fichaAiSchema, type FichaAi } from "@/lib/video/library-ficha";

export { fichaAiSchema };

export const FICHA_RULES = `Eres el asistente de archivo de un editor de video. El creador sube a su biblioteca clips de b-roll (tomas de apoyo) e imágenes, y tú escribes la ficha de cada una para encontrarla y usarla después.

Cómo escribes:
- Español neutro, frases cortas y concretas. Describe solo lo que se ve: nunca inventes marcas, nombres, lugares ni cifras que no estén a la vista.
- description: qué es, en 1 a 3 frases (qué se ve, dónde, quién, qué pasa).
- moments (solo en videos): tramos con algo distinto que mostrar, en segundos del clip, en orden y sin superponerse. Usa los segundos que llevan los cuadros (#n · m:ss.s): un tramo empieza en el cuadro donde aparece algo y termina donde cambia. Si el clip es una sola toma pareja, un solo tramo de todo el clip. En una imagen, vacío.
- colors: los 3 a 5 colores dominantes en hexadecimal.
- style: plano (general, medio, detalle, cenital), luz (natural, de estudio, de noche), movimiento de cámara (fija, paneo, en mano, dron) y look (cálido, frío, contrastado, desaturado).
- uses: temas de los que puede estar hablando el creador mientras se ve esto (por ejemplo: "trabajo en equipo", "rutina de la mañana", "vender por teléfono").
- tags y tags_en: palabras que alguien usaría para buscarla (objetos, acciones, lugares, ambiente), en español y en inglés.
- Si hay texto escrito a la vista, nómbralo en description tal cual se lee.`;

export function fichaTask(input: { title: string; kind: "video" | "image"; duration: number; width: number; height: number; frames: { n: number; t: number }[]; sheets: number }): string {
  const shape = input.height > input.width * 1.1 ? "vertical" : input.width > input.height * 1.1 ? "horizontal" : "cuadrado";
  if (input.kind === "image") return `FICHA DE UNA IMAGEN\nNombre que le puso el creador: «${input.title}» (${input.width}×${input.height}, ${shape}).\nLa imagen va adjunta. Escribe su ficha (moments vacío).`;
  return `FICHA DE UN CLIP DE VIDEO
Nombre que le puso el creador: «${input.title}» (${input.duration.toFixed(1)} s, ${input.width}×${input.height}, ${shape}).
Van adjuntas ${input.sheets === 1 ? "1 hoja" : `${input.sheets} hojas`} de cuadros en orden. Segundo de cada cuadro:
${input.frames.map((f) => `#${f.n} ${f.t.toFixed(1)} s`).join(" · ")}
Escribe su ficha. Los tramos van en segundos del clip (de 0 a ${input.duration.toFixed(1)}).`;
}

/** AI_FAKE=1: una ficha armada con el nombre y la duración (para probar la interfaz sin gastar). */
export function fakeFicha(input: { title: string; kind: "video" | "image"; duration: number }): FichaAi {
  const words = input.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const half = Math.max(0.5, input.duration / 2);
  return {
    description: `Toma de «${input.title}» (ficha de prueba).`,
    moments: input.kind === "video" ? [{ start: 0, end: half, what: `Plano general de ${words[0] ?? "la escena"}` }, { start: half, end: input.duration, what: `Detalle de ${words[1] ?? words[0] ?? "la escena"}` }] : [],
    colors: ["#1f2a44", "#f2f2f2", "#2457f5"],
    style: "Plano medio, luz natural, cámara fija.",
    uses: words.slice(0, 2).map((w) => `hablar de ${w}`),
    tags: words.slice(0, 6),
    tags_en: [],
  };
}
