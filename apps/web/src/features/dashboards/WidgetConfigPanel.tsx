import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import type { Aggregation, ChartQuery, ChartType, DateGrain, Measure, NumberFormat, SchemaTable, WidgetDisplay } from "@/types/api";

import type { WidgetDraft } from "./ChartWidget";

export const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "kpi", label: "KPI card" }, { value: "bar", label: "Bar" }, { value: "stacked_bar", label: "Stacked bar" },
  { value: "line", label: "Line / time series" }, { value: "area", label: "Area" }, { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" }, { value: "scatter", label: "Scatter" }, { value: "histogram", label: "Histogram" },
  { value: "boxplot", label: "Box plot" }, { value: "heatmap", label: "Heatmap" }, { value: "table", label: "Table" },
];

const AGGS: { value: Aggregation; label: string; numeric: boolean }[] = [
  { value: "count", label: "Count", numeric: false }, { value: "count_distinct", label: "Count distinct", numeric: false },
  { value: "sum", label: "Sum", numeric: true }, { value: "avg", label: "Average", numeric: true },
  { value: "median", label: "Median", numeric: true }, { value: "min", label: "Min", numeric: false }, { value: "max", label: "Max", numeric: false },
];

const NUMERIC = new Set(["integer", "float", "decimal"]);
const TEMPORAL = new Set(["date", "timestamp"]);

/** Client-side validation mirroring the backend; returns a message or null. */
export function validateQuery(q: ChartQuery, types: Record<string, string>): string | null {
  const t = q.chart_type;
  const need = (c: string | null | undefined, what: string) => (!c ? `Choose ${what}` : !(c in types) ? `Column '${c}' no longer exists` : null);
  if (["bar", "stacked_bar", "line", "area", "pie", "donut", "heatmap"].includes(t)) { const e = need(q.dimension, "a dimension"); if (e) return e; }
  if (["stacked_bar", "heatmap"].includes(t)) { const e = need(q.series, "a breakdown (series)"); if (e) return e; }
  if (t === "scatter") return need(q.x, "an X column") ?? need(q.y, "a Y column");
  if (t === "histogram" || t === "boxplot") {
    const e = need(q.y, "a value column");
    if (e) return e;
    if (!NUMERIC.has(types[q.y!] ?? "")) return "The value column must be numeric";
  }
  if (q.date_grain && q.date_grain !== "none" && q.dimension && !TEMPORAL.has(types[q.dimension] ?? "")) return "Date grouping needs a date column";
  for (const m of q.measures) {
    if (m.column && !(m.column in types)) return `Column '${m.column}' no longer exists`;
    if (!m.column && m.agg !== "count") return "Choose a column for this aggregation";
    if (m.column && ["sum", "avg", "median"].includes(m.agg) && !NUMERIC.has(types[m.column] ?? "") && types[m.column] !== "boolean") return `${m.agg} needs a numeric column`;
  }
  return null;
}

interface Props {
  widget: WidgetDraft;
  schema: SchemaTable[];
  onChange: (w: WidgetDraft) => void;
  onClose: () => void;
}

