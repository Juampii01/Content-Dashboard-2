"use server";

import { after } from "next/server";
import { FEATURES } from "@/lib/features";
import { z } from "zod";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { isDenied, requireEditor } from "@/lib/auth";
import { clearChat, loadChat, saveChat, type ChatMessage } from "@/lib/video/compos/chat";
import { findLinks } from "@/lib/video/director/request";
import { cleanRefs } from "@/lib/video/refs";
import { VIDEO_CHAT_ID } from "@/lib/video/chat-conversation";
import { copyWholeLook, LookError, lookForChat, startLook } from "@/lib/video/look";
import { activeLongRequest, LONG_BUSY_MESSAGE } from "@/lib/video/compos/requests";
import { ComposRequestError } from "@/lib/video/compos/flows";
import { videoChatConversation } from "@/lib/video/chat-conversation";
import { loadProject } from "@/lib/video/service";
import type { VideoChatItem } from "@/lib/video/chat-library";
import { chatInputSchema, chatTurn as turn, CLIP_WAIT_MAX_MS, clipStates, pendingClipWait } from "@/lib/video/chat-turn";
import type { ChatClip } from "@/lib/video/compos/chat";
import { analyzeMissing, generateFicha } from "@/lib/video/library";

/**
 * Las piezas de la biblioteca nombradas con @ o adjuntas que no tienen ficha (las de antes de que hubiera fichas) se
 * mandan a analizar, y la charla espera como con un video nuevo. Nunca frena el turno.
 */
async function analyzeAttached(ids: string[], userId: string): Promise<void> {
  const r = await analyzeMissing(ids, userId).catch((error) => {
    console.error("[chat del video] no se pudo pedir la ficha:", error instanceof Error ? error.message : error);
    return { now: [] as string[], queued: [] as string[] };
  });
  if (r.now.length)
    after(async () => {
      for (const id of r.now) await generateFicha(id);
    });
}

/**
 * Chat con la IA del Estudio (panel derecho sin nada elegido): conversa sobre el video y propone acciones con su tramo,
 * que la persona ejecuta con un botón. La charla queda guardada por video (compos_chats con comp_id "video").
 */
type Fail = { ok: false; error: string };
const CHAT_ID = VIDEO_CHAT_ID;
export type { VideoChatItem };
/**
 * looking: la referencia que la IA está mirando; watching: la espera de los videos adjuntos que la app está mirando
 * (en los dos casos el cliente pregunta cada pocos segundos hasta que responde).
 */
export type VideoChatThread = { messages: { role: "user" | "assistant" | "applied"; text: string; at: string; items?: VideoChatItem[]; images?: number; videos?: number }[]; looking?: string; watching?: string };

/** La última referencia pedida en la charla que todavía no tuvo respuesta. */
function pendingLook(messages: ChatMessage[]): string | null {
  const done = new Set(messages.map((m) => m.lookDone).filter(Boolean));
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i]!.look;
    if (id) return done.has(id) ? null : id;
  }
  return null;
}

/** La última referencia ya mirada (para que la IA la siga teniendo en cuenta en los mensajes siguientes). */
function lastLook(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.lookDone) return messages[i]!.lookDone!;
  return null;
}

const view = (messages: ChatMessage[]): VideoChatThread => {
  const looking = pendingLook(messages);
  const watching = pendingClipWait(messages)?.id;
  return {
    messages: messages.slice(-120).map((m) => ({ role: m.role, text: m.text, at: m.at, ...(m.items?.length ? { items: m.items as VideoChatItem[] } : {}), ...(m.refs?.length ? { images: m.refs.length } : {}), ...(m.clips?.length ? { videos: m.clips.length } : {}) })),
    ...(looking ? { looking } : {}),
    ...(watching ? { watching } : {}),
  };
};

export async function loadVideoChatAction(projectId: string): Promise<{ ok: true; thread: VideoChatThread } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  return { ok: true, thread: view((await loadChat(projectId, CHAT_ID)).messages) };
}

export async function clearVideoChatAction(projectId: string): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  await clearChat(projectId, CHAT_ID);
  return { ok: true };
}

const inputSchema = chatInputSchema;

