/**
 * Datos del informe mensual. Es una foto del mes: se guarda tal cual en `monthly_reports.data`
 * y con ella se dibujan la vista previa, el PDF y el correo. Sin dependencias de servidor.
 *
 * Regla: cada número sale de la base. Si una red no da un dato, el campo queda en null y se explica en `notes`.
 */
import type { ContentType, Platform } from "@/lib/social/types";

/** Un número del mes y el mismo número del mes anterior. */
export type Pair = { current: number | null; previous: number | null };

export type ReportPlatform = {
  platform: Platform;
  handle: string;
  /** Seguidores al cierre del mes (último dato del mes). */
  followers: number | null;
  /** Seguidores ganados en el mes (y en el mes anterior). */
  followersGained: Pair;
  /** Visualizaciones de las piezas publicadas en el mes. */
  views: Pair;
  /** Me gusta + comentarios + compartidos + guardados de las piezas del mes. */
  interactions: Pair;
  /** Interacciones ÷ visualizaciones, en puntos porcentuales. */
  engagementRate: Pair;
  pieces: Pair;
  /** Visualizaciones diarias de la cuenta (null = la red no dio el dato ese día). */
  dailyViews: (number | null)[];
  /** Seguidores al final de cada día (con el último dato conocido). */
  dailyFollowers: (number | null)[];
  /** Qué no da esta red, en español, para decirlo en el informe. */
  notes: string[];
};

export type ReportPiece = {
  id: string;
  platform: Platform;
  type: ContentType;
  title: string;
  thumbnail: string | null;
  permalink: string | null;
  publishedAt: string; // ISO
  views: number | null;
  interactions: number | null;
  engagementRate: number | null;
  saves: number | null;
  shares: number | null;
  /** Veces su mediana (misma red y tipo). */
  perfScore: number | null;
  /** "¿Por qué funcionó?" ya guardado en la pieza (no se paga de nuevo). */
  why: string | null;
  lessons: string[];
};

export type ReportWeek = { weekStart: string; weekEnd: string; pieces: number; target: number; hit: boolean; partial: boolean };

export type ReportConsistency = {
  /** Piezas del calendario con fecha en el mes. */
  planned: number;
  /** De esas, las que ya están publicadas (estado o vínculo con una pieza real). */
  plannedPublished: number;
  /** Piezas publicadas en las redes en el mes (estén o no en el calendario). */
  published: number;
  weeklyTarget: number;
  weeks: ReportWeek[];
  goal: {
    followers: number;
    platform: "TOTAL" | Platform;
    deadline: string | null;
    current: number | null;
    /** Seguidores por día al ritmo de los últimos 28 días. */
    perDay: number | null;
    eta: string | null;
    neededPerWeek: number | null;
  } | null;
  streak: number;
};

export type ReportProduction = {
  videosEdited: number;
  carouselsCreated: number;
  carouselsExported: number;
  cloneVideos: number;
  cloneSeconds: number | null;
  scripts: number;
};

export type ReportSummary = {
  headline: string;
  wins: string[];
  watch: string[];
  ideas: { title: string; hook: string; why: string }[];
  /** Lección de la pieza que menos funcionó (null si no hay una). */
  worstLesson: string | null;
};

export type ReportBrand = {
  name: string;
  handle: string | null;
  /** Color principal (#rrggbb) o null = colores de la paleta Medianoche. */
  primary: string | null;
  accent: string | null;
  /** Nombre de la fuente de títulos en Mi marca (se usa si está entre las autoalojadas). */
  headingFont: string | null;
  /** Foto o logo: una URL pública, una ruta de /public o una clave del almacenamiento. */
  image: string | null;
  language: string;
};

export type MonthlyReportData = {
  version: 1;
  /** "2026-10". */
  month: string;
  from: string;
  /** Último día con datos: el fin de mes, o hoy si el mes sigue en curso. */
  to: string;
  monthEnd: string;
  partial: boolean;
  timezone: string;
  generatedAt: string;
  brand: ReportBrand;
  totals: {
    followers: number | null;
    followersGained: Pair;
    views: Pair;
    interactions: Pair;
    engagementRate: Pair;
    pieces: Pair;
  };
  days: string[];
  platforms: ReportPlatform[];
  top: ReportPiece[];
  worst: ReportPiece | null;
  consistency: ReportConsistency;
  production: ReportProduction;
  summary: ReportSummary | null;
};
