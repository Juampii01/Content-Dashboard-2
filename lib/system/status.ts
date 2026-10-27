/**
 * Estado del sistema (Ajustes, solo el dueño). Lógica pura: recibe las filas que lee lib/dal/system.ts y arma lo que
 * se muestra, en español claro y sin secretos. También decide cuándo avisar al dueño (claves de los avisos).
 * Sin base ni sesión: se prueba sola (tests/system-status.test.mts).
 */

import { FEATURES } from "@/lib/features";

export type Tone = "success" | "warning" | "danger" | "neutral";
export type PlatformKey = "INSTAGRAM" | "YOUTUBE" | "TIKTOK";

const platformName: Record<PlatformKey, string> = { INSTAGRAM: "Instagram", YOUTUBE: "YouTube", TIKTOK: "TikTok" };
const platformPath: Record<PlatformKey, string> = { INSTAGRAM: "instagram", YOUTUBE: "youtube", TIKTOK: "tiktok" };

// ─── Entradas (filas de la base) ───────────────────────────────────────────

export type WorkerInput = {
  online: boolean;
  lastSeen: Date | null;
  version: string | null;
  autoStart: boolean;
  stuck: number;
  /** Hay WORKER_SECRET: sin él el worker no puede hablar con la app. */
  secretConfigured: boolean;
};

export type FailedJobRow = {
  id: string;
  type: string;
  errorMessage: string | null;
  finishedAt: Date;
  /** id de lo que procesaba (proyecto, estilo, clip, video largo, carrusel, plantilla). */
  refId: string | null;
  refTitle: string | null;
  /**
   * Estado actual de eso que procesaba (si ya se reintentó o se arregló, no se muestra). Para lo que no tiene estado
   * propio (imágenes de carrusel, plantillas) vale "RECOVERED" cuando un intento posterior salió bien.
   */
  refStatus: string | null;
};

export type FailedCloneRow = {
  id: string;
  title: string;
  errorMessage: string | null;
  updatedAt: Date;
  /** Ya llegó a HeyGen: reintentar crea un video nuevo y vuelve a cobrar. */
  reachedHeyGen: boolean;
  retriedInto: string | null;
};

export type ConnectionRow = {
  id: string;
  platform: PlatformKey;
  handle: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "MISSING_SCOPES" | "ERROR" | "DISCONNECTED";
  statusMessage: string | null;
  demo: boolean;
  lastSyncedAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  accessTokenExpiresAt: Date | null;
  hasRefreshToken: boolean;
  lastRunFailed: boolean;
  lastRunError: string | null;
};

export type ServicesInput = {
  anthropic: boolean;
  resend: boolean;
  pexels: boolean;
  pixabay: boolean;
  storage: boolean;
  videoStorage: boolean;
  heygen: boolean;
  heygenWebhookError: string | null;
  openai: boolean;
  platformsConfigured: Record<PlatformKey, boolean>;
};

// ─── Salida ───────────────────────────────────────────────────────────────

export type RetryKind = "video" | "style" | "broll" | "long" | "clone";

export type FailureView = {
  key: string;
  title: string;
  what: string; // qué era: "Video del Editor", "Clips"…
  message: string;
  at: Date;
  href: string;
  /** Acción de reintento disponible (null = se resuelve desde el link). */
  retry: { kind: RetryKind; id: string } | null;
  /** Texto del link cuando no hay reintento directo. */
  hrefLabel: string;
};

export type ConnectionProblem = {
  key: string;
  platform: PlatformKey;
  handle: string;
  tone: Tone;
  label: string;
  message: string;
  reconnectHref: string;
};

export type ServiceView = {
  key: string;
  name: string;
  tone: Tone;
  status: string; // "Configurado", "Falta configurar"…
  message: string;
  /** Lo arregla el cliente desde la app (link) o lo configura quien hizo la instalación (null). */
  href: string | null;
};

export type WorkerView = {
  tone: Tone;
  label: string;
  message: string;
  lastSeen: Date | null;
  version: string | null;
};

