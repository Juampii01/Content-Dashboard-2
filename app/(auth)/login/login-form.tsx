"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { signIn, type SignInState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {notice && <Notice tone="warning">{notice}</Notice>}
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <Field label="Correo" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} placeholder="tu@correo.com" />
      </Field>
      <Field label="Contraseña" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
      </Field>
      <Button type="submit" disabled={pending} icon={<LogIn className="h-4 w-4" />} className="mt-1 w-full">
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
