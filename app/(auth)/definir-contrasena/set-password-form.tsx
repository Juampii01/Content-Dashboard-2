"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { setPassword, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";

export function SetPasswordForm({ token, isInvitation }: { token: string; isInvitation: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setPassword, {});

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {isInvitation && !state.error && <Notice>Bienvenido. Define tu contraseña y entra a tu espacio.</Notice>}
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <input type="hidden" name="token" value={token} />
      <Field label="Contraseña nueva" htmlFor="password" hint="Mínimo 10 caracteres.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Repite la contraseña" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" disabled={pending} icon={<KeyRound className="h-4 w-4" aria-hidden />} className="w-full">
        {pending ? "Guardando…" : "Guardar y continuar"}
      </Button>
    </form>
  );
}