export type SystemStatus = {
  worker: WorkerView;
  failures: FailureView[];
  connections: ConnectionProblem[];
  services: ServiceView[];
  /** Problemas que piden atención (para el resumen de arriba). */
  problemCount: number;
};

// ─── Worker ───────────────────────────────────────────────────────────────

export function workerView(w: WorkerInput): WorkerView {
  const base = { lastSeen: w.lastSeen, version: w.version };
  if (!w.secretConfigured) {
    return { ...base, tone: "danger", label: "Sin configurar", message: "Falta la clave compartida del servicio de procesamiento (WORKER_SECRET). Sin ella no se editan videos ni se generan imágenes. Pídele a quien hizo tu instalación que la agregue." };
  }
  if (w.online) {
    return w.stuck > 0
      ? { ...base, tone: "warning", label: "Encendido, con trabajos esperando", message: `Hay ${w.stuck === 1 ? "1 trabajo" : `${w.stuck} trabajos`} en cola hace más de 3 minutos. Si no avanzan en un rato, reinicia el servicio de procesamiento.` }
      : { ...base, tone: "success", label: "Encendido", message: "El servicio que edita tus videos y genera tus imágenes está funcionando." };
  }
  if (w.stuck > 0) {
    return {
      ...base,
      tone: "danger",
      label: "Apagado, con trabajos esperando",
      message: w.autoStart
        ? `Hay ${w.stuck === 1 ? "1 trabajo esperando" : `${w.stuck} trabajos esperando`} y el servicio no arrancó solo. Revisa la máquina del worker en Fly.`
        : `Hay ${w.stuck === 1 ? "1 trabajo esperando" : `${w.stuck} trabajos esperando`}. Enciende el servicio de procesamiento para que avancen.`,
    };
  }
  return {
    ...base,
    tone: "neutral",
    label: w.autoStart ? "En reposo" : "Apagado",
    message: w.autoStart
      ? "Se enciende solo cuando subes un video o pides imágenes, y se apaga cuando termina para no gastar."
      : w.lastSeen
        ? "No está encendido. Los trabajos nuevos esperan en cola hasta que arranque."
        : "Todavía no se conectó nunca. Los videos y las imágenes de carruseles lo necesitan.",
  };
}

// ─── Trabajos fallidos ────────────────────────────────────────────────────

const FALLBACK = "Algo falló al procesarlo. Vuelve a intentarlo; si sigue pasando, avísale a soporte.";

type JobKind = { what: string; href: (id: string) => string; retry: RetryKind | null; hrefLabel: string; failedStatus?: string };

const jobKinds: Record<string, JobKind> = {
  VIDEO_ANALYZE: { what: "Video del Editor", href: (id) => `/editor/${id}`, retry: "video", hrefLabel: "Ver video", failedStatus: "FAILED" },
  VIDEO_EDIT: { what: "Video del Editor", href: (id) => `/editor/${id}`, retry: "video", hrefLabel: "Ver video", failedStatus: "FAILED" },
  VIDEO_RENDER: { what: "Exportación de video", href: (id) => `/editor/${id}`, retry: "video", hrefLabel: "Ver video", failedStatus: "FAILED" },
  VIDEO_STYLE: { what: "Estilo de edición", href: (id) => `/editor/estilos/${id}`, retry: "style", hrefLabel: "Ver estilo", failedStatus: "FAILED" },
  VIDEO_CLIP: { what: "Clip de b-roll", href: () => `/editor/biblioteca`, retry: "broll", hrefLabel: "Ver biblioteca", failedStatus: "FAILED" },
  LONG_VIDEO_CLIPS: { what: "Clips de un video largo", href: (id) => `/editor/clips/${id}`, retry: "long", hrefLabel: "Ver video", failedStatus: "FAILED" },
  CAROUSEL_IMAGES: { what: "Imágenes de carrusel", href: (id) => `/carruseles/${id}`, retry: null, hrefLabel: "Abrir y volver a generar" },
  CAROUSEL_STYLE: { what: "Plantilla de carrusel", href: (id) => `/carruseles/plantillas/${id}`, retry: null, hrefLabel: "Ver plantilla", failedStatus: "FAILED" },
  CAROUSEL_COPY: { what: "Copia de un carrusel", href: (id) => `/carruseles/copiar/${id}`, retry: null, hrefLabel: "Ver y reintentar" },
  CAROUSEL_ANIMATE: { what: "Video de un slide", href: (id) => `/carruseles/${id}`, retry: null, hrefLabel: "Abrir y volver a animar" },
  AUDIO_SPLIT: { what: "Música sacada de un reel", href: () => `/editor/biblioteca#musica`, retry: null, hrefLabel: "Ver y reintentar", failedStatus: "FAILED" },
  REEL_COPY: { what: "Copia de un reel", href: (id) => `/guiones/copiar/${id}`, retry: null, hrefLabel: "Ver y reintentar", failedStatus: "FAILED" },
};

