import {
  BarChart3,
  CalendarDays,
  Clapperboard,
  Compass,
  GalleryHorizontalEnd,
  House,
  type LucideIcon,
  Palette,
  ScrollText,
  Settings,
  UserRound,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; description: string };
export type NavGroup = { label: string; items: NavItem[] };

/** Navegación lateral, en el orden de CLAUDE.md §3. */
export const navigation: NavGroup[] = [
  {
    label: "Medir",
    items: [
      { href: "/inicio", label: "Inicio", icon: House, description: "Resumen de tu semana" },
      { href: "/metricas", label: "Métricas", icon: BarChart3, description: "Rendimiento de tu contenido" },
      { href: "/estratega", label: "Estratega", icon: Compass, description: "Pregúntale a tus datos" },
    ],
  },
  {
    label: "Planear",
    items: [
      { href: "/calendario", label: "Calendario", icon: CalendarDays, description: "Lo que vas a publicar" },
      { href: "/guiones", label: "Guiones", icon: ScrollText, description: "Ideas convertidas en guiones" },
    ],
  },
  {
    label: "Producir",
    items: [
      { href: "/carruseles", label: "Carruseles", icon: GalleryHorizontalEnd, description: "Carruseles para Instagram" },
      { href: "/editor", label: "Editor de video", icon: Clapperboard, description: "Tu video crudo, editado" },
      { href: "/clon", label: "Videos con clon", icon: UserRound, description: "Videos con tu clon digital" },
    ],
  },
  {
    label: "Configurar",
    items: [
      { href: "/marca", label: "Mi marca", icon: Palette, description: "Tu tono, público y estilo" },
      { href: "/ajustes", label: "Ajustes", icon: Settings, description: "Cuentas, claves y equipo" },
    ],
  },
];
