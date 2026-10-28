import * as Popover from "@radix-ui/react-popover";
import { CalendarRange, ChevronDown, ListFilter, Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { useColumnValues } from "@/services/hooks";
import type { ActiveFilter, SchemaTable } from "@/types/api";

export interface FilterDraft {
  id: string;
  dataset_id: string;
  column: string;
  filter_type: "date_range" | "category";
  label: string;
}

/** Runtime value of each dashboard filter, keyed by filter id. */
export type FilterValues = Record<string, { from?: string; to?: string; values?: unknown[] }>;

export function toActiveFilters(defs: FilterDraft[], values: FilterValues): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  for (const d of defs) {
    const v = values[d.id];
    if (!v) continue;
    if (d.filter_type === "date_range") {
      if (v.from && v.to) out.push({ dataset_id: d.dataset_id, filter: { column: d.column, op: "between", values: [v.from, v.to] } });
      else if (v.from) out.push({ dataset_id: d.dataset_id, filter: { column: d.column, op: "gte", value: v.from } });
      else if (v.to) out.push({ dataset_id: d.dataset_id, filter: { column: d.column, op: "lte", value: v.to } });
    } else if (v.values?.length) {
      out.push({ dataset_id: d.dataset_id, filter: { column: d.column, op: "in", values: v.values } });
    }
  }
  return out;
}

function CategoryFilter({ projectId, def, value, onChange }: { projectId: string; def: FilterDraft; value: unknown[]; onChange: (v: unknown[]) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data, isLoading } = useColumnValues(projectId, def.dataset_id, def.column, search, open);
  const has = (v: unknown) => value.some((x) => x === v);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs", value.length ? "border-accent bg-accent-soft text-fg" : "border-line bg-surface-2 text-muted hover:text-fg")}>
          <ListFilter className="size-3.5" aria-hidden />{def.label}
          {value.length > 0 && <span className="font-medium">: {value.length === 1 ? String(value[0] ?? "(null)") : `${value.length} selected`}</span>}
          <ChevronDown className="size-3" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-64 rounded-md border border-line bg-surface p-2 shadow-pop">
          <Input className="mb-2 h-7 text-xs" placeholder={`Search ${def.label}`} aria-label={`Search ${def.label}`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-64 space-y-0.5 overflow-auto">
            {isLoading ? <Spinner /> : data?.map((d) => (
              <div key={String(d.value)} className="flex items-center justify-between px-1">
                <Checkbox label={d.value === null ? "(null)" : String(d.value)} checked={has(d.value)} onChange={(c) => onChange(c ? [...value, d.value] : value.filter((x) => x !== d.value))} />
                <span className="tabular text-[10px] text-subtle">{d.count}</span>
              </div>
            ))}
          </div>
          {value.length > 0 && <Button size="sm" variant="ghost" className="mt-2 w-full justify-center" onClick={() => onChange([])}>Clear</Button>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface Props {
  projectId: string;
  defs: FilterDraft[];
  values: FilterValues;
  onValues: (v: FilterValues) => void;
  editing: boolean;
  schema: SchemaTable[];
  onAdd: (d: Omit<FilterDraft, "id">) => void;
  onRemove: (id: string) => void;
  crossFilter: { label: string } | null;
  onClearCross: () => void;
}

export function FilterBar({ projectId, defs, values, onValues, editing, schema, onAdd, onRemove, crossFilter, onClearCross }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Omit<FilterDraft, "id">>({ dataset_id: schema[0]?.dataset_id ?? "", column: "", filter_type: "category", label: "" });
  // The schema may load after mount, so fall back to the first dataset rather than a stale empty id.
  const datasetId = schema.some((s) => s.dataset_id === draft.dataset_id) ? draft.dataset_id : schema[0]?.dataset_id ?? "";
  const table = schema.find((s) => s.dataset_id === datasetId);
  const set = (id: string, v: FilterValues[string]) => onValues({ ...values, [id]: v });

  if (!defs.length && !editing && !crossFilter) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-6" role="toolbar" aria-label="Dashboard filters">
      {defs.map((d) => (
        <div key={d.id} className="flex items-center gap-1">
          {d.filter_type === "date_range" ? (
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-0.5 text-xs text-muted">
              <CalendarRange className="size-3.5" aria-hidden /><span>{d.label}</span>
              <input type="date" aria-label={`${d.label} from`} className="bg-transparent text-fg outline-none" value={values[d.id]?.from ?? ""} onChange={(e) => set(d.id, { ...values[d.id], from: e.target.value || undefined })} />
              <span>–</span>
              <input type="date" aria-label={`${d.label} to`} className="bg-transparent text-fg outline-none" value={values[d.id]?.to ?? ""} onChange={(e) => set(d.id, { ...values[d.id], to: e.target.value || undefined })} />
            </div>
          ) : (
            <CategoryFilter projectId={projectId} def={d} value={values[d.id]?.values ?? []} onChange={(v) => set(d.id, { values: v })} />
          )}
          {editing && <Button variant="ghost" size="icon-sm" aria-label={`Remove filter ${d.label}`} onClick={() => onRemove(d.id)}><X /></Button>}
        </div>
      ))}
      {crossFilter && (
        <span className="inline-flex h-7 items-center gap-1 rounded-md border border-accent bg-accent-soft pl-2.5 text-xs">
          Cross-filter: <span className="font-medium">{crossFilter.label}</span>
          <button className="px-1.5 text-muted hover:text-fg" aria-label="Clear cross-filter" onClick={onClearCross}><X className="size-3" /></button>
        </span>
      )}
      {Object.values(values).some((v) => v.from || v.to || v.values?.length) && (
        <Button size="sm" variant="ghost" onClick={() => onValues({})}>Reset filters</Button>
      )}
      {editing && (
        <Popover.Root open={adding} onOpenChange={setAdding}>
          <Popover.Trigger asChild><Button size="sm" variant="outline" icon={<Plus />}>Add filter</Button></Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={4} className="z-50 w-72 space-y-3 rounded-md border border-line bg-surface p-3 shadow-pop">
              <Field label="Dataset">{(id) => <Select id={id} value={datasetId} onChange={(e) => setDraft({ ...draft, dataset_id: e.target.value, column: "" })}>{schema.map((s) => <option key={s.dataset_id} value={s.dataset_id}>{s.name}</option>)}</Select>}</Field>
              <Field label="Column">{(id) => (
                <Select id={id} value={draft.column} onChange={(e) => {
                  const col = table?.columns.find((c) => c.name === e.target.value);
                  const temporal = col && (col.logical_type === "date" || col.logical_type === "timestamp");
                  setDraft({ ...draft, column: e.target.value, filter_type: temporal ? "date_range" : "category", label: draft.label || e.target.value });
                }}>
                  <option value="">—</option>{table?.columns.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.logical_type}</option>)}
                </Select>)}</Field>
              <Field label="Label">{(id) => <Input id={id} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />}</Field>
              <p className="text-xs text-subtle">{draft.filter_type === "date_range" ? "Date range filter" : "Category filter"}. Applies to every widget built on this dataset.</p>
              <Button variant="primary" className="w-full justify-center" disabled={!draft.column || !draft.label.trim()}
                onClick={() => { onAdd({ ...draft, dataset_id: datasetId }); setAdding(false); setDraft({ ...draft, dataset_id: datasetId, column: "", label: "" }); }}>Add filter</Button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
