import { LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { signOut } from "@/app/(auth)/actions";

const roleLabel = { OWNER: "Dueño", EDITOR: "Editor", VIEWER: "Solo lectura" } as const;

/** Usuario actual y botón para salir. Lee la sesión, así que va detrás de un <Suspense>. */
export async function UserMenu() {
  const user = await getCurrentUser();
  const initials = user.name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-accent font-mono text-xs font-bold text-paper">
        {initials}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
        <span className="block truncate text-xs text-muted">{roleLabel[user.role]}</span>
      </span>
      <form action={signOut}>
        <button type="submit" className="rounded-lg p-2 text-muted transition hover:bg-white/5 hover:text-white" aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

export function UserMenuSkeleton() {
  return <div aria-hidden className="skeleton h-[54px]" />;
}
