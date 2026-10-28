import { ChevronLeft, ChevronRight, Columns3, Download, Filter, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataGrid } from "@/components/DataGrid";
import { Button } from "@/components/ui/button";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { MenuContent, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { api, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useRows } from "@/services/hooks";
import type { ColumnFilter, DatasetColumn, FilterOp } from "@/types/api";

const OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: "eq", label: "=", needsValue: true }, { op: "neq", label: "≠", needsValue: true },
  { op: "gt", label: ">", needsValue: true }, { op: "gte", label: "≥", needsValue: true },
  { op: "lt", label: "<", needsValue: true }, { op: "lte", label: "≤", needsValue: true },
  { op: "contains", label: "contains", needsValue: true }, { op: "starts_with", label: "starts with", needsValue: true },
  { op: "is_null", label: "is empty", needsValue: false }, { op: "not_null", label: "is not empty", needsValue: false },
];

interface Props {
  projectId: string;
  datasetId: string;
  version: number;
  columns: DatasetColumn[];
  tableName: string;
}

/** Server-side paginated, sortable, filterable browser. The full dataset never reaches the browser. */
export function DataExplorer({ projectId, datasetId, version, columns, tableName }: Props) {
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<[string, "asc" | "desc"][]>([]);
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [colSearch, setColSearch] = useState("");
  const [draft, setDraft] = useState<ColumnFilter>({ column: columns[0]?.name ?? "", op: "eq", value: "" });
  const [exporting, setExporting] = useState(false);

  const visible = useMemo(() => columns.map((c) => c.name).filter((c) => !hidden.has(c)), [columns, hidden]);
  const params = { version, offset: page * pageSize, limit: pageSize, sort, filters, columns: visible.length === columns.length ? null : visible };
  const { data, isFetching, error, refetch } = useRows(projectId, datasetId, params, visible.length > 0);
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  const toggleSort = (col: string, additive: boolean) => {
    setPage(0);
    setSort((prev) => {
      const current = prev.find(([c]) => c === col)?.[1];
      const next: [string, "asc" | "desc"] | null = current === undefined ? [col, "asc"] : current === "asc" ? [col, "desc"] : null;
      const rest = additive ? prev.filter(([c]) => c !== col) : [];
      return next ? [...rest, next] : rest;
    });
  };

  const addFilter = () => {
    const meta = OPS.find((o) => o.op === draft.op)!;
    if (meta.needsValue && (draft.value === "" || draft.value == null)) return;
    setFilters((f) => [...f, meta.needsValue ? draft : { column: draft.column, op: draft.op }]);
    setDraft((d) => ({ ...d, value: "" }));
    setPage(0);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { truncated } = await api.download(`/projects/${projectId}/datasets/${datasetId}/export`, { version, filters, columns: visible }, `${tableName}.csv`);
      toast.success(truncated ? "Exported the first 1,000,000 rows" : "Export downloaded");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 sm:px-6">
        <Filter className="size-4 text-subtle" aria-hidden />
        <Select aria-label="Filter column" className="h-7 w-40 text-xs" value={draft.column} onChange={(e) => setDraft({ ...draft, column: e.target.value })}>
          {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </Select>
        <Select aria-label="Filter operator" className="h-7 w-28 text-xs" value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value as FilterOp })}>
          {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </Select>
        {OPS.find((o) => o.op === draft.op)?.needsValue && (
          <Input aria-label="Filter value" className="h-7 w-40 text-xs" placeholder="Value" value={String(draft.value ?? "")}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addFilter()} />
        )}
        <Button size="sm" icon={<Plus />} onClick={addFilter}>Add filter</Button>
        {filters.map((f, i) => (
          <span key={i} className="inline-flex h-6 items-center gap-1 rounded border border-line bg-surface-3 pl-2 text-xs">
            <span className="font-medium">{f.column}</span> {OPS.find((o) => o.op === f.op)?.label} {f.value !== undefined && <span className="font-mono">{String(f.value)}</span>}
            <button className="px-1 text-subtle hover:text-fg" aria-label={`Remove filter on ${f.column}`} onClick={() => { setFilters((fs) => fs.filter((_, j) => j !== i)); setPage(0); }}><X className="size-3" /></button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <MenuRoot>
            <MenuTrigger asChild><Button size="sm" icon={<Columns3 />}>Columns ({visible.length}/{columns.length})</Button></MenuTrigger>
            <MenuContent>
              <div className="w-64 p-1">
                <Input className="mb-2 h-7 text-xs" placeholder="Search columns" aria-label="Search columns" value={colSearch} onChange={(e) => setColSearch(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                <div className="max-h-72 overflow-auto">
                  {columns.filter((c) => c.name.toLowerCase().includes(colSearch.toLowerCase())).map((c) => (
                    <div key={c.name} className="flex items-center justify-between px-1 py-0.5">
                      <Checkbox label={c.name} checked={!hidden.has(c.name)} onChange={(v) => setHidden((h) => { const n = new Set(h); if (v) n.delete(c.name); else n.add(c.name); return n; })} />
                      <span className="font-mono text-[10px] text-subtle">{c.logical_type}</span>
                    </div>
                  ))}
                </div>
              </div>
            </MenuContent>
          </MenuRoot>
          <Button size="sm" icon={<Download />} loading={exporting} onClick={() => void exportCsv()}>Export CSV</Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {error ? <div className="p-4"><ErrorState error={error} onRetry={() => void refetch()} /></div> : !data ? <Skeleton className="m-4 h-64" /> : (
          <DataGrid label={`${tableName} rows`} className="absolute inset-0" columns={data.columns} rows={data.rows} sort={sort} rowOffset={data.offset}
            onSort={toggleSort} />
        )}
        {isFetching && data && <div className="absolute top-0 right-0 left-0 h-0.5 skeleton" aria-hidden />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted sm:px-6">
        <span className="tabular">{data ? `${formatNumber(data.total, "integer")} rows${filters.length ? " match" : ""} · ${data.duration_ms} ms` : ""}</span>
        <div className="flex items-center gap-2">
          <Select aria-label="Rows per page" className="h-7 w-24 text-xs" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
            {[50, 100, 250, 500, 1000].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </Select>
          <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></Button>
          <span className="tabular">Page {page + 1} of {formatNumber(pages, "integer")}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
