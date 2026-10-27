/**
 * Funciones apagadas en esta versión. Mientras una esté en `false`, no aparece en ninguna pantalla (navegación,
 * botones, Ajustes) y sus páginas y endpoints siguen en «Próximamente» (lib/coming-soon.ts), que responde 404.
 *
 * - `clone`: Videos con clon y lo que usa HeyGen (clon, voz clonada para corregir frases y sincronía de labios).
 *   HeyGen apaga sus API v1 y v2 el 31-oct-2026; el código usa la v3, pero nunca se probó con una cuenta real.
 */
export const FEATURES = { clone: false } as const;
