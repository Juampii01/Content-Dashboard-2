import "server-only";
import { env } from "@/lib/env";

/**
 * Cliente tipado de la API v3 de HeyGen (nada de v1/v2: dejan de funcionar el 31-oct-2026).
 *
 * Documentación consultada el 18-oct-2026 en developers.heygen.com:
 * - users/me: /reference/get-current-user.md
 * - avatares (looks): /docs/avatars.md y /docs/avatar-looks.md
 * - voces: /docs/voices/overview.md
 * - videos: /reference/create-video.md y /reference/get-video.md
 * - webhooks: /docs/webhooks.md y /docs/webhook-events.md
 *
 * Todas las respuestas vienen en `{ data: ... }` y los errores en `{ error: { code, message, ... } }`.
 * Las listas paginan por cursor: `?limit=&token=` → `{ data, has_more, next_token }`.
 * La API key es del cliente: se recibe ya descifrada y nunca se registra en logs.
 */

// ─── Tipos de la API ──────────────────────────────────────────────────────

export type HeyGenEngine = "avatar_iii" | "avatar_iv" | "avatar_v";
export type HeyGenAspectRatio = "9:16" | "1:1" | "16:9";
export type HeyGenResolution = "1080p" | "720p";

export type HeyGenUser = {
  username: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  billing_type?: "wallet" | "subscription" | "usage_based" | null;
  wallet?: {
    currency: "usd" | "credits";
    remaining_balance?: number | null;
    auto_reload?: { enabled: boolean; threshold_usd?: number | null; amount_usd?: number | null } | null;
  } | null;
  subscription?: {
    plan: string;
    credits: {
      premium_credits?: { remaining?: number | null; resets_at?: string | null } | null;
      add_on_credits?: { remaining?: number | null; resets_at?: string | null } | null;
    };
  } | null;
  usage_based?: {
    spending_current_usd?: number | null;
    spending_cap_usd?: number | null;
    included_credits?: number | null;
    remaining_credits?: number | null;
  } | null;
};

/** Un "look" de avatar. Su `id` es el que va como `avatar_id` al crear un video. */
export type HeyGenLook = {
  id: string;
  name: string;
  avatar_type: "studio_avatar" | "digital_twin" | "photo_avatar" | string;
  group_id: string | null;
  gender: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  default_voice_id: string | null;
  tags?: string[];
  supported_api_engines?: HeyGenEngine[];
  status?: "processing" | "completed" | "failed" | null;
};

export type HeyGenVoice = {
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  preview_audio_url: string | null;
  support_pause?: boolean;
  support_locale?: boolean;
  type: "public" | "private";
};

export type HeyGenPage<T> = { data: T[]; has_more: boolean; next_token: string | null };

export type CreateAvatarVideoInput = {
  type: "avatar";
  avatar_id: string;
  script: string;
  voice_id: string;
  engine: { type: HeyGenEngine };
  title?: string;
  voice_settings?: { speed?: number };
  background?: { type: "color"; value: string };
  caption?: { file_format: "srt"; style?: "default" | null };
  resolution?: HeyGenResolution;
  aspect_ratio?: HeyGenAspectRatio;
  callback_id?: string;
};

export type HeyGenVideoStatus = "pending" | "processing" | "completed" | "failed";

export type HeyGenVideo = {
  id: string;
  title?: string | null;
  status: HeyGenVideoStatus | string;
  created_at?: number | null;
  completed_at?: number | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  gif_url?: string | null;
  captioned_video_url?: string | null;
  subtitle_url?: string | null;
  duration?: number | null;
  failure_code?: string | null;
  failure_message?: string | null;
  video_page_url?: string | null;
};

export type HeyGenWebhookEndpoint = {
  endpoint_id: string;
  url: string;
  events: string[] | null;
  status?: string;
  created_at?: string | number;
  secret?: string | null;
};

// ─── Errores ──────────────────────────────────────────────────────────────

