import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";

import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-line bg-surface-2 px-2.5 text-[13px] text-fg placeholder:text-subtle " +
  "transition-colors hover:border-line-strong focus-visible:border-accent focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-50 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, "h-8", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(control, "min-h-20 py-2", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, "h-8 cursor-pointer pr-7", className)} {...props}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

/** Label + control + hint/error with correct aria wiring. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children(id, descId)}
      {(error || hint) && (
        <p id={descId} className={cn("text-xs", error ? "text-danger" : "text-subtle")} role={error ? "alert" : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg select-none">
      <input
        type="checkbox"
        className="size-3.5 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
