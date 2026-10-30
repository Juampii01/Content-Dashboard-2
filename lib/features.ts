/**
 * Funciones apagadas en esta versión. Mientras una esté en `false`, no aparece en ninguna pantalla (navegación,
 * botones, Ajustes) y sus páginas y endpoints siguen en «Próximamente» (lib/coming-soon.ts), que responde 404.
 *
 * - `clone`: Videos con clon y lo que usa HeyGen (clon, voz clonada para corregir frases y sincronía de labios).
 *   HeyGen apaga sus API v1 y v2 el 31-oct-2026; el código usa la v3, pero nunca se probó con una cuenta real.
 * - `aiOnly`: el Editor de video se usa solo hablándole a la IA (chat y video, sin línea de tiempo, biblioteca ni
 *   paneles manuales). El chat hace lo que se pide en el momento. Apagado, vuelve el Estudio completo.
 * - `copyExact`: «cópiala tal cual» en el chat del video: toda la edición de una referencia en una sola pieza (kit,
 *   escenas atadas a palabras y las hojas de la referencia a la vista, lib/video/look.ts `copyWholeLook`).
 */
export const FEATURES = { clone: false, aiOnly: true, copyExact: true } as const;
