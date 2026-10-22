import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, KeyRound, Languages, Lock } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/feedback";
import { TranslateWizard } from "@/components/clon/translate-wizard";
import { getHeyGenStatus, listTranslationSources } from "@/lib/dal/clone";
import { fileDriver } from "@/lib/storage/files";

export const metadata: Metadata = { title: "Traducir con tu clon" };

/**
 * /clon/traducir — el mismo video en otro idioma con la cara y la voz del cliente.
 * Parámetros (para enlazar desde otros módulos):
 * - `?editor=<id>`: un video ya renderizado en el Editor (video_projects en DONE).
 * - `?video=<id>`: un video con clon (o una traducción) ya listo (clone_videos en COMPLETED).
 * Sin parámetros, la persona elige el video o sube uno.
 */
async function Wizard({ searchParams }: { searchParams: PageProps<"/clon/traducir">["searchParams"] }) {
  const params = await searchParams;
  const status = await getHeyGenStatus({ withBalance: true });

  if (!status.configured) {
    return (
      <EmptyState
        icon={<KeyRound className="h-5 w-5" aria-hidden />}
        title="Primero conecta HeyGen"
        description={
          status.isOwner
            ? "La traducción se hace en tu propia cuenta de HeyGen, con tu voz y tu saldo. Guarda tu API key en Ajustes y vuelve aquí."
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
        description="Puedes ver los videos traducidos, pero para traducir uno nuevo pide acceso de edición al dueño de la cuenta."
      />
    );
  }

  const sources = await listTranslationSources();
  const wantEditor = typeof params.editor === "string" ? params.editor : null;
  const wantClone = typeof params.video === "string" ? params.video : null;
  const initial = wantEditor
    ? (sources.editor.find((s) => s.id === wantEditor) ?? null)
    : wantClone
      ? (sources.clone.find((s) => s.id === wantClone) ?? null)
      : null;

  return (
    <TranslateWizard
      sources={sources}
      initial={initial ? { type: initial.type, id: initial.id } : null}
      missingSource={Boolean((wantEditor || wantClone) && !initial)}
      uploadMode={fileDriver()}
      balance={status.balance}
      balanceError={status.balanceError}
    />
  );
}

export default function TranslatePage({ searchParams }: PageProps<"/clon/traducir">) {
  return (
    <>
      <ButtonLink href="/clon" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Videos con clon
      </ButtonLink>
      <PageHeader
        eyebrow="Traducir con tu clon"
        title="Tu video en otro idioma, con tu cara y tu voz"
        description="Elige un video y el idioma. HeyGen lo traduce con tu voz y ajusta los labios, o tu clon lo graba de nuevo con el texto adaptado. Ves el costo antes de confirmar."
        icon={<Languages className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-[520px]" />}>
        <Wizard searchParams={searchParams} />
      </Suspense>
    </>
  );
}
