import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/types/api";

import { Button } from "./button";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const statusMeta: Record<JobStatus | "importing" | "ready", { tone: Tone; icon: ReactNode; label: string }> = {
  pending: { tone: "neutral", icon: <CircleDashed />, label: "Queued" },
  running: { tone: "accent", icon: <Loader2 className="animate-spin" />, label: "Running" },
  importing: { tone: "accent", icon: <Loader2 className="animate-spin" />, label: "Importing" },
  succeeded: { tone: "success", icon: <CheckCircle2 />, label: "Succeeded" },
  ready: { tone: "success", icon: <CheckCircle2 />, label: "Ready" },
  failed: { tone: "danger", icon: <XCircle />, label: "Failed" },
  cancelled: { tone: "neutral", icon: <XCircle />, label: "Cancelled" },
};

/** Status is always icon + label, never colour alone. */
export function StatusBadge({ status }: { status: keyof typeof statusMeta }) {
  const meta = statusMeta[status];
  return (
    <Badge tone={meta.tone}>
      {meta.icon}
      {meta.label}
    </Badge>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded", className)} aria-hidden />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="text-xs">{label}…</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 text-subtle [&_svg]:size-8">{icon}</div>}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 rounded-md border border-danger/30 bg-danger-soft text-[13px]",
        compact ? "items-center p-2" : "items-start p-3",
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="break-words text-fg">{errorMessage(error)}</p>
        {requestId && !compact && <p className="mt-1 font-mono text-[11px] text-subtle">Request {requestId}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <div
        className={cn("h-full rounded-full bg-accent transition-[width]", value === null && "skeleton w-1/3")}
        style={value === null ? undefined : { width: `${Math.max(2, value * 100)}%` }}
      />
    </div>
  );
}
