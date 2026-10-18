"use client";

import { useState, useTransition } from "react";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import type { GrowthGoals } from "@/lib/db/schema";
import { platformLabel, type Platform } from "@/lib/social/types";
import { saveGoalsAction } from "./actions";

export function GoalDialog({ initial, platforms, label, variant = "ghost" }: { initial: GrowthGoals; platforms: Platform[]; label: string; variant?: "primary" | "ghost" | "subtle" }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ followers: String(initial.followers), platform: initial.platform, weeklyPieces: String(initial.weeklyPieces), deadline: initial.deadline ?? "" });

  const save = () =>
    start(async () => {
      const res = await saveGoalsAction(form);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Meta guardada.");
        setOpen(false);
      }
    });

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)} icon={<Target className="h-4 w-4" aria-hidden />}>
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Tu meta de crecimiento"
        description="Con tu meta y tu ritmo real calculamos cuándo llegas y cuánto tienes que publicar."
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Guardando…" : "Guardar meta"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Seguidores" htmlFor="goal-followers">
            <Input id="goal-followers" type="number" inputMode="numeric" min={100} step={100} value={form.followers} onChange={(e) => setForm({ ...form, followers: e.target.value })} />
          </Field>
          <Field label="En" htmlFor="goal-platform">
            <Select id="goal-platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as GrowthGoals["platform"] })}>
              <option value="TOTAL">Todas mis redes (suma)</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {platformLabel[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Piezas por semana" htmlFor="goal-weekly" hint="Lo que te comprometes a publicar.">
            <Input id="goal-weekly" type="number" inputMode="numeric" min={1} max={30} value={form.weeklyPieces} onChange={(e) => setForm({ ...form, weeklyPieces: e.target.value })} />
          </Field>
          <Field label="Fecha límite (opcional)" htmlFor="goal-deadline">
            <Input id="goal-deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
