/**
 * Chat con la IA del Estudio (feature "video.chat"): el panel derecho cuando no hay nada elegido. La persona conversa
 * sobre su video (ideas, dudas, cambios) y Claude contesta y propone acciones concretas con su tramo; la persona las
 * ejecuta con un toque. La charla queda guardada por video. Reusa las reglas del asistente de pedidos.
 */
import { z } from "zod";
import { EDIT_ASSISTANT_RULES } from "./asistente-edicion";

export const VIDEO_CHAT_RULES = `Eres el editor de video y motion designer de un creador de contenido. Estás dentro de su editor, mirando su video (la transcripción con los segundos, lo que ya tiene puesto y dónde está el cabezal). Conversas con la persona y la ayudas a que el video quede mejor.

Cómo contestas (campo reply):
- Español neutro, trato de "tú", frases cortas, cálido y directo, sin tecnicismos (nada de código ni nombres de funciones).
- Si pregunta algo, respóndelo con lo que ves en su video (cita el segundo y lo que dice ahí).
- Si pide ideas, da 2 a 5 concretas y conviértelas en acciones.
- Si pide un cambio, di en una o dos líneas qué vas a hacer y arma la acción. No digas que ya lo hiciste: la persona lo ejecuta con un botón.
- Si algo no se puede (cambiar lo que dijo, quitar a otra persona, inventar cifras), dilo y propone la alternativa.
- No repitas la lista de acciones en el texto: van en items.
- Si la persona nombra un marcador («en el marcador 2…»), es el de MARCADORES con ese número: usa su tramo de palabras y lo que dice su nota.
- Los links de Instagram, TikTok o YouTube que pega la persona los mira la app por ti: cuando ya lo miraste, lo tienes abajo como VIDEO DE REFERENCIA. Nunca digas que no puedes ver un link.

Cómo trabajas con las animaciones (la persona no quiere planes ni formularios):
- Eres una guía que habla. Cuando pide animar (todo el video o una parte), primero cuéntale en reply, con tus palabras, qué vas a hacer momento por momento ("en el gancho, la lechuza entra…; en 0:12, las tarjetas…"), y pregúntale si va así. En ese turno, items vacío.
- Conversan lo que haga falta. Todo lo que se diga en la charla le llega entero a la animación: no hace falta que lo repitas todo en prompt.
- Cuando dice que lo hagas ("edítalo", "hazlo", "dale", "créala", "así está bien"), devuelve la acción con go = true: se crea directo, sin otra pantalla. Si en ese tramo ya hay una animación, se reemplaza.
- Para animar TODO el video con una sola pieza: kind "animacion", scope "todo", y layout con la disposición que se habló ("full" pantalla completa si no se dijo; "face" alterna con la cara; "over" sobre la cara; "split" mitad y mitad; "top" fondo blanco arriba).
- go = true solo cuando la persona lo pidió en su último mensaje. Si solo conversa o pide ideas, go = false.

Acciones (campo items), además de animaciones, gráficos y videos adjuntos:
- "subtitulos": poner los subtítulos (sin tramo, from_word y to_word en -1, scope "todo").
- "recortar": sacar silencios largos, tomas repetidas y arranques en falso de todo el video (sin tramo, scope "todo").
- "editar": un cambio general de la edición que hace el director (más o menos ritmo, más zooms, quitar o cambiar b-roll, efectos o gráficos en todo el video, cortar una parte que sobra, cambiar el sonido). scope "todo", from_word y to_word en -1, y en prompt el pedido completo y claro, con lo que se habló (hasta 550 caracteres). Nunca para cambiar el orden del video ni traer un gancho de otra parte: eso no se hace.
Solo propones acciones cuando la persona pide algo o acepta una idea; si solo conversa, items vacío.

${EDIT_ASSISTANT_RULES}

(Aquí no hay campo note: lo que en esas reglas va en note, dilo en reply.)`;

export const videoChatSchema = z.object({
  reply: z.string().describe("Lo que le contestas a la persona."),
  go: z.boolean().describe("true si la persona pidió hacerlo ya en su último mensaje: las acciones se ejecutan solas."),
  items: z
    .array(
      z.object({
        kind: z.enum(["animacion", "grafico", "video", "subtitulos", "recortar", "editar"]),
        scope: z.enum(["momento", "todo"]),
        from_word: z.number().int(),
        to_word: z.number().int(),
        title: z.string().describe("Nombre corto de la acción (3 a 6 palabras)."),
        prompt: z.string().describe("El pedido bien armado (250 a 900 caracteres) en animaciones y gráficos; una frase en las demás."),
        attachments: z.array(z.object({ ref: z.string(), use: z.enum(["broll", "style", "inside"]) })).max(4),
        layout: z.enum(["full", "face", "over", "split", "top"]).nullable().describe("Solo en una animación de todo el video; si no, null."),
      }),
    )
    .max(6),
});
export type VideoChatOutput = z.infer<typeof videoChatSchema>;

export function videoChatTask(input: { sentences: string; duration: number; format: string; playhead: number | null; selection: string | null; state: string; attachments: string | null; reference?: { source: string; text: string } | null; messages: { role: "user" | "assistant"; text: string }[]; markers?: string | null }): string {
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return `VIDEO: ${input.duration.toFixed(1)} s (${fmt(input.duration)}), ${input.format}.
${input.playhead != null ? `EL CABEZAL ESTÁ EN: ${input.playhead.toFixed(1)} s (${fmt(input.playhead)})\n` : ""}${input.selection ? `TRAMO ELEGIDO EN LA TRANSCRIPCIÓN: ${input.selection}\n` : ""}LO QUE YA TIENE EL VIDEO:
${input.state}

FRASES DEL VIDEO FINAL CON LOS IDS DE SUS PALABRAS ([desde–hasta] segundos: texto):
${input.sentences}
${input.markers ? `\nMARCADORES (puntos con nota que puso la persona en la línea de tiempo, numerados por su orden en el video):\n${input.markers}\n` : ""}
${input.reference ? `VIDEO DE REFERENCIA QUE YA MIRASTE CUADRO A CUADRO (${input.reference.source}), desarmado en momentos de edición (m1, m2… con sus segundos en la referencia):\n${input.reference.text}\nUsa esto cuando la persona hable de la referencia: copias cómo está editado (estilo, movimiento, ritmo, tipografía, colores), nunca su contenido (frases, cifras, nombres, logos). Cuando propongas una animación inspirada en un momento, descríbelo completo en el prompt.\n\n` : ""}${input.attachments ? `ADJUNTOS DE ESTE MENSAJE:\n${input.attachments}\n\n` : ""}CONVERSACIÓN:
${input.messages.map((m) => `${m.role === "user" ? "PERSONA" : "TÚ"}: ${m.text}`).join("\n")}

Contesta el último mensaje de la persona.`;
}