const failOf = (error: unknown, where: string): Fail => {
  console.error(`[chat del video] ${where}`, error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
  return { ok: false, error: error instanceof AiError ? error.userMessage : error instanceof LookError ? error.message : "No pudimos responder. Prueba de nuevo." };
};

/** go: la persona pidió hacerlo ya; el cliente ejecuta las acciones del último mensaje sin esperar el toque. */
export async function videoChatAction(input: z.input<typeof inputSchema>): Promise<{ ok: true; thread: VideoChatThread; go?: boolean } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  const d = parsed.data;
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación." };
  const saved = await loadChat(d.projectId, CHAT_ID);
  const now = new Date().toISOString();
  const refs = cleanRefs(d.projectId, d.images ?? []);
  // Los videos adjuntos (subidos aquí o nombrados con @) quedan en el mensaje: Claude ve sus cuadros en este turno y en los que siguen.
  const clips: ChatClip[] = d.attachments.filter((a) => a.kind === "video" && a.libraryId).map((a) => ({ ref: a.ref, id: a.libraryId!, name: a.name }));
  const messages: ChatMessage[] = [...saved.messages, { role: "user", text: d.text, at: now, ...(refs.length ? { refs } : {}), ...(clips.length ? { clips } : {}) }];
  try {
    await analyzeAttached(d.attachments.flatMap((a) => (a.libraryId ? [a.libraryId] : [])), user.id);
    // Si la app todavía está mirando un video adjunto (cuadros y ficha), se contesta cuando termine.
    const waiting = (await clipStates(clips.map((c) => c.id))).filter((c) => c.state === "waiting");
    if (waiting.length) {
      const wait = { id: `w${Date.now().toString(36)}`, clips: clips.map((c) => c.id) };
      const next: ChatMessage[] = [...messages, { role: "assistant", text: `Estoy mirando tu video${clips.length > 1 ? "s" : ""} cuadro a cuadro. Tarda 1 o 2 minutos; puedes seguir editando y te contesto aquí mismo.`, at: new Date().toISOString(), clipWait: wait }];
      await saveChat(d.projectId, CHAT_ID, { messages: next, agreed: null });
      return { ok: true, thread: view(next) };
    }
    // Un link de Instagram, TikTok o YouTube: la app lo baja y lo mira cuadro a cuadro (VIDEO_LOOK); la IA contesta cuando termina.
    const link = findLinks(d.text)[0];
    if (link && !pendingLook(saved.messages)) {
      const lookId = await startLook(d.projectId, { link }, user.id);
      const next: ChatMessage[] = [...messages, { role: "assistant", text: "Voy a mirar ese video cuadro a cuadro. Tarda de 1 a 3 minutos; puedes seguir editando y te contesto aquí mismo.", at: new Date().toISOString(), look: lookId }];
      await saveChat(d.projectId, CHAT_ID, { messages: next, agreed: null });
      return { ok: true, thread: view(next) };
    }
    const lookId = lastLook(saved.messages);
    const ref = lookId ? await lookForChat(d.projectId, lookId) : null;
    const reply = await turn(d, messages, user.id, ref?.text ? { source: ref.source, text: ref.text } : null, d.text, refs);
    if ("ok" in reply) return reply;
    const next = [...messages, reply.message];
    await saveChat(d.projectId, CHAT_ID, { messages: next, agreed: null });
    return { ok: true, thread: view(next), go: reply.go };
  } catch (error) {
    return failOf(error, "turno");
  }
}

const lookInputSchema = inputSchema.omit({ text: true }).extend({ lookId: z.uuid() });

/**
 * Lo pregunta el cliente cada pocos segundos mientras la IA mira una referencia. Cuando está lista, la IA contesta qué
 * vio y dónde lo pondría en este video; si falló, se dice en la charla.
 */
export async function videoChatLookAction(input: z.input<typeof lookInputSchema>): Promise<{ ok: true; thread: VideoChatThread; waiting: boolean; go?: boolean } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = lookInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  const d = parsed.data;
  const saved = await loadChat(d.projectId, CHAT_ID);
  if (pendingLook(saved.messages) !== d.lookId) return { ok: true, thread: view(saved.messages), waiting: false };
  const look = await lookForChat(d.projectId, d.lookId);
  if (look.status !== "ready" && look.status !== "failed") return { ok: true, thread: view(saved.messages), waiting: true };
  let reply: ChatMessage;
  // Si con el link pidió «cópiala tal cual» (o hacerlo ya), lo que propone la IA se hace solo.
  let go = false;
  if (look.status === "failed" || !look.text) {
    reply = { role: "assistant", text: `No pude mirar ese video: ${(look.error ?? "algo falló al bajarlo").replace(/[.\s]+$/, "")}. Pégame el link otra vez o prueba con otro.`, at: new Date().toISOString(), lookDone: d.lookId };
  } else {
    try {
      const lastUser = [...saved.messages].reverse().find((m) => m.role === "user")?.text ?? "";
      const out = await turn(d, [...saved.messages, { role: "user", text: "[La app terminó de mirar el video de referencia. Cuéntame qué ves y dónde lo pondrías en mi video, según lo que te pedí.]", at: new Date().toISOString() }], user.id, { source: look.source, text: look.text }, lastUser);
      if ("ok" in out) return out;
      reply = { ...out.message, lookDone: d.lookId };
      go = Boolean(out.go);
    } catch (error) {
      return failOf(error, "referencia");
    }
  }
  // Releer por si otra pestaña ya contestó mientras la IA pensaba.
  const fresh = await loadChat(d.projectId, CHAT_ID);
  if (pendingLook(fresh.messages) !== d.lookId) return { ok: true, thread: view(fresh.messages), waiting: false };
  const next = [...fresh.messages, reply];
  await saveChat(d.projectId, CHAT_ID, { messages: next, agreed: null });
  return { ok: true, thread: view(next), waiting: false, go };
}

