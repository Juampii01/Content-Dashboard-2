import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "md" | "sm";

const variants: Record<Variant, string> = {
  primary: "btn",
  ghost: "btn-ghost",
  subtle:
    "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-muted transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-danger/50 bg-danger/10 px-4 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50",
};

const sizes: Record<Size, string> = { md: "", sm: "!px-3 !py-1.5 !text-xs" };

type Common = { variant?: Variant; size?: Size; icon?: ReactNode; children?: ReactNode; className?: string };

export function Button({ variant = "primary", size = "md", icon, children, className, ...props }: Common & ComponentProps<"button">) {
  return (
    <button type="button" className={cn(variants[variant], sizes[size], className)} {...props}>
      {icon}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", icon, children, className, ...props }: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={cn(variants[variant], sizes[size], className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}
