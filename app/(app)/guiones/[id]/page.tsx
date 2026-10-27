import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Citrus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { ScriptEditor } from "@/components/guiones/script-editor";
import { getCurrentUser } from "@/lib/auth";
import { getScript } from "@/lib/dal/scripts";

export const metadata: Metadata = { title: "Guion" };

async function Editor({ params }: { params: PageProps<"/guiones/[id]">["params"] }) {
  const { id } = await params;
  const [me, data] = await Promise.all([getCurrentUser(), getScript(id)]);
  if (!data?.script.content) notFound();
  const { script, versions, parent } = data;
  return (
    <ScriptEditor
      scriptId={script.id}
      initial={script.content!}
      format={script.format}
      status={script.status}
      versions={versions.map((v) => ({ id: v.id, action: v.action, createdAt: v.createdAt.toISOString() }))}
      parent={parent}
      canEdit={me.role !== "VIEWER"}
    />
  );
}

/** Acceso a "Sacarle todo el jugo" con este guion como origen (no se muestra a quien solo puede ver). */
async function JugoLink({ params }: { params: PageProps<"/guiones/[id]">["params"] }) {
  const [{ id }, me] = await Promise.all([params, getCurrentUser()]);
  if (me.role === "VIEWER") return null;
  return (
    <ButtonLink href={`/jugo?guion=${id}`} variant="ghost" size="sm" icon={<Citrus className="h-4 w-4" aria-hidden />}>
      Sacarle todo el jugo
    </ButtonLink>
  );
}

export default function ScriptPage({ params }: PageProps<"/guiones/[id]">) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <ButtonLink href="/guiones" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
          Volver a Guiones
        </ButtonLink>
        <Suspense fallback={null}>
          <JugoLink params={params} />
        </Suspense>
      </div>
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <Editor params={params} />
      </Suspense>
    </>
  );
}
