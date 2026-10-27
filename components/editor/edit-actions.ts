"use server";

import { z } from "zod";
import { aiConfigured, withAiScope } from "@/lib/ai/client";
import { isDenied, requireEditor } from "@/lib/auth";
import { loadProject, suggestTrim, transcribeAgain, VideoError } from "@/lib/video/service";
import type { BrollOption, Transcript } from "@/lib/video/types";
import { loadClip, pieceOf } from "@/lib/video/library";
import { pieceOption } from "@/lib/video/library-ficha";
import { signBrollOptions, type SignedOption } from "@/lib/dal/editor-media";

/**
 * Acciones de la pestaña Edición del Estudio: cada herramienta corre por separado sobre el video limpio.
 * Ninguna guarda nada: devuelven lo que la revisión aplica (y se deshace con Ctrl+Z) y se guarda con el resto.
 */

type Fail = { ok: false; error: string };

/** «Recortar»: las palabras que cortaría el editor (silencios, tomas repetidas, arranques en falso y muletillas). */
export async function suggestTrimAction(projectId: string): Promise<{ ok: true; removed: number[]; planned: "ai" | "auto" } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Datos no válidos." };
  const project = await loadProject(projectId);
  if (!project || !(project.transcript as Transcript | null)?.words?.length) return { ok: false, error: "Este video todavía no tiene transcripción." };
  try {
    const r = await withAiScope(projectId, () => suggestTrim(project), { userId: user.id });
    return { ok: true, ...r };
  } catch (error) {
    if (error instanceof VideoError) return { ok: false, error: error.message };
    console.error("[editor] recortar:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos buscar los recortes. Prueba de nuevo." };
  }
}

/** «Subtitular» cuando el video no tiene transcripción: la vuelve a crear (el video pasa a procesarse). */
export async function transcribeAgainAction(projectId: string): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Datos no válidos." };
  try {
    await transcribeAgain(projectId, user.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof VideoError) return { ok: false, error: error.message };
    console.error("[editor] transcribir de nuevo:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos crear la transcripción. Prueba de nuevo." };
  }
}

import { editAssistantInput, runEditAssistant, type AssistantItem } from "@/lib/video/edit-assistant";
const assistantInput = editAssistantInput;
export type { AssistantItem };

/**
 * Asistente de pedidos: lo que dice la persona → pedidos bien armados para animaciones o gráficos, con su tramo. Un
 * video adjunto se mira antes (cuadros y ficha): mientras tanto responde `waiting` y el cliente vuelve a pedir.
 */
export async function editAssistantAction(input: z.input<typeof assistantInput>): Promise<{ ok: true; items: AssistantItem[]; note: string; waiting?: string[] } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = assistantInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación." };
  return runEditAssistant(parsed.data, user.id);
}

const clipMetaSchema = z.object({ duration: z.number().min(0).max(3600), width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192) });

/**
 * Un clip que se acaba de subir a la biblioteca, como alternativa de b-roll para ponerlo ya en un tramo. Mientras el
 * worker lo prepara (miniatura, duración) se usan los datos que leyó el navegador; al renderizar, los de la base.
 */
export async function clipOptionAction(clipId: string, meta: z.input<typeof clipMetaSchema>): Promise<{ ok: true; option: SignedOption } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const m = clipMetaSchema.safeParse(meta);
  if (!z.uuid().safeParse(clipId).success || !m.success) return { ok: false, error: "Clip no válido." };
  const clip = await loadClip(clipId);
  if (!clip || clip.status === "UPLOADING" || clip.status === "FAILED") return { ok: false, error: clip?.status === "FAILED" ? "No pudimos preparar ese clip. Súbelo de nuevo." : "El clip todavía no terminó de subir." };
  // Lista: con su tipo (una imagen es b-roll fijo). Recién subido: con lo que midió el navegador.
  const option: BrollOption =
    clip.status === "READY"
      ? pieceOption(pieceOf(clip))
      : {
          source: "library",
          id: clip.id,
          duration: clip.duration ?? m.data.duration,
          width: clip.width ?? m.data.width,
          height: clip.height ?? m.data.height,
          key: clip.fileKey,
          thumbKey: clip.thumbKey,
          title: clip.title,
        };
  const [signed] = await signBrollOptions([option]);
  return signed ? { ok: true, option: signed } : { ok: false, error: "No pudimos preparar el clip." };
}
