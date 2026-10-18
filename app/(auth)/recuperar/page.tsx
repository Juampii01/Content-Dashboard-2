import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetRequestForm } from "./reset-request-form";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <AuthShell
      title="Recupera tu acceso"
      description="Escribe tu correo y te enviamos un enlace para elegir una contraseña nueva."
      footer={<Link href="/login" className="text-accent-hi hover:text-white">Volver a entrar</Link>}
    >
      <ResetRequestForm />
    </AuthShell>
  );
}
