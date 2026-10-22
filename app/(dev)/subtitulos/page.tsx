import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaptionLab } from "./lab";

export const metadata: Metadata = { title: "Subtítulos animados (solo desarrollo)" };

/**
 * Banco de pruebas de la galería de subtítulos: dibuja un estilo a tamaño real (1080×1920 o 1920×1080) en un instante
 * fijo, para compararlo cuadro a cuadro con el render del worker. `?style=caja&t=2.9&format=9:16&accent=%230070F8`.
 * Solo existe en desarrollo (en producción responde 404).
 */
export default function CaptionLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CaptionLab />;
}
