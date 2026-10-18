import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

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
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|fonts/|demo/|icon.svg|favicon.ico|robots.txt).*)"],
};
