import { getAnthropicKeyStatus } from "@/lib/dal/anthropic-key";
import { AnthropicKeyPanel } from "./anthropic-key-panel";

/** Ajustes → Claves de servicios: la clave de API de Anthropic del cliente. Solo el dueño la cambia. */
export async function AnthropicKeySection() {
  const status = await getAnthropicKeyStatus();
  return <AnthropicKeyPanel status={status} />;
}
