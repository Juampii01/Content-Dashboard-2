/**
 * Director de edición: tipos compartidos (app, navegador y pruebas; sin nada de servidor).
 *
 * El director mira el video (hojas de contacto y medidas del worker, "ojos"), lo entiende (mapa del video), lee el
 * brief de la persona (o lo infiere) y decide toda la edición junta: cortes, orden, gancho, b-roll, gráficos, palabras
 * resaltadas, zooms y ritmo, cada cosa con su "por qué". Antes de renderizar, un crítico mira cuadros del plan armado
 * (segunda mirada) y, después del render, cuadros del MP4 final (revisión final).
 */
import { z } from "zod";
import type { BrollItem } from "../types";
import type { BudgetPlan, StagePlan } from "./cost";
import type { RequestLocks } from "./locks";
import type { DirectorReference, ReferenceSource } from "./reference";
import type { ComplianceItem, PlanBaseline } from "./request";

// ─── Ojos (lo que mide el worker, worker/video/eyes.py) ──────────────────

export type EyesFace = { x: number; y: number; w: number; h: number; score: number; frontal: boolean; yaw: number };

export type EyesSample = {
  /** Número del cuadro en las hojas de contacto (empieza en 1). */
  i: number;
  /** Segundo del original. */
  t: number;
  scene: boolean;
  face: EyesFace | null;
  faces: number;
  sharp: number;
  luma: number;
  clipped: number;
  crushed: number;
  backlit: boolean;
  shift: number;
  text: string;
  textBand: [number, number] | null;
  energy: number | null;
};

export type EyesTramo = {
  id: string;
  start: number;
  end: number;
  sceneStart: boolean;
  samples: number[];
  faceRatio: number;
  frontalRatio: number;
  face: { x: number; y: number; w: number; h: number } | null;
  sharp: number;
  blurry: boolean;
  luma: number;
  dark: boolean;
  bright: boolean;
  backlit: boolean;
  motion: number;
  shaky: boolean;
  text: string;
  textBand: [number, number] | null;
  energy: number | null;
};

export type EyesSheet = { key: string; frames: number[]; width: number; height: number };

export type Eyes = {
  version: 1;
  duration: number;
  width: number;
  height: number;
  scenes: number[];
  samples: EyesSample[];
  tramos: EyesTramo[];
  sheets: EyesSheet[];
  layout: { tileW: number; tileH: number; cols: number; rows: number; labelH: number };
  stats: { frames: number; faceRatio: number; frontalRatio: number; sharpMedian: number; scenes: number; ocr: number };
  notes: string[];
};

// ─── Brief ────────────────────────────────────────────────────────────────

export const BRIEF_GOALS = ["anuncio", "educar", "vender", "historia", "otro"] as const;
export type BriefGoal = (typeof BRIEF_GOALS)[number];

export const BRIEF_GOAL_LABELS: Record<BriefGoal, string> = {
  anuncio: "Anuncio",
  educar: "Educar",
  vender: "Vender",
  historia: "Contar una historia",
  otro: "Otro",
};

export const briefSchema = z.object({
  goal: z.enum(BRIEF_GOALS).nullable(),
  audience: z.string().trim().max(300),
  cta: z.string().trim().max(300),
  mustKeep: z.string().trim().max(400),
  /** Notas libres para el director ("que se note el producto", "tono serio"). */
  notes: z.string().trim().max(600),
  /** Un video de referencia para la edición (link de Instagram, TikTok o YouTube): se imita su edición, no su contenido. */
  reference: z
    .string()
    .trim()
    .max(500)
    .refine((v) => !v || /^https:\/\/([a-z0-9-]+\.)*(instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\//i.test(v), "Pega un link de Instagram, TikTok o YouTube.")
    .optional(),
});
export type Brief = z.infer<typeof briefSchema>;

export const EMPTY_BRIEF: Brief = { goal: null, audience: "", cta: "", mustKeep: "", notes: "" };

/** Tope de gasto de IA por video (USD). */
export const BUDGET = { min: 1, default: 8, max: 20 } as const;

// ─── Mapa del video (lo que entendió) ─────────────────────────────────────

export const VIDEO_KINDS = ["talking_head", "anuncio", "demo_pantalla", "varias_personas", "exterior", "entrevista", "otro"] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];
export const VIDEO_KIND_LABELS: Record<VideoKind, string> = {
  talking_head: "Hablando a cámara",
  anuncio: "Anuncio",
  demo_pantalla: "Demo de pantalla",
  varias_personas: "Varias personas",
  exterior: "Exterior",
  entrevista: "Entrevista",
  otro: "Otro",
};

export const SHOT_KINDS = ["a_camara", "producto", "pantalla", "gesto", "b_roll_propio", "texto", "otro"] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];
export const SHOT_KIND_LABELS: Record<ShotKind, string> = {
  a_camara: "A cámara",
  producto: "Producto",
  pantalla: "Pantalla",
  gesto: "Gesto clave",
  b_roll_propio: "Toma de apoyo",
  texto: "Texto en pantalla",
  otro: "Otro",
};

