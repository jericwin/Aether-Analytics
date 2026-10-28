import * as RT from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-[17px] font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-line bg-surface shadow-panel", className)}>
      {(title || actions) && (
        <header className="flex min-h-10 items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="truncate text-[13px] font-semibold text-fg">{title}</h2>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-panel">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold tracking-tight text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-subtle">{hint}</div>}
    </div>
  );
}

export const Tabs = RT.Root;

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RT.List className={cn("flex gap-1 overflow-x-auto border-b border-line px-4 sm:px-6", className)}>{children}</RT.List>
  );
}

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RT.Trigger
      value={value}
      className={cn(
        "-mb-px flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13px] whitespace-nowrap text-muted",
        "hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg [&_svg]:size-3.5",
      )}
    >
      {children}
    </RT.Trigger>
  );
}

export const TabPanel = RT.Content;

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
