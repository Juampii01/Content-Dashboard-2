"use server";

import { z } from "zod";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, aiConfigured, generateStructured, withAiScope } from "@/lib/ai/client";
import { EDIT_ASSISTANT_RULES, editAssistantSchema, editAssistantTask, type EditAssistantOutput } from "@/lib/ai/prompts/asistente-edicion";
import { isDenied, requireEditor } from "@/lib/auth";
import { loadProject, suggestTrim, transcribeAgain, VideoError } from "@/lib/video/service";
import type { BrollOption, Transcript } from "@/lib/video/types";
import { loadClip, pieceOf } from "@/lib/video/library";
import { pieceOption } from "@/lib/video/library-ficha";
import { signBrollOptions, type SignedOption } from "@/lib/dal/editor-media";

/**
 * Acciones de la pestaña Edición del Estudio: cada herramienta corre por separado sobre el video limpio.
 * Ninguna guarda nada: devuelven lo que la revisión aplica (y se deshace con Ctrl+Z) y se guarda con el resto.
 */

type Fail = { ok: false; error: string };

/** «Recortar»: las palabras que cortaría el editor (silencios, tomas repetidas, arranques en falso y muletillas). */
export async function suggestTrimAction(projectId: string): Promise<{ ok: true; removed: number[]; planned: "ai" | "auto" } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Datos no válidos." };
  const project = await loadProject(projectId);
  if (!project || !(project.transcript as Transcript | null)?.words?.length) return { ok: false, error: "Este video todavía no tiene transcripción." };
  try {
    const r = await withAiScope(projectId, () => suggestTrim(project), { userId: user.id });
    return { ok: true, ...r };
  } catch (error) {
    if (error instanceof VideoError) return { ok: false, error: error.message };
    console.error("[editor] recortar:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos buscar los recortes. Prueba de nuevo." };
  }
}

/** «Subtitular» cuando el video no tiene transcripción: la vuelve a crear (el video pasa a procesarse). */
export async function transcribeAgainAction(projectId: string): Promise<{ ok: true } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "Datos no válidos." };
  try {
    await transcribeAgain(projectId, user.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof VideoError) return { ok: false, error: error.message };
    console.error("[editor] transcribir de nuevo:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos crear la transcripción. Prueba de nuevo." };
  }
}

const assistantInput = z.object({
  projectId: z.uuid(),
  wish: z.string().trim().min(3, "Escribe qué quieres.").max(1500, "Es demasiado largo: resúmelo un poco."),
  sentences: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0), start: z.number().min(0), end: z.number().min(0), text: z.string().max(600) })).max(800),
  duration: z.number().min(0).max(3600),
  format: z.enum(["9:16", "16:9"]),
  selection: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).nullable(),
  playhead: z.number().min(0).max(3600).nullable(),
  prefer: z.enum(["animacion", "grafico"]).nullable(),
  /** Videos e imágenes que adjuntó la persona (A1, A2…). */
  attachments: z
    .array(z.object({ ref: z.string().regex(/^A[1-9]$/), kind: z.enum(["video", "image"]), name: z.string().max(120), duration: z.number().min(0).max(3600).nullable() }))
    .max(8)
    .default([]),
});

export type AssistantItem = EditAssistantOutput["items"][number];