/**
 * Un aviso por cosa (el último fallo de cada proyecto, estilo, clip…). Lo que ya se reintentó o se arregló no se
 * muestra: si el proyecto ya no está en FAILED, el fallo quedó atrás.
 */
export function failureViews(jobs: FailedJobRow[], clones: FailedCloneRow[]): FailureView[] {
  const seen = new Set<string>();
  const out: FailureView[] = [];
  const sorted = [...jobs].sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
  for (const job of sorted) {
    const kind = jobKinds[job.type];
    if (!kind) continue;
    const refKey = `${kind.retry ?? job.type}:${job.refId ?? job.id}`;
    if (seen.has(refKey)) continue;
    seen.add(refKey);
    // Si lo que procesaba ya no existe o ya no está fallido, no hay nada que resolver.
    if (kind.failedStatus && job.refStatus !== kind.failedStatus) continue;
    // Sin estado propio y sin título: lo que procesaba se borró (por ejemplo, el carrusel), ya no hay qué resolver.
    if (!kind.failedStatus && (!job.refId || !job.refTitle)) continue;
    // Lo que no tiene estado propio (imágenes, plantillas): si un intento posterior salió bien, ya está.
    if (job.refStatus === "RECOVERED") continue;
    out.push({
      key: `job:${job.id}`,
      title: job.refTitle?.trim() || kind.what,
      what: kind.what,
      message: job.errorMessage?.trim() || FALLBACK,
      at: job.finishedAt,
      href: kind.href(job.refId ?? ""),
      retry: kind.retry && job.refId ? { kind: kind.retry, id: job.refId } : null,
      hrefLabel: kind.hrefLabel,
    });
  }
  for (const c of clones) {
    if (c.retriedInto) continue;
    out.push({
      key: `clone:${c.id}`,
      title: c.title,
      what: "Video con clon",
      message: c.errorMessage?.trim() || FALLBACK,
      at: c.updatedAt,
      href: `/clon/${c.id}`,
      // Si ya llegó a HeyGen, reintentar vuelve a cobrar: se hace desde su página, donde se ve el costo.
      retry: c.reachedHeyGen ? null : { kind: "clone", id: c.id },
      hrefLabel: c.reachedHeyGen ? "Ver costo y reintentar" : "Ver video",
    });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ─── Conexiones ───────────────────────────────────────────────────────────

const DAY = 86_400_000;

export function connectionProblems(rows: ConnectionRow[], now: Date): ConnectionProblem[] {
  const out: ConnectionProblem[] = [];
  for (const c of rows) {
    if (c.demo || c.status === "DISCONNECTED") continue;
    const name = platformName[c.platform];
    const base = { key: `connection:${c.id}`, platform: c.platform, handle: c.handle, reconnectHref: `/api/social/${platformPath[c.platform]}/connect` };
    switch (c.status) {
      case "EXPIRED":
        out.push({ ...base, tone: "danger", label: "Conexión vencida", message: c.statusMessage || `${name} cerró la sesión. Vuelve a conectarla para que sigan llegando tus métricas.` });
        continue;
      case "REVOKED":
        out.push({ ...base, tone: "danger", label: "Permiso quitado", message: c.statusMessage || `Quitaste el permiso desde ${name}. Vuelve a conectarla si quieres seguir viendo tus números.` });
        continue;
      case "MISSING_SCOPES":
        out.push({ ...base, tone: "warning", label: "Faltan permisos", message: c.statusMessage || `Al conectar ${name} no se aceptaron todos los permisos. Vuelve a conectarla y acepta todos.` });
        continue;
      case "ERROR":
        out.push({ ...base, tone: "danger", label: "Con error", message: c.statusMessage || c.lastRunError || `${name} está respondiendo con errores. Si sigue así mañana, vuelve a conectarla.` });
        continue;
    }
    // ACTIVE: avisar antes de que venza un token que no se puede refrescar solo.
    const expiry = c.hasRefreshToken ? c.refreshTokenExpiresAt : c.accessTokenExpiresAt;
    if (expiry && expiry.getTime() - now.getTime() < 7 * DAY) {
      const days = Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / DAY));
      out.push({ ...base, tone: "warning", label: "Vence pronto", message: days === 0 ? `La conexión con ${name} vence hoy. Vuelve a conectarla para no perder días de métricas.` : `La conexión con ${name} vence en ${days === 1 ? "1 día" : `${days} días`}. Vuelve a conectarla para no perder días de métricas.` });
      continue;
    }
    if (c.lastRunFailed) {
      out.push({ ...base, tone: "warning", label: "Última sincronización falló", message: c.lastRunError || "La última vez no pudimos traer tus números. Lo volvemos a intentar solo; si se repite, vuelve a conectarla." });
    }
  }
  return out;
}

