import type { ReactNode } from "react";
import { Play } from "lucide-react";

/** Marco común de las pantallas de acceso: logo, título, explicación y tarjeta con el formulario. */
export function AuthShell({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Content Studio";
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-sm animate-step-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="tile-hero mb-5">
            <Play className="h-5 w-5 fill-white" aria-hidden />
          </span>
          <p className="eyebrow mb-2">{appName}</p>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-muted">{description}</p>
        </div>
        <div className="card p-6 sm:p-7">{children}</div>
        {footer && <div className="mt-6 text-center text-xs text-muted">{footer}</div>}
      </div>
    </main>
  );
}
