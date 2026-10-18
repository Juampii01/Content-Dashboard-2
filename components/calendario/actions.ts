"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { AiError } from "@/lib/ai/client";
import { isDay, isTime } from "@/lib/calendar/dates";
import { CALENDAR_STATUSES, PLANNED_FORMATS, PLATFORMS } from "@/lib/calendar/labels";
import { acceptSuggestion, LinkError, linkTarget, rejectSuggestion, unlinkTarget } from "@/lib/calendar/linking";
import { buildWeekPlan, PlanError, type PlanIdea } from "@/lib/calendar/plan";
import { CalendarError, createEntry, createIdeas, deleteEntry, moveEntry, scheduleFromSource, updateEntry, type SourceKind } from "@/lib/calendar/service";
import { linkCandidates, searchScripts } from "@/lib/dal/calendar";

/**
 * Acciones del Calendario. Cada una valida la sesión (requireEditor) y los datos (Zod) antes de escribir.
 * Mover una pieza no refresca la página: el cliente ya la movió (actualización optimista) y, si falla, vuelve atrás.
 */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(error: unknown, fallback = "Algo salió mal. Prueba de nuevo."): { ok: false; error: string } {
  if (error instanceof AiError) {
    console.error("[ia]", error.detail);
    return { ok: false, error: error.userMessage };
  }
  if (error instanceof CalendarError || error instanceof LinkError || error instanceof PlanError) return { ok: false, error: error.message };
  console.error("[calendario]", error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

const uuid = z.string().uuid();
const day = z.string().refine(isDay, "La fecha no es válida.");
const time = z.string().refine(isTime, "La hora no es válida (usa HH:MM).");
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const entrySchema = z.object({
  id: uuid.optional(),
  title: z.string().trim().min(2, "Ponle un título a la pieza.").max(160, "El título es demasiado largo (máximo 160 caracteres)."),
  notes: optionalText(4000, "Las notas son demasiado largas."),
  hook: optionalText(600, "El gancho es demasiado largo (máximo 600 caracteres)."),
  pillar: optionalText(120, "El pilar es demasiado largo."),
  format: z.enum(PLANNED_FORMATS),
  status: z.enum(CALENDAR_STATUSES),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Elige al menos una red de destino.").max(3),
  scheduledDate: day.nullable(),
  scheduledTime: time.nullable(),
  scriptId: uuid.nullable(),
  carouselId: uuid.nullable().optional(),
  cloneVideoId: uuid.nullable().optional(),
  videoProjectId: uuid.nullable().optional(),
  source: z.enum(["manual", "guion", "carrusel", "clon", "editor", "plan"]).optional(),
});
export type EntryForm = z.input<typeof entrySchema>;

export async function saveEntryAction(input: EntryForm): Promise<ActionResult<{ id: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const { id, ...data } = parsed.data;
  try {
    if (id) await updateEntry(id, data);
    const newId = id ?? (await createEntry(data, user.id));
    refresh();
    return { ok: true, data: { id: newId } };
  } catch (error) {
    return fail(error, "No pudimos guardar la pieza. Prueba de nuevo.");
  }
}

export async function moveEntryAction(id: string, date: string | null, time?: string | null): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success || (date !== null && !isDay(date)) || (time != null && !isTime(time))) return { ok: false, error: "No pudimos mover la pieza: datos no válidos." };
  try {
    await moveEntry(id, date, time);
    return { ok: true };
  } catch (error) {
    return fail(error, "No pudimos mover la pieza. Volvió a su lugar.");
  }
}

export async function deleteEntryAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pieza no válida." };
  try {
    await deleteEntry(id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "No pudimos borrar la pieza. Prueba de nuevo.");
  }
}

export async function searchScriptsAction(q: string): Promise<ActionResult<Awaited<ReturnType<typeof searchScripts>>>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  try {
    return { ok: true, data: await searchScripts(String(q ?? "")) };
  } catch (error) {
    return fail(error, "No pudimos buscar guiones.");
  }
}

// ─── Vínculo con las piezas publicadas ─────────────────────────────────────

