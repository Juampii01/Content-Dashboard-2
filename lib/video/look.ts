import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { AiError, aiConfigured, generateStructured } from "@/lib/ai/client";
import { COPY_RULES, recipeTask, recipeWireSchema, type RecipeWire } from "@/lib/ai/prompts/compos";
import { LOOK_RULES, lookTurnSchema, lookTurnTask, type LookTurn } from "@/lib/ai/prompts/mirar";
import { sentences } from "@/lib/ai/prompts/editor";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { deleteKeys, fileInfo } from "@/lib/storage";
import { fakeRecipe } from "./compos/fake";
import { keptWords, momentDetail, sentencesText, sheetImages, startStudioRequest, type RecipeMoment } from "./compos/flows";
import { loadWorkCtx } from "./compos/work";
import { referenceSummary, type ReferenceMoment, type ReferenceSheet, type ReferenceSource } from "./director/reference";
import { isReferenceLink } from "./director/request";
import { readDirector } from "./director/types";
import { outputRange } from "./timeline";
import { styleMetricsSchema } from "./style";

/**
 * «Mira este video y dime qué ves»: la persona pega un link (o sube un video) de una edición que le gusta. El worker lo
 * baja y lo mide (VIDEO_LOOK: cuadros densos y hojas, como "Copiar edición"), Claude lo desarma en momentos (la receta)
 * y le cuenta qué ve y dónde lo pondría en su video. Conversan (la charla queda guardada) y, al «Aplicar», cada
 * momento elegido es un pedido de animación con sus cuadros de la referencia. El video de referencia nunca se guarda.
 */
export class LookError extends Error {}

export type LookStatus = "queued" | "analyzing" | "thinking" | "ready" | "failed";
export type LookItem = { moment: string; include: boolean; from_word: number; to_word: number; brief: string; why: string };
type LookMessage = { role: "user" | "assistant" | "applied"; text: string; at: string };
type LookData = { metrics: unknown; moments: ReferenceMoment[]; transcript: string; sheets: ReferenceSheet[] };
type LookRecipe = Omit<RecipeWire, "moments"> & { moments: RecipeMoment[] };

/** Lo que ve el Estudio. */
export type LookView = {
  id: string;
  status: LookStatus;
  error: string | null;
  source: string;
  messages: LookMessage[];
  items: (LookItem & { label: string; refAt: number; at: number | null; end: number | null })[];
  stage: string | null;
};

/** Lo mínimo que tiene que quedar del tope de IA del video para mirar una referencia (receta con visión + charla). */
export const LOOK_MIN_USD = 1;

const MOMENT_LABEL: Record<string, string> = { transicion: "Transición", texto: "Texto animado", tarjeta: "Tarjeta", camara: "Movimiento de cámara", look: "Look", broll: "B-roll", recorte: "Recorte de la persona", subtitulos: "Subtítulos", sonido: "Sonido", grafico: "Gráfico", imagen: "Imagen" };

async function row(projectId: string, lookId: string) {
  const [r] = await getDb()
    .select()
    .from(schema.videoLooks)
    .where(and(eq(schema.videoLooks.id, lookId), eq(schema.videoLooks.projectId, projectId)))
    .limit(1);
  return r ?? null;
}

const setLook = (id: string, patch: Partial<typeof schema.videoLooks.$inferInsert>) => getDb().update(schema.videoLooks).set(patch).where(eq(schema.videoLooks.id, id));

/** Empieza a mirar una referencia: un link o el video que se acaba de subir (la ruta que reservó el Estudio). */
export async function startLook(projectId: string, input: { link?: string | null; upload?: boolean }, userId: string): Promise<string> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx) throw new LookError("Este video todavía no está listo.");
  if (ctx.project.status !== "AWAITING_REVIEW" && ctx.project.status !== "DONE") throw new LookError("Espera a que termine lo que se está procesando.");
  if (!aiConfigured()) throw new LookError("Falta configurar la IA en esta instalación.");
  if (ctx.cap - ctx.spent < LOOK_MIN_USD) throw new LookError(`Queda poco tope de IA en este video (necesitas al menos USD ${LOOK_MIN_USD}). Súbelo en el brief del director.`);
  let source: ReferenceSource;
  const director = readDirector(ctx.project.director);
  if (input.upload) {
    const up = director.refUpload;
    if (!up) throw new LookError("No encontramos el video. Vuelve a subirlo.");
    const info = await fileInfo(up.key);
    if (!info || info.size === 0) throw new LookError("La subida no terminó. Vuelve a elegir el archivo.");
    source = { kind: "upload", key: up.key, name: up.name };
  } else {
    const link = input.link?.trim() ?? "";
    if (!isReferenceLink(link)) throw new LookError("Pega un link de Instagram, TikTok o YouTube, o sube el video.");
    source = { kind: "link", url: link };
  }
  // Una referencia a la vez por video: la anterior que seguía en curso se descarta.
  await getDb()
    .update(schema.videoLooks)
    .set({ status: "failed", error: "La reemplazaste por otra." })
    .where(and(eq(schema.videoLooks.projectId, projectId), inArray(schema.videoLooks.status, ["queued", "analyzing", "thinking"])));
  const [created] = await getDb().insert(schema.videoLooks).values({ projectId, source, createdBy: userId }).returning({ id: schema.videoLooks.id });
  if (input.upload) {
    await getDb()
      .update(schema.videoProjects)
      .set({ director: { ...director, refUpload: null, updatedAt: new Date().toISOString() } as unknown as Record<string, unknown> })
      .where(eq(schema.videoProjects.id, projectId));
  }
  const job = await enqueueJob({ type: "VIDEO_LOOK", videoProjectId: projectId, createdBy: userId, stage: "En cola", maxAttempts: 2, input: { projectId, lookId: created!.id } });
  await setLook(created!.id, { jobId: (job as { id?: string } | null)?.id ?? null });
  return created!.id;
}

