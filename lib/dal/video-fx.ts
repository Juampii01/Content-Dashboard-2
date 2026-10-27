import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { ensureFxMasks, fxThumbs, type FxMaskView, type FxThumb } from "@/lib/video/fx-service";
import { loadProject } from "@/lib/video/service";
import { composImageUrls } from "@/lib/video/compos/service";
import { buildTimeline } from "@/lib/video/timeline";
import type { EditPlan, MediaInfo, Transcript } from "@/lib/video/types";

/**
 * Lo que necesita la revisión para previsualizar los efectos: la cara medida por el worker (los "ojos", para ubicar los
 * efectos igual que el render), las miniaturas de tus reels y el recorte de la persona (tiras de máscaras firmadas).
 */
export type FxContext = {
  faces: { t: number; face: { x: number; y: number; w: number; h: number } | null }[];
  thumbs: FxThumb[];
  masks: FxMaskView | null;
  /** URLs firmadas de las imágenes generadas de las animaciones (por id de imagen). */
  composImages: Record<string, string>;
};

export async function getFxContext(projectId: string): Promise<FxContext | null> {
  await getCurrentUser();
  const project = await loadProject(projectId);
  if (!project?.plan || !project.transcript) return null;
  const eyes = project.eyes as { samples?: { t: number; face: FxContext["faces"][number]["face"] }[] } | null;
  const faces = (eyes?.samples ?? []).map((s) => ({ t: s.t, face: s.face ? { x: s.face.x, y: s.face.y, w: s.face.w, h: s.face.h } : null }));
  return { faces, thumbs: await fxThumbs(), masks: await fxMasks(projectId, false), composImages: await composImageUrls([project.plan as EditPlan]) };
}

/** Estado del recorte para la vista previa (con `enqueue`, pide al worker lo que falta). */
export async function fxMasks(projectId: string, enqueue: boolean, userId: string | null = null): Promise<FxMaskView | null> {
  const project = await loadProject(projectId);
  if (!project?.plan || !project.transcript) return null;
  const plan = project.plan as EditPlan;
  const media = (project.media ?? {}) as MediaInfo;
  const transcript = project.transcript as Transcript;
  const timeline = buildTimeline(transcript.words, plan, media.duration || transcript.duration);
  return ensureFxMasks({ projectId, plan, timeline, media, userId, enqueue });
}
