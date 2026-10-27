import "server-only";
import { z } from "zod";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, generateStructured, withAiScope } from "@/lib/ai/client";
import { EDIT_ASSISTANT_RULES, editAssistantSchema, editAssistantTask, type EditAssistantOutput } from "@/lib/ai/prompts/asistente-edicion";
import { attachedClips, clipStates, clipVision } from "./chat-turn";
import { loadProject } from "./service";
import type { Transcript } from "./types";

/**
 * Asistente de pedidos de la pestaña Edición (paso "video.edicion.asistente"): lo que dice la persona → pedidos bien
 * armados (animación, gráfico o su video como b-roll) con su tramo. Los videos adjuntos quedan en la biblioteca y se
 * miran antes, igual que en el chat del video: Claude recibe su ficha y sus hojas de cuadros, y las animaciones llevan
 * esas hojas como referencia de estilo (styleClips).
 */
export const editAssistantInput = z.object({
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
    .array(z.object({ ref: z.string().regex(/^A[1-9]$/), kind: z.enum(["video", "image"]), name: z.string().max(120), duration: z.number().min(0).max(3600).nullable(), libraryId: z.uuid().optional() }))
    .max(8)
    .default([]),
});

/** styleClips: videos adjuntos cuyas hojas de cuadros van como referencia de estilo de la animación. */
export type AssistantItem = EditAssistantOutput["items"][number] & { styleClips?: string[] };

/** Asistente de pedidos: lo que dice la persona → pedidos bien armados para animaciones o gráficos, con su tramo. */
/**
 * Un video adjunto (queda en la biblioteca) se mira antes de armar los pedidos, igual que en el chat: mientras el worker
 * saca sus cuadros y Claude escribe la ficha, se responde `waiting` con los ids y el cliente vuelve a pedir en unos
 * segundos. Después Claude recibe su ficha y sus hojas de cuadros (no solo el nombre del archivo).
 */
type Fail = { ok: false; error: string };

export async function runEditAssistant(d: z.output<typeof editAssistantInput>, userId: string): Promise<{ ok: true; items: AssistantItem[]; note: string; waiting?: string[] } | Fail> {
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
  const clips = attachedClips(d.attachments, d.wish);
  const states = await clipStates(clips.map((c) => c.id));
  const waiting = states.filter((c) => c.state === "waiting").map((c) => c.id);
  if (waiting.length) return { ok: true, items: [], note: "Estoy mirando tu video…", waiting };
  try {
    const brandCtx = await brandContext(await getBrand());
    const seen = await clipVision(clips);
    const byId = new Map(seen.clips.map((c) => [c.id, c]));
    const attachText = d.attachments.length
      ? d.attachments
          .map((a) => {
            const clip = a.libraryId ? byId.get(a.libraryId) : undefined;
            if (clip) return `${a.ref}: el video ${clip.code} de abajo (ya lo miraste cuadro a cuadro).`;
            return `${a.ref}: ${a.kind === "video" ? `video «${a.name}»${a.duration ? `, dura ${a.duration.toFixed(1)} s` : ""}` : `imagen «${a.name}»`}`;
          })
          .join("\n") +
        (seen.text ? `\n\nVIDEOS ADJUNTOS (ya los miraste: su ficha y sus hojas de cuadros van en las imágenes adjuntas). Elige el momento por lo que se ve y descríbelo en el prompt; si es una referencia de estilo, describe lo que ves (personajes, estilo de animación, colores) para la animación. Nunca digas que solo tienes el nombre del archivo.\n${seen.text}` : "")
      : null;
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
          attachments: attachText,
        }),
        schema: editAssistantSchema,
        ...(seen.images.length ? { images: seen.images, imageSizes: seen.sizes } : {}),
        maxTokens: 4000,
        userId,
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
      .filter((it): it is AssistantItem => Boolean(it))
      .map((it): AssistantItem => {
        // Una animación lleva de referencia de estilo las hojas de los videos adjuntos que no van como b-roll en ella.
        if (it.kind !== "animacion" || !seen.clips.length) return it;
        const broll = new Set(it.attachments.filter((a) => a.use === "broll").map((a) => a.ref));
        const style = seen.clips.filter((c) => c.kind === "video" && (c.reference || d.attachments.some((a) => a.libraryId === c.id && !broll.has(a.ref)))).map((c) => c.id);
        return style.length ? { ...it, styleClips: style.slice(0, 2) } : it;
      });
    return { ok: true, items, note: out.note.slice(0, 400) };
  } catch (error) {
    console.error("[editor] asistente:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    return { ok: false, error: error instanceof AiError ? error.userMessage : "No pudimos armar el pedido. Prueba de nuevo." };
  }
}

