import * as React from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-800 text-white hover:bg-brand-700 active:bg-brand-900 disabled:bg-zinc-300 disabled:text-zinc-500",
  accent:
    "bg-amber-400 text-brand-950 hover:bg-amber-300 active:bg-amber-500 disabled:bg-zinc-200 disabled:text-zinc-500",
  secondary:
    "border border-zinc-300 bg-white text-zinc-900 hover:border-amber-400/70 hover:bg-amber-50 disabled:text-zinc-400",
  ghost: "text-brand-800 hover:bg-brand-50 disabled:text-zinc-400",
  danger: "bg-red-700 text-white hover:bg-red-600 disabled:bg-red-300",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={rest.type ?? "button"}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
        />
      ) : null}
      {children}
    </button>
  );
}
