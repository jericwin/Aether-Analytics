import { Code2, Copy, Download, GripVertical, MoreHorizontal, Settings2, Table2, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { buildOption, readTokens } from "@/components/charts/chartOptions";
import { EChart, type EChartsInstance } from "@/components/charts/EChart";
import { DataGrid } from "@/components/DataGrid";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/menu";
import { useTheme } from "@/hooks/useTheme";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useChartData } from "@/services/hooks";
import type { ActiveFilter, ChartQuery, WidgetDisplay } from "@/types/api";

export interface WidgetDraft {
  id: string;
  title: string;
  dataset_id: string;
  query: ChartQuery;
  display: WidgetDisplay;
  layout: { x: number; y: number; w: number; h: number };
}

interface Props {
  projectId: string;
  widget: WidgetDraft;
  filters: ActiveFilter[];
  editing: boolean;
  selected: boolean;
  onSelect?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  /** Cross-filter: user clicked a category value. */
  onCrossFilter?: (column: string, value: unknown) => void;
}

const CROSS_FILTERABLE = new Set(["bar", "stacked_bar", "pie", "donut", "line", "area"]);

export function ChartWidget({ projectId, widget, filters, editing, selected, onSelect, onDuplicate, onRemove, onCrossFilter }: Props) {
  const { data, error, isLoading, isFetching, refetch } = useChartData(projectId, widget.dataset_id, widget.query, filters);
  const { resolved } = useTheme();
  const [asTable, setAsTable] = useState(widget.query.chart_type === "table");
  const [showSql, setShowSql] = useState(false);
  const chartRef = useRef<EChartsInstance | null>(null);
  const q = widget.query;

  const option = useMemo(() => {
    if (!data || q.chart_type === "kpi" || q.chart_type === "table") return null;
    return buildOption(q, widget.display, data, readTokens());
    // resolved: rebuild with the new theme's tokens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, widget.display, resolved]);

  const crossFilterable = CROSS_FILTERABLE.has(q.chart_type) && !!q.dimension && (q.date_grain ?? "none") === "none";

  const downloadPng = () => {
    const url = chartRef.current?.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: readTokens().surface });
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${widget.title.replace(/[^\w-]+/g, "_")}.png`;
    a.click();
  };

  let body: React.ReactNode;
  if (error) body = <div className="p-3"><ErrorState error={error} compact onRetry={() => void refetch()} /></div>;
  else if (isLoading || !data) body = <div className="h-full p-3"><Skeleton className="h-full" /></div>;
  else if (!data.rows.length) body = <div className="flex h-full items-center justify-center text-xs text-muted">No data for the current filters</div>;
  else if (q.chart_type === "kpi") {
    body = (
      <div className="flex h-full flex-wrap items-center gap-x-6 gap-y-2 px-4 pb-2">
        {data.columns.map((c, i) => (
          <div key={c.name} className="min-w-0">
            <div className="tabular truncate text-[28px] leading-tight font-semibold tracking-tight" title={String(data.rows[0]?.[i] ?? "")}>
              {formatNumber(data.rows[0]?.[i], widget.display.number_format ?? "auto", widget.display.currency)}
            </div>
            {data.columns.length > 1 && <div className="truncate text-xs text-muted">{q.measures[i]?.label || c.name}</div>}
          </div>
        ))}
      </div>
    );
  } else if (asTable || q.chart_type === "table") {
    body = <DataGrid label={`${widget.title} data`} className="absolute inset-0" columns={data.columns} rows={data.rows} />;
  } else {
    body = (
      <EChart
        option={option ?? {}}
        chartRef={chartRef}
        ariaLabel={`${widget.title} chart. Use the table view for the underlying values.`}
        onClick={crossFilterable && onCrossFilter && !editing ? (p) => p.name !== undefined && onCrossFilter(q.dimension!, p.name === "(null)" ? null : p.name) : undefined}
      />
    );
  }

  return (
    <div
      className={cn("flex h-full flex-col overflow-hidden rounded-lg border bg-surface shadow-panel", selected ? "border-accent ring-1 ring-accent/40" : "border-line")}
      onMouseDown={editing ? onSelect : undefined}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        {editing && <GripVertical className="widget-drag-handle size-4 cursor-grab text-subtle" aria-label="Drag to move" />}
        <h3 className="min-w-0 flex-1 truncate pl-1 text-[13px] font-semibold" title={widget.title}>{widget.title}</h3>
        {isFetching && data && <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-label="Updating" />}
        {data?.applied_filters ? <Tooltip content={`${data.applied_filters} dashboard filter(s) applied`}><span className="text-[10px] text-accent">filtered</span></Tooltip> : null}
        {q.chart_type !== "kpi" && q.chart_type !== "table" && (
          <Tooltip content={asTable ? "Show chart" : "Show as table"}>
            <Button variant="ghost" size="icon-sm" aria-label={asTable ? "Show chart" : "Show as table"} onClick={() => setAsTable((t) => !t)}><Table2 /></Button>
          </Tooltip>
        )}
        <MenuRoot>
          <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${widget.title}`}><MoreHorizontal /></Button></MenuTrigger>
          <MenuContent>
            {editing && <MenuItem icon={<Settings2 />} onSelect={() => onSelect?.()}>Configure</MenuItem>}
            {editing && <MenuItem icon={<Copy />} onSelect={() => onDuplicate?.()}>Duplicate</MenuItem>}
            <MenuItem icon={<Code2 />} onSelect={() => setShowSql(true)} disabled={!data}>View query & lineage</MenuItem>
            <MenuItem icon={<Download />} onSelect={downloadPng} disabled={!option || asTable}>Download PNG</MenuItem>
            {editing && <><MenuSeparator /><MenuItem icon={<Trash2 />} danger onSelect={() => onRemove?.()}>Remove</MenuItem></>}
          </MenuContent>
        </MenuRoot>
      </div>
      <div className="relative min-h-0 flex-1">{body}</div>
      {data?.truncated && <div className="border-t border-line px-2 py-1 text-[10px] text-warning">Showing a bounded subset of results</div>}
      <Dialog open={showSql} onOpenChange={setShowSql} title="Query & lineage" size="lg"
        description={data && <>Source: dataset <strong>{data.dataset.name}</strong> (table <span className="font-mono">{data.dataset.table_name}</span>), version {data.dataset.version}. Executed in {data.duration_ms} ms.</>}>
        <pre className="overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap">{data?.sql}</pre>
        <p className="mt-2 text-xs text-subtle">Generated from the widget configuration, validated by the same SQL guard as the workbench, and executed against the current dataset version.</p>
      </Dialog>
    </div>
  );
}
