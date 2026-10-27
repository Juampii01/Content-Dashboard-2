"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireOwner } from "@/lib/auth";
import { removeScrapeCreatorsKey, saveScrapeCreatorsKey, ScrapeCreatorsKeyError, testSavedScrapeCreatorsKey } from "@/lib/scrapecreators/key";

export type ScrapeCreatorsKeyState = { ok?: boolean; credits?: number | null; error?: string };

const keySchema = z.string().trim().min(16, "Esa clave es demasiado corta. Cópiala completa.").max(300, "Esa clave es demasiado larga. Revisa que copiaste solo la clave.");

/** Solo el dueño: prueba la clave con ScrapeCreators (sin gastar créditos) y la guarda cifrada. */
export async function saveScrapeCreatorsKeyAction(_prev: ScrapeCreatorsKeyState, formData: FormData): Promise<ScrapeCreatorsKeyState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const parsed = keySchema.safeParse(String(formData.get("apiKey") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    const { credits } = await saveScrapeCreatorsKey(parsed.data, owner.id);
    refresh();
    return { ok: true, credits };
  } catch (error) {
    if (error instanceof ScrapeCreatorsKeyError) return { error: error.message };
    console.error("[scrapecreators] guardar clave:", error instanceof Error ? error.message : "error");
    return { error: "No pudimos guardar la clave. Vuelve a intentarlo en unos minutos." };
  }
}

/** «Probar»: créditos que quedan con la clave guardada. No gasta créditos. */
export async function testScrapeCreatorsKeyAction(): Promise<ScrapeCreatorsKeyState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  try {
    return { ok: true, credits: await testSavedScrapeCreatorsKey() };
  } catch (error) {
    if (error instanceof ScrapeCreatorsKeyError) return { error: error.message };
    console.error("[scrapecreators] probar clave:", error instanceof Error ? error.message : "error");
    return { error: "No pudimos probar la clave. Vuelve a intentarlo en unos minutos." };
  }
}

export async function removeScrapeCreatorsKeyAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await removeScrapeCreatorsKey();
  refresh();
  return { ok: true };
}