export const BAD_TAKE_KINDS = ["fuera_de_cuadro", "mira_a_otro_lado", "borroso", "contraluz", "oscuro", "movido", "repetida", "otro"] as const;
export type BadTakeKind = (typeof BAD_TAKE_KINDS)[number];
export const BAD_TAKE_LABELS: Record<BadTakeKind, string> = {
  fuera_de_cuadro: "Fuera de cuadro",
  mira_a_otro_lado: "Mira a otro lado",
  borroso: "Borroso",
  contraluz: "A contraluz",
  oscuro: "Muy oscuro",
  movido: "Cámara movida",
  repetida: "Toma repetida",
  otro: "Toma mala",
};

export const BEAT_ROLES = ["gancho", "problema", "promesa", "punto", "prueba", "cifra", "objecion", "oferta", "cta", "historia", "otro"] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];
export const BEAT_LABELS: Record<BeatRole, string> = {
  gancho: "Gancho",
  problema: "Problema",
  promesa: "Promesa",
  punto: "Punto clave",
  prueba: "Prueba",
  cifra: "Cifra",
  objecion: "Objeción",
  oferta: "Oferta",
  cta: "Llamado a la acción",
  historia: "Historia",
  otro: "Otro",
};

/** Un tramo del video (en palabras y en segundos del original). */
export type MapShot = { from: number; to: number; start: number; end: number; kind: ShotKind; shows: string; important: boolean; why: string; frame: number | null };
export type MapBadTake = { from: number; to: number; start: number; end: number; kind: BadTakeKind; note: string; frame: number | null };
export type MapText = { start: number; end: number; text: string; band: "arriba" | "centro" | "abajo" };
export type MapBeat = { from: number; to: number; role: BeatRole; summary: string };

export type VideoMap = {
  kind: VideoKind;
  /** Una frase: qué es el video y para qué sirve. */
  summary: string;
  setting: string;
  shots: MapShot[];
  badTakes: MapBadTake[];
  onScreenText: MapText[];
  beats: MapBeat[];
  figures: string[];
  promise: string;
  objection: string;
  cta: string;
  /** Lo que la IA infiere del brief (se muestra para confirmar si la persona no lo llenó). */
  inferredBrief: Brief;
  /** "ai": Claude miró las hojas; "medidas": se armó solo con las medidas (sin imágenes o sin IA). */
  by: "ai" | "medidas";
  frames: number;
};

// ─── Segunda mirada y revisión final ─────────────────────────────────────