/** Lo que entrega el worker: las medidas y las hojas, o el aviso de que no se pudo bajar. */
export async function saveLookData(projectId: string, lookId: string, payload: { ok: boolean; error?: string; metrics?: unknown; moments?: ReferenceMoment[]; transcript?: string; sheets?: ReferenceSheet[] }): Promise<boolean> {
  const look = await row(projectId, lookId);
  if (!look || (look.status !== "queued" && look.status !== "analyzing")) return false;
  const source = look.source as ReferenceSource;
  // El video subido no se guarda: se borra apenas el worker lo midió (o no pudo).
  if (source.kind === "upload") await deleteKeys([source.key]).catch(() => undefined);
  if (!payload.ok) {
    await setLook(lookId, { status: "failed", error: (payload.error || "No pudimos bajar ese video. Descárgalo y súbelo.").slice(0, 400) });
    return false;
  }
  const sheets = (payload.sheets ?? []).filter((s) => s.key.startsWith(`editor/${projectId}/mirar/${lookId}/`));
  const metrics = styleMetricsSchema.safeParse(payload.metrics);
  const data: LookData = { metrics: metrics.success ? metrics.data : null, moments: payload.moments ?? [], transcript: (payload.transcript ?? "").slice(0, 6000), sheets };
  await setLook(lookId, { status: "thinking", data: data as unknown as Record<string, unknown>, error: null });
  return true;
}

