import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

/**
 * Correos transaccionales (invitaciones y recuperación de contraseña) con Resend.
 *
 * En desarrollo, si no hay RESEND_API_KEY, el enlace se muestra en la consola del servidor
 * para poder probar sin configurar correo. En producción la falta de configuración es un error.
 */
type Email = {
  to: string;
  subject: string;
  heading: string;
  intro: string;
  /** Sin botón cuando el destinatario no tiene acceso a la app (por ejemplo, un sponsor). */
  actionLabel?: string;
  actionUrl?: string;
  footnote: string;
  bullets?: string[];
  attachments?: { filename: string; content: Buffer }[];
};

function render({ heading, intro, actionLabel, actionUrl, footnote, bullets }: Email): { html: string; text: string } {
  const appName = env().NEXT_PUBLIC_APP_NAME;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;background:#030a22;font-family:Inter,Segoe UI,Arial,sans-serif;color:#dce7f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#07163f;border:1px solid rgba(91,156,225,.32);border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 8px;font-family:'JetBrains Mono',Menlo,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8cc6ff">${esc(appName)}</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#ffffff">${esc(heading)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a7b9d4">${esc(intro)}</p>
${bullets?.length ? `<ul style="margin:0 0 24px;padding-left:18px;font-size:14px;line-height:1.6;color:#dce7f7">${bullets.map((b) => `<li style="margin:0 0 6px">${esc(b)}</li>`).join("")}</ul>` : ""}
${actionUrl && actionLabel ? `<a href="${esc(actionUrl)}" style="display:inline-block;background:#0070f8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:12px">${esc(actionLabel)}</a>` : ""}
<p style="margin:${actionUrl ? 24 : 0}px 0 0;font-size:13px;line-height:1.6;color:#6f84a8">${esc(footnote)}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
  const text = `${heading}\n\n${intro}\n\n${bullets?.length ? `${bullets.map((b) => `- ${b}`).join("\n")}\n\n` : ""}${actionUrl && actionLabel ? `${actionLabel}: ${actionUrl}\n\n` : ""}${footnote}`;
  return { html, text };
}

export async function sendEmail(email: Email): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM, NODE_ENV } = env();
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    if (NODE_ENV !== "production") {
      const files = email.attachments?.map((a) => `${a.filename} (${Math.round(a.content.byteLength / 1024)} KB)`).join(", ");
      console.info(`[correo de prueba] Para: ${email.to} · ${email.subject}\n${email.actionUrl ?? ""}${files ? `\nAdjuntos: ${files}` : ""}`);
      return;
    }
    throw new Error("Falta configurar el correo: agrega RESEND_API_KEY y EMAIL_FROM.");
  }
  const { html, text } = render(email);
  const { error } = await new Resend(RESEND_API_KEY).emails.send({
    from: EMAIL_FROM,
    to: email.to,
    subject: email.subject,
    html,
    text,
    attachments: email.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });
  if (error) throw new Error(`No se pudo enviar el correo: ${error.message}`);
}

export function invitationEmail(to: string, inviterName: string | null, url: string): Email {
  const appName = env().NEXT_PUBLIC_APP_NAME;
  return {
    to,
    subject: `Te invitaron a ${appName}`,
    heading: "Tienes una invitación",
    intro: `${inviterName ? `${inviterName} te invitó` : "Te invitaron"} a ${appName}, el espacio donde se mide, planea y produce el contenido de la marca. Define tu contraseña para entrar.`,
    actionLabel: "Definir mi contraseña",
    actionUrl: url,
    footnote: "El enlace vence en 7 días. Si no esperabas esta invitación, ignora este correo.",
  };
}

export function passwordResetEmail(to: string, url: string): Email {
  return {
    to,
    subject: "Restablece tu contraseña",
    heading: "Restablece tu contraseña",
    intro: "Recibimos un pedido para cambiar la contraseña de tu cuenta. Usa el botón para elegir una nueva.",
    actionLabel: "Elegir una contraseña nueva",
    actionUrl: url,
    footnote: "El enlace vence en 1 hora. Si no lo pediste, ignora este correo: tu contraseña no cambia.",
  };
}

export function weeklyReportEmail(to: string, input: { headline: string; wins: string[]; watch: string[]; ideas: string[]; weekLabel: string }): Email {
  return {
    to,
    subject: `Tu semana: ${input.headline}`.slice(0, 140),
    heading: `Tu semana · ${input.weekLabel}`,
    intro: input.headline,
    bullets: [...input.wins.map((w) => `✓ ${w}`), ...input.watch.map((w) => `! ${w}`), ...input.ideas.map((i) => `Idea: ${i}`)],
    actionLabel: "Ver el resumen completo",
    actionUrl: `${env().NEXT_PUBLIC_APP_URL}/inicio`,
    footnote: "Te llega cada lunes con los números de la semana anterior.",
  };
}

/**
 * Informe mensual con el PDF adjunto. A quien es del equipo se le suma el botón para abrirlo en la app;
 * a un destinatario externo (un sponsor) solo le llega el resumen y el PDF.
 */
export function monthlyReportEmail(
  to: string,
  input: { brandName: string; monthLabel: string; headline: string | null; bullets: string[]; fileName: string; pdf: Buffer; appUrl: string | null },
): Email {
  return {
    to,
    subject: `Informe de ${input.monthLabel} · ${input.brandName}`.slice(0, 140),
    heading: `Informe de ${input.monthLabel}`,
    intro: input.headline ?? `Aquí está el informe de contenido de ${input.brandName} de ${input.monthLabel}. Va adjunto en PDF.`,
    bullets: input.bullets,
    actionLabel: input.appUrl ? "Ver los informes en la app" : undefined,
    actionUrl: input.appUrl ?? undefined,
    footnote: `El informe completo va adjunto (${input.fileName}). Te llega porque estás en la lista de destinatarios del informe mensual de ${input.brandName}.`,
    attachments: [{ filename: input.fileName, content: input.pdf }],
  };
}