export const ISSUE_KINDS = ["salto", "frase_cortada", "broll_no_corresponde", "tapa_importante", "subtitulo_sobre_texto", "gancho_confuso", "final_abrupto", "toma_mala", "ritmo", "otro"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const ISSUE_LABELS: Record<IssueKind, string> = {
  salto: "Salto feo",
  frase_cortada: "Frase cortada",
  broll_no_corresponde: "B-roll que no corresponde",
  tapa_importante: "Tapa algo importante",
  subtitulo_sobre_texto: "Subtítulos encima de texto",
  gancho_confuso: "Gancho que no se entiende solo",
  final_abrupto: "Final abrupto",
  toma_mala: "Toma mala",
  ritmo: "Ritmo",
  otro: "Otro",
};

export type CriticIssue = {
  kind: IssueKind;
  severity: "alta" | "media" | "baja";
  /** Segundo del video final donde está. */
  at: number;
  note: string;
  /** Qué hacer, dicho como un pedido al director ("No tapes el panel con el gráfico 2"). */
  fix: string;
  /** "reglas": lo encontró una verificación automática; "ai": el crítico con visión. */
  by: "reglas" | "ai";
};

export type CriticRound = {
  n: number;
  score: number;
  verdict: string;
  issues: CriticIssue[];
  /** Hojas con los cuadros que se miraron. */
  sheets: string[];
  frames: number;
  fixed: boolean;
  at: string;
};

export type FinalReview = {
  score: number;
  ok: boolean;
  verdict: string;
  issues: CriticIssue[];
  sheets: string[];
  /** Instantes de los cuadros de las hojas (en orden: #1, #2…). */
  frames: number[];
  at: string;
  by: "ai" | "reglas";
};

// ─── Edítalo así, versiones y costo ───────────────────────────────────────

export type EditRequest = {
  at: string;
  instruction: string;
  changes: string[];
  note: string;
  source: "persona" | "arreglo";
  /** Id del pedido (las vueltas de un mismo pedido actualizan la misma entrada). */
  id?: string;
  /** Qué se hizo de cada parte del pedido y qué no (lib/video/director/request.ts). */
  compliance?: ComplianceItem[];
  /** Vueltas del director para este pedido. */
  rounds?: number;
  /** Lo que gastó este pedido en IA (USD). */
  costUsd?: number;
  /** La referencia que pasó con el pedido: si se pudo mirar y qué se midió. */
  reference?: { ok: boolean; summary: string; error?: string | null } | null;
};

/** Pedido en curso: el texto, sus vueltas y lo que hace falta para comparar al final. */
export type PendingRequest = {
  kind: "edit" | "fix";
  instruction: string;
  id?: string;
  /** Vuelta del director en este pedido (0 = la primera). */
  attempt?: number;
  /** Lo que no se cumplió en la vuelta anterior (para la siguiente) y su huella (si se repite, no hay otra vuelta). */
  focus?: string[];
  missingKey?: string;
  /** El plan antes del pedido, en medidas (para el cumplimiento). */
  baseline?: PlanBaseline;
  /** "Qué cambió" acumulado de las vueltas. */
  changes?: string[];
  /** Gasto de IA del video cuando empezó el pedido. */
  spentAtStart?: number;
  /** Referencia adjunta (link o archivo subido): el worker la mide antes de dirigir. */
  reference?: { id: string; source: ReferenceSource } | null;
};

export type PlanVariant = {
  id: string;
  label: string;
  why: string;
  duration: number;
  removals: { from_word: number; to_word: number }[];
  hook: { from_word: number; to_word: number } | null;
  /** Los b-roll de esta versión (los del plan principal que quedan, tal como estaban). */
  broll: BrollItem[];
};

export type StageCost = { stage: string; model: string; costUsd: number };

export type DirectorState = {
  version: 1;
  map: VideoMap | null;
  rounds: CriticRound[];
  final: FinalReview | null;
  edits: EditRequest[];
  variants: PlanVariant[];
  /** Qué se dejó de hacer por el tope de costo, en palabras para la persona. */
  degraded: string[];
  /** Pedido en curso ("Edítalo así" o un arreglo de la revisión final). */
  pending: PendingRequest | null;
  /** Etapas del director que ya corrieron en este análisis (para retomar si el worker se reinicia). */
  steps: string[];
  /** Ciclo en curso: el análisis completo o un pedido ("Edítalo así" o un arreglo), que tiene una sola vuelta. */
  cycle: "analysis" | "edit";
  /** Plan de costo del análisis (modelos, vueltas y estimación) dentro del tope. */
  budget: BudgetPlan | null;
  /**
   * El último pedido de "Edítalo así" y lo que no se puede deshacer (lib/video/director/locks.ts): el crítico y las
   * correcciones lo respetan.
   */
  request?: RequestLocks | null;
  /**
   * El pedido que se está cerrando (después de dirigirlo, mientras corre la segunda mirada): con qué comparar, cuántas
   * vueltas lleva, con qué crítico y qué referencia lleva.
   */
  active?: { id: string; baseline: PlanBaseline; attempt: number; spentAtStart: number; referenceId: string | null; critic: StagePlan | null; missingKey?: string } | null;
  /** La última referencia de edición que miró el director (de "Edítalo así" o del brief). */
  reference?: DirectorReference | null;
  /** Subida de una referencia reservada desde el Estudio (la ruta y el tamaño que se aceptan). */
  refUpload?: { key: string; bytes: number; name: string; at: string } | null;
  updatedAt: string;
};

export const EMPTY_DIRECTOR: DirectorState = { version: 1, map: null, rounds: [], final: null, edits: [], variants: [], degraded: [], pending: null, steps: [], cycle: "analysis", budget: null, updatedAt: new Date(0).toISOString() };

export function readDirector(raw: unknown): DirectorState {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<DirectorState>;
  return {
    ...EMPTY_DIRECTOR,
    ...d,
    rounds: Array.isArray(d.rounds) ? d.rounds : [],
    edits: Array.isArray(d.edits) ? d.edits : [],
    variants: Array.isArray(d.variants) ? d.variants : [],
    degraded: Array.isArray(d.degraded) ? d.degraded : [],
    steps: Array.isArray(d.steps) ? d.steps : [],
    version: 1,
  };
}

export function readBrief(raw: unknown): Brief | null {
  const parsed = briefSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function briefIsEmpty(b: Brief | null | undefined): boolean {
  return !b || (!b.goal && !b.audience && !b.cta && !b.mustKeep && !b.notes && !b.reference);
}

/** Brief efectivo: lo que escribió la persona manda; lo vacío se completa con lo que infirió la IA. */
export function effectiveBrief(own: Brief | null, inferred: Brief | null): Brief & { inferred: (keyof Brief)[] } {
  const base = own ?? EMPTY_BRIEF;
  const inf = inferred ?? EMPTY_BRIEF;
  const out = { ...base, inferred: [] as (keyof Brief)[] };
  for (const key of ["goal", "audience", "cta", "mustKeep"] as const) {
    if (!base[key] && inf[key]) {
      (out as Record<string, unknown>)[key] = inf[key];
      out.inferred.push(key);
    }
  }
  return out;
}
