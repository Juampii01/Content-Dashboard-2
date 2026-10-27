"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { requestPasswordReset, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";

export function ResetRequestForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordReset, {});

  if (state.sent) {
    return (
      <Notice tone="success" title="Revisa tu correo">
        Si {state.email} tiene acceso a este espacio, te llegará un enlace en unos minutos. Vence en 1 hora. Revisa también la carpeta de spam.
      </Notice>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <Field label="Correo" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} placeholder="tu@correo.com" />
      </Field>
      <Button type="submit" disabled={pending} icon={<Mail className="h-4 w-4" aria-hidden />} className="w-full">
        {pending ? "Enviando…" : "Enviar enlace"}
      </Button>
    </form>
  );
}
