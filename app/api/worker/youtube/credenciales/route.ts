import { NextResponse, type NextRequest } from "next/server";
import { IMAGE_PROVIDERS } from "@/lib/carousels/images";
import { fail, workerJob } from "@/lib/carousels/worker-api";

/**
 * POST /api/worker/youtube/credenciales — la credencial de imágenes del cliente (sesión de ChatGPT o API key de
 * OpenAI), descifrada, para un YT_THUMBNAILS en curso. Mismo proveedor que Carruseles; con OpenAI se pide 16:9
 * (1536×864, múltiplo de 16) y el worker lo deja en 1280×720. Viaja solo en la respuesta.
 */
export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["YT_THUMBNAILS"]);
  if (gate instanceof NextResponse) return gate;
  const provider = (gate.job.input as { provider?: string }).provider;
  if (provider !== "chatgpt" && provider !== "openai") return fail("Proveedor de imágenes no válido.");
  try {
    const creds = await IMAGE_PROVIDERS[provider === "chatgpt" ? "chatgpt" : "openai-api"].workerCredentials();
    if (!creds) return fail(provider === "chatgpt" ? "Vuelve a conectar tu ChatGPT en Ajustes → Claves de servicios." : "Agrega tu API key de OpenAI en Ajustes → Claves de servicios.");
    return NextResponse.json(provider === "openai" ? { ...creds, size: "1536x864" } : creds, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[worker/youtube/credenciales]", error instanceof Error ? error.message : "error");
    return fail("No pudimos leer la conexión guardada. Vuelve a conectar tu cuenta en Ajustes.");
  }
}
