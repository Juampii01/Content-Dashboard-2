"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Campana de avisos: "tu video está listo", "no pudimos exportar…". Consulta /api/avisos cada 30 s mientras la
 * pestaña está visible (una sola consulta aunque la campana se muestre en dos lugares) y avisa con un toast cuando
 * llega uno nuevo. Al abrirla, los avisos quedan como vistos.
 */

type Item = { id: string; tone: "success" | "error"; title: string; body: string; href: string; createdAt: string; unread: boolean };
type State = { items: Item[]; unread: number; loaded: boolean };

const POLL_MS = 30_000;
let state: State = { items: [], unread: 0, loaded: false };
const listeners = new Set<() => void>();
const known = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

async function load() {
  if (inflight) return;
  inflight = true;
  try {
    const res = await fetch("/api/avisos", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { items: Item[]; unread: number };
    // Toast solo para lo que llega con la app abierta (no para lo que ya estaba al entrar).
    if (state.loaded) {
      for (const item of data.items.filter((i) => i.unread && !known.has(i.id)).reverse()) {
        (item.tone === "success" ? toast.success : toast.error)(item.title, { description: item.body });
      }
    }
    for (const item of data.items) known.add(item.id);
    set({ items: data.items, unread: data.unread, loaded: true });
  } catch {
    // Sin conexión: se reintenta en la próxima vuelta.
  } finally {
    inflight = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (document.visibilityState === "visible") await load();
    schedule();
  }, POLL_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void load();
    schedule();
    window.addEventListener("focus", load);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (timer) clearTimeout(timer);
      timer = null;
      window.removeEventListener("focus", load);
    }
  };
}

const EMPTY: State = { items: [], unread: 0, loaded: false };

export function NotificationBell({ align = "left" }: { align?: "left" | "right" }) {
  const current = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  function toggle() {
    if (open) return close();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(360, window.innerWidth - 32);
      const left = align === "right" ? Math.max(16, rect.right - width) : Math.min(rect.left, window.innerWidth - width - 16);
      setPos({ top: rect.bottom + 8, left });
    }
    setOpen(true);
    if (state.unread) {
      set({ ...state, unread: 0, items: state.items.map((i) => ({ ...i, unread: false })) });
      void fetch("/api/avisos", { method: "POST" }).catch(() => {});
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (close(), buttonRef.current?.focus());
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const label = current.unread ? `Avisos: ${current.unread} sin ver` : "Avisos";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative rounded-xl p-2 text-muted transition hover:bg-white/5 hover:text-white"
      >
        <Bell className="h-5 w-5" />
        {current.unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-none text-white">
            {current.unread > 9 ? "9+" : current.unread}
          </span>
        )}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Avisos"
          style={{ top: pos.top, left: pos.left, width: Math.min(360, typeof window === "undefined" ? 360 : window.innerWidth - 32) }}
          className="fixed z-[60] max-h-[70vh] animate-pop-in overflow-y-auto rounded-2xl border border-line bg-card p-2 shadow-2xl"
        >
          <p className="eyebrow px-3 pb-1 pt-2">Avisos</p>
          {!current.items.length ? (
            <p className="px-3 pb-4 pt-1 text-sm text-muted">
              Aún no hay avisos. Cuando termine un video, un carrusel o un video con clon, te avisamos aquí y por correo.
            </p>
          ) : (
            <ul className="space-y-1">
              {current.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={close}
                    className={cn("flex gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/5", item.unread && "bg-accent/10")}
                  >
                    {item.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-accent-hi" /> : <XCircle className="mt-0.5 h-4 w-4 flex-none text-red-400" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{item.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{item.body}</span>
                      <span className="mt-1 block font-mono text-[11px] text-placeholder">{formatRelative(item.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>,
        // En el body: la barra lateral usa backdrop-filter, que recorta a los hijos con position: fixed.
        document.body,
      )}
    </>
  );
}
