import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-6xl" };

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md" }: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]" />
        <RD.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-lg border border-line bg-surface shadow-pop focus:outline-none",
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RD.Title className="text-[15px] font-semibold text-fg">{title}</RD.Title>
              {description ? (
                <RD.Description className="mt-1 text-[13px] text-muted">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{title}</RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close dialog">
                <X />
              </Button>
            </RD.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | void;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", destructive, onConfirm }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
