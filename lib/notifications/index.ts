import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * Avisos de "listo" y "falló" de los trabajos lentos. Se arman a partir de la tabla `jobs` (el worker la actualiza
 * directo en la base y después avisa a la app con /api/worker/avisos; el cron de cada hora barre lo que falte) y de
 * los videos con clon (lib/heygen/service.ts llama a `notify`). Cada aviso tiene una clave única: nunca se repite.
 * Si el trabajo tardó más de un minuto, también sale un correo a quien lo pidió.
 */

export type NotificationInput = {
  key: string;
  userId: string | null;
  tone: "success" | "error";
  title: string;
  body: string;
  href: string;
  /** Mandar correo además del aviso en la app. */
  email: boolean;
  /** Nota al pie del correo (por defecto, la de los trabajos que tardan más de un minuto). */
  footnote?: string;
};

const EMAIL_AFTER_SECONDS = 60;

/** Crea el aviso (si no existía) y manda el correo. Nunca tira error: un aviso que falla no rompe nada. */
export async function notify(input: NotificationInput): Promise<void> {
  try {
    const db = getDb();
    const [row] = await db
      .insert(schema.notifications)
      .values({ key: input.key, userId: input.userId, tone: input.tone, title: input.title.slice(0, 140), body: input.body.slice(0, 400), href: input.href })
      .onConflictDoNothing({ target: schema.notifications.key })
      .returning({ id: schema.notifications.id });
    if (!row || !input.email || !input.userId) return;
    const to = await emailOf(input.userId);
    if (!to) return;
    await sendEmail({
      to,
      subject: input.title,
      heading: input.title,
      intro: input.body,
      actionLabel: input.tone === "success" ? "Abrir" : "Ver qué pasó",
      actionUrl: `${env().NEXT_PUBLIC_APP_URL}${input.href}`,
      footnote: input.footnote ?? "Te avisamos por correo cuando termina un trabajo que tarda más de un minuto, así no tienes que esperar con la pestaña abierta.",
    });
    await db.execute(sql`update notifications set emailed_at = now() where id = ${row.id}`);
  } catch (error) {
    console.error("[avisos]", input.key, error instanceof Error ? error.message : error);
  }
}

async function emailOf(userId: string): Promise<string | null> {
  const result = await getDb().execute<{ email: string }>(sql`
    select u.email from users u join team_members tm on tm.user_id = u.id where u.id = ${userId} and tm.active limit 1
  `);
  return result.rows[0]?.email ?? null;
}

type JobRow = {
  id: string;
  type: string;
  status: "SUCCEEDED" | "FAILED";
  input: Record<string, unknown> | null;
  error_message: string | null;
  video_project_id: string | null;
  created_by: string | null;
  seconds: number;
  project_title: string | null;
  carousel_title: string | null;
};

const quoted = (title: string | null) => (title ? `"${title}"` : "Tu video");

/** Qué aviso corresponde a cada tipo de trabajo terminado (null = ese trabajo no avisa). */
export function jobNotification(job: JobRow): Omit<NotificationInput, "email" | "key" | "userId"> & { emailable: boolean } | null {
  const ok = job.status === "SUCCEEDED";
  const failure = job.error_message?.trim() || "Algo falló al procesarlo. Vuelve a intentarlo; si sigue pasando, avísale a soporte.";
  const id = (k: string) => (typeof job.input?.[k] === "string" ? (job.input[k] as string) : null);
  switch (job.type) {
    case "VIDEO_ANALYZE":
    case "VIDEO_EDIT": {
      if (!job.video_project_id) return null;
      const href = `/editor/${job.video_project_id}`;
      return ok
        ? { tone: "success", title: "Tu video está listo para revisar", body: `${quoted(job.project_title)} ya tiene la edición propuesta: cortes, subtítulos y b-roll. Revísala y expórtala.`, href, emailable: true }
        : { tone: "error", title: "No pudimos preparar tu video", body: failure, href, emailable: true };
    }
    case "VIDEO_RENDER": {
      if (!job.video_project_id) return null;
      const href = `/editor/${job.video_project_id}`;
      return ok
        ? { tone: "success", title: "Tu video está exportado", body: `${quoted(job.project_title)} ya se puede descargar.`, href, emailable: true }
        : { tone: "error", title: "No pudimos exportar tu video", body: failure, href, emailable: true };
    }
    case "CAROUSEL_IMAGES": {
      const carouselId = id("carouselId");
      if (!carouselId) return null;
      const href = `/carruseles/${carouselId}`;
      const name = job.carousel_title ? `"${job.carousel_title}"` : "Tu carrusel";
      return ok
        ? { tone: "success", title: "Las imágenes de tu carrusel están listas", body: `${name} ya tiene sus imágenes. Revísalo y descárgalo.`, href, emailable: true }
        : { tone: "error", title: "No pudimos generar las imágenes", body: failure, href, emailable: true };
    }
    case "CAROUSEL_STYLE": {
      const templateId = id("templateId");
      if (!templateId) return null;
      const href = `/carruseles/plantillas/${templateId}`;
      return ok
        ? { tone: "success", title: "Tu plantilla está lista", body: "Copiamos el diseño del carrusel de referencia. Ya puedes usarla.", href, emailable: false }
        : { tone: "error", title: "No pudimos copiar la plantilla", body: failure, href, emailable: false };
    }
    case "VIDEO_STYLE": {
      const styleId = id("styleId");
      if (!styleId) return null;
      const href = `/editor/estilos/${styleId}`;
      return ok
        ? { tone: "success", title: "Tu estilo de edición está listo", body: "Medimos el video de referencia. Ya puedes editar como ese video.", href, emailable: false }
        : { tone: "error", title: "No pudimos medir el video de referencia", body: failure, href, emailable: false };
    }
    default:
      return null;
  }
}

/** Convierte en avisos los trabajos terminados en los últimos 2 días que todavía no avisaron. */
export async function sweepJobNotifications(limit = 50): Promise<number> {
  const result = await getDb().execute<JobRow>(sql`
    select j.id, j.type, j.status, j.input, j.error_message, j.video_project_id, j.created_by,
      extract(epoch from (j.finished_at - j.created_at))::float as seconds,
      p.title as project_title, c.title as carousel_title
    from jobs j
    left join video_projects p on p.id = j.video_project_id
    left join carousels c on j.type = 'CAROUSEL_IMAGES' and c.id::text = j.input->>'carouselId'
    where j.status in ('SUCCEEDED', 'FAILED')
      and j.finished_at > now() - interval '2 days'
      and j.type in ('VIDEO_ANALYZE', 'VIDEO_EDIT', 'VIDEO_RENDER', 'CAROUSEL_IMAGES', 'CAROUSEL_STYLE', 'VIDEO_STYLE')
      and not exists (select 1 from notifications n where n.key = 'job:' || j.id::text)
    order by j.finished_at
    limit ${limit}
  `);
  let created = 0;
  for (const job of result.rows) {
    const n = jobNotification(job);
    if (!n) continue;
    const { emailable, ...rest } = n;
    await notify({ ...rest, key: `job:${job.id}`, userId: job.created_by, email: emailable && job.seconds >= EMAIL_AFTER_SECONDS });
    created++;
  }
  return created;
}
