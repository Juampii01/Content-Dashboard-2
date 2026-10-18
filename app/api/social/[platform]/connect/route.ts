import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { lt } from "drizzle-orm";
import { getOptionalUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { authorizeUrl, platformConfigured } from "@/lib/social/providers";
import { platformFromSlug } from "@/lib/social/types";

/**
 * GET /api/social/{instagram|youtube|tiktok}/connect
 * Solo el dueño conecta redes. Guarda un estado de un solo uso (10 minutos) y manda a la red a pedir permiso.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/social/[platform]/connect">) {
  const settings = new URL("/ajustes", request.nextUrl.origin);
  const user = await getOptionalUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));

  const platform = platformFromSlug((await params).platform);
  if (!platform) return NextResponse.json({ error: "Red no válida." }, { status: 404 });
  if (user.role !== "OWNER") {
    settings.searchParams.set("error", "solo-dueno");
    return NextResponse.redirect(settings);
  }
  if (!platformConfigured(platform)) {
    settings.searchParams.set("error", "sin-configurar");
    settings.searchParams.set("red", platform);
    return NextResponse.redirect(settings);
  }

  const db = getDb();
  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, new Date()));
  const state = randomBytes(24).toString("base64url");
  await db.insert(schema.oauthStates).values({ state, platform, createdBy: user.id, expiresAt: new Date(Date.now() + 10 * 60_000) });

  return NextResponse.redirect(authorizeUrl(platform, state));
}
