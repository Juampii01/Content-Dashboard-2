import { Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listTeamMembers } from "@/lib/dal/team";
import { InviteForm, MemberRow } from "./team-client";

/** Equipo: quién entra al espacio y con qué permisos. Solo el dueño puede invitar o cambiar accesos. */
export async function TeamSection() {
  const [me, members] = await Promise.all([getCurrentUser(), listTeamMembers()]);
  const isOwner = me.role === "OWNER";

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
        {members.map((member) => (
          <MemberRow key={member.userId} member={member} isMe={member.userId === me.id} canManage={isOwner} />
        ))}
      </ul>
      {isOwner ? (
        <InviteForm />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Users className="h-4 w-4 text-accent-hi" aria-hidden />
          Solo el dueño de la cuenta puede invitar personas o cambiar permisos.
        </p>
      )}
    </div>
  );
}

export function TeamSectionSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div className="skeleton h-16" />
      <div className="skeleton h-16" />
      <div className="skeleton h-40" />
    </div>
  );
}
