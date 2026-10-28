/**
 * Color del video principal (Estudio → Edición → «Color y filtros»): filtro, brillo, contraste, saturación y
 * temperatura, como los ajustes de un editor de video. Solo toca a la persona (el video grabado): el b-roll, los gráficos
 * y las animaciones tienen su propio look.
 *
 * Es la única fuente de verdad: la vista previa usa la matriz como filtro SVG (`feColorMatrix`) y el worker la escribe
 * como una LUT 3D (`lut3d`), igual que el look del b-roll (lib/video/broll-edit.ts). Un plan sin `grade` (los de antes)
 * se ve exactamente igual.
 */
import { z } from "zod";
import { LOOK_FILTERS, lookMatrix, lookSchema, type ColorMatrix } from "./broll-edit";

export const gradeSchema = z.object({
  /** Filtro de base (los mismos del b-roll) y cuánto se aplica. */
  filter: z.enum(LOOK_FILTERS).default("none"),
  strength: z.number().min(0).max(1).default(1),
  brightness: z.number().min(-0.3).max(0.3).default(0),
  contrast: z.number().min(-0.5).max(0.5).default(0),
  saturation: z.number().min(-1).max(1).default(0),
  /** -1 = frío (azul), 1 = cálido (naranja). */
  temperature: z.number().min(-1).max(1).default(0),
});
export type Grade = z.output<typeof gradeSchema>;
export type GradeInput = z.input<typeof gradeSchema>;

export const NEUTRAL_GRADE: Grade = gradeSchema.parse({});

/** La corrección guardada, o null si no cambia nada (así el plan queda como antes). */
export function cleanGrade(raw: unknown): Grade | null {
  const parsed = gradeSchema.safeParse(raw ?? {});
  if (!parsed.success) return null;
  return isNeutral(parsed.data) ? null : roundGrade(parsed.data);
}

export function isNeutral(g: Grade): boolean {
  return (g.filter === "none" || g.strength <= 0) && g.brightness === 0 && g.contrast === 0 && g.saturation === 0 && g.temperature === 0;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
function roundGrade(g: Grade): Grade {
  return { filter: g.filter, strength: r3(g.strength), brightness: r3(g.brightness), contrast: r3(g.contrast), saturation: r3(g.saturation), temperature: r3(g.temperature) };
}

/** a ∘ b (primero b, después a), en matrices 3×4 por filas. */
function compose(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out = new Array(12).fill(0) as ColorMatrix;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 4 + c] = a[r * 4]! * b[c]! + a[r * 4 + 1]! * b[4 + c]! + a[r * 4 + 2]! * b[8 + c]!;
    out[r * 4 + 3] = a[r * 4]! * b[3]! + a[r * 4 + 1]! * b[7]! + a[r * 4 + 2]! * b[11]! + a[r * 4 + 3]!;
  }
  return out;
}

/**
 * Matriz del color: el look (filtro, saturación, contraste y brillo, en el orden del b-roll) y después la temperatura
 * (más rojo y menos azul al calentar; al revés al enfriar, con un toque de verde para que la piel no se vea gris).
 * null si no cambia nada.
 */
export function gradeMatrix(g: Grade | null | undefined, accent: string): ColorMatrix | null {
  if (!g || isNeutral(g)) return null;
  const look = lookSchema.parse({ filter: g.filter, strength: g.strength, brightness: g.brightness, contrast: g.contrast, saturation: g.saturation });
  let m = lookMatrix(look, accent) ?? ([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as ColorMatrix);
  if (g.temperature !== 0) {
    const t = g.temperature;
    const warm: ColorMatrix = [1 + 0.12 * t, 0, 0, 0, 0, 1 + 0.025 * t, 0, 0, 0, 0, 1 - 0.14 * t, 0];
    m = compose(warm, m);
  }
  return m.map((v) => Math.round(v * 1e5) / 1e5) as ColorMatrix;
}

/** Presets de un toque, como los filtros de un editor. */
export const GRADE_PRESETS: { id: string; label: string; grade: Partial<Grade> }[] = [
  { id: "natural", label: "Natural", grade: {} },
  { id: "vivido", label: "Vívido", grade: { saturation: 0.25, contrast: 0.12, brightness: 0.02 } },
  { id: "calido", label: "Cálido", grade: { temperature: 0.45, saturation: 0.08 } },
  { id: "frio", label: "Frío", grade: { temperature: -0.45, saturation: -0.05 } },
  { id: "cine", label: "Cine", grade: { contrast: 0.18, saturation: -0.18, temperature: 0.15, brightness: -0.03 } },
  { id: "luminoso", label: "Luminoso", grade: { brightness: 0.08, contrast: -0.08, saturation: 0.06 } },
  { id: "suave", label: "Suave", grade: { saturation: -0.3, contrast: -0.12, brightness: 0.02 } },
  { id: "retro", label: "Retro", grade: { filter: "warm", strength: 0.8, saturation: -0.2, contrast: -0.06 } },
  { id: "bn", label: "Blanco y negro", grade: { filter: "bw", contrast: 0.15 } },
  { id: "noche", label: "Noche", grade: { filter: "cool", strength: 0.9, brightness: -0.06, contrast: 0.1, saturation: -0.15 } },
];

export function presetGrade(id: string): Grade {
  const p = GRADE_PRESETS.find((x) => x.id === id);
  return gradeSchema.parse(p?.grade ?? {});
}

/** El preset que coincide con la corrección actual (para marcarlo), o null si se ajustó a mano. */
export function matchingGradePreset(g: Grade | null): string | null {
  const cur = JSON.stringify(roundGrade(g ?? NEUTRAL_GRADE));
  for (const p of GRADE_PRESETS) if (JSON.stringify(roundGrade(presetGrade(p.id))) === cur) return p.id;
  return null;
}

export const GRADE_SLIDERS: { key: "brightness" | "contrast" | "saturation" | "temperature"; label: string; min: number; max: number; step: number }[] = [
  { key: "brightness", label: "Brillo", min: -0.3, max: 0.3, step: 0.01 },
  { key: "contrast", label: "Contraste", min: -0.5, max: 0.5, step: 0.01 },
  { key: "saturation", label: "Saturación", min: -1, max: 1, step: 0.02 },
  { key: "temperature", label: "Temperatura", min: -1, max: 1, step: 0.02 },
];
