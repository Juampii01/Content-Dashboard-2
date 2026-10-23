"use server";

import { z } from "zod";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { aiConfigured, withAiScope } from "@/lib/ai/client";
import { isDenied, requireEditor } from "@/lib/auth";
import { loadProject, scriptText } from "@/lib/video/service";
import { proofreadTranscript } from "@/lib/video/transcript-fix";
import type { Transcript } from "@/lib/video/types";

/**
 * "Revisar ortografía con IA" en la revisión: busca las palabras mal transcritas y devuelve sus correcciones.
 * No guarda nada: la revisión las suma a lo que ya corrigió la persona y se guardan con el resto.
 */
export async function proofreadAction(projectId: string): Promise<{ ok: true; fixes: Record<string, string> } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Datos no válidos." };
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación." };
  const project = await loadProject(projectId);
  const words = (project?.transcript as Transcript | null)?.words;
  if (!project || !words?.length) return { ok: false, error: "Este video todavía no tiene transcripción." };
  const brand = await getBrand();
  const fixes = await withAiScope(projectId, async () => proofreadTranscript({ words, brandCtx: await brandContext(brand), script: await scriptText(project.scriptId) }));
  return { ok: true, fixes };
}
