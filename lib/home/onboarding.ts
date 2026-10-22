/**
 * Guía de los primeros 10 minutos (Inicio). Lógica pura: recibe lo que ya hizo la instalación (lo lee
 * `getSetupProgress` en lib/dal/home.ts) y arma los pasos con su estado. Sin base ni sesión: se prueba sola.
 */

export type SetupProgress = {
  /** Hay al menos una red real conectada (las cuentas de demostración no cuentan). */
  connected: boolean;
  /** Mi marca tiene lo mínimo: nicho, público y tono. */
  brand: boolean;
  /** Se subió un video al Editor o un video largo a Clips. */
  video: boolean;
  /** Hay al menos un guion. */
  script: boolean;
  /** Hubo al menos una pregunta al estratega. */
  strategist: boolean;
  /** Hay algo en el calendario (lo sigue usando Inicio para otras decisiones). */
  planned: boolean;
  /** La persona cerró la guía con "Ya lo conozco". */
  dismissed: boolean;
};

export type OnboardingStepKey = "connected" | "brand" | "video" | "script" | "strategist";

export type OnboardingAction = { label: string; href: string };

export type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  description: string;
  /** Minutos aproximados, para que se vea que son 10 en total. */
  minutes: number;
  done: boolean;
  primary: OnboardingAction;
  secondary?: OnboardingAction;
};

export type Onboarding = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  /** 0 a 100. */
  percent: number;
  /** El primer paso pendiente (el que se muestra abierto). null = todo listo. */
  current: OnboardingStepKey | null;
  /** Se muestra en Inicio: no la cerró y le falta algo. */
  visible: boolean;
};

const STEPS: Omit<OnboardingStep, "done">[] = [
  {
    key: "connected",
    title: "Conecta tus redes",
    description: "Instagram, YouTube o TikTok. Con eso llegan tus métricas, el puntaje de tus ganchos y todo lo que la IA aprende de ti.",
    minutes: 2,
    primary: { label: "Conectar mis redes", href: "/ajustes" },
  },
  {
    key: "brand",
    title: "Completa Mi marca",
    description: "Lo mínimo: tu nicho, tu público ideal y tu tono. Con esas tres cosas los guiones, los carruseles y el estratega ya suenan a ti.",
    minutes: 2,
    primary: { label: "Completar mi marca", href: "/marca" },
  },
  {
    key: "video",
    title: "Sube tu primer video",
    description: "Sube un video crudo y recibe la edición propuesta: cortes, subtítulos y b-roll. Si tienes un podcast o un live, prueba Clips y saca varios shorts de una vez.",
    minutes: 3,
    primary: { label: "Subir un video", href: "/editor/nuevo" },
    secondary: { label: "Probar Clips", href: "/editor/clips" },
  },
  {
    key: "script",
    title: "Arma tu primer guion",
    description: "Parte de una idea o de un video que te gustó. Recibes el guion con ganchos puntuados y lo puedes mandar directo al Editor.",
    minutes: 2,
    primary: { label: "Crear un guion", href: "/guiones/nuevo" },
  },
  {
    key: "strategist",
    title: "Conoce al estratega",
    description: "Pregúntale qué publicar esta semana o por qué un video funcionó. Responde mirando tus números reales, no consejos genéricos.",
    minutes: 1,
    primary: { label: "Hablar con el estratega", href: "/estratega" },
  },
];

export function buildOnboarding(progress: SetupProgress): Onboarding {
  const steps = STEPS.map((s) => ({ ...s, done: Boolean(progress[s.key]) }));
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const current = steps.find((s) => !s.done)?.key ?? null;
  return {
    steps,
    doneCount,
    total,
    percent: Math.round((doneCount / total) * 100),
    current,
    visible: !progress.dismissed && current !== null,
  };
}
