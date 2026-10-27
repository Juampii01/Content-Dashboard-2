import "server-only";
import { loadChat } from "./compos/chat";
import { lookForChat } from "./look";
import { markersForPrompt } from "./markers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { buildTimeline } from "./timeline";
import type { EditPlan, MediaInfo, Transcript } from "./types";

/** La charla del Chat con la IA del Estudio (compos_chats con comp_id "video"). */
export const VIDEO_CHAT_ID = "video";

/**
 * La charla con la IA del Estudio, entera y en orden, para mandarla tal cual a cada animación que sale de ahí (nada se
 * resume). Incluye lo que ya se hizo y, si se miró un video de referencia, lo que la IA vio en él.
 */
export async function videoChatConversation(projectId: string): Promise<string> {
  const { messages } = await loadChat(projectId, VIDEO_CHAT_ID);
  const lines: string[] = [];
  let lastLook: string | null = null;
  for (const m of messages) {
    if (m.lookDone) lastLook = m.lookDone;
    if (m.role === "applied") lines.push(`[HECHO] ${m.text}`);
    else lines.push(`${m.role === "user" ? "PERSONA" : "IA"}: ${m.text}`);
  }
  let out = lines.join("\n");
  // Los marcadores con nota del video («en el marcador 2…»), para que cada animación sepa dónde es.
  const markers = await markersOfProject(projectId).catch(() => "");
  if (markers) out = `${out}\n\nMARCADORES DEL VIDEO (puntos con nota que puso la persona, numerados por su orden en el video):\n${markers}`;
  if (lastLook) {
    const look = await lookForChat(projectId, lastLook).catch(() => null);
    // Al final: si la charla es muy larga se recorta el principio, nunca la referencia ni lo último que se acordó.
    if (look?.text) out = `${out}\n\nVIDEO DE REFERENCIA QUE SE MIRÓ EN LA CHARLA (${look.source}), desarmado en momentos (copia cómo está editado, nunca su contenido):\n${look.text.slice(0, 8000)}`;
  }
  return out;
}

async function markersOfProject(projectId: string): Promise<string> {
  const [project] = await getDb().select({ plan: schema.videoProjects.plan, transcript: schema.videoProjects.transcript, media: schema.videoProjects.media }).from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  const plan = project?.plan as EditPlan | null;
  const transcript = project?.transcript as Transcript | null;
  if (!plan?.markers?.length || !transcript?.words.length) return "";
  return markersForPrompt(buildTimeline(transcript.words, plan, (project?.media as MediaInfo | null)?.duration || transcript.duration), plan.markers);
}
