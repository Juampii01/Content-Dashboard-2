import type { ScriptContent } from "@/lib/db/schema";

/** Límite de caracteres del texto hablado. HeyGen no documenta un máximo; 10 000 caracteres son unos 10 minutos. */
export const MAX_SCRIPT_CHARS = 10_000;

/**
 * Texto que dice el clon a partir de un guion: el gancho elegido, lo hablado de cada bloque y el CTA.
 * No incluye textos en pantalla ni indicaciones de b-roll.
 */
export function spokenTextFromScript(content: ScriptContent): string {
  const hook = content.hooks[content.selectedHook]?.text ?? content.hooks[0]?.text ?? "";
  return [hook, ...content.beats.map((b) => b.spoken), content.cta.spoken]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}
