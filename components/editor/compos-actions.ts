"use server";

import { z } from "zod";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, aiConfigured, generateStructured, withAiScope } from "@/lib/ai/client";
import { COMPOS_CHAT_RULES, composChatSchema, composChatTask } from "@/lib/ai/prompts/compos-chat";
import { clearChat, loadChat, saveChat, type ChatMessage, type ChatThread } from "@/lib/video/compos/chat";
import { isDenied, requireEditor } from "@/lib/auth";
import { ComposRequestError, planWholeVideo, startStudioRequest, startWholeVideo, type WholePlan } from "@/lib/video/compos/flows";
import { composStatus, type ComposStatus } from "@/lib/video/compos/service";
import { ackRequests, cancelRequest } from "@/lib/video/compos/requests";
import { loadProject } from "@/lib/video/service";
import { readBytes } from "@/lib/storage";
import { videoChatConversation } from "@/lib/video/chat-conversation";
import { cleanRefs, MAX_REF_INPUT_BYTES, RefError, refUrl, saveRefImage, type RefImage } from "@/lib/video/refs";

/**
 * Animaciones a medida en el Estudio: "Pide una animación aquí" (sobre un tramo, con texto libre) y "Pídele un cambio a
 * esta animación". El pedido lo hace el worker con la IA (trabajo VIDEO_COMPOS) sin sacar el video de la revisión; el
 * Estudio consulta el estado y, cuando termina, pone la animación en la línea de tiempo (se puede deshacer).
 */
const idSchema = z.uuid();
const requestSchema = z.object({
  from_word: z.number().int().min(0),
  to_word: z.number().int().min(0),
  instruction: z.string().trim().min(3, "Escribe qué animación quieres.").max(1500, "El pedido es demasiado largo: resúmelo en pocas frases."),
  replace: z.unknown().nullable().optional(),
  /** Segundo dentro de la animación donde está el cabezal (en una pieza única, se cambia esa escena). */
  at: z.number().min(0).max(600).nullable().optional(),
  /** Imágenes que mandó la persona (de estilo o para usar dentro). Se vuelven a validar contra el proyecto. */
  refs: z.array(z.unknown()).max(8).optional(),
  /** Salió del Chat con la IA: va la charla entera (la lee el servidor) y, si ya hay una animación ahí, se reemplaza. */
  fromChat: z.boolean().optional(),
});

/** Varios pedidos pueden correr a la vez. `error`: el pedido quedó creado pero sin tope de IA (se muestra en él). */
export async function requestAnimationAction(projectId: string, input: z.input<typeof requestSchema>): Promise<{ ok: true; workId: string; error: string | null } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = requestSchema.safeParse(input);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Pedido no válido." };
  try {
    const conversation = parsed.data.fromChat ? await videoChatConversation(projectId) : null;
    const { workId, error } = await startStudioRequest(projectId, { ...parsed.data, replace: parsed.data.replace ?? null, at: parsed.data.at ?? null, refs: parsed.data.refs ?? [], conversation, autoReplace: Boolean(parsed.data.fromChat) }, user.id);
    return { ok: true, workId, error };
  } catch (error) {
    if (error instanceof ComposRequestError) return { ok: false, error: error.message };
    console.error("[animaciones] pedido:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos empezar la animación. Prueba de nuevo." };
  }
}

/**
 * Sube una imagen para un pedido o para la charla de una animación: se valida, se achica (lado mayor 1568 px, WebP) y
 * queda en el proyecto. Devuelve la referencia y una URL de corta duración para verla.
 */
export async function uploadRefImageAction(projectId: string, form: FormData): Promise<{ ok: true; ref: Omit<RefImage, "use" | "note">; url: string } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Falta la imagen." };
  if (!/^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i.test(file.type)) return { ok: false, error: "Sube una imagen JPG, PNG o WebP." };
  if (file.size > MAX_REF_INPUT_BYTES) return { ok: false, error: "La imagen pesa más de 12 MB." };
  const project = await loadProject(projectId);
  if (!project) return { ok: false, error: "No encontramos ese proyecto." };
  try {
    const ref = await saveRefImage(projectId, Buffer.from(await file.arrayBuffer()));
    return { ok: true, ref, url: await refUrl(ref.key) };
  } catch (error) {
    if (error instanceof RefError) return { ok: false, error: error.message };
    console.error("[animaciones] imagen:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos subir la imagen. Prueba de nuevo." };
  }
}

