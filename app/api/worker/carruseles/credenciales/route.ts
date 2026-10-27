import { NextResponse, type NextRequest } from "next/server";
import { IMAGE_PROVIDERS, isImageProviderId } from "@/lib/carousels/images";
import { fail, workerJob } from "@/lib/carousels/worker-api";

/**
 * POST /api/worker/carruseles/credenciales — la API key de OpenAI del cliente, descifrada, para un CAROUSEL_IMAGES en curso. Viaja solo en la respuesta; el worker no la guarda ni la loguea.
 */
export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["CAROUSEL_IMAGES"]);
  if (gate instanceof NextResponse) return gate;
  const provider = (gate.job.input as { provider?: string }).provider;
  if (!isImageProviderId(provider)) return fail("Agrega tu API key de OpenAI en Ajustes → Claves de servicios y vuelve a generar.");
  try {
    const creds = await IMAGE_PROVIDERS[provider].workerCredentials();
    if (!creds) return fail("Agrega tu API key de OpenAI en Ajustes → Claves de servicios.");
    return NextResponse.json(creds, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[worker/carruseles/credenciales]", error instanceof Error ? error.message : "error");
    return fail("No pudimos leer la conexión guardada. Revisa tu API key de OpenAI en Ajustes.");
  }
}
