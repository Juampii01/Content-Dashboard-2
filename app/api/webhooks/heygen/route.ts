import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import { getDb, schema } from "@/lib/db";
import { findVideoForEvent, getWebhookSecret, refreshCloneVideo } from "@/lib/heygen/service";

/**
 * POST /api/webhooks/heygen: avisos de HeyGen cuando un video termina (avatar_video.success | avatar_video.fail).
 *
 * - Firma: HMAC-SHA256 en hex del body crudo con el secreto del endpoint, en el header `signature`
 *   (developers.heygen.com/docs/webhooks.md). Se verifica sobre el texto tal cual llegó, sin re-serializar,
 *   y se compara en tiempo constante.
 * - Un mismo evento puede llegar más de una vez: se deduplica en `webhook_events` por tipo + video_id.
 * - HeyGen espera respuesta en menos de 10 s: se responde enseguida y el trabajo (consultar el video y copiar
 *   los archivos) sigue con `after()`. El estado se toma de GET /v3/videos/{id}, no del cuerpo del aviso.
 */
const MAX_BODY = 256 * 1024;

function validSignature(raw: string, signature: string, secret: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type HeyGenEvent = { event_id?: string; event_type?: string; event_data?: { video_id?: string; callback_id?: string | null } };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Cuerpo demasiado grande." }, { status: 413 });

  const signature = (request.headers.get("signature") ?? "").trim();
  if (!signature) return NextResponse.json({ error: "Falta la firma." }, { status: 400 });

  const secret = await getWebhookSecret();
  if (!secret || !validSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }

  let event: HeyGenEvent;
  try {
    event = JSON.parse(raw) as HeyGenEvent;
  } catch {
    return NextResponse.json({ error: "El cuerpo no es JSON." }, { status: 400 });
  }

  const type = event.event_type ?? "";
  const videoId = event.event_data?.video_id ?? null;
  if (!type.startsWith("avatar_video.") || !videoId) {
    // Otros eventos (o sin video): se aceptan para que HeyGen no reintente, pero no se procesan.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const key = `heygen:${type}:${videoId}`;
  const inserted = await getDb().insert(schema.webhookEvents).values({ key }).onConflictDoNothing().returning({ key: schema.webhookEvents.key });
  if (inserted.length === 0) return NextResponse.json({ ok: true, duplicate: true });

  const row = await findVideoForEvent(videoId, event.event_data?.callback_id ?? null);
  if (!row) return NextResponse.json({ ok: true, unknown: true });

  after(async () => {
    try {
      await refreshCloneVideo(row.id, { minAgeSec: 0 });
    } catch (error) {
      console.error("[clon] webhook:", error instanceof Error ? error.message : "error");
    }
  });
  return NextResponse.json({ ok: true });
}
