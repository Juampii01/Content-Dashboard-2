import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
import { getOptionalUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { platformLabel } from "@/lib/social/types";

/** Aviso arriba de todas las pantallas cuando una red dejó de actualizarse y hay que reconectarla. */
export async function ConnectionBanner() {
  const user = await getOptionalUser();
  if (!user) return null;
  const broken = await getDb()
    .select({ platform: schema.socialAccounts.platform, message: schema.socialAccounts.statusMessage })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.current, true), inArray(schema.socialAccounts.status, ["EXPIRED", "REVOKED", "MISSING_SCOPES", "ERROR"])));
  if (broken.length === 0) return null;

  const labels = broken.map((b) => platformLabel[b.platform]);
  const names = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}` : labels[0];
  const text =
    broken.length === 1
      ? (broken[0]!.message ?? `${names} dejó de actualizarse. Reconecta la cuenta para seguir midiendo.`)
      : `${names} dejaron de actualizarse. Reconecta las cuentas para seguir midiendo.`;
  return (
    <div role="alert" className="mb-6 flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-text">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning" aria-hidden />
        {text}
      </p>
      {user.role === "OWNER" ? (
        <Link href="/ajustes" className="btn-ghost self-start !py-1.5 text-sm sm:self-auto">
          Reconectar
        </Link>
      ) : (
        <span className="text-xs text-muted">Avísale al dueño de la cuenta.</span>
      )}
    </div>
  );
}