/** URLs de corta duración de las imágenes de una charla (para mostrarlas). */
async function chatRefUrls(projectId: string, thread: ChatThread): Promise<Record<string, string>> {
  const keys = [...new Set(thread.messages.flatMap((m) => cleanRefs(projectId, m.refs ?? []).map((r) => r.key)))];
  const out: Record<string, string> = {};
  await Promise.all(keys.map(async (k) => (out[k] = await refUrl(k).catch(() => ""))));
  return out;
}

export async function composStatusAction(projectId: string): Promise<{ ok: true; data: ComposStatus } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  try {
    const project = await loadProject(projectId);
    if (!project) return { ok: false, error: "No encontramos ese proyecto." };
    return { ok: true, data: await composStatus(project) };
  } catch (error) {
    console.error("[animaciones] estado:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos consultar la animación." };
  }
}

const workIdSchema = z.string().regex(/^w[0-9a-z]{1,30}$/);

/** Cancela un pedido de animación (en cola: no se hace; en curso: se detiene en el próximo paso). */
export async function cancelAnimationAction(projectId: string, workId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success || !workIdSchema.safeParse(workId).success) return { ok: false, error: "Pedido no válido." };
  return (await cancelRequest(projectId, workId)) ? { ok: true } : { ok: false, error: "Ese pedido ya terminó." };
}

/** Marca pedidos como entregados: ya están en la revisión guardada (o la persona cerró el aviso de uno fallido). */
export async function ackAnimationsAction(projectId: string, workIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const ids = workIds.filter((w) => workIdSchema.safeParse(w).success).slice(0, 30);
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Pedido no válido." };
  await ackRequests(projectId, ids);
  return { ok: true };
}

// ─── Animar todo el video ────────────────────────────────────────────────

const modeSchema = z.enum(["face", "over", "split", "top", "full"]);

/** Paso 1: Claude propone el estilo y un pedido por momento. Tarda hasta un par de minutos. */
export async function planWholeVideoAction(projectId: string, mode: z.infer<typeof modeSchema>, notes: string): Promise<{ ok: true; plan: WholePlan } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success || !modeSchema.safeParse(mode).success) return { ok: false, error: "Pedido no válido." };
  try {
    return { ok: true, plan: await planWholeVideo(projectId, { mode, notes: String(notes ?? "").slice(0, 800) }) };
  } catch (error) {
    if (error instanceof ComposRequestError) return { ok: false, error: error.message };
    console.error("[animaciones] plan de todo el video:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos armar el plan. Prueba de nuevo." };
  }
}

const wholeSchema = z.object({
  mode: modeSchema,
  style: z.string().max(600),
  moments: z
    .array(z.object({ from_word: z.number().int().min(0), to_word: z.number().int().min(0), title: z.string().max(80).optional(), prompt: z.string().trim().min(20, "Cada animación necesita un pedido (al menos una frase).").max(1100, "Un pedido es demasiado largo: resúmelo.") }))
    .min(1, "No hay animaciones para crear.")
    .max(30),
});

/** Paso 2: crea todas (en espera; entran a la cola de a varias y aparecen solas en la línea de tiempo). */
export async function startWholeVideoAction(projectId: string, plan: z.input<typeof wholeSchema>): Promise<{ ok: true; count: number; workId: string; error: string | null } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = wholeSchema.safeParse(plan);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Pedido no válido." };
  try {
    return { ok: true, ...(await startWholeVideo(projectId, parsed.data, user.id)) };
  } catch (error) {
    if (error instanceof ComposRequestError) return { ok: false, error: error.message };
    console.error("[animaciones] todo el video:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos empezar las animaciones. Prueba de nuevo." };
  }
}

