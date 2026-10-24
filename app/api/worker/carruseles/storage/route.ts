import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ANIM_KEY_RE, REF_KEY_RE, SLIDE_KEY_RE } from "@/lib/carousels/files";
import { PHOTO_KEY_RE } from "@/lib/youtube/files";
import { fail, workerJob } from "@/lib/carousels/worker-api";
import { fileDriver, workerTransfer } from "@/lib/storage";

/**
 * POST /api/worker/carruseles/storage — acceso de corta duración a un archivo para un trabajo de Carruseles.
 * - CAROUSEL_STYLE: solo leer las referencias de su plantilla (`carruseles-ref/<plantilla>/NN.ext`).
 * - CAROUSEL_COPY: solo leer los slides subidos de su copia (`carruseles-ref/<copia>/NN.ext`).
 * - CAROUSEL_IMAGES: leer la referencia de estilo, las fotos del personaje y la imagen a corregir que nombra el trabajo,
 *   y subir las imágenes de sus slides (`carruseles/<carrusel>/<slide>-<azar>.ext`).
 * - CAROUSEL_ANIMATE: leer el slide dibujado y subir su video (`carruseles/<carrusel>/anim/<slide>-<azar>.mp4`).
 */
const body = z.object({ key: z.string().min(3).max(300), op: z.enum(["get", "put"]), contentType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4"]).optional() });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["CAROUSEL_STYLE", "CAROUSEL_IMAGES", "CAROUSEL_COPY", "CAROUSEL_ANIMATE"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Pedido no válido.", 400);
  const { key, op, contentType } = parsed.data;
  if (!fileDriver()) return fail("Falta configurar el almacenamiento de archivos.", 503, true);
  const input = gate.job.input as {
    templateId?: string;
    copyId?: string;
    carouselId?: string;
    slideId?: string;
    sourceKey?: string;
    styleRefKey?: string | null;
    items?: { slideId: string; characterKeys?: string[]; editKey?: string | null }[];
  };

  let allowed = false;
  if (gate.job.type === "CAROUSEL_STYLE") {
    allowed = op === "get" && REF_KEY_RE.test(key) && key.startsWith(`carruseles-ref/${input.templateId}/`);
  } else if (gate.job.type === "CAROUSEL_COPY") {
    allowed = op === "get" && REF_KEY_RE.test(key) && key.startsWith(`carruseles-ref/${input.copyId}/`);
  } else if (gate.job.type === "CAROUSEL_ANIMATE") {
    allowed =
      op === "get"
        ? key === input.sourceKey && ANIM_KEY_RE.test(key)
        : ANIM_KEY_RE.test(key) && key.endsWith(".mp4") && key.startsWith(`carruseles/${input.carouselId}/anim/${input.slideId}-`) && contentType === "video/mp4";
  } else if (op === "get") {
    const items = input.items ?? [];
    allowed =
      (Boolean(input.styleRefKey) && key === input.styleRefKey) ||
      (PHOTO_KEY_RE.test(key) && items.some((i) => i.characterKeys?.includes(key))) ||
      (SLIDE_KEY_RE.test(key) && key.startsWith(`carruseles/${input.carouselId}/`) && items.some((i) => i.editKey === key));
  } else {
    const slideId = key.split("/")[2]?.replace(/-[0-9a-f]{8}\.\w+$/i, "");
    allowed = SLIDE_KEY_RE.test(key) && key.startsWith(`carruseles/${input.carouselId}/`) && Boolean(input.items?.some((i) => i.slideId === slideId));
  }
  if (!allowed) return fail("Ese archivo no es de este trabajo.", 403);
  try {
    return NextResponse.json(await workerTransfer(key, op, contentType));
  } catch (error) {
    console.error("[worker/carruseles/storage]", error instanceof Error ? error.message : error);
    return fail("No se pudo preparar el acceso al archivo.", 500, true);
  }
}
