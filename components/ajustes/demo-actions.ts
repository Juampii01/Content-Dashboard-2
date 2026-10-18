"use server";

import { refresh } from "next/cache";
import { isDenied, requireOwner } from "@/lib/auth";
import { clearDemo, loadDemo } from "@/lib/demo";

export type DemoState = { ok?: boolean; error?: string; message?: string };

export async function loadDemoAction(): Promise<DemoState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const loaded = await loadDemo();
  refresh();
  return loaded.length
    ? { ok: true, message: "Listo. Cargamos 6 meses de contenido de ejemplo. Mira Inicio y Métricas." }
    : { error: "Todas las redes ya tienen una cuenta real conectada: la demo no se mezcla con datos reales." };
}

export async function clearDemoAction(): Promise<DemoState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const n = await clearDemo();
  refresh();
  return { ok: true, message: n ? "Listo. Borramos los datos de demostración." : "No había datos de demostración." };
}
