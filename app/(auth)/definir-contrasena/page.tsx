import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Definir contraseña" };

async function Content({ searchParams }: { searchParams: PageProps<"/definir-contrasena">["searchParams"] }) {
  const { token, invitacion } = await searchParams;
  if (typeof token !== "string" || token.length < 10) {
    return (
      <Notice tone="warning" title="Enlace incompleto">
        Abre el enlace completo desde el correo que recibiste, o pide uno nuevo en{" "}
        <Link href="/recuperar" className="underline">¿Olvidaste tu contraseña?</Link>
      </Notice>
    );
  }
  return <SetPasswordForm token={token} isInvitation={invitacion === "1"} />;
}

export default function SetPasswordPage({ searchParams }: PageProps<"/definir-contrasena">) {
  return (
    <AuthShell
      title="Elige tu contraseña"
      description="Usa al menos 10 caracteres. Una frase que recuerdes es más segura que una palabra corta."
      footer={<Link href="/login" className="text-accent-hi hover:text-white">Volver a entrar</Link>}
    >
      <Suspense fallback={<Skeleton className="h-56" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
