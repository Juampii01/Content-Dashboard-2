"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, Play, X } from "lucide-react";
import { navigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Navegación principal. Fija a la izquierda en pantallas grandes;
 * en tablet y teléfono se abre como panel desde un botón en la barra superior.
 */
export function Sidebar({ appName, footer }: { appName: string; footer: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const brand = (
    <Link href="/inicio" onClick={() => setOpen(false)} className="flex items-center gap-3 px-2" aria-label={`${appName} · inicio`}>
      <span className="tile-hero !h-9 !w-9 !rounded-xl">
        <Play className="h-4 w-4 fill-white" />
      </span>
      <span className="text-[15px] font-bold tracking-tight text-white">{appName}</span>
    </Link>
  );

  const nav = (
    <nav aria-label="Principal" className="flex flex-col gap-6">
      {navigation.map((group) => (
        <div key={group.label}>
          <p className="eyebrow mb-2 px-3 !text-[10px] !text-muted/70">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium transition",
                      active
                        ? "border-accent/40 bg-accent/15 font-semibold text-white"
                        : "border-transparent text-muted hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className={cn("h-[18px] w-[18px]", active ? "text-accent-hi" : "")} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Barra superior en pantallas chicas */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-white/10 bg-bg/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl p-2 text-muted hover:bg-white/5 hover:text-white"
          aria-label="Abrir menú"
          aria-expanded={open}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Panel móvil */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-label="Cerrar menú" />
          <aside className="absolute inset-y-0 left-0 flex w-72 animate-step-in flex-col gap-6 overflow-y-auto border-r border-white/10 bg-bg-deep p-4">
            <div className="flex items-center justify-between">
              {brand}
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 text-muted hover:bg-white/5 hover:text-white" aria-label="Cerrar menú">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            <div className="mt-auto">{footer}</div>
          </aside>
        </div>
      )}

      {/* Barra lateral fija */}
      <aside className="sticky top-0 hidden h-screen w-64 flex-none flex-col gap-8 overflow-y-auto border-r border-white/10 bg-bg-deep/60 px-3 py-5 backdrop-blur-xl lg:flex">
        {brand}
        {nav}
        <div className="mt-auto">{footer}</div>
      </aside>
    </>
  );
}
