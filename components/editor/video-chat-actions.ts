"use server";

import { z } from "zod";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, aiConfigured, generateStructured, withAiScope } from "@/lib/ai/client";
import { VIDEO_CHAT_RULES, videoChatSchema, videoChatTask, type VideoChatOutput } from "@/lib/ai/prompts/chat-video";
import { isDenied, requireEditor } from "@/lib/auth";
import { clearChat, loadChat, saveChat, type ChatMessage } from "@/lib/video/compos/chat";
import { findLinks } from "@/lib/video/director/request";
import { VIDEO_CHAT_ID } from "@/lib/video/chat-conversation";
import { LookError, lookForChat, startLook } from "@/lib/video/look";
import { loadProject } from "@/lib/video/service";
import type { Transcript } from "@/lib/video/types";

/**
 * Chat con la IA del Estudio (panel derecho sin nada elegido): conversa sobre el video y propone acciones con su tramo,
 * que la persona ejecuta con un botón. La charla queda guardada por video (compos_chats con comp_id "video").
 */
type Fail = { ok: false; error: string };
const CHAT_ID = VIDEO_CHAT_ID;
export type VideoChatItem = VideoChatOutput["items"][number];
/** looking: la referencia que la IA está mirando (el cliente pregunta cada pocos segundos hasta que responde). */
export type VideoChatThread = { messages: { role: "user" | "assistant" | "applied"; text: string; at: string; items?: VideoChatItem[] }[]; looking?: string };

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
  return { messages: messages.slice(-120).map((m) => ({ role: m.role, text: m.text, at: m.at, ...(m.items?.length ? { items: m.items as VideoChatItem[] } : {}) })), ...(looking ? { looking } : {}) };
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

const inputSchema = z.object({
  projectId: z.uuid(),
  text: z.string().trim().min(2, "Escribe tu mensaje.").max(2000, "Es demasiado largo: resúmelo un poco."),
  sentences: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0), start: z.number().min(0), end: z.number().min(0), text: z.string().max(600) })).max(800),
  duration: z.number().min(0).max(3600),
  format: z.enum(["9:16", "16:9"]),
  playhead: z.number().min(0).max(3600).nullable(),
  selection: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).nullable(),
  state: z.string().max(6000),
  attachments: z
    .array(z.object({ ref: z.string().regex(/^A[1-9]$/), kind: z.enum(["video", "image"]), name: z.string().max(120), duration: z.number().min(0).max(3600).nullable() }))
    .max(8)
    .default([]),
});

type ChatInput = z.output<typeof inputSchema>;

/** Valida el pedido contra el proyecto y arma lo que la IA necesita ver. */
async function prepare(d: Omit<ChatInput, "text">) {
  const project = await loadProject(d.projectId);
  const words = (project?.transcript as Transcript | null)?.words;
  if (!project || !words?.length) return null;
  const max = words.length - 1;
  const ids = new Set<number>();
  for (const f of d.sentences) for (let id = f.from; id <= Math.min(f.to, max); id++) ids.add(id);
  const sel = d.selection && d.selection.from <= max ? `[${d.selection.from}–${Math.min(d.selection.to, max)}] «${words.slice(d.selection.from, Math.min(d.selection.to, max) + 1).map((w) => w.text).join(" ").slice(0, 400)}»` : null;
  const sentencesText = d.sentences
    .filter((f) => f.from <= max)
    .map((f) => `[${f.from}–${Math.min(f.to, max)}] ${f.start.toFixed(1)}–${f.end.toFixed(1)} s: ${f.text}`)
    .join("\n");
  return { max, ids, sel, sentencesText };
}