export async function linkCandidatesAction(targetId: string): Promise<ActionResult<Awaited<ReturnType<typeof linkCandidates>>>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(targetId).success) return { ok: false, error: "Destino no válido." };
  try {
    return { ok: true, data: await linkCandidates(targetId) };
  } catch (error) {
    return fail(error, "No pudimos buscar tus publicaciones.");
  }
}

async function linkOp(targetId: string, op: () => Promise<void>, fallback: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(targetId).success) return { ok: false, error: "Destino no válido." };
  try {
    await op();
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, fallback);
  }
}

export async function acceptSuggestionAction(targetId: string): Promise<ActionResult> {
  return linkOp(targetId, () => acceptSuggestion(targetId), "No pudimos vincular la pieza.");
}

export async function rejectSuggestionAction(targetId: string): Promise<ActionResult> {
  return linkOp(targetId, () => rejectSuggestion(targetId), "No pudimos descartar la sugerencia.");
}

export async function linkTargetAction(targetId: string, itemId: string): Promise<ActionResult> {
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "Publicación no válida." };
  return linkOp(targetId, () => linkTarget(targetId, itemId), "No pudimos vincular la pieza.");
}

export async function unlinkTargetAction(targetId: string): Promise<ActionResult> {
  return linkOp(targetId, () => unlinkTarget(targetId), "No pudimos desvincular la pieza.");
}

// ─── Plan semanal con IA ───────────────────────────────────────────────────

export async function planWeekAction(): Promise<ActionResult<{ weekStart: string; ideas: PlanIdea[] }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  try {
    return { ok: true, data: await buildWeekPlan(user.id) };
  } catch (error) {
    return fail(error, "No pudimos armar el plan. Prueba de nuevo.");
  }
}

const planIdeas = z
  .array(
    z.object({
      title: z.string().trim().min(2).max(160),
      hook: z.string().trim().max(600),
      pillar: z.string().trim().max(120).nullable(),
      format: z.enum(PLANNED_FORMATS),
      platforms: z.array(z.enum(PLATFORMS)).min(1).max(3),
      date: day.nullable(),
      why: z.string().trim().max(400).optional(),
    }),
  )
  .min(1, "Elige al menos una idea.")
  .max(7);

export async function acceptPlanAction(ideas: z.input<typeof planIdeas>): Promise<ActionResult<{ created: number }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = planIdeas.safeParse(ideas);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa las ideas." };
  try {
    const ids = await createIdeas(
      parsed.data.map((i) => ({
        title: i.title,
        hook: i.hook || null,
        pillar: i.pillar,
        format: i.format,
        platforms: i.platforms,
        scheduledDate: i.date,
        notes: i.why ? `Por qué: ${i.why}` : null,
      })),
      user.id,
    );
    refresh();
    return { ok: true, data: { created: ids.length } };
  } catch (error) {
    return fail(error, "No pudimos crear las ideas. Prueba de nuevo.");
  }
}

// ─── Para otros módulos ────────────────────────────────────────────────────

const sourceKinds = ["guion", "carrusel", "clon", "editor"] as const;

/**
 * "Enviar a Calendario" desde Guiones, Carruseles, Clon o Editor.
 * Crea la pieza (sin fecha si no se indica) o devuelve la que ya existía para esa fuente.
 * Uso: `const res = await scheduleFromSourceAction("guion", scriptId)` y luego
 * `router.push(res.data.scheduledDate ? `/calendario?fecha=${res.data.scheduledDate}` : "/calendario")`.
 */
export async function scheduleFromSourceAction(
  kind: SourceKind,
  id: string,
  date?: string | null,
): Promise<ActionResult<{ entryId: string; created: boolean; scheduledDate: string | null }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!sourceKinds.includes(kind) || !uuid.safeParse(id).success || (date != null && !isDay(date))) return { ok: false, error: "No pudimos enviarlo al calendario: datos no válidos." };
  try {
    const out = await scheduleFromSource({ kind, id, date: date ?? null, userId: user.id });
    refresh();
    return { ok: true, data: out };
  } catch (error) {
    return fail(error, "No pudimos enviarlo al calendario. Prueba de nuevo.");
  }
}
