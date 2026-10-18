"use client";

import { useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/format";
import { classifyHooksAction } from "./actions";

export function ClassifyHooksButton({ pending }: { pending: number }) {
  const [busy, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      icon={<Sparkles className={busy ? "h-4 w-4 animate-pulse" : "h-4 w-4"} aria-hidden />}
      onClick={() =>
        start(async () => {
          const res = await classifyHooksAction();
          if (!res.ok) toast.error(res.error);
          else toast.success(res.message);
        })
      }
    >
      {busy ? "Clasificando…" : `Clasificar ${formatNumber(pending)} piezas`}
    </Button>
  );
}
