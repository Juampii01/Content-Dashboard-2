import type { Metadata } from "next";
import { Suspense } from "react";
import { Compass, MessageSquarePlus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { StrategistChat } from "@/components/estratega/chat";
import { getCurrentUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { DAILY_QUESTION_LIMIT, getConversation, getSuggestions, listConversations, questionsToday } from "@/lib/dal/strategist";

export const metadata: Metadata = { title: "Estratega" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Parámetros: `?c=<id>` abre una conversación guardada; `?q=<pregunta>` deja la pregunta escrita
 * y con `&enviar=1` la manda al abrir (el acceso desde Inicio y desde otros módulos).
 */
async function Strategist({ searchParams }: { searchParams: PageProps<"/estratega">["searchParams"] }) {
  const params = await searchParams;
  const id = one(params.c);
  const me = await getCurrentUser();
  const [conversations, conversation, used, suggestions] = await Promise.all([listConversations(), id ? getConversation(id) : null, questionsToday(me.id), getSuggestions()]);
  const question = one(params.q).slice(0, 1000);

  return (
    <>
      {id && !conversation && (
        <div className="mb-4">
          <Notice tone="warning">No encontramos esa conversación. Puede que se haya borrado: empieza una nueva.</Notice>
        </div>
      )}
      <StrategistChat
        key={conversation?.id ?? "nueva"}
        conversationId={conversation?.id ?? null}
        initialMessages={(conversation?.messages ?? []).map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
        conversations={conversations.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() }))}
        suggestions={suggestions}
        remaining={Math.max(0, DAILY_QUESTION_LIMIT - used)}
        limit={DAILY_QUESTION_LIMIT}
        canEdit={me.role !== "VIEWER"}
        aiReady={aiConfigured()}
        initialQuestion={conversation ? "" : question}
        autoSend={!conversation && one(params.enviar) === "1" && question.trim().length >= 3}
      />
    </>
  );
}

export default function EstrategaPage({ searchParams }: PageProps<"/estratega">) {
  return (
    <>
      <PageHeader
        eyebrow="Estratega"
        title="Pregúntale a tus datos"
        description="Qué publicar, por qué bajó una red, qué gancho te funciona: te responde con tus números y te muestra de dónde sale cada dato."
        icon={<Compass className="h-5 w-5" aria-hidden />}
        actions={
          <ButtonLink href="/estratega" variant="ghost" icon={<MessageSquarePlus className="h-4 w-4" aria-hidden />}>
            Nueva conversación
          </ButtonLink>
        }
      />
      <Suspense
        fallback={
          <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <Skeleton className="hidden h-96 lg:block" />
            <div className="flex flex-col gap-4">
              <Skeleton className="h-[420px]" />
              <Skeleton className="h-20" />
            </div>
          </div>
        }
      >
        <Strategist searchParams={searchParams} />
      </Suspense>
    </>
  );
}
