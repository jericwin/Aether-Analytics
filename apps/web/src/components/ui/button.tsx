import { Loader2 } from "lucide-react";
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent",
  secondary: "bg-surface-3 text-fg hover:bg-line border border-line",
  outline: "bg-transparent text-fg border border-line-strong hover:bg-surface-3",
  ghost: "bg-transparent text-muted hover:text-fg hover:bg-surface-3 border border-transparent",
  danger: "bg-danger text-white hover:opacity-90 border border-transparent",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
  icon: "h-8 w-8 justify-center",
  "icon-sm": "h-7 w-7 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap transition-colors",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
