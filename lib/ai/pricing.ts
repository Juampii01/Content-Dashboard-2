/**
 * Precios de la API de Anthropic (USD por millón de tokens) y cálculo del costo de una llamada.
 * Fuente: platform.claude.com/docs/en/about-claude/pricing, consultada el 27-oct-2026 (PRICES_CHECKED). Si cambian, se
 * actualizan aquí y nada más.
 *
 * Sin nada de servidor: lo usan el cliente de IA (para registrar el costo en api_usage), el director de edición (para
 * estimar y respetar el tope por video) y las pruebas.
 */

/** Página oficial de precios y el día en que se revisaron los de abajo (se muestran en la vista de consumo). */
export const PRICES_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export const PRICES_CHECKED = "2026-10-27";

export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite1h: number };

export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite1h: 8 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite1h: 4 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite1h: 0.2 },
};

/** Haiku 5.5 cambia de precio cuando el pedido pasa de 100 mil tokens de entrada. */
const HAIKU_LONG: ModelPrice = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite1h: 1 };

export type Usage = {
  /** Tokens de entrada sin caché. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export function priceFor(model: string, totalInput: number): ModelPrice {
  if (model === "claude-haiku-5-5" && totalInput > 100_000) return HAIKU_LONG;
  // Un modelo desconocido se cobra como Opus: mejor sobrestimar que pasarse del tope.
  return PRICES[model] ?? PRICES["claude-opus-5-5"]!;
}

/** Costo en USD de una llamada. El contexto en caché se escribe con TTL de 1 hora (lib/ai/client.ts). */
export function costOf(model: string, u: Usage): number {
  const p = priceFor(model, u.input + u.cacheRead + u.cacheWrite);
  const cost = (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite1h) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Tokens que cuesta una imagen: un token por cada parche de 28×28 px (modelos de alta resolución, lado largo ≤ 2576). */
export function imageTokens(width: number, height: number): number {
  const scale = Math.min(1, 2576 / Math.max(width, height, 1));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return Math.min(4784, Math.ceil(w / 28) * Math.ceil(h / 28));
}

/** Estimación gruesa de tokens de un texto (español: unas 3,2 letras por token con el tokenizador nuevo). */
export function textTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}