/**
 * «Animar todo» desde el Chat con la IA, sin pantalla de plan: si ya hay una pieza de todo el video, se rehace con la
 * charla; si no, se arman las escenas con la charla entera y se crea directo. Cada etapa recibe la charla completa.
 */
export async function wholeFromChatAction(projectId: string, input: { layout: z.infer<typeof modeSchema>; prompt: string }): Promise<{ ok: true; replaced: boolean; error: string | null } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const layout = modeSchema.safeParse(input?.layout);
  const prompt = String(input?.prompt ?? "").trim().slice(0, 1500);
  if (!idSchema.safeParse(projectId).success || !layout.success || prompt.length < 3) return { ok: false, error: "Pedido no válido." };
  try {
    const conversation = await videoChatConversation(projectId);
    const project = await loadProject(projectId);
    const long = (((project?.plan as { compositions?: { id: string; long?: boolean; from_word: number; to_word: number }[] } | null)?.compositions) ?? []).find((c) => c.long);
    if (long) {
      const { error } = await startStudioRequest(projectId, { from_word: long.from_word, to_word: long.to_word, instruction: `Rehacer toda la pieza con lo que se habló en la charla: ${prompt}`.slice(0, 1500), replace: { id: long.id }, conversation }, user.id);
      return { ok: true, replaced: true, error };
    }
    const plan = await planWholeVideo(projectId, { mode: layout.data, notes: prompt, conversation });
    const r = await startWholeVideo(projectId, { mode: plan.mode, style: plan.style, moments: plan.moments, conversation }, user.id);
    return { ok: true, replaced: false, error: r.error };
  } catch (error) {
    if (error instanceof ComposRequestError) return { ok: false, error: error.message };
    console.error("[animaciones] todo el video desde el chat:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos empezar la animación. Prueba de nuevo." };
  }
}

const compIdSchema = z.string().regex(/^[a-z0-9]{3,40}$/i);

const chatSchema = z.object({
  compId: compIdSchema,
  text: z.string().trim().min(1).max(2000),
  name: z.string().max(80),
  why: z.string().max(300),
  start: z.number().min(0).max(3600),
  end: z.number().min(0).max(3600),
  scenes: z.array(z.object({ title: z.string().max(80), start: z.number().min(0), end: z.number().min(0), brief: z.string().max(1200) })).max(30),
  scene: z.string().max(80).nullable(),
  params: z.array(z.object({ label: z.string().max(80), value: z.string().max(160) })).max(12),
  sounds: z.string().max(2000),
  words: z.string().max(12000),
  /** Imágenes que van con este mensaje. */
  refs: z.array(z.unknown()).max(4).optional(),
});

/** La charla guardada de una animación (para mostrarla al elegirla). */
export async function loadComposChatAction(projectId: string, compId: string): Promise<{ ok: true; thread: ChatThread; refUrls: Record<string, string> } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success || !compIdSchema.safeParse(compId).success) return { ok: false, error: "Datos no válidos." };
  const thread = await loadChat(projectId, compId);
  return { ok: true, thread, refUrls: await chatRefUrls(projectId, thread) };
}

/** Marca en la charla que se mandaron los cambios acordados (la IA lo recuerda la próxima vez). */
export async function appliedComposChatAction(projectId: string, compId: string): Promise<{ ok: true; thread: ChatThread } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success || !compIdSchema.safeParse(compId).success) return { ok: false, error: "Datos no válidos." };
  const thread = await loadChat(projectId, compId);
  if (!thread.agreed) return { ok: true, thread };
  const next: ChatThread = { messages: [...thread.messages, { role: "applied", text: thread.agreed.instruction, at: new Date().toISOString() }], agreed: null };
  await saveChat(projectId, compId, next);
  return { ok: true, thread: next };
}

/** «Empezar de nuevo»: borra la charla de esa animación. */
export async function clearComposChatAction(projectId: string, compId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success || !compIdSchema.safeParse(compId).success) return { ok: false, error: "Datos no válidos." };
  await clearChat(projectId, compId);
  return { ok: true };
}

