import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { comingSoon } from "./lib/coming-soon";

/**
 * Filtro rápido: quien no tiene cookie de sesión va al login.
 * No consulta la base (por eso es rápido); la autorización real se comprueba cerca de los datos
 * (`lib/auth`) en cada página, acción y endpoint. Falla cerrado: sin cookie, no pasa.
 */
const PUBLIC_PATHS = [
  "/login",
  "/recuperar",
  "/definir-contrasena",
  "/privacidad",
  "/terminos",
  "/eliminar-datos",
  "/api/cron",
  "/api/webhooks",
  // Las llama el worker de video (sin cookie). Cada ruta exige `Authorization: Bearer <WORKER_SECRET>`
  // con comparación en tiempo constante (lib/jobs: workerAuthorized).
  "/api/worker",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Módulos en "Próximamente": sus endpoints no responden para nadie (las páginas muestran el aviso en su layout).
  if (pathname.startsWith("/api/") && comingSoon(pathname.slice(4))) {
    return NextResponse.json({ error: "Esta herramienta todavía no está disponible." }, { status: 404 });
  }
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (isPublic) return NextResponse.next();

  const hasSession = Boolean(getSessionCookie(request, { cookiePrefix: "cs" }));
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

/**
 * Fuera del filtro: archivos estáticos y las rutas que reciben videos grandes en desarrollo
 * (almacenamiento local). Con el filtro activo, Next copia el cuerpo en memoria y lo corta en 10 MB.
 * Esas rutas validan la sesión (`/api/editor/files`, `/api/clon/archivos`) o el WORKER_SECRET (`/api/worker/files`) ellas mismas.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|fonts/|demo/|emoji/|sfx/|icon.svg|favicon.ico|robots.txt|api/editor/files/|api/worker/files/|api/clon/archivos/).*)"],
};