// ─── Servicios y claves ───────────────────────────────────────────────────

export function serviceViews(s: ServicesInput): ServiceView[] {
  const ok = (key: string, name: string, message: string, href: string | null = null): ServiceView => ({ key, name, tone: "success", status: "Configurado", message, href });
  const missing = (key: string, name: string, message: string, href: string | null = null, tone: Tone = "warning"): ServiceView => ({ key, name, tone, status: "Falta configurar", message, href });
  const out: ServiceView[] = [];

  out.push(s.anthropic ? ok("anthropic", "Inteligencia artificial", "Guiones, estratega, informes y planes de edición funcionan.") : missing("anthropic", "Inteligencia artificial", "Sin tu clave de API de Anthropic no se generan guiones, ni el estratega, ni la edición con IA. Agrégala en Ajustes → Claves de servicios.", "/ajustes#claves", "danger"));

  out.push(s.resend ? ok("resend", "Correos", "Invitaciones, recuperación de contraseña, avisos e informes salen por correo.") : missing("resend", "Correos", "No salen invitaciones, recuperación de contraseña ni avisos por correo. Los avisos dentro de la app sí funcionan. Lo configura quien hizo tu instalación."));

  const storage = s.storage && s.videoStorage;
  out.push(storage ? ok("storage", "Archivos", "Tus videos, miniaturas e imágenes se guardan bien.") : missing("storage", "Archivos", !s.storage ? "Falta el almacenamiento de archivos: no se pueden subir videos ni guardar imágenes. Lo configura quien hizo tu instalación." : "Falta el almacenamiento privado de videos: el Editor no puede recibir videos. Lo configura quien hizo tu instalación.", null, "danger"));

  out.push(
    s.pexels || s.pixabay
      ? ok("stock", "B-roll de stock", `El Editor busca tomas de apoyo en ${[s.pexels && "Pexels", s.pixabay && "Pixabay"].filter(Boolean).join(" y ")} además de tu biblioteca.`, "/editor/biblioteca")
      : { key: "stock", name: "B-roll de stock", tone: "neutral", status: "Opcional", message: "Sin Pexels ni Pixabay, el b-roll sale solo de tu biblioteca. Funciona igual; con una de las dos hay más tomas para elegir.", href: "/editor/biblioteca" },
  );

  if (!FEATURES.clone) {
    // Videos con clon apagados (lib/features.ts): HeyGen no se muestra.
  } else if (!s.heygen) out.push({ key: "heygen", name: "HeyGen (videos con clon)", tone: "neutral", status: "Sin conectar", message: "Guarda tu API key de HeyGen para crear tu clon y generar videos con él.", href: "/ajustes#claves" });
  else if (s.heygenWebhookError) out.push({ key: "heygen", name: "HeyGen (videos con clon)", tone: "warning", status: "Conectado, con un detalle", message: `${s.heygenWebhookError} Los videos igual se revisan cada pocos minutos.`, href: "/ajustes#claves" });
  else out.push(ok("heygen", "HeyGen (videos con clon)", "Tu clave está guardada y HeyGen nos avisa cuando termina cada video.", "/ajustes#claves"));

  if (s.openai) {
    out.push(ok("images", "Imágenes", "Se generan con tu clave de API de OpenAI.", "/ajustes#claves"));
  } else {
    out.push({ key: "images", name: "Imágenes", tone: "neutral", status: "Sin conectar", message: "Guarda tu clave de API de OpenAI para generar las imágenes de carruseles, animaciones y miniaturas.", href: "/ajustes#claves" });
  }

  const apps = (Object.keys(s.platformsConfigured) as PlatformKey[]).filter((p) => !s.platformsConfigured[p]);
  if (apps.length > 0) {
    out.push({ key: "apps", name: "Apps de redes", tone: apps.length === 3 ? "warning" : "neutral", status: apps.length === 3 ? "Falta configurar" : "En parte", message: `Todavía no se puede conectar ${apps.map((p) => platformName[p]).join(", ").replace(/, ([^,]*)$/, " ni $1")}: falta configurar la app de esa red en tu instalación.`, href: null });
  }
  return out;
}

