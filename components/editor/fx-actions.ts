"use server";

import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { fxMasks } from "@/lib/dal/video-fx";
import type { FxMaskView } from "@/lib/video/fx-service";

const idSchema = z.uuid();

/**
 * Recorte de la persona para la vista previa de los efectos: devuelve las tiras listas (URLs firmadas) y, si faltan
 * segundos, se los pide al worker (trabajo VIDEO_FX). La revisión lo consulta cada pocos segundos mientras falte algo.
 */
export async function fxMasksAction(projectId: string): Promise<{ ok: true; data: FxMaskView | null } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  try {
    return { ok: true, data: await fxMasks(projectId, true, user.id) };
  } catch (error) {
    console.error("[efectos] recorte:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos consultar el recorte. Prueba de nuevo." };
  }
}