/**
 * Charla con el taller antes de reescribir una animación: la IA contesta qué va a hacer (con los segundos del video)
 * y arma el pedido final consolidado. La conversación queda guardada por animación (con lo que ya se cambió). No cambia
 * la animación: el Estudio manda el pedido cuando la persona dice «Hacer los cambios».
 */
export async function composChatAction(projectId: string, input: z.input<typeof chatSchema>): Promise<{ ok: true; thread: ChatThread; scope: "scene" | "all"; refUrls: Record<string, string> } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = chatSchema.safeParse(input);
  if (!z.uuid().safeParse(projectId).success || !parsed.success) return { ok: false, error: "Datos no válidos." };
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación." };
  const d = parsed.data;
  const saved = await loadChat(projectId, d.compId);
  const now = new Date().toISOString();
  const attached = cleanRefs(projectId, d.refs);
  const messages: ChatMessage[] = [...saved.messages, { role: "user", text: d.text, at: now, ...(attached.length ? { refs: attached } : {}) }];
  // Lo que Claude mira: las imágenes de la charla (las últimas 4), en orden.
  const seen = new Map<string, RefImage>();
  for (const m of messages) for (const r of cleanRefs(projectId, m.refs ?? [])) seen.set(r.key, r);
  const refs = [...seen.values()].slice(-4);
  try {
    const brandCtx = await brandContext(await getBrand());
    // A la IA: los últimos 40 mensajes; los cambios ya hechos van marcados como tales.
    const history = messages.slice(-40).map((m) =>
      m.role === "applied"
        ? { role: "assistant" as const, text: `[CAMBIOS YA HECHOS EN LA ANIMACIÓN] ${m.text}` }
        : { role: m.role, text: m.refs?.length ? `${m.text} [adjuntó ${m.refs.map((r) => `imagen ${refs.findIndex((x) => x.key === r.key) + 1} (${r.use === "inside" ? "para usar dentro" : "de estilo"})`).join(", ")}]` : m.text },
    );
    const pics = refs.length ? await refImages(refs) : [];
    const out = await withAiScope(projectId, () =>
      generateStructured({
        feature: "video.compos.charla",
        model: "main",
        context: `${COMPOS_CHAT_RULES}\n\n${brandCtx}`,
        task: composChatTask({ ...d, messages: history, refs: refs.map((r) => ({ use: r.use, note: r.note ?? null })) }),
        ...(pics.length ? { images: pics, imageSizes: refs.map((r) => ({ width: r.width, height: r.height })) } : {}),
        schema: composChatSchema,
        maxTokens: 2500,
        userId: user.id,
        fake: () => {
          const asked = messages.filter((m) => m.role === "user").map((m) => m.text);
          return { reply: `Esto es lo que voy a hacer:\n- ${asked.join("\n- ")}\n\nSi está bien, toca «Hacer los cambios».`, instruction: asked.join(". ").slice(0, 1400), scope: d.scene ? "scene" : "all" };
        },
      }),
    );
    const thread: ChatThread = { messages: [...messages, { role: "assistant", text: out.reply.slice(0, 3000), at: new Date().toISOString() }], agreed: { instruction: out.instruction.slice(0, 1500), scope: out.scope } };
    await saveChat(projectId, d.compId, thread);
    return { ok: true, thread, scope: out.scope, refUrls: await chatRefUrls(projectId, thread) };
  } catch (error) {
    console.error("[compos] charla:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    return { ok: false, error: error instanceof AiError ? error.userMessage : "No pudimos responder. Prueba de nuevo." };
  }
}

/** Las imágenes de la charla para Claude (WebP chicas, ya achicadas al subirlas). */
async function refImages(refs: RefImage[]): Promise<{ mediaType: "image/webp"; data: string }[]> {
  const out: { mediaType: "image/webp"; data: string }[] = [];
  for (const r of refs) {
    try {
      out.push({ mediaType: "image/webp", data: (await readBytes(r.key, 8 * 1024 * 1024)).toString("base64") });
    } catch (error) {
      console.error("[compos] charla: no se pudo leer una imagen:", error instanceof Error ? error.message : error);
    }
  }
  return out;
}
