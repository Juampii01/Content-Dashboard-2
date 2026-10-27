import type { ReactNode } from "react";
import Link from "next/link";
import { Play } from "lucide-react";

/**
 * Datos del responsable para las páginas legales. Vienen de variables públicas opcionales
 * (se leen en el build): LEGAL_COMPANY_NAME, LEGAL_CONTACT_EMAIL, LEGAL_UPDATED_AT.
 */
export function legalInfo() {
  return {
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Content Studio",
    company: process.env.LEGAL_COMPANY_NAME ?? (process.env.NEXT_PUBLIC_APP_NAME || "la empresa que administra esta instalación"),
    email: process.env.LEGAL_CONTACT_EMAIL ?? null,
    updatedAt: process.env.LEGAL_UPDATED_AT ?? "18 oct 2026",
  };
}

export function Contact() {
  const { email, company } = legalInfo();
  // Incluye la preposición ("a correo" / "al contacto…") para que la frase quede bien en los dos casos.
  return email ? (
    <>
      a{" "}
      <a href={`mailto:${email}`} className="text-accent-hi underline underline-offset-2">
        {email}
      </a>
    </>
  ) : (
    <span>al contacto de {company} indicado en tu contrato</span>
  );
}

/** Marco de las páginas públicas (privacidad, términos y eliminación de datos). */
export function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const { appName, updatedAt } = legalInfo();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
      <header className="mb-10">
        <Link href="/login" className="mb-8 inline-flex items-center gap-3" aria-label={`${appName} · entrar`}>
          <span className="tile-hero !h-9 !w-9">
            <Play className="h-4 w-4 fill-white" aria-hidden />
          </span>
          <span className="eyebrow">{appName}</span>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-muted">{intro}</p>
        <p className="mt-2 font-mono text-xs text-placeholder">Última actualización: {updatedAt}</p>
      </header>
      <article className="legal space-y-8 text-[15px] leading-relaxed text-text/90">{children}</article>
      <footer className="mt-14 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 text-sm text-muted">
        <Link href="/privacidad" className="hover:text-text">Privacidad</Link>
        <Link href="/terminos" className="hover:text-text">Términos</Link>
        <Link href="/eliminar-datos" className="hover:text-text">Eliminar mis datos</Link>
      </footer>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-white">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
