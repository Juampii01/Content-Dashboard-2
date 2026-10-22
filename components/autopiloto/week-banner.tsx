import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { pendingWeekItems } from "@/lib/dal/autopilot";

/**
 * Aviso para Inicio: "Tu semana está lista" con cuántas piezas esperan aprobación. No muestra nada si no hay.
 * Va dentro de un <Suspense> (lee la sesión).
 */
export async function WeekReadyBanner() {
  const week = await pendingWeekItems();
  if (!week) return null;
  return (
    <Link href="/calendario/semana" className="card card-lift group flex items-center gap-4 border-accent/40 p-4 sm:p-5">
      <span className="tile-icon h-10 w-10 flex-none">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-white">Tu semana está lista</span>
        <span className="block text-sm text-muted">{week.pending === 1 ? "1 pieza espera" : `${week.pending} piezas esperan`} tu aprobación, con sus guiones y carruseles escritos.</span>
      </span>
      <ArrowRight className="h-5 w-5 flex-none text-accent-hi transition group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
