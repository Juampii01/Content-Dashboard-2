"use client";

import { useActionState, useState, useTransition } from "react";
import { MailPlus, RotateCcw, Send, UserX } from "lucide-react";
import type { Role } from "@/lib/auth";
import type { TeamMember } from "@/lib/dal/team";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import {
  changeRoleAction,
  deactivateAction,
  inviteAction,
  reactivateAction,
  resendInviteAction,
  type TeamActionState,
} from "./team-actions";

const roleLabel: Record<Role, string> = { OWNER: "Dueño", EDITOR: "Editor", VIEWER: "Solo lectura" };
const roleHint: Record<Role, string> = {
  OWNER: "Todo, incluidas las conexiones, las claves y el equipo.",
  EDITOR: "Crea y edita contenido. No toca conexiones ni equipo.",
  VIEWER: "Solo mira métricas y contenido.",
};

function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function MemberRow({ member, isMe, canManage }: { member: TeamMember; isMe: boolean; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<TeamActionState>({});
  const run = (action: () => Promise<TeamActionState>) =>
    startTransition(async () => {
      setFeedback(await action());
    });

  return (
    <li className={cn("flex flex-col gap-3 bg-white/[0.02] px-4 py-3.5 sm:flex-row sm:items-center", !member.active && "opacity-60")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent/20 font-mono text-xs font-bold text-accent-glow">
          {initials(member.name)}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
            <span className="truncate">{member.name}</span>
            {isMe && <span className="pill !py-0.5 !text-[11px]">Tú</span>}
            {member.pending && member.active && <span className="pill !border-warning/40 !bg-warning/10 !py-0.5 !text-[11px] !text-warning">Invitación pendiente</span>}
            {!member.active && <span className="pill !py-0.5 !text-[11px]">Sin acceso</span>}
          </p>
          <p className="truncate text-xs text-muted">{member.email}</p>
        </div>
      </div>

      {canManage && !isMe ? (
        <div className="flex flex-wrap items-center gap-2">
          {member.active && (
            <Select
              aria-label={`Rol de ${member.name}`}
              value={member.role}
              disabled={pending}
              onChange={(e) => run(() => changeRoleAction(member.userId, e.target.value as Role))}
              className="!w-auto !py-1.5 text-sm"
            >
              {(Object.keys(roleLabel) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </Select>
          )}
          {member.active && member.pending && (
            <Button variant="subtle" size="sm" disabled={pending} icon={<Send className="h-3.5 w-3.5" aria-hidden />} onClick={() => run(() => resendInviteAction(member.userId))}>
              Reenviar
            </Button>
          )}
          {member.active ? (
            <Button variant="subtle" size="sm" disabled={pending} icon={<UserX className="h-3.5 w-3.5" aria-hidden />} onClick={() => run(() => deactivateAction(member.userId))}>
              Quitar acceso
            </Button>
          ) : (
            <Button variant="subtle" size="sm" disabled={pending} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => run(() => reactivateAction(member.userId))}>
              Devolver acceso
            </Button>
          )}
        </div>
      ) : (
        <span className="text-sm text-muted">{roleLabel[member.role]}</span>
      )}

      {(feedback.error || feedback.message) && (
        <p role={feedback.error ? "alert" : "status"} className={cn("text-xs sm:basis-full", feedback.error ? "text-danger" : "text-success")}>
          {feedback.error ?? feedback.message}
        </p>
      )}
    </li>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState<TeamActionState, FormData>(inviteAction, {});
  const [role, setRole] = useState<Role>("EDITOR");

  return (
    <form action={action} className="card flex flex-col gap-4 p-5" noValidate key={state.ok ? state.message : "form"}>
      <div>
        <h3 className="font-semibold text-white">Invitar a alguien</h3>
        <p className="mt-1 text-sm text-muted">Le llega un correo para definir su contraseña. El enlace vence en 7 días.</p>
      </div>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.message && <Notice tone="success">{state.message}</Notice>}
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
        <Field label="Correo" htmlFor="invite-email">
          <Input id="invite-email" name="email" type="email" required placeholder="editor@correo.com" autoComplete="off" />
        </Field>
        <Field label="Nombre" htmlFor="invite-name" hint="Opcional.">
          <Input id="invite-name" name="name" placeholder="Ana López" autoComplete="off" />
        </Field>
        <Field label="Rol" htmlFor="invite-role" hint={roleHint[role]}>
          <Select id="invite-role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(roleLabel) as Role[]).map((r) => (
              <option key={r} value={r}>
                {roleLabel[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={pending} icon={<MailPlus className="h-4 w-4" aria-hidden />} className="self-start">
        {pending ? "Enviando…" : "Enviar invitación"}
      </Button>
    </form>
  );
}
