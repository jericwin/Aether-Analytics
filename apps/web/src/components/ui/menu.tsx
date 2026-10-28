import * as DM from "@radix-ui/react-dropdown-menu";
import * as TT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const MenuRoot = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "end" }: { children: ReactNode; align?: "start" | "end" }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={4}
        className="z-50 min-w-44 rounded-md border border-line bg-surface p-1 shadow-pop"
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none select-none",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-3 [&_svg]:size-3.5",
        danger ? "text-danger" : "text-fg",
      )}
    >
      {icon}
      {children}
    </DM.Item>
  );
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <TT.Root delayDuration={350}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded border border-line bg-surface-3 px-2 py-1 text-xs text-fg shadow-pop"
        >
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

export const TooltipProvider = TT.Provider;
