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

// ─── Traducción, voz y sincronía de labios (tabla oficial actualizada el 19-oct-2026) ─────────────

/**
 * Tarifas de pago por uso de la API, de la tabla de https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained
 * ("Last updated on October 19, 2026"), consultada el 22-oct-2026. Créditos tal como los publica HeyGen.
 * - Video Translation, por minuto: Speed sin labios (solo audio) US$ 0.57 / 11 · Speed con labios US$ 0.81 / 16 ·
 *   Precision con labios US$ 1.50 / 30. La documentación aclara que "translations are always charged on the source
 *   duration" (/docs/video-translate): se cobra por la duración del video original.
 * - "Lipsync Audio mode", por minuto: Speed US$ 0.84 / 17 · Precision US$ 1.74 / 35. La tabla no dice sobre qué duración
 *   se cobra: estimamos sobre el tramo que mandamos (el clip recortado), que es lo único que recibe HeyGen.
 * - Text-to-Speech "Speech, Starfish": US$ 0.12 / 2 créditos por minuto. Las voces "HeyGen Voice" instantáneas cobran
 *   US$ 15 por millón de caracteres. Una frase corregida cuesta menos de un centavo con cualquiera de las dos.
 */
export const TRANSLATION_PRICING_CHECKED_ON = "2026-10-22";
export const TRANSLATION_PRICING_UPDATED_ON = "2026-10-19";

export type TranslationModeKey = "speed" | "precision" | "audio_only";

export const TRANSLATION_MODES: Record<TranslationModeKey, { label: string; usdPerMinute: number; creditsPerMinute: number; hint: string; lipsync: boolean }> = {
  speed: { label: "Rápido", usdPerMinute: 0.81, creditsPerMinute: 16, lipsync: true, hint: "Tu voz en el otro idioma y labios sincronizados. Ideal si casi no te mueves." },
  precision: { label: "Precisión", usdPerMinute: 1.5, creditsPerMinute: 30, lipsync: true, hint: "Labios más naturales y una traducción que cuida el contexto. Para el video final." },
  audio_only: { label: "Solo audio", usdPerMinute: 0.57, creditsPerMinute: 11, lipsync: false, hint: "Tu voz en el otro idioma, sin tocar la imagen: la boca no coincide." },
};
export const TRANSLATION_MODE_ORDER: TranslationModeKey[] = ["speed", "precision", "audio_only"];

export const LIPSYNC_MODES: Record<"speed" | "precision", { label: string; usdPerMinute: number; creditsPerMinute: number }> = {
  speed: { label: "Rápido", usdPerMinute: 0.84, creditsPerMinute: 17 },
  precision: { label: "Precisión", usdPerMinute: 1.74, creditsPerMinute: 35 },
};

export const SPEECH_USD_PER_MINUTE = 0.12;
export const SPEECH_CREDITS_PER_MINUTE = 2;

export type SimpleEstimate = { seconds: number; usd: number; credits: number; usdPerMinute: number };

/** Costo por minuto con redondeo hacia arriba al centavo (y al crédito). */
export function perMinuteCost(seconds: number, usdPerMinute: number, creditsPerMinute: number): SimpleEstimate {
  const minutes = Math.max(0, seconds) / 60;
  return { seconds, usd: Math.ceil(minutes * usdPerMinute * 100) / 100, credits: Math.ceil(minutes * creditsPerMinute), usdPerMinute };
}

export function estimateTranslation(seconds: number, mode: TranslationModeKey): SimpleEstimate {
  const m = TRANSLATION_MODES[mode];
  return perMinuteCost(seconds, m.usdPerMinute, m.creditsPerMinute);
}

export function estimateLipsync(seconds: number, mode: "speed" | "precision"): SimpleEstimate {
  const m = LIPSYNC_MODES[mode];
  return perMinuteCost(seconds, m.usdPerMinute, m.creditsPerMinute);
}

export function estimateSpeech(seconds: number): SimpleEstimate {
  return perMinuteCost(seconds, SPEECH_USD_PER_MINUTE, SPEECH_CREDITS_PER_MINUTE);
}

/** Saldo que no alcanza para `usd` (o `credits`), con el texto para mostrar. null = alcanza o no se puede saber. */
export function balanceShortfall(balance: BalanceLike | null, cost: { usd: number; credits: number }): string | null {
  if (!balance || balance.amount == null) return null;
  if (balance.unit === "usd" && balance.amount < cost.usd) return `Tu saldo de API en HeyGen (${formatUsd(balance.amount)}) no alcanza: esto cuesta unos ${formatUsd(cost.usd)}.`;
  if (balance.unit === "credits" && balance.amount < cost.credits) return `Tu saldo de API en HeyGen (${formatCredits(balance.amount)}) no alcanza: esto cuesta unos ${formatCredits(cost.credits)}.`;
  return null;
}
