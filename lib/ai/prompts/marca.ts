import { z } from "zod";
import { languageRules } from "../language";

/** Perfil de marca que arma la IA a partir de las respuestas y las muestras. Después la persona lo edita. */
export const brandDraftSchema = z.object({
  niche: z.string().describe("Nicho en una frase concreta (ej. 'Asesoría de marketing para clínicas dentales en Estados Unidos')."),
  whatYouSell: z.string().describe("Qué vende y a qué precio aproximado si se sabe."),
  differentiator: z.string().describe("Qué lo hace distinto de otros del mismo nicho, en una o dos frases."),
  audience: z.string().describe("Cliente ideal en 2 o 3 frases: quién es, en qué momento está, qué quiere lograr."),
  audiencePains: z.array(z.string()).describe("5 a 7 dolores, con las palabras que usaría esa persona."),
  audienceDesires: z.array(z.string()).describe("4 a 6 deseos concretos."),
  objections: z.array(z.string()).describe("4 a 6 objeciones para comprar, como frases que diría el cliente."),
  beliefs: z.array(z.string()).describe("3 creencias del creador que van contra la corriente del nicho."),
  tone: z.string().describe("Cómo habla el creador en 2 frases: registro, ritmo, energía, humor."),
  signaturePhrases: z.array(z.string()).describe("Frases o muletillas propias que aparecen en las muestras (0 a 5)."),
  bannedWords: z.array(z.string()).describe("Palabras o clichés que no encajan con esta marca (3 a 8)."),
  emojiPolicy: z.enum(["ninguno", "pocos", "libres"]),
  pillars: z
    .array(z.object({ name: z.string(), description: z.string(), share: z.number().describe("Porcentaje del contenido del mes (los pilares suman 100).") }))
    .describe("3 a 5 pilares de contenido."),
  offers: z
    .array(z.object({ name: z.string(), promise: z.string(), cta: z.string().describe("Llamado a la acción que se dice en el video."), keyword: z.string().describe("Palabra para comentar o mandar por DM, en mayúsculas, o vacío.") }))
    .describe("1 a 3 ofertas con su CTA."),
});
export type BrandDraft = z.infer<typeof brandDraftSchema>;

export function brandDraftContext(language: string): string {
  return `Eres estratega de contenido para creadores latinos que venden servicios e infoproductos.
Tu trabajo: armar el perfil de marca que después se usa para escribir guiones con su voz.

REGLAS
- Usa lo que la persona dijo y lo que se nota en sus muestras. Si algo no está, propón lo más probable para ese nicho y que sea específico, nunca genérico.
- Nada de frases de manual ("aportar valor", "conectar con tu audiencia"). Escribe como hablaría un estratega con experiencia.
- Los dolores, deseos y objeciones van en primera persona del cliente, con sus palabras.
- ${languageRules(language)}
- Responde solo con el JSON del esquema.`;
}

export function brandDraftTask(input: {
  name: string;
  whatYouSell: string;
  audience: string;
  differentiator: string;
  neverSay: string;
  samples: { source: string; text: string }[];
  topPieces: string[];
}): string {
  return `RESPUESTAS DE LA PERSONA
Nombre o marca: ${input.name || "(no dijo)"}
Qué vende: ${input.whatYouSell || "(no dijo)"}
A quién: ${input.audience || "(no dijo)"}
Qué la diferencia: ${input.differentiator || "(no dijo)"}
Qué nunca diría: ${input.neverSay || "(no dijo)"}

MUESTRAS DE CÓMO HABLA
${input.samples.length ? input.samples.map((s, i) => `<muestra n="${i + 1}" fuente="${s.source}">\n${s.text.slice(0, 3000)}\n</muestra>`).join("\n") : "(sin muestras)"}

SUS PIEZAS QUE MEJOR FUNCIONARON
${input.topPieces.length ? input.topPieces.map((t) => `- ${t}`).join("\n") : "(sin datos)"}

Arma el perfil de marca completo.`;
}

/** "Prueba de voz": un guion corto de muestra para comprobar que el perfil suena a la persona. */
export const voiceTestSchema = z.object({
  topic: z.string().describe("El tema elegido, en pocas palabras."),
  hook: z.string(),
  body: z.array(z.string()).describe("3 o 4 bloques hablados, cada uno de 1 a 3 frases."),
  cta: z.string(),
});
export type VoiceTest = z.infer<typeof voiceTestSchema>;

export const VOICE_TEST_TASK = `Escribe un reel de 30 a 40 segundos de muestra para que la persona compruebe si suena a ella.
Elige tú el tema: el dolor más fuerte de su audiencia, contado desde una de sus creencias. Usa su tono, su ritmo y sus frases propias con moderación.
Solo el texto hablado: gancho, 3 o 4 bloques y un CTA de una de sus ofertas.`;
