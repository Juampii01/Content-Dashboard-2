/**
 * Módulos que todavía no se habilitan en producción ("Próximamente"). Mientras estén aquí, nadie entra (ni el dueño):
 * la navegación los muestra deshabilitados, sus páginas muestran el aviso y sus endpoints responden 404.
 * Para habilitar uno, sácalo de esta lista.
 */
export const COMING_SOON = {
  "/clon": "Videos con tu clon digital: escribe un guion y tu clon lo graba por ti.",
  "/miniaturas": "Títulos y miniaturas para YouTube creados con IA, con tu cara y tu estilo.",
} as const satisfies Record<string, string>;

export type ComingSoonPath = keyof typeof COMING_SOON;

export function comingSoon(pathname: string): ComingSoonPath | null {
  for (const base of Object.keys(COMING_SOON) as ComingSoonPath[]) {
    if (pathname === base || pathname.startsWith(`${base}/`)) return base;
  }
  return null;
}
