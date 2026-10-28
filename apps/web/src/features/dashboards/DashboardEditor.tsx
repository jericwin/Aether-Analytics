import { useQueryClient } from "@tanstack/react-query";
import { Eye, Maximize2, Pencil, Plus, Printer, Save, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GridLayout, type Layout } from "react-grid-layout";
import { useBlocker, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/menu";
import { useElementWidth } from "@/hooks/useElementWidth";
import { api, errorMessage } from "@/lib/api";
import { cn, uid } from "@/lib/utils";
import { keys, useDashboard, useProject, useSchema } from "@/services/hooks";
import type { ActiveFilter, DashboardDetail, SchemaTable } from "@/types/api";

import { ChartWidget, type WidgetDraft } from "./ChartWidget";
import { FilterBar, type FilterDraft, type FilterValues, toActiveFilters } from "./FilterBar";
import { validateQuery, WidgetConfigPanel } from "./WidgetConfigPanel";

interface Draft {
  name: string;
  description: string | null;
  widgets: WidgetDraft[];
  filters: FilterDraft[];
}

export function toDraft(d: DashboardDetail): Draft {
  return {
    name: d.name,
    description: d.description,
    widgets: d.widgets.filter((w) => w.dataset_id).map((w) => ({
      id: w.id, title: w.title, dataset_id: w.dataset_id!, query: w.config.query, display: w.config.display ?? {}, layout: w.layout,
    })),
    filters: d.filters.map((f) => ({ id: f.id, dataset_id: f.dataset_id, column: f.column, filter_type: f.filter_type, label: f.label })),
  };
}

export function newWidget(schema: SchemaTable[], y: number): WidgetDraft | null {
  const t = schema[0];
  if (!t) return null;
  const dim = t.columns.find((c) => c.logical_type === "string") ?? t.columns[0];
  return {
    id: uid(), title: "New chart", dataset_id: t.dataset_id,
    query: { chart_type: "bar", dimension: dim?.name ?? null, date_grain: "none", measures: [{ column: null, agg: "count" }], limit: 20, include_nulls: true },
    display: {}, layout: { x: 0, y, w: 6, h: 7 },
  };
}

export default function DashboardEditor() {
  const { projectId = "", dashboardId = "" } = useParams();
  const qc = useQueryClient();
  const { data: project } = useProject(projectId);
  const { data, isLoading, error, refetch } = useDashboard(projectId, dashboardId);
  const { data: schema = [] } = useSchema(projectId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [cross, setCross] = useState<{ source: string; dataset_id: string; column: string; value: unknown } | null>(null);
  const [saving, setSaving] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [containerRef, width] = useElementWidth();
  const canEdit = project?.role !== "viewer";

  useEffect(() => {
    if (data && !draft) {
      const d = toDraft(data);
      setDraft(d);
      setSaved(JSON.stringify(d));
      if (!d.widgets.length && project?.role !== "viewer") setEditing(true);
    }
  }, [data, draft, project]);

  const dirty = !!draft && JSON.stringify(draft) !== saved;
  // Protect unsaved work on in-app navigation and tab close.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  useEffect(() => {
    const exit = () => setPresenting(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", exit);
    return () => document.removeEventListener("fullscreenchange", exit);
  }, []);

  const types = useCallback((datasetId: string) => Object.fromEntries((schema.find((s) => s.dataset_id === datasetId)?.columns ?? []).map((c) => [c.name, c.logical_type])), [schema]);

  const filters: ActiveFilter[] = useMemo(() => {
    if (!draft) return [];
    return toActiveFilters(draft.filters, filterValues);
  }, [draft, filterValues]);

  const filtersFor = useCallback((w: WidgetDraft): ActiveFilter[] => {
    if (!cross || cross.source === w.id) return filters;
    return [...filters, { dataset_id: cross.dataset_id, filter: { column: cross.column, op: "in", values: [cross.value] } }];
  }, [filters, cross]);

  const update = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn(d) : d));
  const updateWidget = (w: WidgetDraft) => update((d) => ({ ...d, widgets: d.widgets.map((x) => (x.id === w.id ? w : x)) }));

  const onLayout = (layout: Layout) => {
    if (!editing) return;
    update((d) => ({
      ...d,
      widgets: d.widgets.map((w) => {
        const l = layout.find((i) => i.i === w.id);
        return l && (l.x !== w.layout.x || l.y !== w.layout.y || l.w !== w.layout.w || l.h !== w.layout.h) ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w;
      }),
    }));
  };

  const addWidget = () => {
    if (!draft) return;
    const y = draft.widgets.reduce((m, w) => Math.max(m, w.layout.y + w.layout.h), 0);
    const w = newWidget(schema, y);
    if (!w) return toast.error("Import a dataset first. Widgets need a ready dataset.");
    update((d) => ({ ...d, widgets: [...d.widgets, w] }));
    setSelected(w.id);
  };

  const save = async () => {
    if (!draft) return;
    const invalid = draft.widgets.map((w) => [w, validateQuery(w.query, types(w.dataset_id))] as const).find(([, e]) => e);
    if (invalid) {
      setSelected(invalid[0].id);
      return toast.error(`"${invalid[0].title}": ${invalid[1]}`);
    }
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim() || "Untitled dashboard",
        description: draft.description,
        widgets: draft.widgets.map((w) => ({ title: w.title.trim() || "Untitled", dataset_id: w.dataset_id, query: w.query, display: w.display, layout: w.layout })),
        filters: draft.filters.map((f) => ({ dataset_id: f.dataset_id, column: f.column, filter_type: f.filter_type, label: f.label })),
      };
      const res = await api.put<DashboardDetail>(`/projects/${projectId}/dashboards/${dashboardId}`, body);
      const next = toDraft(res);
      // Keep selection pointing at the re-created widget at the same position.
      const idx = draft.widgets.findIndex((w) => w.id === selected);
      setDraft(next);
      setSaved(JSON.stringify(next));
      setSelected(idx >= 0 ? next.widgets[idx]?.id ?? null : null);
      qc.setQueryData(keys.dashboard(projectId, dashboardId), res);
      void qc.invalidateQueries({ queryKey: keys.dashboards(projectId) });
      toast.success("Dashboard saved");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const present = async () => {
    setEditing(false);
    setSelected(null);
    try {
      await document.getElementById("dashboard-canvas")?.requestFullscreen();
    } catch {
      toast.error("Full-screen mode is not available in this browser");
    }
  };

  if (error) return <div className="p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (isLoading || !draft) return <div className="space-y-3 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-96" /></div>;
  const selectedWidget = draft.widgets.find((w) => w.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-6 print:hidden">
          {editing ? (
            <Input aria-label="Dashboard name" className="h-8 max-w-xs text-[15px] font-semibold" value={draft.name} maxLength={120} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />
          ) : <h1 className="truncate text-[17px] font-semibold tracking-tight">{draft.name}</h1>}
          {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {editing && <Button icon={<Plus />} onClick={addWidget}>Add chart</Button>}
            {editing && dirty && <Tooltip content="Discard unsaved changes"><Button variant="ghost" icon={<Undo2 />} onClick={() => { setDraft(JSON.parse(saved) as Draft); setSelected(null); }}>Discard</Button></Tooltip>}
            {canEdit && (editing
              ? <Button icon={<Eye />} onClick={() => { setEditing(false); setSelected(null); }}>View</Button>
              : <Button icon={<Pencil />} onClick={() => setEditing(true)}>Edit</Button>)}
            <Tooltip content="Full-screen presentation"><Button variant="ghost" size="icon" aria-label="Present full screen" onClick={() => void present()}><Maximize2 /></Button></Tooltip>
            <Tooltip content="Print or save as PDF (browser print dialog)"><Button variant="ghost" size="icon" aria-label="Print or save as PDF" onClick={() => { setEditing(false); setSelected(null); setTimeout(() => window.print(), 100); }}><Printer /></Button></Tooltip>
            {canEdit && <Button variant="primary" icon={<Save />} loading={saving} disabled={!dirty} onClick={() => void save()}>Save</Button>}
          </div>
        </div>
        <FilterBar
          projectId={projectId} defs={draft.filters} values={filterValues} onValues={setFilterValues} editing={editing} schema={schema}
          onAdd={(f) => update((d) => ({ ...d, filters: [...d.filters, { ...f, id: uid() }] }))}
          onRemove={(id) => { update((d) => ({ ...d, filters: d.filters.filter((f) => f.id !== id) })); setFilterValues(({ [id]: _, ...rest }) => rest); }}
          crossFilter={cross ? { label: `${cross.column} = ${cross.value === null ? "(null)" : String(cross.value)}` } : null}
          onClearCross={() => setCross(null)}
        />
        <div id="dashboard-canvas" className={cn("min-h-0 flex-1 overflow-auto bg-bg", presenting && "p-4")}>
          <div className="px-2 py-2 sm:px-4">
            {/* Measure the unpadded box so the grid never exceeds the visible width. */}
            <div ref={containerRef}>
            {!draft.widgets.length ? (
              <EmptyState title="This dashboard is empty" description={schema.length ? "Add a chart, choose a dataset and configure what it shows." : "Import a dataset into this project first."}
                action={canEdit && <Button variant="primary" icon={<Plus />} onClick={() => { setEditing(true); addWidget(); }} disabled={!schema.length}>Add chart</Button>} />
            ) : width > 0 && (
              <GridLayout
                width={width}
                layout={draft.widgets.map((w) => ({ i: w.id, ...w.layout, minW: 2, minH: 3 }))}
                gridConfig={{ cols: 12, rowHeight: 40, margin: [12, 12] }}
                dragConfig={{ enabled: editing, handle: ".widget-drag-handle" }}
                resizeConfig={{ enabled: editing }}
                onLayoutChange={onLayout}
              >
                {draft.widgets.map((w) => (
                  <div key={w.id}>
                    <ChartWidget
                      projectId={projectId} widget={w} filters={filtersFor(w)} editing={editing} selected={editing && selected === w.id}
                      onSelect={() => setSelected(w.id)}
                      onDuplicate={() => {
                        const copy = { ...w, id: uid(), title: `${w.title} (copy)`, layout: { ...w.layout, y: w.layout.y + w.layout.h } };
                        update((d) => ({ ...d, widgets: [...d.widgets, copy] }));
                      }}
                      onRemove={() => { update((d) => ({ ...d, widgets: d.widgets.filter((x) => x.id !== w.id) })); if (selected === w.id) setSelected(null); }}
                      onCrossFilter={(column, value) => setCross((c) => (c && c.source === w.id && c.value === value ? null : { source: w.id, dataset_id: w.dataset_id, column, value }))}
                    />
                  </div>
                ))}
              </GridLayout>
            )}
            </div>
          </div>
        </div>
      </div>
      {editing && selectedWidget && (
        <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-sm border-l border-line bg-surface shadow-pop lg:static lg:z-auto lg:w-80 lg:shadow-none" aria-label="Widget configuration">
          <WidgetConfigPanel widget={selectedWidget} schema={schema} onChange={updateWidget} onClose={() => setSelected(null)} />
        </aside>
      )}
      <ConfirmDialog open={blocker.state === "blocked"} onOpenChange={(o) => !o && blocker.reset?.()} title="Leave without saving?"
        description="Your dashboard has unsaved changes that will be lost." confirmLabel="Leave" destructive onConfirm={() => blocker.proceed?.()} />
    </div>
  );
}
