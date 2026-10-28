import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useRef } from "react";

import { formatCell } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ResultColumn } from "@/types/api";

const ROW_H = 28;

interface Props {
  columns: ResultColumn[];
  rows: unknown[][];
  sort?: [string, "asc" | "desc"][];
  onSort?: (column: string, additive: boolean) => void;
  rowOffset?: number;
  className?: string;
  label: string;
}

function isNumericType(t: string): boolean {
  return /int|float|double|decimal|numeric|real|hugeint/i.test(t);
}

/** Virtualised, keyboard-scrollable result grid. Only visible rows are rendered. */
export function DataGrid({ columns, rows, sort = [], onSort, rowOffset = 0, className, label }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 12 });
  const template = `56px ${columns.map((c) => (isNumericType(c.type) ? "minmax(96px,max-content)" : "minmax(120px,max-content)")).join(" ")}`;
  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      role="grid"
      aria-label={label}
      aria-rowcount={rows.length + 1}
      className={cn("relative overflow-auto bg-surface text-[12.5px] focus-visible:outline-offset-[-2px]", className)}
    >
      <div className="min-w-full" style={{ width: "max-content" }}>
        <div role="row" className="sticky top-0 z-10 grid border-b border-line bg-surface-2" style={{ gridTemplateColumns: template }}>
          <div className="px-2 py-1.5 text-right text-[11px] text-subtle" role="columnheader">#</div>
          {columns.map((c) => {
            const s = sort.find(([n]) => n === c.name)?.[1];
            return (
              <div key={c.name} role="columnheader" aria-sort={s === "asc" ? "ascending" : s === "desc" ? "descending" : "none"} className="border-l border-line">
                <button
                  type="button"
                  disabled={!onSort}
                  onClick={(e) => onSort?.(c.name, e.shiftKey)}
                  className={cn("flex w-full items-center gap-1 px-2 py-1.5 text-left", onSort && "hover:bg-surface-3", isNumericType(c.type) && "justify-end")}
                  title={onSort ? "Sort by this column (shift-click to add)" : undefined}
                >
                  <span className="truncate font-semibold text-fg">{c.name}</span>
                  <span className="font-mono text-[10px] text-subtle">{c.type.toLowerCase().replace(/\(.*\)/, "")}</span>
                  {s === "asc" && <ArrowUp className="size-3 text-accent" aria-hidden />}
                  {s === "desc" && <ArrowDown className="size-3 text-accent" aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((v) => {
            const row = rows[v.index] ?? [];
            return (
              <div
                key={v.key}
                role="row"
                aria-rowindex={v.index + 2}
                className="absolute left-0 grid w-full border-b border-line/60 hover:bg-surface-2"
                style={{ gridTemplateColumns: template, height: ROW_H, transform: `translateY(${v.start}px)` }}
              >
                <div role="rowheader" className="tabular px-2 py-1 text-right text-[11px] text-subtle">{rowOffset + v.index + 1}</div>
                {columns.map((c, ci) => {
                  const value = row[ci];
                  return (
                    <div
                      key={c.name}
                      role="gridcell"
                      className={cn("max-w-[420px] truncate border-l border-line/60 px-2 py-1", isNumericType(c.type) && "tabular text-right", value === null && "text-subtle italic")}
                      title={value === null ? "null" : formatCell(value, c.type)}
                    >
                      {value === null ? "null" : formatCell(value, c.type)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
