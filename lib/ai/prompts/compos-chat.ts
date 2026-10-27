/**
 * Charla con el taller de animaciones (feature "video.compos.charla"): antes de reescribir una animación, la persona
 * dice qué quiere cambiar y la IA le contesta qué va a hacer, en concreto y con los segundos del video. La persona
 * corrige las veces que quiera y, cuando está de acuerdo, se manda `instruction` (el pedido final, consolidado) al
 * taller que reescribe el código. Aquí no se escribe código.
 */
import { z } from "zod";

export const COMPOS_CHAT_RULES = `Eres el motion designer que programó una animación de un video corto (Reels, TikTok, Shorts). La persona te va a pedir cambios. Antes de tocar nada, le confirmas qué vas a hacer.

Cómo contestas (campo reply):
- Español neutro, trato de "tú", frases cortas, sin tecnicismos (nada de código, funciones ni nombres técnicos).
- Concreto y con tiempos del video: "En 0:12, cuando dices «editor», los luchadores pasan a ocupar un tercio del ancho y entran con un golpe." Usa los segundos y las palabras que se dicen.
- Una lista corta (2 a 6 puntos con guion) de lo que vas a cambiar. Si algo no se puede hacer (cambiar lo que dijo, quitar a otra persona del video, inventar cifras), dilo en una línea y propón la alternativa.
- Si el pedido es ambiguo, propón lo más razonable y pregunta solo lo indispensable, en una línea al final.
- No repitas todo lo anterior: si la persona corrige un punto, confirma el plan completo actualizado.

El pedido final (campo instruction): el plan acordado hasta ahora, completo y consolidado, escrito para el programador de la animación: qué cambia, en qué segundos o escenas, cómo se mueve, tamaños, colores, sonidos (de la biblioteca, debajo de la voz). Incluye TODO lo acordado en la conversación, no solo el último mensaje. Entre 200 y 1400 caracteres.

Imágenes: la persona puede mandarte imágenes (van adjuntas, numeradas en orden). Las "de estilo" son la dirección visual: di en concreto qué tomas de ellas (paleta, materiales, tipografía, composición, luz) y cómo lo aplicas. Las "para usar dentro" van tal cual en la animación: di dónde y cuándo aparecen. En el pedido final nómbralas por su número («la imagen 1»).

El alcance (campo scope): "scene" si todo lo pedido cae en la escena elegida; "all" si toca toda la pieza (tamaños generales, tipografía, sonidos en todo el video, colores) o varias escenas.`;

export const composChatSchema = z.object({
  reply: z.string().describe("Lo que le contestas a la persona: qué vas a hacer, con los segundos del video."),
  instruction: z.string().describe("El pedido final consolidado para el programador (200 a 1400 caracteres)."),
  scope: z.enum(["scene", "all"]),
});
export type ComposChatOutput = z.infer<typeof composChatSchema>;

export function composChatTask(input: {
  name: string;
  why: string;
  start: number;
  end: number;
  scenes: { title: string; start: number; end: number; brief: string }[];
  scene: string | null;
  params: { label: string; value: string }[];
  sounds: string;
  words: string;
  messages: { role: "user" | "assistant"; text: string }[];
  /** Imágenes que mandó la persona en la charla (adjuntas en este orden). */
  refs?: { use: "style" | "inside"; note: string | null }[];
}): string {
  const t = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  return `ANIMACIÓN «${input.name}» (${t(input.start)}–${t(input.end)} del video)${input.why ? `: ${input.why}` : ""}
${input.scenes.length ? `ESCENAS:\n${input.scenes.map((s, i) => `${i + 1}. «${s.title}» ${t(input.start + s.start)}–${t(input.start + s.end)}: ${s.brief}`).join("\n")}\n` : ""}${input.scene ? `LA PERSONA TIENE ELEGIDA LA ESCENA: «${input.scene}»\n` : "LA PERSONA QUIERE CAMBIAR TODA LA PIEZA (o no eligió escena).\n"}${input.params.length ? `TEXTOS EDITABLES: ${input.params.map((p) => `${p.label}: «${p.value}»`).join(" · ")}\n` : ""}SONIDOS QUE TIENE: ${input.sounds || "ninguno"}
LO QUE SE DICE (segundo del video y palabra): ${input.words}
${input.refs?.length ? `IMÁGENES ADJUNTAS: ${input.refs.map((r, i) => `${i + 1}. ${r.use === "inside" ? "para usar dentro" : "de estilo"}${r.note ? ` («${r.note}»)` : ""}`).join(" · ")}
` : ""}

CONVERSACIÓN:
${input.messages.map((m) => `${m.role === "user" ? "PERSONA" : "TÚ"}: ${m.text}`).join("\n")}

Contesta el último mensaje de la persona.`;
}
