import { Notice } from "@/components/ui/feedback";
import { platformFromSlug, platformLabel, type Platform } from "@/lib/social/types";

/** Mensajes al volver del OAuth. La URL solo trae códigos; el texto se arma aquí. */
function reasonMessage(platform: Platform | null, reason: string | undefined): string | null {
  const name = platform ? platformLabel[platform] : "la red";
  switch (reason) {
    case "BAD_ACCOUNT":
      return platform === "INSTAGRAM"
        ? "Tu cuenta de Instagram es personal. Cámbiala a profesional (creador o empresa) desde la app de Instagram y vuelve a conectar."
        : platform === "YOUTUBE"
          ? "Esa cuenta de Google no tiene un canal de YouTube. Vuelve a conectar y elige la cuenta del canal."
          : `${name} no devolvió los datos de la cuenta. Inténtalo de nuevo.`;
    case "MISSING_SCOPES":
      return `Faltan permisos de ${name}. Vuelve a conectar y acepta todos los permisos que se piden.`;
    case "RATE_LIMITED":
      return `${name} pidió esperar un poco. Vuelve a intentarlo en unos minutos.`;
    case "AUTH_EXPIRED":
    case "AUTH_REVOKED":
      return `${name} no aceptó el acceso. Vuelve a intentarlo.`;
    default:
      return null;
  }
}

export async function ConnectNotice({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const connected = get("conectado");
  const error = get("error");
  const platformParam = get("red");
  const platform = platformParam ? ((["INSTAGRAM", "YOUTUBE", "TIKTOK"] as const).find((p) => p === platformParam) ?? null) : null;

  if (connected) {
    const p = platformFromSlug(connected);
    if (!p) return null;
    return (
      <Notice tone="success" title={`${platformLabel[p]} quedó conectado`}>
        Estamos importando tu histórico. Puede tardar unos minutos; los números aparecen en Métricas a medida que llegan.
      </Notice>
    );
  }
  if (!error) return null;

  const name = platform ? platformLabel[platform] : "la red";
  const messages: Record<string, string> = {
    "solo-dueno": "Solo el dueño de la cuenta puede conectar redes.",
    "sin-configurar": `La app de ${name} todavía no está configurada en esta instalación. Avísale a soporte.`,
    "estado-invalido": "El enlace de conexión venció o ya se usó. Vuelve a tocar “Conectar”.",
    cancelado: `Cancelaste la conexión o no aceptaste los permisos de ${name}. Puedes intentarlo de nuevo cuando quieras.`,
    conexion: reasonMessage(platform, get("motivo")) ?? `No pudimos conectar ${name}. Inténtalo de nuevo en unos minutos.`,
    "red-invalida": "Esa red no existe.",
  };
  const text = messages[error];
  if (!text) return null;
  return <Notice tone="danger" title="No se pudo conectar">{text}</Notice>;
}
