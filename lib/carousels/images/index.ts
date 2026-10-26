import "server-only";
import { env } from "@/lib/env";
import { credentialRow, readSecret, type ImageCredentialKind } from "./credentials";

/**
 * Proveedores de imágenes para los slides. Las imágenes van siempre **sin texto** (el texto lo dibuja la plantilla)
 * y se generan en el worker, nunca en una función de Vercel.
 *
 * - `chatgpt` (por defecto): Codex CLI en el worker con la cuenta de ChatGPT del propio cliente.
 * - `openai-api` (respaldo): API de imágenes de OpenAI con la API key del cliente.
 *
 * Cada proveedor sabe qué credencial usa y qué le manda al worker (descifrado, solo en memoria, dentro de un
 * trabajo en curso). Para sumar otro (por ejemplo, otro modelo de imágenes), se agrega aquí y en
 * worker/carruseles/trabajos.py.
 */
export type ImageProviderId = "chatgpt" | "openai-api";

export interface ImageProvider {
  id: ImageProviderId;
  label: string;
  credential: ImageCredentialKind;
  /** Lo que necesita el worker para generar. */
  workerCredentials(): Promise<Record<string, unknown> | null>;
}

const chatgpt: ImageProvider = {
  id: "chatgpt",
  label: "Tu cuenta de ChatGPT",
  credential: "CHATGPT",
  async workerCredentials() {
    const authJson = await readSecret("CHATGPT");
    return authJson ? { provider: "chatgpt", authJson, model: env().CODEX_MODEL, effort: "medium" } : null;
  },
};

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

export const IMAGE_PROVIDERS: Record<ImageProviderId, ImageProvider> = { chatgpt, "openai-api": openaiApi };

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return value === "chatgpt" || value === "openai-api";
}

export type ImageProvidersStatus = {
  chatgpt: { configured: boolean; label: string | null; updatedAt: string | null };
  openai: { configured: boolean; label: string | null; updatedAt: string | null };
  /** El que se usa si no se elige otro: ChatGPT si está conectado; si no, la API key. */
  preferred: ImageProviderId | null;
};

export async function providersStatus(): Promise<ImageProvidersStatus> {
  const [c, o] = await Promise.all([credentialRow("CHATGPT"), credentialRow("OPENAI")]);
  return {
    chatgpt: { configured: Boolean(c), label: c?.label ?? null, updatedAt: c?.updatedAt.toISOString() ?? null },
    openai: { configured: Boolean(o), label: o?.label ?? null, updatedAt: o?.updatedAt.toISOString() ?? null },
    // Solo la clave de API de OpenAI: la cuenta de ChatGPT (Codex) ya no se usa en un producto de terceros.
    preferred: o ? "openai-api" : null,
  };
}
