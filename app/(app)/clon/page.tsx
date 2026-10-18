import type { Metadata } from "next";
import { Suspense } from "react";
import { BellRing, ExternalLink, KeyRound, Plus, UserRound, Video, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { CloneGuide } from "@/components/clon/clone-guide";
import { CloneVideoList } from "@/components/clon/video-list";
import { getHeyGenStatus, listCloneVideos } from "@/lib/dal/clone";
import { describeBalance, HEYGEN_API_USAGE_URL } from "@/lib/heygen/pricing";

export const metadata: Metadata = { title: "Videos con clon" };

async function HeaderAction() {
  const status = await getHeyGenStatus();
  if (!status.configured || !status.canEdit) return null;
  return (
    <ButtonLink href="/clon/nuevo" icon={<Plus className="h-4 w-4" aria-hidden />}>
      Nuevo video
    </ButtonLink>
  );
}

async function BalanceCard() {
  const status = await getHeyGenStatus({ withBalance: true });
  if (!status.configured) return null;
  const balance = status.balance ? describeBalance(status.balance) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="tile-icon h-11 w-11 flex-none">
            <Wallet className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="eyebrow">Saldo de API en HeyGen</p>
            <p className={`mt-0.5 font-mono text-2xl font-semibold tabular-nums ${balance?.empty ? "text-warning" : "text-white"}`}>{balance?.value ?? "—"}</p>
            {balance?.note && <p className="mt-0.5 text-xs text-muted">{balance.note}</p>}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <a href={HEYGEN_API_USAGE_URL} target="_blank" rel="noreferrer" className="btn-ghost !px-3 !py-1.5 !text-xs">
            Cargar saldo en HeyGen
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">(se abre en otra pestaña)</span>
          </a>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <BellRing className={`h-3.5 w-3.5 ${status.webhookActive ? "text-success" : "text-warning"}`} aria-hidden />
            {status.webhookActive ? "HeyGen nos avisa cuando un video está listo" : "Sin avisos automáticos: revisamos el estado cada pocos segundos"}
          </p>
        </div>
      </div>
      {status.balanceError && <Notice tone="danger">{status.balanceError}</Notice>}
      {balance?.empty && !status.balanceError && (
        <Notice tone="warning" title="Sin saldo de API">
          Para generar videos carga saldo de API en HeyGen. El saldo de la API se paga aparte del plan web.
        </Notice>
      )}
    </div>
  );
}

async function CloneHome() {
  const status = await getHeyGenStatus();

  if (!status.configured) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          icon={<KeyRound className="h-5 w-5" aria-hidden />}
          title="Conecta tu cuenta de HeyGen"
          description={
            status.isOwner
              ? "Tus videos con clon se generan en tu propia cuenta de HeyGen, con tu clon y tu saldo. Pega tu API key en Ajustes y vuelve aquí."
              : "Los videos con clon se generan en la cuenta de HeyGen de la marca. Pídele al dueño de la cuenta que agregue la API key en Ajustes."
          }
          action={
            status.isOwner ? (
              <ButtonLink href="/ajustes#claves" icon={<KeyRound className="h-4 w-4" aria-hidden />}>
                Agregar mi API key
              </ButtonLink>
            ) : undefined
          }
        />
        <CloneGuide defaultOpen />
      </div>
    );
  }

  const videos = await listCloneVideos();
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<Skeleton className="h-28" />}>
        <BalanceCard />
      </Suspense>

      {!status.storageReady && (
        <Notice tone="info" title="Los videos quedan en tu cuenta de HeyGen">
          Esta instalación todavía no tiene almacenamiento de archivos, así que cada video se trae de HeyGen al abrirlo. Si lo borras en HeyGen, aquí deja de
          verse: descárgalo cuando esté listo.
        </Notice>
      )}

      <section aria-labelledby="clon-videos" className="flex flex-col gap-4">
        <h2 id="clon-videos" className="text-lg font-semibold">
          Tus videos
        </h2>
        {videos.length === 0 ? (
          <EmptyState
            icon={<Video className="h-5 w-5" aria-hidden />}
            title="Todavía no generaste videos con tu clon"
            description="Elige un guion o pega un texto, elige tu clon y su voz, y revisa cuánto va a costar antes de generarlo."
            action={
              status.canEdit ? (
                <ButtonLink href="/clon/nuevo" icon={<Plus className="h-4 w-4" aria-hidden />}>
                  Nuevo video
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <CloneVideoList initial={videos} />
        )}
      </section>

      <CloneGuide />
    </div>
  );
}

export default function ClonPage() {
  return (
    <>
      <PageHeader
        eyebrow="Videos con clon"
        title="Videos con tu clon digital"
        description="Elige un guion y tu clon lo graba con tu cara y tu voz. Usa tu propia cuenta de HeyGen: el clon y el saldo son tuyos."
        icon={<UserRound className="h-5 w-5" aria-hidden />}
        actions={
          <Suspense fallback={null}>
            <HeaderAction />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            <Skeleton className="h-28" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          </div>
        }
      >
        <CloneHome />
      </Suspense>
    </>
  );
}
