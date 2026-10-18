import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <span className="tile-icon h-12 w-12">
          <Compass className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Esta página no existe</h1>
          <p className="mt-2 text-sm text-muted">Puede que el enlace esté incompleto o que la pieza se haya movido.</p>
        </div>
        <ButtonLink href="/inicio">Volver al inicio</ButtonLink>
      </div>
    </main>
  );
}
