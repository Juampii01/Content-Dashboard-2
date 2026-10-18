import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UiShowcase } from "./showcase";

export const metadata: Metadata = { title: "Sistema de diseño (solo desarrollo)" };

/**
 * Vitrina del sistema de diseño con datos de ejemplo. Solo existe en desarrollo:
 * en producción responde 404 y no se enlaza desde ninguna parte.
 */
export default function UiShowcasePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiShowcase />;
}
