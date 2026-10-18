"use client";

import { useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { generateWeeklyReportAction } from "./actions";

export function GenerateReportButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      icon={<Sparkles className={pending ? "h-4 w-4 animate-pulse" : "h-4 w-4"} aria-hidden />}
      onClick={() =>
        start(async () => {
          const res = await generateWeeklyReportAction();
          if (!res.ok) toast.error(res.error);
        })
      }
    >
      {pending ? "Escribiendo…" : label}
    </Button>
  );
}
