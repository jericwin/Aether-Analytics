import { Database, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Badge, EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { formatBytes, formatNumber, timeAgo } from "@/lib/format";
import { useDatasets, useProject } from "@/services/hooks";

import { ImportWizard } from "./ImportWizard";

export default function DatasetsPage() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: project } = useProject(projectId);
  const { data, isLoading, error, refetch } = useDatasets(projectId);
  const [search, setSearch] = useState("");
  const importing = params.get("import") === "1";
  const canEdit = project?.role !== "viewer";
  const setImporting = (o: boolean) => setParams(o ? { import: "1" } : {}, { replace: true });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((d) => !q || d.name.toLowerCase().includes(q) || d.table_name.includes(q));
  }, [data, search]);

  return (
    <div>
      <PageHeader title="Data" description="Imported datasets. Each import creates an immutable, versioned Parquet snapshot."
        actions={canEdit && <Button variant="primary" icon={<Upload />} onClick={() => setImporting(true)}>Import data</Button>} />
      <div className="px-4 py-3 sm:px-6">
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-subtle" aria-hidden />
          <Input className="pl-8" placeholder="Search datasets" aria-label="Search datasets" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="px-4 pb-6 sm:px-6">
        {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <Skeleton className="h-48" /> : !data?.length ? (
          <EmptyState icon={<Database />} title="No datasets yet" description="Import a CSV, Excel, JSON or Parquet file. You will preview the inferred schema before anything is stored."
            action={canEdit && <Button variant="primary" icon={<Upload />} onClick={() => setImporting(true)}>Import your first dataset</Button>} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>{["Name", "Table", "Status", "Rows", "Columns", "Size", "Quality", "Version", "Updated"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-2">
                    <td className="px-3 py-2"><Link to={d.id} className="font-medium text-fg hover:text-accent">{d.name}</Link>
                      {d.source_filename && <div className="text-[11px] text-subtle">{d.source_filename}</div>}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{d.table_name}</td>
                    <td className="px-3 py-2"><StatusBadge status={d.status} /></td>
                    <td className="tabular px-3 py-2">{d.row_count == null ? "—" : formatNumber(d.row_count, "integer")}</td>
                    <td className="tabular px-3 py-2">{d.column_count ?? "—"}</td>
                    <td className="tabular px-3 py-2 text-muted">{formatBytes(d.size_bytes)}</td>
                    <td className="px-3 py-2">{d.quality_score == null ? "—" : <Badge tone={d.quality_score >= 90 ? "success" : d.quality_score >= 70 ? "warning" : "danger"}>{d.quality_score.toFixed(0)}</Badge>}</td>
                    <td className="px-3 py-2 text-muted">{d.current_version ? `v${d.current_version}` : "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted">{timeAgo(d.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <p className="p-4 text-[13px] text-muted">No datasets match “{search}”.</p>}
          </div>
        )}
      </div>
      <ImportWizard projectId={projectId} open={importing} onOpenChange={setImporting} />
    </div>
  );
}
