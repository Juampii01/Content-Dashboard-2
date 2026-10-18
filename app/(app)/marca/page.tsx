import type { Metadata } from "next";
import { Suspense } from "react";
import { Palette } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/feedback";
import { BrandEditor } from "@/components/marca/brand-editor";
import type { BrandInput } from "@/components/marca/actions";
import { getCurrentUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { getBrandProfile, getVoiceSuggestions } from "@/lib/dal/brand";

export const metadata: Metadata = { title: "Mi marca" };

async function Editor() {
  const [me, brand, suggestions] = await Promise.all([getCurrentUser(), getBrandProfile(), getVoiceSuggestions()]);
  const initial: BrandInput = {
    name: brand?.name ?? "",
    handle: brand?.handle ?? "",
    niche: brand?.niche ?? "",
    whatYouSell: brand?.whatYouSell ?? "",
    differentiator: brand?.differentiator ?? "",
    audience: brand?.audience ?? "",
    audiencePains: brand?.audiencePains ?? [],
    audienceDesires: brand?.audienceDesires ?? [],
    objections: brand?.objections ?? [],
    beliefs: brand?.beliefs ?? [],
    tone: brand?.tone ?? "",
    signaturePhrases: brand?.signaturePhrases ?? [],
    bannedWords: brand?.bannedWords ?? [],
    emojiPolicy: (brand?.emojiPolicy as BrandInput["emojiPolicy"]) ?? "pocos",
    language: (brand?.language as BrandInput["language"]) ?? "es-neutro",
    voiceSamples: brand?.voiceSamples ?? [],
    offers: brand?.offers ?? [],
    pillars: brand?.pillars ?? [],
    extraContext: brand?.extraContext ?? "",
  };
  return <BrandEditor initial={initial} suggestions={suggestions} aiReady={aiConfigured()} canEdit={me.role !== "VIEWER"} />;
}

export default function MarcaPage() {
  return (
    <>
      <PageHeader
        eyebrow="Mi marca"
        title="Cómo suena tu marca"
        description="Lo que pongas aquí lo usan los guiones, los carruseles y el clon. Cuanto más concreto, más suenan a ti."
        icon={<Palette className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Editor />
      </Suspense>
    </>
  );
}
