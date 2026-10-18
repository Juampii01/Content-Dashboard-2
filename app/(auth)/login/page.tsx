import type { Metadata } from "next";
import { Suspense } from "react";
import { Play } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

const notices: Record<string, string> = {
  "sin-acceso": "Tu usuario no tiene acceso a este espacio. Pide una invitación al dueño de la cuenta.",
};

async function LoginWithNotice({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  const notice = typeof error === "string" ? notices[error] : undefined;
  return <LoginForm notice={notice} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Content Studio";

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-sm animate-step-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="tile-hero mb-5">
            <Play className="h-5 w-5 fill-white" />
          </span>
          <p className="eyebrow mb-2">{appName}</p>
          <h1 className="text-2xl font-bold">Entra a tu espacio</h1>
          <p className="mt-2 text-sm text-muted">Mide, planea y produce todo tu contenido desde un solo lugar.</p>
        </div>
        <div className="card p-6 sm:p-7">
          <Suspense fallback={<LoginForm />}>
            <LoginWithNotice searchParams={searchParams} />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-muted">¿No tienes acceso? Pídele una invitación al dueño de la cuenta.</p>
      </div>
    </main>
  );
}
