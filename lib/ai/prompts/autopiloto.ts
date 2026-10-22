/**
 * Indicaciones del autopiloto semanal. Se suman a la tarea del plan semanal del Calendario
 * (lib/ai/prompts/calendario.ts): el contexto de marca ya trae el ranking de ganchos y las piezas que mejor rindieron.
 *
 * Versión 1 (oct 2026).
 */
export function autopilotExtra(input: { count: number; days: string[]; reportIdeas: { title: string; hook: string }[] }): string {
  const ideas = input.reportIdeas.length ? input.reportIdeas.map((i) => `- ${i.title}${i.hook ? `: “${i.hook}”` : ""}`).join("\n") : "- (no hay informes todavía)";
  return `AUTOPILOTO (esta semana se escribe sola: cada pieza sale con su guion o su carrusel)
- Exactamente ${input.count} pieza${input.count === 1 ? "" : "s"}, una por día, solo en estos días: ${input.days.join(", ")}.
- Formatos: REEL, SHORT y CAROUSEL (como máximo un carrusel cada tres piezas). Nada de VIDEO largo ni STORY.
- Apóyate en lo que funcionó: los tipos de gancho que mejor rinden y los ángulos de las piezas que superaron su mediana.
- Si una idea de los informes encaja con los pilares atrasados, úsala (reescribe el gancho si hace falta). Si no encaja, ignórala.
- El campo "why" dice en una frase qué patrón real o qué pilar atrasado cubre. Nada de cifras que no estén en el contexto.

IDEAS PENDIENTES DE TUS INFORMES
${ideas}`;
}
