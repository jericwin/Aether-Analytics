import { AlertTriangle, FileUp, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { DataGrid } from "@/components/DataGrid";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, ErrorState, Spinner } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNewVersion, usePreview, useStartImport, useUpload } from "@/services/hooks";
import type { ImportOptions, LogicalType, Preview, Upload } from "@/types/api";

const ACCEPT = ".csv,.tsv,.txt,.parquet,.xlsx,.xls,.json,.jsonl,.ndjson";
const TYPES: LogicalType[] = ["string", "integer", "float", "boolean", "date", "timestamp"];

export function suggestTableName(name: string): string {
  let slug = name.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "dataset";
  if (/^\d/.test(slug)) slug = `t_${slug}`;
  return slug.slice(0, 63);
}

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When set, the file is imported as a new version of this dataset. */
  versionOf?: { id: string; name: string };
}

export function ImportWizard({ projectId, open, onOpenChange, versionOf }: Props) {
  const navigate = useNavigate();
  const upload = useUpload(projectId);
  const preview = usePreview(projectId);
  const start = useStartImport(projectId);
  const newVersion = useNewVersion(projectId, versionOf?.id ?? "");
  const [source, setSource] = useState<Upload | null>(null);
  const [options, setOptions] = useState<ImportOptions>({ has_header: true, detect_dates: true, encoding: "utf-8" });
  const [name, setName] = useState("");
  const [tableName, setTableName] = useState("");
  const [result, setResult] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setSource(null);
      setResult(null);
      setName("");
      setTableName("");
      setOptions({ has_header: true, detect_dates: true, encoding: "utf-8" });
      upload.reset();
      preview.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-run the preview whenever options change (debounced).
  useEffect(() => {
    if (!source) return;
    const t = setTimeout(() => {
      preview.mutate({ sourceId: source.id, options }, { onSuccess: setResult, onError: () => setResult(null) });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, options]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(file, {
      onSuccess: (s) => {
        setSource(s);
        const base = file.name.replace(/\.[^.]+$/, "");
        setName(base);
        setTableName(suggestTableName(base));
        setOptions((o) => ({
          ...o,
          delimiter: null,
          encoding: (s.detected.encoding as ImportOptions["encoding"]) ?? "utf-8",
          sheet: s.detected.sheets?.[0] ?? null,
        }));
      },
    });
  };

  const submit = () => {
    if (!source) return;
    if (versionOf) {
      newVersion.mutate({ source_id: source.id, options }, {
        onSuccess: () => { toast.success("New version import started"); onOpenChange(false); },
        onError: (e) => toast.error(errorMessage(e)),
      });
      return;
    }
    start.mutate({ source_id: source.id, name: name.trim(), table_name: tableName || undefined, options }, {
      onSuccess: ({ dataset }) => {
        toast.success(`Import of "${dataset.name}" started`);
        onOpenChange(false);
        navigate(`/projects/${projectId}/data/${dataset.id}`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const set = (patch: Partial<ImportOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const fmt = source?.file_format;
  const tableValid = !tableName || /^[a-z_][a-z0-9_]{0,62}$/.test(tableName);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={versionOf ? `New version of ${versionOf.name}` : "Import dataset"}
      description="Files are validated by content, previewed, then imported in the background as immutable Parquet."
      footer={source && (
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={start.isPending || newVersion.isPending}
            disabled={!result || preview.isPending || (!versionOf && (!name.trim() || !tableValid))}>
            {versionOf ? "Import new version" : "Import"}
          </Button>
        </>
      )}
    >
      {!source ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files[0]); }}
          className={cn("flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-line-strong")}
        >
          {upload.isPending ? <Spinner label="Uploading and validating" /> : (
            <>
              <UploadCloud className="size-8 text-subtle" aria-hidden />
              <p className="mt-3 text-[14px] font-medium">Drop a file here, or choose one</p>
              <p className="mt-1 text-xs text-muted">CSV / TSV, Excel (.xlsx, .xls), JSON / NDJSON, Parquet</p>
              <Button className="mt-4" variant="primary" icon={<FileUp />} onClick={() => fileInput.current?.click()}>Choose file</Button>
              <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a file to import" onChange={(e) => onFile(e.target.files?.[0])} />
            </>
          )}
          {upload.error && <div className="mt-4 w-full max-w-lg text-left"><ErrorState error={upload.error} /></div>}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-line bg-surface-2 p-3 text-xs">
              <div className="truncate font-medium text-fg">{source.original_filename}</div>
              <div className="mt-1 flex gap-2 text-muted"><Badge>{source.file_format.toUpperCase()}</Badge>{formatBytes(source.size_bytes)}</div>
            </div>
            {!versionOf && (
              <>
                <Field label="Dataset name">{(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}</Field>
                <Field label="SQL table name" hint="Used in SQL queries" error={tableValid ? undefined : "Lowercase letters, digits and underscores"}>
                  {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" value={tableName} maxLength={63} onChange={(e) => setTableName(e.target.value.toLowerCase())} />}
                </Field>
              </>
            )}
            {fmt === "csv" && (
              <>
                <Field label="Delimiter">{(id) => (
                  <Select id={id} value={options.delimiter ?? ""} onChange={(e) => set({ delimiter: e.target.value || null })}>
                    <option value="">Auto-detect{source.detected.delimiter ? ` (${JSON.stringify(source.detected.delimiter)})` : ""}</option>
                    <option value=",">Comma ,</option><option value=";">Semicolon ;</option><option value={"\t"}>Tab</option><option value="|">Pipe |</option>
                  </Select>)}</Field>
                <Field label="Encoding">{(id) => (
                  <Select id={id} value={options.encoding} onChange={(e) => set({ encoding: e.target.value as ImportOptions["encoding"] })}>
                    <option value="utf-8">UTF-8</option><option value="utf-8-sig">UTF-8 with BOM</option><option value="windows-1252">Windows-1252</option>
                    <option value="latin-1">Latin-1 (ISO-8859-1)</option><option value="utf-16">UTF-16</option>
                  </Select>)}</Field>
                <Field label="Skip leading rows">{(id) => <Input id={id} type="number" min={0} max={1000} value={options.skip_rows ?? 0} onChange={(e) => set({ skip_rows: Math.max(0, Number(e.target.value) || 0) })} />}</Field>
              </>
            )}
            {(fmt === "xlsx" || fmt === "xls") && (
              <Field label="Worksheet">{(id) => (
                <Select id={id} value={options.sheet ?? ""} onChange={(e) => set({ sheet: e.target.value })}>
                  {source.detected.sheets?.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>)}</Field>
            )}
            {fmt === "json" && (
              <Field label="JSON layout">{(id) => (
                <Select id={id} value={options.json_format ?? "auto"} onChange={(e) => set({ json_format: e.target.value as ImportOptions["json_format"] })}>
                  <option value="auto">Auto-detect</option><option value="records">Array of objects</option><option value="ndjson">Newline-delimited</option>
                </Select>)}</Field>
            )}
            {fmt !== "parquet" && fmt !== "json" && <Checkbox label="First row is a header" checked={options.has_header ?? true} onChange={(v) => set({ has_header: v })} />}
            {fmt !== "parquet" && (
              <Field label="Null markers" hint="Comma-separated values treated as missing">
                {(id, d) => <Input id={id} aria-describedby={d} defaultValue="NA, N/A, null, NULL, None, #N/A"
                  onBlur={(e) => set({ null_values: ["", ...e.target.value.split(",").map((s) => s.trim()).filter(Boolean)] })} />}
              </Field>
            )}
            <Checkbox label="Detect dates (unambiguous formats only)" checked={options.detect_dates ?? true} onChange={(v) => set({ detect_dates: v })} />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Preview{result && <span className="font-normal text-muted"> · first {result.sample_size} rows, types inferred from this sample</span>}</h3>
              {preview.isPending && <Spinner label="Parsing" />}
            </div>
            {preview.error && <ErrorState error={preview.error} />}
            {result && result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-xs text-fg">
                {result.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />{w}</li>)}
              </ul>
            )}
            {result && (
              <>
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="text-xs">
                    <thead><tr>{result.columns.map((c) => <th key={c.name} className="border-b border-line bg-surface-2 px-2 py-1.5 text-left font-semibold whitespace-nowrap">{c.name}</th>)}</tr></thead>
                    <tbody><tr>{result.columns.map((c) => (
                      <td key={c.name} className="px-1.5 py-1.5">
                        <Select aria-label={`Type for ${c.name}`} className="h-7 w-28 text-xs" value={options.type_overrides?.[c.name] ?? c.logical_type}
                          onChange={(e) => {
                            const overrides = { ...(options.type_overrides ?? {}) };
                            const v = e.target.value as LogicalType;
                            if (v === c.logical_type && !options.type_overrides?.[c.name]) delete overrides[c.name];
                            else overrides[c.name] = v;
                            set({ type_overrides: overrides });
                          }}>
                          {!TYPES.includes(c.logical_type) && <option value={c.logical_type}>{c.logical_type}</option>}
                          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </Select>
                      </td>))}</tr></tbody>
                  </table>
                </div>
                <DataGrid label="Import preview" className="h-80 rounded-md border border-line"
                  columns={result.columns.map((c) => ({ name: c.name, type: c.physical_type }))} rows={result.rows} />
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
