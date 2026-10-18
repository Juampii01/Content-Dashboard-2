/** Reglas de idioma para los prompts, según el idioma configurado en Mi marca. */
export const LANGUAGES = {
  "es-neutro": "Español neutro latinoamericano",
  "es-MX": "Español de México",
  "es-CO": "Español de Colombia",
  "es-AR": "Español rioplatense (Argentina/Uruguay)",
  "es-ES": "Español de España",
  "en-US": "Inglés de Estados Unidos",
} as const;
export type LanguageKey = keyof typeof LANGUAGES;

export function languageRules(language: string): string {
  switch (language) {
    case "es-AR":
      return 'IDIOMA: español rioplatense. Voseo natural ("vos tenés", "mirá"). Sin "vosotros".';
    case "es-ES":
      return 'IDIOMA: español de España ("vosotros", "vale" cuando suene natural).';
    case "es-MX":
      return 'IDIOMA: español de México, trato de "tú", natural y cercano. Sin voseo ni "vosotros". "Video" sin tilde.';
    case "es-CO":
      return 'IDIOMA: español de Colombia, trato de "tú", natural y cercano. Sin voseo ni "vosotros". "Video" sin tilde.';
    case "en-US":
      return "LANGUAGE: American English, conversational.";
    default:
      return 'IDIOMA: español neutro latinoamericano. Trato de "tú". Prohibido el voseo ("tenés", "podés", "vos") y el español de España ("vosotros", "tenéis", "vale", "vídeo" con tilde, "móvil", "ordenador"). Se escribe "video". Evita regionalismos de cualquier país.';
  }
}
