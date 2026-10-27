import type { Metadata } from "next";
import { Suspense } from "react";
import { Palette } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/feedback";
import { BrandEditor } from "@/components/marca/brand-editor";
import { EditorDefaultsForm } from "@/components/editor/editor-defaults-form";
import type { BrandInput } from "@/components/marca/actions";
import { getCurrentUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { getBrandProfile, getVoiceSuggestions } from "@/lib/dal/brand";
import { getEditorDefaults } from "@/lib/dal/editor-defaults";
import { brandGraphicLook } from "@/lib/video/graphics";

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

/** Valores por defecto del Editor de video ("Hazlo por mí" y proyectos nuevos): viven en Mi marca. */
async function EditorDefaults() {
  const [brand, view] = await Promise.all([getBrandProfile(), getEditorDefaults()]);
  // El mismo acento que usa el render de los subtítulos (lib/video/service.ts).
  const accent = [brand?.colors?.accent, brand?.colors?.primary].find((c) => c && /^#[0-9a-f]{6}$/i.test(c)) ?? "#FFD84D";
  return <EditorDefaultsForm initial={view.defaults} tracks={view.tracks} accent={accent} brandFont={brandGraphicLook(brand).font} canEdit={view.canEdit} />;
}

export default function MarcaPage() {
  return (
    <>
      <PageHeader
        eyebrow="Mi marca"
        title="Cómo suena tu marca"
        description="Lo que pongas aquí lo usan los guiones, los carruseles y el editor de video. Cuanto más concreto, más suenan a ti."
        icon={<Palette className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Editor />
      </Suspense>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <EditorDefaults />
        </Suspense>
      </div>
    </>
  );
}
