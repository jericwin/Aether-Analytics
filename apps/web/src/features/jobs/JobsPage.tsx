import { Activity, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, ProgressBar, Skeleton, StatusBadge } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { errorMessage } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useCancelJob, useJobs, useProjects } from "@/services/hooks";
import type { Job } from "@/types/api";

const TYPE_LABELS: Record<string, string> = { dataset_import: "Dataset import", dataset_profile: "Data profiling" };

export function jobLabel(job: Job): string {
  return TYPE_LABELS[job.job_type] ?? job.job_type;
}

function duration(job: Job): string {
  if (!job.started_at) return "—";
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now();
  const s = (end - new Date(job.started_at).getTime()) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function JobsPage() {
  const [status, setStatus] = useState("");
  const [projectId, setProjectId] = useState("");
  const { data: projects } = useProjects({});
  const { data, isLoading, error, refetch } = useJobs({ status: status || undefined, project_id: projectId || undefined, limit: 100 });
  const cancel = useCancelJob();
  const names = new Map(projects?.items.map((p) => [p.id, p.name]));

  return (
    <div>
      <PageHeader title="Activity & Jobs" description="Background work such as imports and profiling. Jobs are stored in the database and survive restarts." />
      <div className="flex flex-wrap gap-2 px-4 py-3 sm:px-6">
        <Select aria-label="Filter by status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="active">Active</option><option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option><option value="cancelled">Cancelled</option>
        </Select>
        <Select aria-label="Filter by project" className="w-56" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div className="px-4 pb-6 sm:px-6">
        {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <Skeleton className="h-40" /> : !data?.items.length ? (
          <EmptyState icon={<Activity />} title="No jobs" description="Imports and profiling runs will appear here." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Job</th><th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Progress</th><th className="px-3 py-2 font-medium">Created</th><th className="px-3 py-2 font-medium">Duration</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((j) => (
                  <tr key={j.id} className="align-top">
                    <td className="px-3 py-2"><StatusBadge status={j.status} /></td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{jobLabel(j)}</div>
                      {j.error_message && <div className="mt-0.5 max-w-md text-xs text-danger">{j.error_message}</div>}
                      {j.status === "succeeded" && j.result && "row_count" in j.result && <div className="text-xs text-muted">{String(j.result.row_count)} rows imported</div>}
                    </td>
                    <td className="px-3 py-2">{j.project_id ? <Link className="text-accent hover:underline" to={`/projects/${j.project_id}`}>{names.get(j.project_id) ?? "Project"}</Link> : "—"}</td>
                    <td className="w-48 px-3 py-2">
                      {j.status === "running" ? (<><ProgressBar value={j.progress} /><div className="mt-1 truncate text-xs text-muted">{j.progress_message}</div></>) : <span className="text-xs text-muted">{j.progress_message ?? ""}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted" title={formatDateTime(j.created_at)}>{timeAgo(j.created_at)}</td>
                    <td className="tabular px-3 py-2 text-xs text-muted">{duration(j)}</td>
                    <td className="px-3 py-2 text-right">
                      {(j.status === "pending" || j.status === "running") && (
                        <Button size="sm" variant="outline" icon={<XCircle />} disabled={j.cancel_requested}
                          onClick={() => cancel.mutate(j.id, { onSuccess: () => toast.success("Cancellation requested"), onError: (e) => toast.error(errorMessage(e)) })}>
                          {j.cancel_requested ? "Cancelling" : "Cancel"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
