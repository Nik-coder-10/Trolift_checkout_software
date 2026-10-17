import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent" | "orange";

const tones: Record<Tone, string> = {
  neutral: "bg-zinc-200 text-zinc-800",
  success: "bg-green-100 text-green-900",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-800",
  info: "bg-brand-100 text-brand-900",
  accent: "bg-amber-400 text-brand-950",
  orange: "bg-orange-100 text-orange-900",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