/** Asistente de pedidos: lo que dice la persona → pedidos bien armados para animaciones o gráficos, con su tramo. */
export async function editAssistantAction(input: z.input<typeof assistantInput>): Promise<{ ok: true; items: AssistantItem[]; note: string } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = assistantInput.safeParse(input);
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
  const text = d.sentences
    .filter((f) => f.from <= max)
    .map((f) => `[${f.from}–${Math.min(f.to, max)}] ${f.start.toFixed(1)}–${f.end.toFixed(1)} s: ${f.text}`)
    .join("\n");
  try {
    const brandCtx = await brandContext(await getBrand());
    const out = await withAiScope(d.projectId, () =>
      generateStructured({
        feature: "video.edicion.asistente",
        model: "main",
        context: `${EDIT_ASSISTANT_RULES}\n\n${brandCtx}`,
        task: editAssistantTask({
          wish: d.wish,
          sentences: text,
          duration: d.duration,
          format: d.format,
          selection: sel,
          playhead: d.playhead,
          prefer: d.prefer,
          attachments: d.attachments.length ? d.attachments.map((a) => `${a.ref}: ${a.kind === "video" ? `video «${a.name}»${a.duration ? `, dura ${a.duration.toFixed(1)} s` : ""}` : `imagen «${a.name}»`}`).join("\n") : null,
        }),
        schema: editAssistantSchema,
        maxTokens: 4000,
        userId: user.id,
        fake: () => {
          const f = (d.selection ? d.sentences.find((x) => x.from <= d.selection!.from && d.selection!.from <= x.to) : null) ?? d.sentences[Math.floor(d.sentences.length / 3)] ?? d.sentences[0];
          const clip = d.attachments.find((a) => a.kind === "video");
          const images = d.attachments.filter((a) => a.kind === "image");
          return {
            items: f
              ? [
                  ...(clip ? [{ kind: "video" as const, scope: "momento" as const, from_word: f.from, to_word: f.to, title: `Tu video «${clip.name.slice(0, 40)}»`, prompt: "Va donde lo pediste.", attachments: [{ ref: clip.ref, use: "broll" as const }] }] : []),
                  ...(!clip || images.length
                    ? [{ kind: d.prefer ?? ("animacion" as const), scope: "momento" as const, from_word: f.from, to_word: f.to, title: "Lo que pediste", prompt: `Sobre «${f.text.slice(0, 120)}»: ${d.wish}. Fondo blanco, la frase clave entra palabra por palabra en negro con el color de la marca en la palabra más importante, y un whoosh suave al entrar.`, attachments: images.map((a) => ({ ref: a.ref, use: "style" as const })) }]
                    : []),
                ]
              : [],
            note: "",
          };
        },
      }),
    );
    // Solo tramos que existen en el video final (los ids que quedan) y en orden.
    const items = out.items
      .map((raw) => {
        let it = raw;
        // Solo adjuntos que existen y del tipo correcto (un video como b-roll, una imagen en una animación).
        const kinds = new Map(d.attachments.map((a) => [a.ref, a.kind]));
        it = { ...it, attachments: it.attachments.filter((a) => (a.use === "broll" ? kinds.get(a.ref) === "video" : kinds.get(a.ref) === "image" && it.kind === "animacion")) };
        if (it.kind === "video" && !it.attachments.length) return null;
        if (it.scope === "todo") return it.kind === "video" ? null : { ...it, from_word: -1, to_word: -1 };
        const from = Math.max(0, Math.min(it.from_word, it.to_word));
        const to = Math.min(max, Math.max(it.from_word, it.to_word));
        if (!ids.has(from) && !ids.has(to)) return null;
        return { ...it, from_word: from, to_word: to, prompt: it.prompt.slice(0, 1500), title: it.title.slice(0, 80) };
      })
      .filter((it): it is AssistantItem => Boolean(it));
    return { ok: true, items, note: out.note.slice(0, 400) };
  } catch (error) {
    console.error("[editor] asistente:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    return { ok: false, error: error instanceof AiError ? error.userMessage : "No pudimos armar el pedido. Prueba de nuevo." };
  }
}

const clipMetaSchema = z.object({ duration: z.number().min(0).max(3600), width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192) });

/**
 * Un clip que se acaba de subir a la biblioteca, como alternativa de b-roll para ponerlo ya en un tramo. Mientras el
 * worker lo prepara (miniatura, duración) se usan los datos que leyó el navegador; al renderizar, los de la base.
 */
export async function clipOptionAction(clipId: string, meta: z.input<typeof clipMetaSchema>): Promise<{ ok: true; option: SignedOption } | Fail> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const m = clipMetaSchema.safeParse(meta);
  if (!z.uuid().safeParse(clipId).success || !m.success) return { ok: false, error: "Clip no válido." };
  const clip = await loadClip(clipId);
  if (!clip || clip.status === "UPLOADING" || clip.status === "FAILED") return { ok: false, error: clip?.status === "FAILED" ? "No pudimos preparar ese clip. Súbelo de nuevo." : "El clip todavía no terminó de subir." };
  // Lista: con su tipo (una imagen es b-roll fijo). Recién subido: con lo que midió el navegador.
  const option: BrollOption =
    clip.status === "READY"
      ? pieceOption(pieceOf(clip))
      : {
          source: "library",
          id: clip.id,
          duration: clip.duration ?? m.data.duration,
          width: clip.width ?? m.data.width,
          height: clip.height ?? m.data.height,
          key: clip.fileKey,
          thumbKey: clip.thumbKey,
          title: clip.title,
        };
  const [signed] = await signBrollOptions([option]);
  return signed ? { ok: true, option: signed } : { ok: false, error: "No pudimos preparar el clip." };
}
