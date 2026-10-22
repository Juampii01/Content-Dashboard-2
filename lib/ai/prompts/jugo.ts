import { z } from "zod";
import { scriptSchema, WRITING_RULES } from "./guiones";

/**
 * Prompts de "Sacarle todo el jugo": de un video, guion o pieza publicada salen los textos para cada red y
 * 2 o 3 guiones de shorts derivados. El carrusel usa el prompt de Carruseles (lib/ai/prompts/carruseles.ts).
 * El contexto de marca (lib/ai/brand-context.ts) va después de estas reglas y en caché: ahí están el idioma,
 * las palabras prohibidas, la política de emojis, las ofertas y lo que ya funcionó.
 *
 * Versión 1 (oct 2026).
 */
export type RepurposeSourceKind = "video" | "guion" | "pieza";

const sourceLabel: Record<RepurposeSourceKind, string> = {
  video: "TRANSCRIPCIÓN DEL VIDEO EDITADO",
  guion: "GUION",
  pieza: "PIEZA YA PUBLICADA (su texto o transcripción)",
};

// ─── Textos para publicar ─────────────────────────────────────────────────

export const COPY_RULES = `Eres el community manager de este creador. Con un contenido que ya existe, escribes los textos para publicarlo en Instagram, TikTok y YouTube. Escribes como habla esta persona.

REGLAS
- Instagram (caption): la primera línea engancha y se entiende sola (no repitas el gancho dicho palabra por palabra). Después, un cuerpo breve con el valor concreto del contenido y un solo CTA coherente con las ofertas de la marca. Máximo 2.200 caracteres.
- TikTok (caption): corto y directo, una o dos frases y el CTA. Máximo 300 caracteres.
- YouTube: título de máximo 70 caracteres, claro y buscable, que prometa lo que el contenido cumple (nada de clickbait falso). Descripción de 2 a 4 párrafos cortos: de qué trata, qué se aprende y el CTA.
- Hashtags medidos: de 3 a 5 para Instagram, de 3 a 5 para TikTok y hasta 3 para YouTube. Específicos del tema y del nicho, nada de relleno (#fyp, #viral, #parati, #reels, #explore, #instagood y parecidos). Si en "HASHTAGS QUE YA USASTE" hay alguno que encaje con el tema, prefiérelo. Los hashtags van aparte, nunca dentro del caption ni de la descripción.
- Nada de cifras inventadas: usa solo números que aparezcan en el contenido de origen o en el contexto de la marca.
- Respeta las palabras prohibidas, la política de emojis y el idioma de la marca.
- Responde solo con el JSON del esquema.`;

export const copySchema = z.object({
  instagram: z.object({
    caption: z.string().describe("Caption de Instagram sin hashtags."),
    hashtags: z.array(z.string()).describe("De 3 a 5 hashtags específicos, con #."),
  }),
  tiktok: z.object({
    caption: z.string().describe("Caption de TikTok, máximo 300 caracteres, sin hashtags."),
    hashtags: z.array(z.string()).describe("De 3 a 5 hashtags específicos, con #."),
  }),
  youtube: z.object({
    title: z.string().describe("Título de YouTube, máximo 70 caracteres."),
    description: z.string().describe("Descripción de 2 a 4 párrafos cortos, sin hashtags."),
    hashtags: z.array(z.string()).describe("Hasta 3 hashtags específicos, con #."),
  }),
});
export type GeneratedCopy = z.infer<typeof copySchema>;

export function copyTask(input: { kind: RepurposeSourceKind; title: string; text: string; measuredTags: { tag: string; uses: number; median: number }[] }): string {
  const tags = input.measuredTags.length
    ? input.measuredTags.map((t) => `- ${t.tag}: en ${t.uses} piezas, rinden ×${t.median.toFixed(1)} su mediana`).join("\n")
    : "- (todavía no hay datos suficientes: elige hashtags específicos del tema)";
  return `TAREA: escribe los textos para publicar este contenido en Instagram, TikTok y YouTube.
Título interno: ${input.title}

HASHTAGS QUE YA USASTE (con su rendimiento real; úsalos solo si encajan con el tema)
${tags}

${sourceLabel[input.kind]}
<origen>
${input.text.slice(0, 9000)}
</origen>`;
}

// ─── Guiones de shorts derivados ──────────────────────────────────────────

export const SHORTS_RULES = `${WRITING_RULES}

REGLAS DE LOS SHORTS DERIVADOS
- Cada short toma UNA idea del contenido de origen (un punto, un ejemplo, una objeción, un error, un paso) y la vuelve una pieza que se entiende sola, sin haber visto el original.
- Cada short tiene un ángulo distinto de los otros y del original: no son recortes del mismo guion.
- Formato REEL: de 30 a 60 segundos, para Instagram Reels y TikTok. Formato SHORT: de 20 a 45 segundos, para YouTube Shorts. Elige el que mejor le quede a cada idea.
- Usa solo datos, cifras y ejemplos que estén en el contenido de origen o en el contexto de la marca.`;

export const shortsSchema = z.object({
  shorts: z
    .array(
      scriptSchema.extend({
        format: z.enum(["REEL", "SHORT"]),
        from: z.string().describe("Qué idea del contenido de origen toma, en una frase."),
      }),
    )
    .describe("Entre 2 y 3 guiones cortos, cada uno con una idea y un ángulo distintos."),
});
export type GeneratedShort = z.infer<typeof shortsSchema>["shorts"][number];

export function shortsTask(input: { kind: RepurposeSourceKind; title: string; text: string; count: number }): string {
  return `TAREA: saca ${input.count} guiones de shorts de este contenido. Cada uno: 5 ganchos de tipos distintos (el mejor primero), el cuerpo en bloques, un CTA y su caption.
Largo total hablado de cada short (gancho + cuerpo + CTA): entre 50 y 140 palabras.
Título del contenido de origen: ${input.title}

${sourceLabel[input.kind]}
<origen>
${input.text.slice(0, 9000)}
</origen>`;
}