export function buildSystemStatus(input: {
  worker: WorkerInput;
  failedJobs: FailedJobRow[];
  failedClones: FailedCloneRow[];
  connections: ConnectionRow[];
  services: ServicesInput;
  now: Date;
}): SystemStatus {
  const worker = workerView(input.worker);
  const failures = failureViews(input.failedJobs, input.failedClones);
  const connections = connectionProblems(input.connections, input.now);
  const services = serviceViews(input.services);
  const problemCount =
    (worker.tone === "danger" || worker.tone === "warning" ? 1 : 0) + failures.length + connections.length + services.filter((s) => s.tone === "danger" || s.tone === "warning").length;
  return { worker, failures, connections, services, problemCount };
}

// ─── Avisos al dueño ──────────────────────────────────────────────────────

/** Estados de una conexión rota (los que piden reconectar). */
export const BROKEN_STATUSES = new Set<ConnectionRow["status"]>(["EXPIRED", "REVOKED", "MISSING_SCOPES", "ERROR"]);

/**
 * Clave del aviso de una conexión rota: una vez por problema. La última sincronización buena marca el episodio:
 * si se reconecta, sincroniza y se vuelve a romper, la clave cambia y se avisa de nuevo.
 */
export function connectionAlertKey(c: Pick<ConnectionRow, "id" | "status" | "demo" | "lastSyncedAt">): string | null {
  if (c.demo || !BROKEN_STATUSES.has(c.status)) return null;
  return `system:connection:${c.id}:${c.status}:${c.lastSyncedAt ? c.lastSyncedAt.getTime() : "nunca"}`;
}

/** Fallos seguidos del worker desde el último trabajo que salió bien. */
export type FailStreak = { count: number; firstFailedId: string | null };

/**
 * Racha de fallos del worker: si van `threshold` o más trabajos seguidos fallidos, devuelve la clave del aviso, atada
 * al primer fallo de la racha (así se avisa una sola vez por racha, aunque sigan fallando).
 */
export function failStreakKey(streak: FailStreak, threshold = 3): string | null {
  if (streak.count < threshold || !streak.firstFailedId) return null;
  return `system:worker-streak:${streak.firstFailedId}`;
}
