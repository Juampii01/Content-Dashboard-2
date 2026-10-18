import { formatNumber } from "@/lib/format";

/**
 * Tarifas de HeyGen para estimar cuánto cuesta un video ANTES de generarlo.
 *
 * ESTIMACIÓN, no precio oficial: HeyGen cobra por segundo generado y la duración real la marca el audio.
 * Fuentes, consultadas el 18-oct-2026:
 * - Precios PAYG de la API por minuto: https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained
 * - Changelog oct-2026: "1080p bills at the 2k rate: 3× the 768p rate": https://developers.heygen.com/changelog.md
 * - Creación de un Digital Twin: US$ 2.13 = 43 créditos (de ahí sale el valor de un crédito).
 *
 * Pendiente (docs/auditoria/06-clon-heygen.md §6): validar con un render real a 1080p en 9:16 comparando el
 * saldo antes y después, y ajustar estas constantes. Hasta entonces la estimación se inclina a lo caro
 * (aplica el ×3 de 1080p) para no comerse el saldo del cliente sin que se dé cuenta.
 */
export const PRICING_CHECKED_ON = "2026-10-18";
export const PRICING_SOURCE_URL = "https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained";

export type EngineKey = "avatar_iii" | "avatar_iv" | "avatar_v";
export type ResolutionKey = "1080p" | "720p";

export const ENGINES: Record<EngineKey, { label: string; model: string; usdPerMinute: number; hint: string }> = {
  avatar_iii: { label: "Económico", model: "Avatar III", usdPerMinute: 0.6, hint: "Buena calidad para pruebas y videos de volumen." },
  avatar_iv: { label: "Calidad", model: "Avatar IV", usdPerMinute: 4.83, hint: "Gestos y labios más naturales. Unas 8 veces más caro." },
  avatar_v: { label: "Premium", model: "Avatar V", usdPerMinute: 7.2, hint: "El más realista de HeyGen. El más caro." },
};

export const ENGINE_ORDER: EngineKey[] = ["avatar_iii", "avatar_iv", "avatar_v"];

/** Multiplicador sobre la tarifa base (768p). 1080p se cobra al triple según el changelog de oct-2026. */
export const RESOLUTION_MULTIPLIER: Record<ResolutionKey, number> = { "1080p": 3, "720p": 1 };

/** Ritmo de habla para pasar de palabras a minutos (el mismo que usa Guiones: 2.5 palabras por segundo). */
export const WORDS_PER_MINUTE = 150;

/** Valor aproximado de un crédito de API en dólares (43 créditos = US$ 2.13). */
export const USD_PER_CREDIT = 2.13 / 43;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Duración estimada en segundos: palabras ÷ 150 por minuto, ajustada por la velocidad de la voz. */
export function estimateSeconds(words: number, speed = 1): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.round((words / WORDS_PER_MINUTE / Math.max(0.5, speed)) * 60));
}

export type CostEstimate = { seconds: number; usd: number; credits: number; ratePerMinute: number; multiplier: number };

/** Costo estimado = minutos × tarifa del motor × multiplicador de resolución. */
export function estimateCost(input: { words: number; speed: number; engine: EngineKey; resolution: ResolutionKey }): CostEstimate {
  const seconds = estimateSeconds(input.words, input.speed);
  const ratePerMinute = ENGINES[input.engine].usdPerMinute;
  const multiplier = RESOLUTION_MULTIPLIER[input.resolution];
  const usd = Math.ceil((seconds / 60) * ratePerMinute * multiplier * 100) / 100;
  return { seconds, usd, credits: Math.ceil(usd / USD_PER_CREDIT), ratePerMinute, multiplier };
}

/** "US$ 4.83". */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `US$ ${formatNumber(value, { digits: 2 })}`;
}

export function formatCredits(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(Math.round(value * 10) / 10)} créditos`;
}

/** Forma del saldo que devuelve el servidor (ver `balanceFromUser` en lib/heygen/client.ts). */
export type BalanceLike = { unit: "usd" | "credits" | "unknown"; amount: number | null; note: string | null; plan: string | null };

/** Texto del saldo para la interfaz: "US$ 25.00", "430 créditos" o "Plan pro". */
export function describeBalance(balance: BalanceLike): { value: string; note: string | null; empty: boolean } {
  if (balance.unit === "usd") return { value: formatUsd(balance.amount), note: balance.note, empty: (balance.amount ?? 0) <= 0 };
  if (balance.unit === "credits") return { value: formatCredits(balance.amount), note: balance.note, empty: (balance.amount ?? 0) <= 0 };
  return { value: balance.plan ? `Plan ${balance.plan}` : "Sin dato", note: balance.note ?? "HeyGen no informa un saldo comparable para esta cuenta.", empty: false };
}

/** Ayuda oficial de HeyGen sobre cómo se paga la API (aparte del plan web) y página para cargar saldo. */
export const HEYGEN_API_BILLING_HELP = "https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained";
export const HEYGEN_API_USAGE_URL = "https://app.heygen.com/developers/usage";