const clipInputSchema = inputSchema.omit({ text: true }).extend({ waitId: z.string().regex(/^w[0-9a-z]{4,16}$/) });

/**
 * Lo pregunta el cliente cada pocos segundos mientras la app mira los videos adjuntos. Cuando terminan (o pasa demasiado
 * tiempo), la IA contesta lo que pidió la persona mirando sus hojas de cuadros y su ficha.
 */
export async function videoChatClipAction(input: z.input<typeof clipInputSchema>): Promise<{ ok: true; thread: VideoChatThread; waiting: boolean; go?: boolean } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = clipInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  const d = { ...parsed.data, attachments: [] };
  const saved = await loadChat(d.projectId, CHAT_ID);
  const wait = pendingClipWait(saved.messages);
  if (!wait || wait.id !== parsed.data.waitId) return { ok: true, thread: view(saved.messages), waiting: false };
  await analyzeAttached(wait.clips, user.id);
  const states = await clipStates(wait.clips);
  const late = Date.now() - new Date(wait.at).getTime() > CLIP_WAIT_MAX_MS;
  if (states.some((c) => c.state === "waiting") && !late) return { ok: true, thread: view(saved.messages), waiting: true };
  const failed = states.filter((c) => c.state !== "ready");
  let reply: ChatMessage;
  let go = false;
  if (failed.length === states.length) {
    const why = failed[0]?.state === "waiting" ? "todavía no termino de prepararlo (revisa que el procesador de videos esté encendido)" : (failed[0]?.error ?? "algo falló al prepararlo").replace(/[.\s]+$/, "");
    reply = { role: "assistant", text: `No pude mirar tu video: ${why}. Vuelve a adjuntarlo o prueba con otro.`, at: new Date().toISOString(), clipDone: wait.id };
  } else {
    try {
      const lastUser = [...saved.messages].reverse().find((m) => m.role === "user")?.text ?? "";
      const out = await turn(d, [...saved.messages, { role: "user", text: `[La app terminó de mirar ${states.length > 1 ? "los videos que adjunté" : "el video que adjunté"}: tienes sus cuadros. Contesta lo que te pedí arriba mirándolos.]`, at: new Date().toISOString() }], user.id, null, lastUser);
      if ("ok" in out) return out;
      reply = { ...out.message, clipDone: wait.id };
      go = Boolean(out.go);
    } catch (error) {
      return failOf(error, "video adjunto");
    }
  }
  const fresh = await loadChat(d.projectId, CHAT_ID);
  if (pendingClipWait(fresh.messages)?.id !== wait.id) return { ok: true, thread: view(fresh.messages), waiting: false };
  const next = [...fresh.messages, reply];
  await saveChat(d.projectId, CHAT_ID, { messages: next, agreed: null });
  return { ok: true, thread: view(next), waiting: false, go };
}

/** Anota en la charla lo que se hizo (para que la IA lo sepa la próxima vez). */
export async function videoChatDoneAction(projectId: string, text: string): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  const saved = await loadChat(projectId, CHAT_ID);
  await saveChat(projectId, CHAT_ID, { messages: [...saved.messages, { role: "applied", text: text.slice(0, 300), at: new Date().toISOString() }], agreed: null });
  return { ok: true };
}

/**
 * «Cópiala tal cual»: toda la edición de la última referencia que miró la IA en esta charla, en una sola pieza para todo
 * el video (kit, escenas atadas a palabras y las hojas de la referencia a la vista). Reemplaza la pieza que ya había.
 */
export async function videoChatCopyAction(projectId: string, notes: string): Promise<{ ok: true; count: number; error: string | null } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  if (!FEATURES.copyExact) return { ok: false, error: "Copiar una edición completa todavía no está disponible." };
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación." };
  const saved = await loadChat(projectId, CHAT_ID);
  const lookId = lastLook(saved.messages);
  if (!lookId) return { ok: false, error: "Primero pégame el link del video que quieres copiar." };
  try {
    if (await activeLongRequest(projectId)) return { ok: false, error: LONG_BUSY_MESSAGE };
    const project = await loadProject(projectId);
    const long = (((project?.plan as { compositions?: { id: string; long?: boolean }[] } | null)?.compositions) ?? []).find((c) => c.long);
    const conversation = await videoChatConversation(projectId);
    const r = await copyWholeLook(projectId, lookId, user.id, { notes: String(notes ?? "").slice(0, 1500), conversation, replaceId: long?.id ?? null });
    return { ok: true, count: r.count, error: r.error };
  } catch (error) {
    if (error instanceof ComposRequestError) return { ok: false, error: error.message };
    return failOf(error, "copia exacta");
  }
}
