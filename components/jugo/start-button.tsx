"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Citrus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { startPackAction } from "./actions";

/** "Sacarle todo el jugo": arranca la generación y lleva a la pantalla del resultado, que se llena sola. */
export function StartPackButton({ kind, id, disabled, label = "Sacarle todo el jugo" }: { kind: "video" | "guion" | "pieza"; id: string; disabled?: boolean; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={disabled || pending}
      icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Citrus className="h-4 w-4" aria-hidden />}
      onClick={() =>
        start(async () => {
          const res = await startPackAction(kind, id);
          if (!res.ok) return void toast.error(res.error);
          router.push(`/jugo/${res.data!.id}`);
        })
      }
    >
      {pending ? "Empezando…" : label}
    </Button>
  );
}
