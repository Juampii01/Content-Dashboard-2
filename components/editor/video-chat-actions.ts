"use server";

import { z } from "zod";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, aiConfigured, generateStructured, withAiScope } from "@/lib/ai/client";
import { VIDEO_CHAT_RULES, videoChatSchema, videoChatTask, type VideoChatOutput } from "@/lib/ai/prompts/chat-video";
import { isDenied, requireEditor } from "@/lib/auth";
import { clearChat, loadChat, saveChat, type ChatMessage } from "@/lib/video/compos/chat";
import { loadProject } from "@/lib/video/service";
import type { Transcript } from "@/lib/video/types";

/**
 * Chat con la IA del Estudio (panel derecho sin nada elegido): conversa sobre el video y propone acciones con su tramo,
 * que la persona ejecuta con un botón. La charla queda guardada por video (compos_chats con comp_id "video").
 */
type Fail = { ok: false; error: string };
const CHAT_ID = "video";
export type VideoChatItem = VideoChatOutput["items"][number];
export type VideoChatThread = { messages: { role: "user" | "assistant" | "applied"; text: string; at: string; items?: VideoChatItem[] }[] };

const view = (messages: ChatMessage[]): VideoChatThread => ({ messages: messages.map((m) => ({ role: m.role, text: m.text, at: m.at, ...(m.items?.length ? { items: m.items as VideoChatItem[] } : {}) })) });

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

export async function videoChatAction(input: z.input<typeof inputSchema>): Promise<{ ok: true; thread: VideoChatThread } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  const d = parsed.data;
  if (!aiConfigured()) return { ok: false, error: "La IA no está configurada en esta instalación." };
  const project = await loadProject(d.projectId);
  const words = (project?.transcript as Transcript | null)?.words;
  if (!project || !words?.length) return { ok: false, error: "Este video todavía no tiene transcripción." };
  const max = words.length - 1;
  const ids = new Set<number>();
  for (const f of d.sentences) for (let id = f.from; id <= Math.min(f.to, max); id++) ids.add(id);
  const sel = d.selection && d.selection.from <= max ? `[${d.selection.from}–${Math.min(d.selection.to, max)}] «${words.slice(d.selection.from, Math.min(d.selection.to, max) + 1).map((w) => w.text).join(" ").slice(0, 400)}»` : null;
  const sentencesText = d.sentences
    .filter((f) => f.from <= max)
    .map((f) => `[${f.from}–${Math.min(f.to, max)}] ${f.start.toFixed(1)}–${f.end.toFixed(1)} s: ${f.text}`)
    .join("\n");
  const saved = await loadChat(d.projectId, CHAT_ID);
  const now = new Date().toISOString();
  const messages: ChatMessage[] = [...saved.messages, { role: "user", text: d.text, at: now }];
  try {
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
          messages: history,
        }),
        schema: videoChatSchema,
        maxTokens: 5000,
        userId: user.id,
        fake: () => {
          const f = d.sentences[Math.floor(d.sentences.length / 3)] ?? d.sentences[0];
          const wantsSubs = /subt[ií]tul/i.test(d.text);
          return {
            reply: wantsSubs ? "Te propongo ponerle los subtítulos con el estilo de tu marca." : `Buena idea. Lo pondría en «${f?.text.slice(0, 80) ?? ""}».`,
            items: wantsSubs
              ? [{ kind: "subtitulos" as const, scope: "todo" as const, from_word: -1, to_word: -1, title: "Poner subtítulos", prompt: "Subtítulos con el estilo de tu marca.", attachments: [] }]
              : f
                ? [{ kind: "animacion" as const, scope: "momento" as const, from_word: f.from, to_word: f.to, title: "Lo que pediste", prompt: `Sobre «${f.text.slice(0, 120)}»: ${d.text}. Fondo blanco y la frase clave entrando palabra por palabra, con un whoosh suave.`, attachments: [] }]
                : [],
          };
        },
      }),
    );
    const kinds = new Map(d.attachments.map((a) => [a.ref, a.kind]));
    const items = out.items
      .map((raw) => {
        const it = { ...raw, attachments: raw.attachments.filter((a) => (a.use === "broll" ? kinds.get(a.ref) === "video" : kinds.get(a.ref) === "image" && raw.kind === "animacion")) };
        if (it.kind === "subtitulos" || it.kind === "recortar") return { ...it, scope: "todo" as const, from_word: -1, to_word: -1 };
        if (it.kind === "video" && !it.attachments.length) return null;
        if (it.scope === "todo") return it.kind === "video" ? null : { ...it, from_word: -1, to_word: -1 };
        const from = Math.max(0, Math.min(it.from_word, it.to_word));
        const to = Math.min(max, Math.max(it.from_word, it.to_word));
        if (!ids.has(from) && !ids.has(to)) return null;
        return { ...it, from_word: from, to_word: to, prompt: it.prompt.slice(0, 1500), title: it.title.slice(0, 80) };
      })
      .filter((it): it is VideoChatItem => Boolean(it));
    const next: ChatMessage[] = [...messages, { role: "assistant", text: out.reply.slice(0, 4000), at: new Date().toISOString(), ...(items.length ? { items } : {}) }];
    await saveChat(d.projectId, CHAT_ID, { messages: next, agreed: null });
    return { ok: true, thread: view(next.slice(-120)) };
  } catch (error) {
    console.error("[chat del video]", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    return { ok: false, error: error instanceof AiError ? error.userMessage : "No pudimos responder. Prueba de nuevo." };
  }
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
