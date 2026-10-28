import { Database, LayoutDashboard, SquareTerminal, Upload } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Badge, EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/ui/feedback";
import { PageHeader, Panel, Stat } from "@/components/ui/layout";
import { formatDate, formatNumber, timeAgo } from "@/lib/format";
import { useDatasets, useOverview } from "@/services/hooks";

import { jobLabel } from "../jobs/JobsPage";

export function ProjectOverviewPage() {
  const { projectId = "" } = useParams();
  const { data, isLoading, error, refetch } = useOverview(projectId);
  const { data: datasets } = useDatasets(projectId);

  if (error) return <div className="p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (isLoading || !data) return <div className="space-y-3 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const p = data.project;
  const canEdit = p.role !== "viewer";

  return (
    <div>
      <PageHeader
        title={p.name}
        description={p.description ?? undefined}
        meta={<>{p.is_demo && <Badge tone="accent">Synthetic demo data</Badge>}{p.status === "archived" && <Badge>Archived</Badge>}<Badge>{p.role}</Badge><span className="text-xs text-subtle">Created {formatDate(p.created_at)} · updated {timeAgo(p.updated_at)}</span></>}
        actions={<>
          <Link to={`/projects/${p.id}/sql`}><Button icon={<SquareTerminal />}>SQL</Button></Link>
          {canEdit && <Link to={`/projects/${p.id}/data?import=1`}><Button variant="primary" icon={<Upload />}>Import data</Button></Link>}
        </>}
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <Stat label="Datasets" value={formatNumber(data.dataset_count, "integer")} hint={`${formatNumber(data.total_rows, "compact")} rows total`} />
        <Stat label="Dashboards" value={formatNumber(data.dashboard_count, "integer")} />
        <Stat label="Saved queries" value={formatNumber(data.saved_query_count, "integer")} hint={`${formatNumber(data.query_count, "integer")} queries run`} />
        <Stat
          label="Average data quality"
          value={data.avg_quality_score === null ? "—" : `${data.avg_quality_score.toFixed(1)}`}
          hint={data.datasets_with_issues ? `${data.datasets_with_issues} dataset(s) below 90` : data.dataset_count ? "No datasets below 90" : "Import data to score quality"}
        />
      </div>
      <div className="grid gap-4 px-4 pb-6 sm:px-6 xl:grid-cols-3">
        <Panel title="Datasets" className="xl:col-span-2" actions={<Link className="text-xs text-accent hover:underline" to={`/projects/${p.id}/data`}>View all</Link>}>
          {!datasets?.length ? (
            <EmptyState icon={<Database />} title="No datasets yet" description="Import a CSV, Excel, JSON or Parquet file to get started."
              action={canEdit && <Link to={`/projects/${p.id}/data?import=1`}><Button variant="primary" icon={<Upload />}>Import data</Button></Link>} />
          ) : (
            <ul className="divide-y divide-line">
              {datasets.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <Link to={`/projects/${p.id}/data/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <Database className="size-4 text-subtle" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{d.name}</div>
                      <div className="font-mono text-[11px] text-subtle">{d.table_name}</div>
                    </div>
                    <span className="tabular hidden text-xs text-muted sm:block">{d.row_count == null ? "" : `${formatNumber(d.row_count, "integer")} rows`}</span>
                    {d.status === "ready" ? (d.quality_score != null && <Badge tone={d.quality_score >= 90 ? "success" : "warning"}>Quality {d.quality_score.toFixed(0)}</Badge>) : <StatusBadge status={d.status} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent activity">
          {!data.activity.length ? <p className="p-4 text-[13px] text-muted">No activity yet.</p> : (
            <ol className="divide-y divide-line">
              {data.activity.map((a) => (
                <li key={a.id} className="px-4 py-2">
                  <div className="text-[13px]">{a.summary ?? a.action}</div>
                  <div className="text-[11px] text-subtle">{timeAgo(a.created_at)}</div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Recent jobs" className="xl:col-span-3" actions={<Link className="text-xs text-accent hover:underline" to="/jobs">All jobs</Link>}>
          {!data.recent_jobs.length ? <p className="p-4 text-[13px] text-muted">No jobs have run in this project.</p> : (
            <ul className="divide-y divide-line">
              {data.recent_jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <StatusBadge status={j.status} />
                  <span className="min-w-0 flex-1 truncate">{jobLabel(j)}</span>
                  {j.error_message && <span className="hidden truncate text-xs text-danger md:block">{j.error_message}</span>}
                  <span className="text-xs text-subtle">{timeAgo(j.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="flex flex-wrap gap-2 xl:col-span-3">
          <Link to={`/projects/${p.id}/dashboards`}><Button icon={<LayoutDashboard />}>Dashboards</Button></Link>
        </div>
      </div>
    </div>
  );
}