/** Claude desarma la referencia (receta, con los cuadros) y escribe su primera respuesta: qué ve y dónde va. */
export async function thinkLook(projectId: string, lookId: string): Promise<void> {
  const look = await row(projectId, lookId);
  const ctx = await loadWorkCtx(projectId);
  if (!look || !ctx || look.status !== "thinking" || !look.data) return;
  const data = look.data as unknown as LookData;
  try {
    const m = styleMetricsSchema.safeParse(data.metrics);
    const metrics = m.success ? m.data : null;
    const recipe = await generateStructured({
      feature: "video.mirar.receta",
      model: "deep",
      thinking: { effort: "high" },
      context: `${COPY_RULES}\n\n${ctx.brandCtx}`,
      task: recipeTask({
        duration: metrics?.duration ?? (data.moments.at(-1)?.t ?? 30),
        aspect: metrics?.aspect ?? "9:16",
        metrics: referenceSummary(metrics) || "(sin medidas)",
        moments: data.moments.map((x) => `R#${x.frame} ${x.t.toFixed(2)} s${x.cut ? " · corte" : ""}${x.face ? " · persona" : " · sin persona"}${x.text ? ` · texto «${x.text.slice(0, 60)}»` : ""}${x.said ? ` · dice «${x.said.slice(0, 60)}»` : ""}`).join("\n"),
        transcript: data.transcript,
        sheets: data.sheets.length,
        frames: data.moments.length,
      }),
      images: await sheetImages(data.sheets),
      imageSizes: data.sheets.map((s) => ({ width: s.width, height: s.height })),
      schema: recipeWireSchema,
      maxTokens: 32000,
      timeoutMs: 600_000,
      videoProjectId: projectId,
      fake: () => fakeRecipe(data.moments, metrics?.duration ?? 30),
    });
    const withIds: LookRecipe = { ...recipe, moments: recipe.moments.slice(0, 40).map((x, i) => ({ ...x, id: `m${i + 1}` })) };
    await setLook(lookId, { recipe: withIds as unknown as Record<string, unknown> });
    const turn = await runTurn(projectId, withIds, [], []);
    await setLook(lookId, { status: "ready", messages: [{ role: "assistant", text: turn.reply, at: new Date().toISOString() }], proposal: turn.items as unknown as Record<string, unknown>[] });
  } catch (error) {
    console.error("[mirar] receta:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    await setLook(lookId, { status: "failed", error: error instanceof AiError ? error.userMessage : "No pudimos mirar ese video. Prueba de nuevo." });
  }
}

/** Texto de la receta para la charla. */
function recipeText(recipe: LookRecipe): string {
  return [
    recipe.summary,
    ...Object.entries(recipe.global).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`),
    "MOMENTOS:",
    ...recipe.moments.map((m) => `${m.id} [importancia ${m.importance}] ${m.t0.toFixed(1)}–${m.t1.toFixed(1)} s · ${m.kind} · ${m.function}: ${m.visual} | ${m.motion} | ${m.relation}`),
  ].join("\n");
}

/** Una vuelta de la charla: la respuesta y la lista actualizada (solo momentos y tramos que existen). */
async function runTurn(projectId: string, recipe: LookRecipe, history: LookMessage[], current: LookItem[]): Promise<{ reply: string; items: LookItem[] }> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx) throw new LookError("Este video todavía no está listo.");
  const words = keptWords(ctx);
  const msgs = history.slice(-30).map((m) => (m.role === "applied" ? { role: "assistant" as const, text: `[YA SE MANDARON A CREAR] ${m.text}` } : { role: m.role, text: m.text }));
  const out: LookTurn = await generateStructured({
    feature: "video.mirar.charla",
    model: "main",
    context: `${LOOK_RULES}\n\n${ctx.brandCtx}`,
    task: lookTurnTask({
      recipe: recipeText(recipe).slice(0, 24000),
      sentences: sentencesText(words).slice(0, 30000),
      duration: ctx.timeline.duration,
      format: ctx.format,
      current: current.length ? current.map((i) => `${i.moment} ${i.include ? "VA" : "NO VA"} [${i.from_word}–${i.to_word}]: ${i.brief.slice(0, 300)}`).join("\n") : null,
      messages: msgs,
    }),
    schema: lookTurnSchema,
    maxTokens: 8000,
    videoProjectId: projectId,
    fake: () => {
      const said = sentences(words);
      return {
        reply: history.length
          ? `Listo, actualicé la lista con lo que dijiste: «${history.filter((m) => m.role === "user").at(-1)?.text ?? ""}».`
          : `Es una edición ${recipe.global.density}: ${recipe.summary}\n${recipe.moments
              .slice(0, 4)
              .map((m, i) => `${i + 1}. ${m.t0.toFixed(1)} s – ${m.visual.slice(0, 80)}. Lo pondría en tu ${said[Math.min(i, said.length - 1)]?.start.toFixed(1) ?? "0"} s.`)
              .join("\n")}`,
        items: recipe.moments.slice(0, 4).map((m, i) => {
          const f = said[Math.min(i, said.length - 1)];
          return { moment: m.id, include: true, from_word: f?.from ?? 0, to_word: f?.to ?? 0, brief: `${m.visual} ${m.motion}`.slice(0, 600), why: "Cumple la misma función." };
        }),
      };
    },
  });
  const valid = new Set(words.map((w) => w.id));
  const items = out.items
    .filter((i) => recipe.moments.some((m) => m.id === i.moment.trim()))
    .map((i) => ({ ...i, moment: i.moment.trim(), from_word: Math.min(i.from_word, i.to_word), to_word: Math.max(i.from_word, i.to_word), brief: i.brief.slice(0, 1400), why: i.why.slice(0, 300) }))
    .filter((i) => valid.has(i.from_word) && valid.has(i.to_word));
  // Lo que no volvió a mencionar queda como estaba.
  const merged = [...items, ...current.filter((c) => !items.some((i) => i.moment === c.moment))];
  return { reply: out.reply.slice(0, 4000), items: merged.slice(0, 16) };
}

/** La persona contesta: Claude responde y actualiza la lista. */
export async function lookChat(projectId: string, lookId: string, text: string): Promise<void> {
  const look = await row(projectId, lookId);
  if (!look || look.status !== "ready" || !look.recipe) throw new LookError("Esa referencia ya no está disponible.");
  const ctx = await loadWorkCtx(projectId);
  if (ctx && ctx.cap - ctx.spent < 0.05) throw new LookError("No queda tope de IA en este video. Súbelo en el brief del director.");
  const now = new Date().toISOString();
  const messages: LookMessage[] = [...look.messages, { role: "user", text: text.slice(0, 2000), at: now }];
  const turn = await runTurn(projectId, look.recipe as unknown as LookRecipe, messages, look.proposal as unknown as LookItem[]);
  const next: LookMessage[] = [...messages, { role: "assistant", text: turn.reply, at: new Date().toISOString() }];
  await setLook(lookId, { messages: next.slice(-120), proposal: turn.items as unknown as Record<string, unknown>[] });
}

/** Marca o desmarca un momento de la lista a mano (sin pasar por la IA). */
export async function toggleLookItem(projectId: string, lookId: string, moment: string, include: boolean): Promise<void> {
  const look = await row(projectId, lookId);
  if (!look || look.status !== "ready") throw new LookError("Esa referencia ya no está disponible.");
  const proposal = (look.proposal as unknown as LookItem[]).map((i) => (i.moment === moment ? { ...i, include } : i));
  await setLook(lookId, { proposal: proposal as unknown as Record<string, unknown>[] });
}

/** «Aplicar»: cada momento elegido es un pedido de animación con sus cuadros de la referencia. */
export async function applyLook(projectId: string, lookId: string, userId: string): Promise<{ count: number; failed: string[] }> {
  const look = await row(projectId, lookId);
  if (!look || look.status !== "ready" || !look.recipe || !look.data) throw new LookError("Esa referencia ya no está disponible.");
  const recipe = look.recipe as unknown as LookRecipe;
  const data = look.data as unknown as LookData;
  const chosen = (look.proposal as unknown as LookItem[]).filter((i) => i.include);
  if (!chosen.length) throw new LookError("No hay nada elegido para aplicar.");
  let count = 0;
  const failed: string[] = [];
  for (const item of chosen) {
    const m = recipe.moments.find((x) => x.id === item.moment);
    if (!m) continue;
    const sheets = data.sheets.filter((s) => s.frames.some((f) => m.frames.includes(f))).slice(0, 2);
    try {
      await startStudioRequest(projectId, { from_word: item.from_word, to_word: item.to_word, instruction: item.brief, replace: null, look: { moment: m.id, detail: momentDetail(m), sheets } }, userId);
      count++;
    } catch (error) {
      failed.push(`${m.id}: ${error instanceof Error ? error.message : "no se pudo"}`);
    }
  }
  if (count) {
    const labels = chosen.map((i) => i.moment).join(", ");
    await setLook(lookId, { messages: [...look.messages, { role: "applied" as const, text: `${count} ${count === 1 ? "momento" : "momentos"} (${labels})`, at: new Date().toISOString() }] });
  }
  return { count, failed };
}

/** La última referencia mirada en este video, lista para el Estudio. */
export async function latestLook(projectId: string): Promise<LookView | null> {
  const [look] = await getDb().select().from(schema.videoLooks).where(eq(schema.videoLooks.projectId, projectId)).orderBy(desc(schema.videoLooks.createdAt)).limit(1);
  if (!look) return null;
  const ctx = look.status === "ready" ? await loadWorkCtx(projectId) : null;
  const recipe = look.recipe as unknown as LookRecipe | null;
  const source = look.source as ReferenceSource;
  let stage: string | null = null;
  if (look.status === "queued" || look.status === "analyzing") {
    const [job] = look.jobId ? await getDb().select({ stage: schema.jobs.stage, status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, look.jobId)).limit(1) : [];
    stage = job?.stage ?? null;
    // El trabajo falló sin avisar (por ejemplo, se cayó el worker): se muestra como fallido.
    if (job && (job.status === "FAILED" || job.status === "CANCELED")) {
      await setLook(look.id, { status: "failed", error: "No pudimos mirar ese video. Prueba de nuevo o súbelo." });
      return latestLook(projectId);
    }
  }
  if (look.status === "thinking") {
    stage = "Mirando cada momento";
    // Si quedó pensando más de 15 minutos, se cortó.
    if (Date.now() - new Date(look.updatedAt).getTime() > 15 * 60_000) {
      await setLook(look.id, { status: "failed", error: "Se cortó mientras mirábamos el video. Prueba de nuevo." });
      return latestLook(projectId);
    }
  }
  const items = ((look.proposal as unknown as LookItem[]) ?? []).map((i) => {
    const m = recipe?.moments.find((x) => x.id === i.moment);
    const r = ctx ? outputRange(ctx.timeline, i.from_word, i.to_word) : null;
    return { ...i, label: m ? MOMENT_LABEL[m.kind] ?? m.kind : i.moment, refAt: m?.t0 ?? 0, at: r?.start ?? null, end: r?.end ?? null };
  });
  return {
    id: look.id,
    status: look.status as LookStatus,
    error: look.error,
    source: source.kind === "link" ? source.url : source.name,
    messages: look.messages,
    items,
    stage,
  };
}
