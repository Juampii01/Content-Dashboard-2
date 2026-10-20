import { getImageKeysStatus } from "@/lib/dal/carousels";
import { ImageKeysPanel } from "./image-keys-panel";

/** Ajustes → Claves de servicios: ChatGPT (imágenes con la cuenta del cliente) y API key de OpenAI (respaldo). */
export async function ImageKeysSection() {
  const status = await getImageKeysStatus();
  return <ImageKeysPanel status={status} />;
}

export function ImageKeysSectionSkeleton() {
  return (
    <div aria-hidden className="grid gap-4 lg:grid-cols-2">
      <div className="skeleton h-40" />
      <div className="skeleton h-40" />
    </div>
  );
}