export type HeyGenErrorKind =
  | "INVALID_KEY" // 401: key inválida, vencida o revocada
  | "NO_CREDITS" // saldo de API insuficiente (o el plan web no incluye API)
  | "NOT_READY" // 409: el avatar todavía se está procesando
  | "RATE_LIMITED" // 429
  | "INVALID" // 400: algún dato no sirve
  | "NOT_FOUND" // 404
  | "UNAVAILABLE" // red caída, timeout o 5xx
  | "UNKNOWN";

/** Error de HeyGen ya traducido: `userMessage` se muestra tal cual (qué pasó y qué hacer). `detail` es para logs, sin secretos. */
export class HeyGenError extends Error {
  constructor(
    readonly kind: HeyGenErrorKind,
    readonly userMessage: string,
    readonly detail: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
    readonly retryAfterSec: number | null = null,
  ) {
    super(userMessage);
    this.name = "HeyGenError";
  }
}

const NO_CREDITS_MESSAGE =
  "Tu cuenta de HeyGen no tiene saldo de API suficiente. El saldo de la API se carga aparte del plan web (Creator o Pro no lo incluyen): cárgalo en app.heygen.com → Developers y vuelve a intentarlo.";

function classify(status: number, body: unknown, headers: Headers, path: string): HeyGenError {
  const err = (body as { error?: { code?: string; message?: string; param?: string | null; request_id?: string } } | null)?.error;
  const code = err?.code ?? null;
  const apiMessage = err?.message ?? "";
  const detail = `${status} ${path}${code ? ` ${code}` : ""}${apiMessage ? `: ${apiMessage.slice(0, 300)}` : ""}${err?.request_id ? ` (request ${err.request_id})` : ""}`;
  const lowered = `${code ?? ""} ${apiMessage}`.toLowerCase();

  if (status === 401) {
    return new HeyGenError(
      "INVALID_KEY",
      "HeyGen no acepta la API key: es incorrecta, se venció o la revocaron. Copia una nueva en app.heygen.com → Settings → API y guárdala en Ajustes.",
      detail,
      status,
      code,
    );
  }
  if (status === 402 || /insufficient|credit|balance|quota|payment|billing/.test(lowered)) {
    return new HeyGenError("NO_CREDITS", NO_CREDITS_MESSAGE, detail, status, code);
  }
  if (status === 403) {
    return new HeyGenError(
      "NO_CREDITS",
      "Tu cuenta de HeyGen no tiene acceso a la API. El plan web no incluye la API: actívala cargando saldo en app.heygen.com → Developers.",
      detail,
      status,
      code,
    );
  }
  if (status === 409 && code === "request_in_progress") {
    return new HeyGenError("RATE_LIMITED", "HeyGen todavía está procesando este mismo pedido. Espera unos segundos.", detail, status, code, 2);
  }
  if (status === 409) {
    return new HeyGenError(
      "NOT_READY",
      "Ese avatar todavía no está listo en HeyGen (se está entrenando o falta el consentimiento). Revisa su estado en HeyGen y vuelve a intentarlo cuando aparezca como listo.",
      detail,
      status,
      code,
    );
  }
  if (status === 429) {
    const retry = Number(headers.get("retry-after"));
    return new HeyGenError(
      "RATE_LIMITED",
      "HeyGen está recibiendo demasiados pedidos de tu cuenta (en pago por uso se generan hasta 10 videos a la vez). Espera un minuto y vuelve a intentarlo.",
      detail,
      status,
      code,
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  if (status === 404) {
    return new HeyGenError("NOT_FOUND", "HeyGen no encuentra ese recurso. Puede que lo hayan borrado desde la web de HeyGen.", detail, status, code);
  }
  if (status === 400 || status === 422) {
    const avatarIssue = code === "avatar_not_usable";
    const engineIssue = /engine/.test(lowered);
    return new HeyGenError(
      "INVALID",
      avatarIssue
        ? "HeyGen no permite usar ese avatar (no pasó su revisión de contenido). Elige otro avatar."
        : engineIssue
          ? "Ese avatar no admite el motor elegido. Elige otro motor en el paso de ajustes."
          : "HeyGen rechazó uno de los datos del video. Revisa el texto, el avatar y la voz, y vuelve a intentarlo.",
      detail,
      status,
      code,
    );
  }
  if (status >= 500) {
    return new HeyGenError("UNAVAILABLE", "HeyGen no está respondiendo bien en este momento. Vuelve a intentarlo en unos minutos.", detail, status, code);
  }
  return new HeyGenError("UNKNOWN", "HeyGen devolvió un error inesperado. Vuelve a intentarlo en unos minutos.", detail, status, code);
}

// ─── Cliente ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export type HeyGenClient = ReturnType<typeof createHeyGenClient>;

/** Crea un cliente para una API key. Base configurable con HEYGEN_API_BASE (por defecto https://api.heygen.com). */
export function createHeyGenClient(apiKey: string, options?: { baseUrl?: string }) {
  const base = (options?.baseUrl ?? env().HEYGEN_API_BASE).replace(/\/+$/, "");

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { "X-Api-Key": apiKey, Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    // El mismo Idempotency-Key en los reintentos: si el primer intento llegó, HeyGen devuelve la misma respuesta.
    if (method === "POST" && opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let last: HeyGenError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
          cache: "no-store",
        });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        last = new HeyGenError(
          "UNAVAILABLE",
          timeout ? "HeyGen tardó demasiado en responder. Vuelve a intentarlo en unos minutos." : "No pudimos conectarnos con HeyGen. Revisa tu conexión y vuelve a intentarlo.",
          `${method} ${path}: ${error instanceof Error ? error.name : "error"}`,
        );
        // Sin Idempotency-Key, un POST que quizá llegó no se repite (podría crear dos videos).
        if (method === "POST" && !opts.idempotencyKey) throw last;
        await sleep(600 * 2 ** attempt);
        continue;
      }

      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (res.ok) return body as T;

      const error = classify(res.status, body, res.headers, `${method} ${path}`);
      const canRetry =
        attempt < 2 &&
        ((error.kind === "RATE_LIMITED" && (error.retryAfterSec ?? 1) <= 10) ||
          (error.kind === "UNAVAILABLE" && (method === "GET" || Boolean(opts.idempotencyKey))));
      if (!canRetry) throw error;
      last = error;
      await sleep(error.retryAfterSec ? error.retryAfterSec * 1000 : 800 * 2 ** attempt);
    }
    throw last ?? new HeyGenError("UNKNOWN", "HeyGen devolvió un error inesperado.", `${method} ${path}`);
  }

  function page<T>(raw: { data?: T[]; has_more?: boolean; next_token?: string | null } | null): HeyGenPage<T> {
    return { data: raw?.data ?? [], has_more: Boolean(raw?.has_more), next_token: raw?.has_more ? (raw?.next_token ?? null) : null };
  }

  return {
    /** Perfil y saldo de la cuenta. También sirve para validar la key. */
    async getMe(): Promise<HeyGenUser> {
      const res = await request<{ data: HeyGenUser }>("/v3/users/me");
      return res.data;
    },

    /** Looks de avatares (cada uno se puede usar como `avatar_id`). `ownership: private` = los del cliente. */
    async listLooks(params: { ownership?: "private" | "public"; limit?: number; token?: string | null } = {}): Promise<HeyGenPage<HeyGenLook>> {
      const res = await request<{ data: HeyGenLook[]; has_more: boolean; next_token: string | null }>("/v3/avatars/looks", {
        query: { ownership: params.ownership, limit: params.limit ?? 24, token: params.token },
      });
      return page(res);
    },

    async listVoices(
      params: { type?: "private" | "public"; language?: string; limit?: number; token?: string | null } = {},
    ): Promise<HeyGenPage<HeyGenVoice>> {
      const res = await request<{ data: HeyGenVoice[]; has_more: boolean; next_token: string | null }>("/v3/voices", {
        query: { type: params.type, language: params.language, limit: params.limit ?? 30, token: params.token },
      });
      return page(res);
    },

    async createVideo(input: CreateAvatarVideoInput, idempotencyKey: string): Promise<{ video_id: string; status: string }> {
      const res = await request<{ data: { video_id: string; status: string } }>("/v3/videos", {
        method: "POST",
        body: input,
        idempotencyKey,
        timeoutMs: 30_000,
      });
      return res.data;
    },

    async getVideo(videoId: string): Promise<HeyGenVideo> {
      const res = await request<{ data: HeyGenVideo }>(`/v3/videos/${encodeURIComponent(videoId)}`);
      return res.data;
    },

    /** Registra un endpoint de webhook. El `secret` llega solo en esta respuesta: hay que guardarlo. */
    async createWebhookEndpoint(input: { url: string; events: string[] }, idempotencyKey: string): Promise<HeyGenWebhookEndpoint> {
      const res = await request<{ data: HeyGenWebhookEndpoint }>("/v3/webhooks/endpoints", { method: "POST", body: input, idempotencyKey });
      return res.data;
    },

    async listWebhookEndpoints(token?: string | null): Promise<HeyGenPage<HeyGenWebhookEndpoint>> {
      const res = await request<{ data: HeyGenWebhookEndpoint[]; has_more: boolean; next_token: string | null }>("/v3/webhooks/endpoints", {
        query: { limit: 100, token },
      });
      return page(res);
    },

    async deleteWebhookEndpoint(endpointId: string): Promise<void> {
      await request(`/v3/webhooks/endpoints/${encodeURIComponent(endpointId)}`, { method: "DELETE" });
    },
  };
}

