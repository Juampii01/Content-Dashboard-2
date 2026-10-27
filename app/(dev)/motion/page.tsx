import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionGallery } from "./gallery";

export const metadata: Metadata = { title: "Galería de motion graphics (solo desarrollo)" };

/**
 * Galería del motor de motion graphics: todos los componentes animados en 9:16 y 16:9, pantalla completa y sobre
 * el video, con varios temas de marca. Solo existe en desarrollo (en producción responde 404).
 */
export default function MotionGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MotionGallery />;
}
