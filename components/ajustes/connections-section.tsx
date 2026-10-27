import { getCurrentUser } from "@/lib/auth";
import { listConnections } from "@/lib/dal/metrics";
import { platformConfigured } from "@/lib/social/providers";
import { PLATFORMS } from "@/lib/social/types";
import { ConnectionCard } from "./connection-card";

const descriptions = {
  INSTAGRAM: "Cuenta profesional (creador o empresa). Lee tus publicaciones y sus estadísticas.",
  YOUTUBE: "Tu canal. Lee tus videos, shorts, tiempo de visualización y retención.",
  TIKTOK: "Tu cuenta. Lee tus videos con visualizaciones, me gusta, comentarios y compartidos.",
} as const;

export async function ConnectionsSection() {
  const [me, connections] = await Promise.all([getCurrentUser(), listConnections()]);
  return (
    <ul className="flex flex-col gap-3">
      {PLATFORMS.map((platform) => {
        const c = connections.find((x) => x.platform === platform) ?? null;
        return (
          <ConnectionCard
            key={platform}
            platform={platform}
            description={descriptions[platform]}
            configured={platformConfigured(platform)}
            canConnect={me.role === "OWNER"}
            canSync={me.role !== "VIEWER"}
            connection={
              c && {
                handle: c.handle,
                avatarUrl: c.avatarUrl,
                status: c.status,
                statusMessage: c.statusMessage,
                lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
                backfillDone: c.backfillDone,
                itemCount: c.itemCount,
                demo: c.demo,
                lastError: c.lastRun?.status === "FAILED" ? c.lastRun.errorMessage : null,
              }
            }
          />
        );
      })}
    </ul>
  );
}

export function ConnectionsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div className="skeleton h-24" />
      <div className="skeleton h-24" />
      <div className="skeleton h-24" />
    </div>
  );
}
