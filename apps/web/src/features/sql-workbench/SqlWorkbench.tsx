import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Clock, Download, History, Play, Save, Search, Square, Star, Table2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { DataGrid } from "@/components/DataGrid";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, ErrorState, Spinner, StatusBadge } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/menu";
import { api, errorMessage } from "@/lib/api";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn, safeStorage, uid } from "@/lib/utils";
import { keys, useDeleteSavedQuery, useQueryHistory, useSaveQuery, useSavedQueries, useSchema } from "@/services/hooks";
import type { QueryResult, SavedQuery } from "@/types/api";

import { SqlEditor } from "./SqlEditor";

function SchemaBrowser({ projectId, onInsert }: { projectId: string; onInsert: (s: string) => void }) {
  const { data, isLoading, error } = useSchema(projectId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const tables = useMemo(() => {
    const s = q.toLowerCase();
    return (data ?? []).filter((t) => !s || t.table_name.includes(s) || t.columns.some((c) => c.name.toLowerCase().includes(s)));
  }, [data, q]);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-2">
        <div className="relative"><Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-subtle" aria-hidden />
          <Input className="h-7 pl-7 text-xs" placeholder="Search tables & columns" aria-label="Search schema" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1 text-xs">
        {error ? <ErrorState error={error} compact /> : isLoading ? <Spinner /> : !tables.length ? <p className="p-2 text-muted">{data?.length ? "No matches" : "No ready datasets in this project."}</p> : tables.map((t) => {
          const expanded = open.has(t.table_name) || (!!q && t.columns.some((c) => c.name.toLowerCase().includes(q.toLowerCase())));
          return (
            <div key={t.table_name}>
              <div className="group flex items-center rounded hover:bg-surface-3">
                <button className="flex min-w-0 flex-1 items-center gap-1 px-1 py-1 text-left" aria-expanded={expanded}
                  onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(t.table_name)) n.delete(t.table_name); else n.add(t.table_name); return n; })}>
                  {expanded ? <ChevronDown className="size-3.5 text-subtle" /> : <ChevronRight className="size-3.5 text-subtle" />}
                  <Table2 className="size-3.5 text-accent" aria-hidden />
                  <span className="truncate font-mono font-medium">{t.table_name}</span>
                  <span className="ml-auto pl-1 text-[10px] text-subtle">{formatNumber(t.row_count, "compact")}</span>
                </button>
                <Tooltip content="Insert a SELECT for this table"><button className="px-1 text-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-accent" aria-label={`Insert query for ${t.table_name}`}
                  onClick={() => onInsert(`SELECT *\nFROM ${t.table_name}\nLIMIT 100`)}><Play className="size-3" /></button></Tooltip>
              </div>
              {expanded && (
                <ul className="mb-1 ml-5 border-l border-line pl-2">
                  {t.columns.map((c) => (
                    <li key={c.name}><button className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-3" title="Insert column name"
                      onClick={() => onInsert(/^[a-z_][a-z0-9_]*$/.test(c.name) ? c.name : `"${c.name}"`)}>
                      <span className="truncate font-mono">{c.name}</span><span className="text-[10px] text-subtle">{c.logical_type}</span></button></li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SqlWorkbench() {
  const { projectId = "" } = useParams();
  const draftKey = `aether.sql.${projectId}`;
  const qc = useQueryClient();
  const [sql, setSql] = useState(() => safeStorage.get(draftKey) ?? "");
  const [current, setCurrent] = useState<SavedQuery | null>(null);
  const [side, setSide] = useState<"saved" | "history">("saved");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const runningId = useRef<string | null>(null);
  const { data: schema } = useSchema(projectId);
  const saved = useSavedQueries(projectId);
  const history = useQueryHistory(projectId);
  const save = useSaveQuery(projectId);
  const removeSaved = useDeleteSavedQuery(projectId);

  // Preserve unsaved work per project.
  useEffect(() => {
    const t = setTimeout(() => safeStorage.set(draftKey, sql), 400);
    return () => clearTimeout(t);
  }, [sql, draftKey]);

  const run = useMutation({
    mutationFn: (text: string) => {
      const id = uid();
      runningId.current = id;
      return api.post<QueryResult>(`/projects/${projectId}/queries/execute`, { sql: text, client_query_id: id });
    },
    onSettled: () => {
      runningId.current = null;
      void qc.invalidateQueries({ queryKey: keys.history(projectId) });
    },
  });

  const execute = useCallback(() => {
    if (!sql.trim() || run.isPending) return;
    run.mutate(sql);
  }, [sql, run]);

  const cancel = async () => {
    if (!runningId.current) return;
    try {
      await api.post(`/projects/${projectId}/queries/${runningId.current}/cancel`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const insert = (text: string) => setSql((s) => (s.trim() ? `${s}${s.endsWith("\n") || s.endsWith(" ") ? "" : " "}${text}` : text));

  const doSave = () => {
    const name = saveName.trim();
    if (!name) return;
    save.mutate({ id: current && current.name === name ? current.id : undefined, name, sql }, {
      onSuccess: (q) => { setCurrent(q); setSaveOpen(false); toast.success(`Saved "${q.name}"`); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const exportCsv = async () => {
    try {
      const { truncated } = await api.download(`/projects/${projectId}/queries/export`, { sql }, "query_result.csv");
      toast.success(truncated ? "Exported the first 1,000,000 rows" : "Export downloaded");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const result = run.data;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="flex h-56 shrink-0 flex-col border-b border-line bg-surface lg:h-auto lg:w-64 lg:border-r lg:border-b-0" aria-label="Schema browser">
        <div className="border-b border-line px-3 py-2 text-xs font-semibold text-muted">Tables</div>
        <div className="min-h-0 flex-1"><SchemaBrowser projectId={projectId} onInsert={insert} /></div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
          {run.isPending ? (
            <Button variant="danger" icon={<Square />} onClick={() => void cancel()}>Cancel</Button>
          ) : (
            <Tooltip content="Run (Ctrl+Enter)"><Button variant="primary" icon={<Play />} onClick={execute} disabled={!sql.trim()}>Run</Button></Tooltip>
          )}
          <Button icon={<Save />} disabled={!sql.trim()} onClick={() => { setSaveName(current?.name ?? ""); setSaveOpen(true); }}>Save</Button>
          <Button icon={<Download />} disabled={!sql.trim()} onClick={() => void exportCsv()}>Export CSV</Button>
          {current && <span className="truncate text-xs text-muted">Editing saved query <span className="font-medium text-fg">{current.name}</span></span>}
          <span className="ml-auto hidden text-xs text-subtle sm:block">Read-only DuckDB sandbox · results capped at 10,000 rows</span>
        </div>
        <div className="h-[38%] min-h-40 border-b border-line">
          <SqlEditor value={sql} onChange={setSql} onRun={execute} schema={schema ?? []} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-9 flex-wrap items-center gap-3 border-b border-line bg-surface-2 px-3 py-1.5 text-xs text-muted" aria-live="polite">
            {run.isPending ? <Spinner label="Running query" /> : run.error ? <span className="text-danger">Query failed</span> : result ? (
              <>
                <StatusBadge status="succeeded" />
                <span className="tabular">{formatNumber(result.row_count, "integer")} rows</span>
                <span className="tabular flex items-center gap-1"><Clock className="size-3" />{result.duration_ms} ms</span>
                {result.truncated && <Badge tone="warning">Truncated to {formatNumber(result.max_rows, "integer")} rows. Export for the full result.</Badge>}
                <span>Tables: {result.tables.join(", ") || "none"}</span>
              </>
            ) : <span>Run a query to see results</span>}
          </div>
          <div className="relative min-h-0 flex-1">
            {run.error ? <div className="p-3"><ErrorState error={run.error} /></div>
              : result ? (result.columns.length ? <DataGrid label="Query results" className="absolute inset-0" columns={result.columns} rows={result.rows} /> : <p className="p-3 text-muted">No columns returned.</p>)
              : <EmptyState title="No results yet" description="Write a SELECT query against your project tables, then press Run or Ctrl+Enter." />}
          </div>
        </div>
      </div>
      <aside className="flex h-64 shrink-0 flex-col border-t border-line bg-surface lg:h-auto lg:w-72 lg:border-t-0 lg:border-l" aria-label="Saved queries and history">
        <div className="flex border-b border-line" role="tablist">
          {(["saved", "history"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)}
              className={cn("flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs", side === s ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
              {s === "saved" ? <Star className="size-3.5" /> : <History className="size-3.5" />}{s === "saved" ? "Saved" : "History"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {side === "saved" ? (
            !saved.data?.length ? <p className="p-3 text-xs text-muted">No saved queries yet.</p> : (
              <ul className="divide-y divide-line">
                {saved.data.map((q) => (
                  <li key={q.id} className={cn("group flex items-start gap-1 px-3 py-2 hover:bg-surface-2", current?.id === q.id && "bg-accent-soft")}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => { setSql(q.sql); setCurrent(q); }}>
                      <div className="truncate text-[13px] font-medium">{q.name}</div>
                      <div className="truncate font-mono text-[11px] text-subtle">{q.sql.replace(/\s+/g, " ")}</div>
                    </button>
                    <button className="p-1 text-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger" aria-label={`Delete saved query ${q.name}`}
                      onClick={() => removeSaved.mutate(q.id, { onSuccess: () => { toast.success("Query deleted"); if (current?.id === q.id) setCurrent(null); } })}><Trash2 className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
            )
          ) : !history.data?.items.length ? <p className="p-3 text-xs text-muted">No queries run yet.</p> : (
            <ul className="divide-y divide-line">
              {history.data.items.map((h) => (
                <li key={h.id}><button className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setSql(h.sql); setCurrent(null); }}>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={cn("font-medium", h.status === "succeeded" ? "text-success" : h.status === "cancelled" ? "text-muted" : "text-danger")}>{h.status}</span>
                    <span className="text-subtle">{timeAgo(h.created_at)}</span>
                    {h.duration_ms != null && <span className="tabular ml-auto text-subtle">{h.duration_ms} ms</span>}
                  </div>
                  <div className="mt-0.5 line-clamp-2 font-mono text-[11px] text-muted">{h.sql}</div>
                  {h.error_message && <div className="mt-0.5 line-clamp-2 text-[11px] text-danger">{h.error_message}</div>}
                </button></li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen} title={current ? "Save query" : "Save as new query"} size="sm"
        footer={<><Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!saveName.trim()} onClick={doSave}>Save</Button></>}>
        <Input aria-label="Query name" placeholder="Query name" value={saveName} maxLength={120} autoFocus onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSave()} />
        {current && <p className="mt-2 text-xs text-subtle">Keep the name to update “{current.name}”, or change it to save a new query.</p>}
      </Dialog>
    </div>
  );
}
