import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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

export default function ScriptPage({ params }: PageProps<"/guiones/[id]">) {
  return (
    <>
      <ButtonLink href="/guiones" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Guiones
      </ButtonLink>
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <Editor params={params} />
      </Suspense>
    </>
  );
}