/** Un turno de la IA sobre la charla guardada; devuelve el mensaje de respuesta (sin guardarlo). */
async function turn(d: Omit<ChatInput, "text">, messages: ChatMessage[], userId: string, reference: { source: string; text: string } | null, lastText: string): Promise<{ message: ChatMessage; go: boolean } | Fail> {
  const prep = await prepare(d);
  if (!prep) return { ok: false, error: "Este video todavía no tiene transcripción." };
  const { max, ids, sel, sentencesText } = prep;
  const brandCtx = await brandContext(await getBrand());
  const history = messages.slice(-30).map((m) => (m.role === "applied" ? { role: "assistant" as const, text: `[HECHO] ${m.text}` } : { role: m.role, text: m.text }));
  const out = await withAiScope(d.projectId, () =>
    generateStructured({
      feature: "video.chat",
      model: "main",
      context: `${VIDEO_CHAT_RULES}\n\n${brandCtx}`,
      task: videoChatTask({
        sentences: sentencesText.slice(0, 40000),
        duration: d.duration,
        format: d.format,
        playhead: d.playhead,
        selection: sel,
        state: d.state || "(nada todavía)",
        attachments: d.attachments.length ? d.attachments.map((a) => `${a.ref}: ${a.kind === "video" ? `video «${a.name}»${a.duration ? `, dura ${a.duration.toFixed(1)} s` : ""}` : `imagen «${a.name}»`}`).join("\n") : null,
        reference,
        messages: history,
      }),
      schema: videoChatSchema,
      maxTokens: 5000,
      userId,
      fake: () => {
        const f = d.sentences[Math.floor(d.sentences.length / 3)] ?? d.sentences[0];
        const wantsSubs = /subt[ií]tul/i.test(lastText);
        return {
          go: /^(dale|hazlo|ed[ií]talo|cr[eé]ala)/i.test(lastText.trim()),
          reply: reference ? `Ya miré la referencia. Lo que más se puede copiar es el ritmo de sus animaciones; lo pondría en «${f?.text.slice(0, 80) ?? ""}».` : wantsSubs ? "Te propongo ponerle los subtítulos con el estilo de tu marca." : `Buena idea. Lo pondría en «${f?.text.slice(0, 80) ?? ""}».`,
          items: wantsSubs
            ? [{ kind: "subtitulos" as const, scope: "todo" as const, from_word: -1, to_word: -1, title: "Poner subtítulos", prompt: "Subtítulos con el estilo de tu marca.", attachments: [], layout: null }]
            : f
              ? [{ kind: "animacion" as const, scope: "momento" as const, from_word: f.from, to_word: f.to, title: reference ? "Como en la referencia" : "Lo que pediste", prompt: `Sobre «${f.text.slice(0, 120)}»: ${lastText}. Fondo blanco y la frase clave entrando palabra por palabra, con un whoosh suave.`, attachments: [], layout: null }]
              : [],
        };
      },
    }),
  );
  const kinds = new Map(d.attachments.map((a) => [a.ref, a.kind]));
  const items = out.items
    .map((raw) => {
      const it = { ...raw, attachments: raw.attachments.filter((a) => (a.use === "broll" ? kinds.get(a.ref) === "video" : kinds.get(a.ref) === "image" && raw.kind === "animacion")) };
      if (it.kind === "subtitulos" || it.kind === "recortar" || it.kind === "editar") return { ...it, scope: "todo" as const, from_word: -1, to_word: -1 };
      if (it.kind === "video" && !it.attachments.length) return null;
      if (it.scope === "todo") return it.kind === "video" ? null : { ...it, from_word: -1, to_word: -1 };
      const from = Math.max(0, Math.min(it.from_word, it.to_word));
      const to = Math.min(max, Math.max(it.from_word, it.to_word));
      if (!ids.has(from) && !ids.has(to)) return null;
      return { ...it, from_word: from, to_word: to, prompt: it.prompt.slice(0, 1500), title: it.title.slice(0, 80) };
    })
    .filter((it): it is VideoChatItem => Boolean(it));
  return { message: { role: "assistant", text: out.reply.slice(0, 4000), at: new Date().toISOString(), ...(items.length ? { items } : {}) }, go: out.go && items.length > 0 };
}

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
  const messages: ChatMessage[] = [...saved.messages, { role: "user", text: d.text, at: now }];
  try {
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
    const reply = await turn(d, messages, user.id, ref?.text ? { source: ref.source, text: ref.text } : null, d.text);
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
export async function videoChatLookAction(input: z.input<typeof lookInputSchema>): Promise<{ ok: true; thread: VideoChatThread; waiting: boolean } | Fail> {
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
  if (look.status === "failed" || !look.text) {
    reply = { role: "assistant", text: `No pude mirar ese video: ${(look.error ?? "algo falló al bajarlo").replace(/[.\s]+$/, "")}. Pégame el link otra vez o prueba con otro.`, at: new Date().toISOString(), lookDone: d.lookId };
  } else {
    try {
      const lastUser = [...saved.messages].reverse().find((m) => m.role === "user")?.text ?? "";
      const out = await turn(d, [...saved.messages, { role: "user", text: "[La app terminó de mirar el video de referencia. Cuéntame qué ves y dónde lo pondrías en mi video, según lo que te pedí.]", at: new Date().toISOString() }], user.id, { source: look.source, text: look.text }, lastUser);
      if ("ok" in out) return out;
      reply = { ...out.message, lookDone: d.lookId };
    } catch (error) {
      return failOf(error, "referencia");
    }
  }
  // Releer por si otra pestaña ya contestó mientras la IA pensaba.
  const fresh = await loadChat(d.projectId, CHAT_ID);
  if (pendingLook(fresh.messages) !== d.lookId) return { ok: true, thread: view(fresh.messages), waiting: false };
  const next = [...fresh.messages, reply];
  await saveChat(d.projectId, CHAT_ID, { messages: next, agreed: null });
  return { ok: true, thread: view(next), waiting: false };
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