export function WidgetConfigPanel({ widget, schema, onChange, onClose }: Props) {
  const table = schema.find((t) => t.dataset_id === widget.dataset_id);
  const columns = table?.columns ?? [];
  const types = Object.fromEntries(columns.map((c) => [c.name, c.logical_type]));
  const q = widget.query;
  const setQ = (patch: Partial<ChartQuery>) => onChange({ ...widget, query: { ...q, ...patch } });
  const setD = (patch: Partial<WidgetDisplay>) => onChange({ ...widget, display: { ...widget.display, ...patch } });
  const setMeasure = (i: number, patch: Partial<Measure>) => setQ({ measures: q.measures.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const error = table ? validateQuery(q, types) : "Choose a dataset";
  const t = q.chart_type;
  const usesDimension = !["kpi", "scatter", "histogram"].includes(t);
  const usesMeasures = !["scatter", "histogram", "boxplot"].includes(t);
  const colOptions = (filter?: (type: string) => boolean) => columns.filter((c) => !filter || filter(c.logical_type)).map((c) => <option key={c.name} value={c.name}>{c.name} · {c.logical_type}</option>);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Configure widget</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close configuration" onClick={onClose}><X /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        <Field label="Title">{(id) => <Input id={id} value={widget.title} maxLength={200} onChange={(e) => onChange({ ...widget, title: e.target.value })} />}</Field>
        <Field label="Data source">{(id) => (
          <Select id={id} value={widget.dataset_id} onChange={(e) => onChange({ ...widget, dataset_id: e.target.value, query: { ...q, dimension: null, series: null, x: null, y: null, measures: [{ column: null, agg: "count" }] } })}>
            {schema.map((s) => <option key={s.dataset_id} value={s.dataset_id}>{s.name} ({s.table_name})</option>)}
          </Select>)}</Field>
        <Field label="Chart type">{(id) => (
          <Select id={id} value={t} onChange={(e) => setQ({ chart_type: e.target.value as ChartType })}>
            {CHART_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>)}</Field>

        {usesDimension && (
          <Field label={t === "boxplot" ? "Group by (optional)" : t === "table" ? "Group by (optional)" : "Dimension"}>{(id) => (
            <Select id={id} value={q.dimension ?? ""} onChange={(e) => setQ({ dimension: e.target.value || null, date_grain: TEMPORAL.has(types[e.target.value] ?? "") ? (q.date_grain && q.date_grain !== "none" ? q.date_grain : "month") : "none" })}>
              <option value="">—</option>{colOptions()}
            </Select>)}</Field>
        )}
        {usesDimension && q.dimension && TEMPORAL.has(types[q.dimension] ?? "") && (
          <Field label="Date grouping">{(id) => (
            <Select id={id} value={q.date_grain ?? "none"} onChange={(e) => setQ({ date_grain: e.target.value as DateGrain })}>
              {["none", "day", "week", "month", "quarter", "year"].map((g) => <option key={g} value={g}>{g === "none" ? "No grouping (exact value)" : g}</option>)}
            </Select>)}</Field>
        )}
        {["bar", "stacked_bar", "line", "area", "heatmap"].includes(t) && (
          <Field label={t === "stacked_bar" || t === "heatmap" ? "Breakdown (series)" : "Breakdown (optional)"}>{(id) => (
            <Select id={id} value={q.series ?? ""} onChange={(e) => setQ({ series: e.target.value || null, measures: q.measures.slice(0, 1) })}>
              <option value="">—</option>{colOptions((ty) => !NUMERIC.has(ty) || ty === "integer")}
            </Select>)}</Field>
        )}
        {t === "scatter" && (
          <>
            <Field label="X axis">{(id) => <Select id={id} value={q.x ?? ""} onChange={(e) => setQ({ x: e.target.value || null })}><option value="">—</option>{colOptions((ty) => NUMERIC.has(ty) || TEMPORAL.has(ty))}</Select>}</Field>
            <Field label="Y axis">{(id) => <Select id={id} value={q.y ?? ""} onChange={(e) => setQ({ y: e.target.value || null })}><option value="">—</option>{colOptions((ty) => NUMERIC.has(ty) || TEMPORAL.has(ty))}</Select>}</Field>
            <Field label="Colour by (optional, ≤ 3 groups recommended)">{(id) => <Select id={id} value={q.series ?? ""} onChange={(e) => setQ({ series: e.target.value || null })}><option value="">—</option>{colOptions((ty) => !NUMERIC.has(ty))}</Select>}</Field>
          </>
        )}
        {(t === "histogram" || t === "boxplot") && (
          <Field label="Value column">{(id) => <Select id={id} value={q.y ?? ""} onChange={(e) => setQ({ y: e.target.value || null })}><option value="">—</option>{colOptions((ty) => NUMERIC.has(ty))}</Select>}</Field>
        )}
        {t === "histogram" && <Field label="Bins">{(id) => <Input id={id} type="number" min={2} max={200} value={q.bins ?? 20} onChange={(e) => setQ({ bins: Math.min(200, Math.max(2, Number(e.target.value) || 20)) })} />}</Field>}

        {usesMeasures && (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-muted">Measures</legend>
            {q.measures.map((m, i) => (
              <div key={i} className="flex gap-1.5">
                <Select aria-label={`Aggregation ${i + 1}`} className="w-32" value={m.agg} onChange={(e) => setMeasure(i, { agg: e.target.value as Aggregation, column: e.target.value === "count" ? m.column : m.column })}>
                  {AGGS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </Select>
                <Select aria-label={`Measure column ${i + 1}`} value={m.column ?? ""} onChange={(e) => setMeasure(i, { column: e.target.value || null })}>
                  {m.agg === "count" && <option value="">All rows</option>}
                  {m.agg !== "count" && <option value="">—</option>}
                  {colOptions(AGGS.find((a) => a.value === m.agg)?.numeric ? (ty) => NUMERIC.has(ty) || ty === "boolean" : ["min", "max"].includes(m.agg) ? (ty) => NUMERIC.has(ty) || TEMPORAL.has(ty) : undefined)}
                </Select>
                {q.measures.length > 1 && <Button variant="ghost" size="icon" aria-label={`Remove measure ${i + 1}`} onClick={() => setQ({ measures: q.measures.filter((_, j) => j !== i) })}><X /></Button>}
              </div>
            ))}
            {!q.series && q.measures.length < 4 && !["pie", "donut", "heatmap"].includes(t) && (
              <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setQ({ measures: [...q.measures, { column: null, agg: "count" }] })}>Add measure</Button>
            )}
          </fieldset>
        )}

        {usesDimension && t !== "boxplot" && t !== "kpi" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Sort">{(id) => (
              <Select id={id} value={q.sort ? `${q.sort.by}:${q.sort.direction}` : ""} onChange={(e) => { const [by, direction] = e.target.value.split(":"); setQ({ sort: e.target.value ? { by: by as "dimension" | "measure", direction: direction as "asc" | "desc" } : null }); }}>
                <option value="">Automatic</option><option value="measure:desc">Value ↓</option><option value="measure:asc">Value ↑</option>
                <option value="dimension:asc">Label A→Z / oldest</option><option value="dimension:desc">Label Z→A / newest</option>
              </Select>)}</Field>
            <Field label="Max categories">{(id) => <Input id={id} type="number" min={1} max={1000} value={q.limit ?? 50} onChange={(e) => setQ({ limit: Math.min(1000, Math.max(1, Number(e.target.value) || 50)) })} />}</Field>
          </div>
        )}
        {usesDimension && t !== "kpi" && <Checkbox label="Include empty (null) categories" checked={q.include_nulls ?? true} onChange={(v) => setQ({ include_nulls: v })} />}

        <fieldset className="space-y-3 border-t border-line pt-3">
          <legend className="sr-only">Display</legend>
          <Field label="Number format">{(id) => (
            <Select id={id} value={widget.display.number_format ?? "auto"} onChange={(e) => setD({ number_format: e.target.value as NumberFormat })}>
              {["auto", "compact", "integer", "decimal", "percent", "currency"].map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>)}</Field>
          {widget.display.number_format === "currency" && <Field label="Currency code">{(id) => <Input id={id} maxLength={3} value={widget.display.currency ?? "USD"} onChange={(e) => setD({ currency: e.target.value.toUpperCase() })} />}</Field>}
          {!["kpi", "table"].includes(t) && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="X axis label">{(id) => <Input id={id} value={widget.display.x_label ?? ""} onChange={(e) => setD({ x_label: e.target.value })} />}</Field>
                <Field label="Y axis label">{(id) => <Input id={id} value={widget.display.y_label ?? ""} onChange={(e) => setD({ y_label: e.target.value })} />}</Field>
              </div>
              <Field label="Colour (single series)">{(id) => (
                <Select id={id} value={widget.display.color_slot ?? ""} onChange={(e) => setD({ color_slot: e.target.value === "" ? undefined : Number(e.target.value) })}>
                  <option value="">Automatic</option>{["Blue", "Orange", "Aqua", "Yellow", "Magenta", "Green", "Violet"].map((c, i) => <option key={c} value={i}>{c}</option>)}
                </Select>)}</Field>
              <div className="flex flex-col gap-2">
                <Checkbox label="Show legend" checked={widget.display.show_legend !== false} onChange={(v) => setD({ show_legend: v })} />
                <Checkbox label="Show value labels" checked={!!widget.display.show_labels} onChange={(v) => setD({ show_labels: v })} />
              </div>
            </>
          )}
        </fieldset>
      </div>
      {error && <div role="alert" className="border-t border-line bg-warning-soft px-4 py-2 text-xs text-fg">{error}</div>}
    </div>
  );
}
