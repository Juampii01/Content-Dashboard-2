import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, KeyRound, Lock, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/feedback";
import { NewCloneVideoWizard } from "@/components/clon/new-video-wizard";
import { getBrandProfile } from "@/lib/dal/brand";
import { getHeyGenStatus, listScriptsForClone } from "@/lib/dal/clone";
import { getScript } from "@/lib/dal/scripts";
import { spokenTextFromScript } from "@/lib/heygen/text";

export const metadata: Metadata = { title: "Nuevo video con clon" };

async function Wizard({ searchParams }: { searchParams: PageProps<"/clon/nuevo">["searchParams"] }) {
  const params = await searchParams;
  const status = await getHeyGenStatus({ withBalance: true });

  if (!status.configured) {
    return (
      <EmptyState
        icon={<KeyRound className="h-5 w-5" aria-hidden />}
        title="Primero conecta HeyGen"
        description={
          status.isOwner
            ? "Para generar videos con tu clon necesitas guardar tu API key de HeyGen en Ajustes."
            : "Pídele al dueño de la cuenta que guarde la API key de HeyGen en Ajustes."
        }
        action={
          status.isOwner ? (
            <ButtonLink href="/ajustes#claves" icon={<KeyRound className="h-4 w-4" aria-hidden />}>
              Ir a Ajustes
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }
  if (!status.canEdit) {
    return (
      <EmptyState
        icon={<Lock className="h-5 w-5" aria-hidden />}
        title="Tu usuario es de solo lectura"
        description="Puedes ver los videos generados, pero para crear uno nuevo pide acceso de edición al dueño de la cuenta."
      />
    );
  }

  const requested = typeof params.guion === "string" ? params.guion : null;
  const [scripts, brand, requestedScript] = await Promise.all([listScriptsForClone(), getBrandProfile(), requested ? getScript(requested) : null]);
  const options = [...scripts];
  if (requestedScript?.script.content && !options.some((s) => s.id === requestedScript.script.id)) {
    options.unshift({
      id: requestedScript.script.id,
      title: requestedScript.script.title,
      text: spokenTextFromScript(requestedScript.script.content),
      updatedAt: requestedScript.script.updatedAt.toISOString(),
    });
  }
  const initialScriptId = requestedScript?.script.content ? requestedScript.script.id : null;

  return (
    <NewCloneVideoWizard
      scripts={options}
      initialScriptId={initialScriptId}
      missingScript={Boolean(requested && !initialScriptId)}
      brandColor={brand?.colors?.primary && /^#[0-9a-f]{6}$/i.test(brand.colors.primary) ? brand.colors.primary : null}
      balance={status.balance}
      balanceError={status.balanceError}
    />
  );
}

export default function NewCloneVideoPage({ searchParams }: PageProps<"/clon/nuevo">) {
  return (
    <>
      <ButtonLink href="/clon" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Videos con clon
      </ButtonLink>
      <PageHeader
        eyebrow="Nuevo video con clon"
        title="¿Qué va a decir tu clon?"
        description="Cuatro pasos: el texto, tu clon y su voz, el formato y la confirmación con el costo estimado antes de gastar saldo."
        icon={<Plus className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-[520px]" />}>
        <Wizard searchParams={searchParams} />
      </Suspense>
    </>
  );
}
