"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { signIn, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <Field label="Correo" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} placeholder="tu@correo.com" />
      </Field>
      <Field label="Contraseña" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
      </Field>
      <Button type="submit" disabled={pending} icon={<LogIn className="h-4 w-4" aria-hidden />} className="mt-1 w-full">
        {pending ? "Entrando…" : "Entrar"}
      </Button>
      <Link href="/recuperar" className="text-center text-sm text-accent-hi hover:text-white">
        ¿Olvidaste tu contraseña?
      </Link>
    </form>
  );
}
