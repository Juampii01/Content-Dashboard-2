import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Notice } from "@/components/ui/feedback";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

const notices: Record<string, { tone: "warning" | "success"; text: string }> = {
  "sin-acceso": { tone: "warning", text: "Tu sesión terminó o tu usuario no tiene acceso a este espacio. Entra de nuevo o pide una invitación al dueño de la cuenta." },
  "contrasena-lista": { tone: "success", text: "Listo, tu contraseña quedó guardada. Ya puedes entrar." },
};

/** El aviso depende de la URL, así que va en su propio <Suspense>; el formulario carga al instante. */
async function LoginNotice({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error, aviso } = await searchParams;
  const key = typeof aviso === "string" ? aviso : typeof error === "string" ? error : undefined;
  const notice = key ? notices[key] : undefined;
  if (!notice) return null;
  return (
    <div className="mb-5">
      <Notice tone={notice.tone}>{notice.text}</Notice>
    </div>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthShell
      title="Entra a tu espacio"
      description="Mide, planea y produce todo tu contenido desde un solo lugar."
      footer="¿No tienes acceso? Pídele una invitación al dueño de la cuenta."
    >
      <Suspense fallback={null}>
        <LoginNotice searchParams={searchParams} />
      </Suspense>
      <LoginForm />
    </AuthShell>
  );
}
