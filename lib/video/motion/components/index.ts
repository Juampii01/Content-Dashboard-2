/**
 * Registro de componentes: el nombre que usa la escena → definición (props con Zod, ejemplo y armado).
 */
import { barChart, funnel, lineChart } from "./charts";
import { comparison } from "./compare";
import { checklist, list, steps, timeline } from "./lists";
import { dmNotification, iconBurst } from "./social";
import { beforeAfter, progress, statCard } from "./stat";
import { keyword, quote } from "./words";

export const COMPONENTS = {
  statCard,
  list,
  quote,
  keyword,
  comparison,
  steps,
  funnel,
  dmNotification,
  barChart,
  lineChart,
  checklist,
  timeline,
  iconBurst,
  progress,
  beforeAfter,
} as const;

export type ComponentName = keyof typeof COMPONENTS;
export const COMPONENT_NAMES = Object.keys(COMPONENTS) as ComponentName[];
