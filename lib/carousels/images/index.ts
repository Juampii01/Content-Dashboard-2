import "server-only";
import { env } from "@/lib/env";
import { credentialRow, readSecret, type ImageCredentialKind } from "./credentials";

/**
 * Proveedor de imágenes para los slides, las miniaturas y las animaciones. Las imágenes van siempre **sin texto** (el
 * texto lo dibuja la plantilla) y se generan en el worker, nunca en una función de Vercel.
 *
 * - `openai-api`: API de imágenes de OpenAI con la API key del cliente. Es el único: la cuenta de ChatGPT (Codex) no
 *   se puede usar dentro de un producto de terceros.
 *
 * El proveedor sabe qué credencial usa y qué le manda al worker (descifrado, solo en memoria, dentro de un trabajo en
 * curso). Para sumar otro (por ejemplo, otro modelo de imágenes), se agrega aquí y en worker/carruseles/trabajos.py.
 */
export type ImageProviderId = "openai-api";

export interface ImageProvider {
  id: ImageProviderId;
  label: string;
  credential: ImageCredentialKind;
  /** Lo que necesita el worker para generar. */
  workerCredentials(): Promise<Record<string, unknown> | null>;
}

const openaiApi: ImageProvider = {
  id: "openai-api",
  label: "Tu API key de OpenAI",
  credential: "OPENAI",
  async workerCredentials() {
    const apiKey = await readSecret("OPENAI");
    // 1088×1360: 4:5 exacto y múltiplo de 16, como piden los modelos gpt-image-2.x para tamaños propios.
    return apiKey ? { provider: "openai", apiKey, baseUrl: env().OPENAI_API_BASE, model: env().OPENAI_IMAGE_MODEL, size: "1088x1360", quality: "medium" } : null;
  },
};

export const IMAGE_PROVIDERS: Record<ImageProviderId, ImageProvider> = { "openai-api": openaiApi };

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return value === "openai-api";
}

export type ImageProvidersStatus = {
  openai: { configured: boolean; label: string | null; updatedAt: string | null };
  /** El que se usa: la API key de OpenAI si está; si no, ninguno (sin imágenes). */
  preferred: ImageProviderId | null;
};

export async function providersStatus(): Promise<ImageProvidersStatus> {
  const o = await credentialRow("OPENAI");
  return {
    openai: { configured: Boolean(o), label: o?.label ?? null, updatedAt: o?.updatedAt.toISOString() ?? null },
    preferred: o ? "openai-api" : null,
  };
}
