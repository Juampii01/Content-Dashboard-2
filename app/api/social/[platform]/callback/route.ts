import { after, NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getOptionalUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { saveConnection } from "@/lib/social/connections";
import { exchangeCode } from "@/lib/social/providers";
import { syncAccount } from "@/lib/social/sync/runner";
import { platformFromSlug, platformSlug, SocialApiError } from "@/lib/social/types";

export const maxDuration = 300;

/**
 * GET /api/social/{red}/callback
 * Valida el estado (un solo uso, del mismo usuario, de la misma red y vigente), cambia el código por tokens,
 * guarda la conexión y arranca la importación del histórico después de responder.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/social/[platform]/callback">) {
  const settings = new URL("/ajustes", request.nextUrl.origin);
  const fail = (code: string, detail?: string) => {
    settings.searchParams.set("error", code);
    if (detail) settings.searchParams.set("detalle", detail.slice(0, 200));
    return NextResponse.redirect(settings);
  };

  const platform = platformFromSlug((await params).platform);
  if (!platform) return fail("red-invalida");
  settings.searchParams.set("red", platform);

  const user = await getOptionalUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));

  const query = request.nextUrl.searchParams;
  const state = query.get("state");
  const code = query.get("code");

  // El estado se borra al leerlo: no se puede usar dos veces.
  const [stored] = state ? await getDb().delete(schema.oauthStates).where(eq(schema.oauthStates.state, state)).returning() : [];
  if (!stored || stored.platform !== platform || stored.createdBy !== user.id || stored.expiresAt < new Date()) {
    return fail("estado-invalido");
  }
  if (query.get("error") || !code) {
    // El usuario canceló o rechazó los permisos en la red.
    return fail("cancelado");
  }

  try {
    const connection = await exchangeCode(platform, code);
    const { accountId } = await saveConnection(platform, connection, user.id);
    after(async () => {
      await syncAccount(accountId, "BACKFILL", 270_000);
    });
    settings.searchParams.delete("red");
    settings.searchParams.set("conectado", platformSlug[platform]);
    return NextResponse.redirect(settings);
  } catch (error) {
    if (error instanceof SocialApiError) {
      console.error(`[oauth] ${platform}:`, error.detail);
      return fail("conexion", error.userMessage);
    }
    console.error(`[oauth] ${platform}:`, error instanceof Error ? error.message : error);
    return fail("conexion");
  }
}
