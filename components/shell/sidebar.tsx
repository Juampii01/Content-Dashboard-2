"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, Play, X } from "lucide-react";
import { navigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Navegación principal. Fija a la izquierda en pantallas grandes;
 * en tablet y teléfono se abre como panel desde un botón en la barra superior.
 */
export function Sidebar(props: { appName: string; footer: ReactNode }) {
  const pathname = usePathname();
  return <SidebarView {...props} pathname={pathname} />;
}

/**
 * La barra sin leer la URL. Se usa como respaldo del <Suspense> en rutas dinámicas (por ejemplo,
 * /metricas/[id]), donde la ruta actual solo se conoce al pedir la página.
 */
export function SidebarView({ appName, footer, pathname }: { appName: string; footer: ReactNode; pathname: string }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  // Panel en pantallas pequeñas: Escape cierra, el foco queda atrapado adentro y el fondo no se desplaza.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const opener = openButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open]);

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
      {/* Barra superior en pantallas pequeñas */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-white/10 bg-bg/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        {brand}
        <button
          ref={openButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl p-2 text-muted hover:bg-white/5 hover:text-white"
          aria-label="Abrir menú"
          aria-expanded={open}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Panel lateral en pantallas pequeñas */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" tabIndex={-1} className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-label="Cerrar menú" />
          <aside ref={panelRef} className="absolute inset-y-0 left-0 flex w-72 animate-step-in flex-col gap-6 overflow-y-auto border-r border-white/10 bg-bg-deep p-4">
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
