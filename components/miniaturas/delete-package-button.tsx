"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { deletePackageAction } from "./actions";

export function DeletePackageButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="subtle" size="sm" onClick={() => setOpen(true)} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
        Borrar
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="¿Borrar estos títulos y miniaturas?"
        description="Se borran los títulos y los fondos generados. Tus fotos siguen en Mi marca."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deletePackageAction(id);
                  if (!res.ok) toast.error(res.error);
                  else router.push("/miniaturas");
                })
              }
            >
              Borrar
            </Button>
          </>
        }
      />
    </>
  );
}