// ─── Saldo ────────────────────────────────────────────────────────────────

/**
 * Saldo de la cuenta en una forma simple para la interfaz y la estimación.
 * - `usd`: billetera en dólares (pago por uso de la API, lo normal).
 * - `credits`: billetera en créditos.
 * - `unknown`: plan de suscripción o uso facturado sin saldo comparable; se muestra lo que haya y no se bloquea.
 */
export type HeyGenBalance = {
  unit: "usd" | "credits" | "unknown";
  amount: number | null;
  billingType: string | null;
  plan: string | null;
  autoReload: boolean;
  note: string | null;
};

export function balanceFromUser(user: HeyGenUser): HeyGenBalance {
  const billingType = user.billing_type ?? null;
  if (user.wallet) {
    return {
      unit: user.wallet.currency === "credits" ? "credits" : "usd",
      amount: user.wallet.remaining_balance ?? null,
      billingType,
      plan: null,
      autoReload: Boolean(user.wallet.auto_reload?.enabled),
      note: user.wallet.auto_reload?.enabled ? "Tiene recarga automática activada." : null,
    };
  }
  if (user.usage_based) {
    const cap = user.usage_based.spending_cap_usd;
    const spent = user.usage_based.spending_current_usd ?? 0;
    if (cap != null) {
      return { unit: "usd", amount: Math.max(0, cap - spent), billingType, plan: null, autoReload: false, note: "Disponible hasta tu tope de gasto." };
    }
    if (user.usage_based.remaining_credits != null) {
      return { unit: "credits", amount: user.usage_based.remaining_credits, billingType, plan: null, autoReload: false, note: null };
    }
    return { unit: "unknown", amount: null, billingType, plan: null, autoReload: false, note: "Tu cuenta se factura por uso, sin tope de gasto." };
  }
  if (user.subscription) {
    const credits = (user.subscription.credits.premium_credits?.remaining ?? 0) + (user.subscription.credits.add_on_credits?.remaining ?? 0);
    return {
      unit: "unknown",
      amount: null,
      billingType,
      plan: user.subscription.plan,
      autoReload: false,
      note: `Tu cuenta usa los créditos del plan ${user.subscription.plan} (${credits} disponibles). Para generar por API, HeyGen cobra del saldo de la API, que se carga aparte.`,
    };
  }
  return { unit: "unknown", amount: null, billingType, plan: null, autoReload: false, note: null };
}
