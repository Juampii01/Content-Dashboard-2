import { Suspense } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { UserMenu, UserMenuSkeleton } from "@/components/shell/user-menu";

/**
 * Estructura de la app privada: navegación a la izquierda y contenido a la derecha.
 * La navegación es estática y carga al instante; el usuario se lee de la sesión detrás de un <Suspense>.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Content Studio";

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        appName={appName}
        footer={
          <Suspense fallback={<UserMenuSkeleton />}>
            <UserMenu />
          </Suspense>
        }
      />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl animate-step-in">{children}</div>
      </main>
    </div>
  );
}
