/**
 * Cupo diario de imágenes de un plan de ChatGPT. No está publicado: carrusel-creator-pro lo midió en unas 60 por día
 * por cuenta (62 en una cuenta, 97 en otra). Se usa solo para avisar antes de llegar, nunca para bloquear: con la
 * API key de OpenAI el límite es el saldo de la cuenta del cliente.
 */
export const CHATGPT_DAILY_IMAGES = 60;

export function quotaTone(used: number): "ok" | "near" | "over" {
  return used >= CHATGPT_DAILY_IMAGES ? "over" : used >= CHATGPT_DAILY_IMAGES - 10 ? "near" : "ok";
}
