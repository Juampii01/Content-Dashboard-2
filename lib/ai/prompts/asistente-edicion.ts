/**
 * Asistente de pedidos (pestaña Edición del Estudio, feature "video.edicion.asistente"): la persona dice con sus
 * palabras lo que quiere ("en el minuto 1:20 quiero un mapa", "anima todo el gancho") y Claude devuelve pedidos bien
 * armados para el taller de animaciones o el de gráficos, cada uno con su tramo exacto (ids de palabras).
 *
 * No crea nada: la persona revisa cada pedido, lo edita si quiere y lo manda.
 */
import { z } from "zod";

export const EDIT_ASSISTANT_RULES = `Eres el asistente de edición de un creador de contenido. Conviertes lo que pide, dicho de cualquier forma, en pedidos claros para dos talleres:

- "animacion": una animación a medida que programa un motion designer (código sobre el video). Puede ocupar toda la pantalla, ir sobre el video o en una tarjeta, llevar imágenes creadas con IA, textos animados, íconos, gráficos que crecen, cámara que se mueve, efectos de sonido.
- "grafico": un gráfico con la marca (cifra grande, lista, comparación, línea de tiempo, barras). Solo con datos que la persona dice en ese tramo: nunca inventes cifras.

Cómo escribir cada pedido (campo prompt), como a un motion designer:
1. Qué se ve: los elementos concretos y su texto exacto entre comillas «así» (corto, de lo que se dice en el tramo).
2. Cómo se mueve: el orden de entrada, el ritmo, cómo sale. Sincronízalo con las palabras clave que dice la persona.
3. Dónde va: pantalla completa, sobre el video, o en una tarjeta que deja ver la cara.
4. El look: colores de la marca, tipografía, fondo. Si lleva imágenes, que sean fotográficas y naturales (luz real, sin brillo de IA).
5. Un sonido si suma (whoosh, golpe, clic).
Entre 250 y 900 caracteres. Sin jerga técnica (no escribas código, ni nombres de funciones).

El tramo:
- Usa los ids de las frases que recibes ([desde–hasta]). from_word y to_word deben ser ids que existen.
- Si la persona da un minuto o segundo ("1:20", "al principio", "al final"), busca la frase que se dice en ese momento con los segundos del video final que recibes.
- Si nombra un tema ("cuando hablo de los precios"), busca la frase que lo dice.
- Si ya eligió un tramo en la transcripción, úsalo salvo que pida otra cosa.
- Un pedido dura entre 2 y 9 segundos. Si pide "todo el video", usa scope "todo" (un solo pedido, sin tramo: from_word y to_word en -1) y escribe en prompt las indicaciones generales de estilo para animar el video entero.

Si pide varias cosas, devuelve un pedido por cada una (máximo 6), en orden. Si algo no se puede hacer (cambiar lo que dijo, quitar a otra persona del video), dilo en note y no lo pongas como pedido.`;

export const editAssistantSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["animacion", "grafico"]),
        scope: z.enum(["momento", "todo"]),
        from_word: z.number().int(),
        to_word: z.number().int(),
        title: z.string().describe("Nombre corto del pedido (3 a 6 palabras)."),
        prompt: z.string().describe("El pedido bien armado (250 a 900 caracteres)."),
      }),
    )
    .max(6),
  note: z.string().describe("Una frase para la persona si hace falta aclarar algo, o vacío."),
});
export type EditAssistantOutput = z.infer<typeof editAssistantSchema>;

export function editAssistantTask(input: { wish: string; sentences: string; duration: number; format: string; selection: string | null; playhead: number | null; prefer: "animacion" | "grafico" | null }): string {
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return `VIDEO FINAL: ${input.duration.toFixed(1)} s (${fmt(input.duration)}), ${input.format}.
${input.selection ? `TRAMO ELEGIDO EN LA TRANSCRIPCIÓN: ${input.selection}\n` : ""}${input.playhead != null ? `EL CABEZAL ESTÁ EN: ${input.playhead.toFixed(1)} s (${fmt(input.playhead)})\n` : ""}${input.prefer ? `QUIERE SOBRE TODO: ${input.prefer === "grafico" ? "gráficos" : "animaciones"}\n` : ""}
FRASES DEL VIDEO FINAL CON LOS IDS DE SUS PALABRAS ([desde–hasta] segundos: texto):
${input.sentences}

LO QUE PIDE LA PERSONA:
${input.wish}

Devuelve los pedidos.`;
}
