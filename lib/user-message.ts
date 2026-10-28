/**
 * El mensaje de un error solo si está escrito para la persona (en español); si no, `fallback`. Evita que un
 * «Failed to fetch», un error de Vercel Blob o cualquier texto técnico en inglés llegue a la pantalla. Se usa en el
 * navegador y en el servidor.
 */
const SPANISH =
  /[áéíóúñ¿¡]|subida|archivo|conexión|video|foto|imagen|clave|prueba/i;
const NETWORK =
  /failed to fetch|load failed|networkerror|network request failed/i;

export function userMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const text = error.message.trim();
  if (!text || NETWORK.test(text))
    return NETWORK.test(text)
      ? "Se cortó la conexión. Revisa tu internet y vuelve a intentarlo."
      : fallback;
  return SPANISH.test(text) && !/^[A-Za-z]+Error\b|\bat \S+:\d+/.test(text)
    ? text
    : fallback;
}
