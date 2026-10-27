import "server-only";
import { readUrl } from "@/lib/storage";
import { faceAnchor, sourceRangesOf } from "../fx/compile";
import { fxBrand } from "../fx-service";
import { brandGraphicLook } from "../graphics";
import { getBrand } from "@/lib/ai/brand-context";
import { buildTimeline } from "../timeline";
import type { EditPlan, MediaInfo, Transcript } from "../types";
import { readDirector } from "../director/types";
import { cleanCompositions, compileComposition, composSegments, type Composition } from "./schema";
import { codeHash, validateComposition } from "./validate";
import { readWork, workView, type WorkView } from "./work";
import { readCopy, type CopyReport } from "./flows";
import { listRequests, type RequestView } from "./requests";

/**
 * Composiciones en el servidor: lo que manda el navegador se vuelve a validar (el código que no estaba en el plan
 * guardado pasa por el sandbox antes de guardarse), las URLs firmadas de sus imágenes y el estado de un pedido en curso.
 */

type ProjectLike = { id: string; plan: unknown; transcript: unknown; media: unknown; eyes: unknown };

/**
 * Las composiciones de una revisión, en las que se puede confiar: forma válida, imágenes solo de este proyecto y código
 * conocido (ya validado en el plan guardado) o que pasa ahora la validación con sus datos reales. Lo demás se descarta.
 */
export async function trustedCompositions(project: ProjectLike, raw: unknown[] | undefined, plan: EditPlan): Promise<unknown[] | undefined> {
  if (!raw) return undefined;
  const transcript = project.transcript as Transcript;
  const media = (project.media ?? {}) as MediaInfo;
  const items = cleanCompositions(raw, transcript.words.length);
  const saved = (project.plan as EditPlan | null)?.compositions ?? [];
  const known = new Set(saved.flatMap((c) => [codeHash(c.code), c.checked ?? ""]).filter(Boolean));
  const out: Composition[] = [];
  let ctx: { timeline: ReturnType<typeof buildTimeline>; brand: ReturnType<typeof fxBrand> } | null = null;
  for (const item of items) {
    // Imágenes: solo las del proyecto (generadas por el worker).
    const images = (item.images ?? []).filter((g) => g.key.startsWith(`editor/${project.id}/compos/`));
    const clean = { ...item, ...(images.length ? { images } : {}) };
    if (!images.length) delete clean.images;
    const hash = codeHash(item.code);
    if (known.has(hash)) {
      out.push({ ...clean, checked: hash });
      continue;
    }
    ctx ??= { timeline: buildTimeline(transcript.words, plan, media.duration || transcript.duration), brand: fxBrand(brandGraphicLook(await getBrand())) };
    const seg = composSegments(ctx.timeline, [clean])[0];
    if (!seg) continue;
    const eyes = project.eyes as { samples?: { t: number; face: { x: number; y: number; w: number; h: number } | null }[] } | null;
    const face = faceAnchor(eyes?.samples ?? [], sourceRangesOf(ctx.timeline, seg.start, seg.end), media.width || 1080, media.height || 1920, plan.format, plan.framing.offset_x);
    const spec = compileComposition({ item: clean, start: seg.start, end: seg.end, timeline: ctx.timeline, format: plan.format, brand: ctx.brand, face, captionsVisible: plan.captions.preset !== "ninguno" });
    const check = await validateComposition(clean.code, spec.compos!.env);
    if (check.ok) out.push({ ...clean, checked: check.hash });
    else console.warn(`[composiciones] se descartó una animación que no pasó la validación: ${check.error.slice(0, 200)}`);
  }
  return out;
}

/** URLs firmadas de las imágenes generadas de las composiciones (para la vista previa). */
export async function composImageUrls(plans: (EditPlan | null | undefined)[], extra: { id: string; key: string }[] = []): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const all = [...plans.flatMap((p) => (p?.compositions ?? []).flatMap((c) => c.images ?? [])), ...extra];
  for (const g of all) {
    if (out[g.id]) continue;
    try {
      out[g.id] = await readUrl(g.key);
    } catch {
      /* sin URL: la animación dibuja su respaldo */
    }
  }
  return out;
}

export type ComposStatus = {
  /** Pedidos del Estudio (varios a la vez): en curso y terminados sin entregar. */
  requests: RequestView[];
  work: WorkView | null;
  /** Las animaciones que terminó el taller (para ponerlas en la revisión abierta). */
  made: Composition[];
  images: Record<string, string>;
  copy: CopyReport | null;
};

/** Estado del taller de un proyecto (lo consulta el Estudio mientras hay un pedido en curso). */
export async function composStatus(project: ProjectLike & { director: unknown }): Promise<ComposStatus> {
  const director = readDirector(project.director);
  const work = readWork(director);
  const made = work?.done ? work.tasks.filter((t) => t.status === "done" && t.result).map((t) => t.result!) : [];
  const requests = await listRequests(project.id);
  const images = await composImageUrls([project.plan as EditPlan | null], [...made, ...requests.flatMap((r) => r.made)].flatMap((m) => m.images ?? []));
  return { requests, work: workView(work), made, images, copy: readCopy(director)?.report ?? null };
}
