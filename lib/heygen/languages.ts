/**
 * Idiomas para traducir con el clon.
 *
 * - Traducción de video (HeyGen): la lista la da GET /v3/video-translations/languages (nombres en inglés, como
 *   "English" o "Spanish (Spain)"). Aquí solo se traducen los nombres más comunes para mostrarlos; el valor que se manda
 *   a HeyGen es siempre el nombre tal como vino de su API.
 * - Video nuevo con el clon: el texto lo adapta Claude y el clon lo graba con su voz. `locale` va en
 *   voice_settings.locale (HeyGen lo describe como una "pista de acento para voces multilingües") y `language` es el
 *   código base para la prueba de voz (POST /v3/voices/speech).
 */

const NAMES: Record<string, string> = {
  english: "Inglés",
  "english (united states)": "Inglés (Estados Unidos)",
  "english (us)": "Inglés (Estados Unidos)",
  "english (united kingdom)": "Inglés (Reino Unido)",
  "english (uk)": "Inglés (Reino Unido)",
  "english (australia)": "Inglés (Australia)",
  spanish: "Español",
  "spanish (spain)": "Español (España)",
  "spanish (mexico)": "Español (México)",
  "spanish (latin america)": "Español (Latinoamérica)",
  portuguese: "Portugués",
  "portuguese (brazil)": "Portugués (Brasil)",
  "portuguese (portugal)": "Portugués (Portugal)",
  french: "Francés",
  "french (france)": "Francés (Francia)",
  "french (canada)": "Francés (Canadá)",
  german: "Alemán",
  italian: "Italiano",
  dutch: "Neerlandés",
  japanese: "Japonés",
  korean: "Coreano",
  chinese: "Chino",
  "chinese (mandarin, simplified)": "Chino mandarín (simplificado)",
  arabic: "Árabe",
  hindi: "Hindi",
  russian: "Ruso",
  turkish: "Turco",
  polish: "Polaco",
};

/** Nombre en español de un idioma de HeyGen; si no lo conocemos, el de HeyGen tal cual. */
export function languageLabel(name: string | null | undefined): string {
  if (!name) return "—";
  return NAMES[name.trim().toLowerCase()] ?? name;
}

/** Orden para la lista: primero inglés (el mercado de Estados Unidos), después portugués, francés, etc. */
const PRIORITY = ["english (united states)", "english (us)", "english", "portuguese (brazil)", "portuguese", "french", "german", "italian"];

export function sortLanguages(list: string[]): string[] {
  const rank = (l: string) => {
    const i = PRIORITY.indexOf(l.toLowerCase());
    return i === -1 ? PRIORITY.length : i;
  };
  return [...new Set(list)].sort((a, b) => rank(a) - rank(b) || languageLabel(a).localeCompare(languageLabel(b), "es"));
}

/** El idioma de HeyGen que más se parece a inglés de Estados Unidos (para dejarlo elegido por defecto). */
export function defaultLanguage(list: string[]): string | null {
  const sorted = sortLanguages(list);
  return sorted.find((l) => /^english/i.test(l)) ?? sorted[0] ?? null;
}

export type CloneLanguage = { key: string; label: string; heygenName: string; language: string; locale: string; market: string };

/** Idiomas para "Video nuevo con tu clon". `heygenName` es como lo nombra HeyGen (se guarda en clone_videos.language). */
export const CLONE_LANGUAGES: CloneLanguage[] = [
  { key: "en-US", label: "Inglés (Estados Unidos)", heygenName: "English", language: "en", locale: "en-US", market: "Estados Unidos" },
  { key: "pt-BR", label: "Portugués (Brasil)", heygenName: "Portuguese (Brazil)", language: "pt", locale: "pt-BR", market: "Brasil" },
  { key: "fr-FR", label: "Francés (Francia)", heygenName: "French", language: "fr", locale: "fr-FR", market: "Francia" },
  { key: "de-DE", label: "Alemán", heygenName: "German", language: "de", locale: "de-DE", market: "Alemania" },
  { key: "it-IT", label: "Italiano", heygenName: "Italian", language: "it", locale: "it-IT", market: "Italia" },
  { key: "es-MX", label: "Español (México)", heygenName: "Spanish (Mexico)", language: "es", locale: "es-MX", market: "México y Latinoamérica" },
];

export function cloneLanguage(key: string | null | undefined): CloneLanguage | null {
  return CLONE_LANGUAGES.find((l) => l.key === key) ?? null;
}
