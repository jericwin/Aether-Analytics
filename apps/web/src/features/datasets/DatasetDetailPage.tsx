import { Activity, FileStack, Gauge, MoreHorizontal, Pencil, RefreshCw, Table2, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, ErrorState, Skeleton, Spinner, StatusBadge } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/form";
import { KeyValue, PageHeader, Tab, TabList, TabPanel, Tabs } from "@/components/ui/layout";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ApiError, errorMessage } from "@/lib/api";
import { formatBytes, formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { useDataset, useDeleteDataset, useJobs, useProfile, useProject, useReprofile, useUpdateDataset } from "@/services/hooks";

import { ProfileView } from "../profiling/ProfileView";
import { DataExplorer } from "./DataExplorer";
import { ImportWizard } from "./ImportWizard";

export default function DatasetDetailPage() {
  const { projectId = "", datasetId = "" } = useParams();
  const navigate = useNavigate();
  const { data: project } = useProject(projectId);
  const { data: ds, isLoading, error, refetch } = useDataset(projectId, datasetId);
  const [tab, setTab] = useState("data");
  const profile = useProfile(projectId, datasetId, undefined, ds?.status === "ready" && tab === "profile");
  const { data: jobs } = useJobs({ project_id: projectId, status: "active" });
  const reprofile = useReprofile(projectId, datasetId);
  const update = useUpdateDataset(projectId);
  const del = useDeleteDataset(projectId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newVersion, setNewVersion] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const canEdit = project?.role !== "viewer";

  if (error) return <div className="p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (isLoading || !ds) return <div className="space-y-3 p-6"><Skeleton className="h-10 w-80" /><Skeleton className="h-96" /></div>;
  const v = ds.version;
  const job = jobs?.items.find((j) => j.payload.dataset_id === ds.id);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={ds.name}
        description={ds.description ?? undefined}
        meta={<>
          <StatusBadge status={ds.status} />
          <Badge><span className="font-mono">{ds.table_name}</span></Badge>
          {v && <span className="tabular text-xs text-muted">{formatNumber(v.row_count, "integer")} rows · {v.column_count} columns · {formatBytes(v.size_bytes)} Parquet · v{v.version} · imported {timeAgo(v.created_at)}</span>}
        </>}
        actions={canEdit && (
          <>
            <Button icon={<Upload />} onClick={() => setNewVersion(true)}>New version</Button>
            <MenuRoot>
              <MenuTrigger asChild><Button size="icon" aria-label="Dataset actions"><MoreHorizontal /></Button></MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Pencil />} onSelect={() => { setName(ds.name); setDesc(ds.description ?? ""); setEditing(true); }}>Rename / describe</MenuItem>
                <MenuItem icon={<RefreshCw />} disabled={!v} onSelect={() => reprofile.mutate(undefined, { onSuccess: () => toast.success("Profiling started"), onError: (e) => toast.error(errorMessage(e)) })}>Re-run profiling</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(true)}>Delete dataset</MenuItem>
              </MenuContent>
            </MenuRoot>
          </>
        )}
      />
      {ds.status === "importing" && (
        <div className="border-b border-line bg-accent-soft px-6 py-2 text-[13px]"><Spinner label={job?.progress_message ?? "Import in progress"} /></div>
      )}
      {ds.status === "failed" && !v && (
        <div className="p-6"><ErrorState error={new ApiError(0, "import_failed", ds.error_message ?? "Import failed")} /></div>
      )}
      {v && (
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabList>
            <Tab value="data"><Table2 />Data</Tab>
            <Tab value="profile"><Gauge />Profile & quality</Tab>
            <Tab value="schema"><Activity />Schema</Tab>
            <Tab value="versions"><FileStack />Versions ({ds.versions.length})</Tab>
          </TabList>
          <TabPanel value="data" className="min-h-0 flex-1">
            <DataExplorer projectId={projectId} datasetId={ds.id} version={v.version} columns={v.columns} tableName={ds.table_name} />
          </TabPanel>
          <TabPanel value="profile" className="min-h-0 flex-1 overflow-auto">
            {profile.error ? <div className="p-6"><ErrorState error={profile.error} /></div> : !profile.data ? <div className="p-6"><Spinner label="Loading profile" /></div>
              : profile.data.profile ? <ProfileView profile={profile.data.profile} /> : <EmptyState title="Not profiled yet" />}
          </TabPanel>
          <TabPanel value="schema" className="overflow-auto p-4 sm:px-6">
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="border-b border-line text-left text-xs text-muted"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Column</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Storage type</th><th className="px-3 py-2">Nulls</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {v.columns.map((c) => (
                    <tr key={c.name}><td className="px-3 py-1.5 text-subtle">{c.position + 1}</td><td className="px-3 py-1.5 font-medium">{c.name}</td>
                      <td className="px-3 py-1.5"><Badge>{c.logical_type}</Badge></td><td className="px-3 py-1.5 font-mono text-xs text-muted">{c.physical_type}</td>
                      <td className="tabular px-3 py-1.5">{formatNumber(c.null_count, "integer")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {v.warnings.length > 0 && (
              <div className="mt-4"><h3 className="mb-2 text-[13px] font-semibold">Import warnings</h3>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
            )}
          </TabPanel>
          <TabPanel value="versions" className="overflow-auto p-4 sm:px-6">
            <ol className="space-y-3">
              {ds.versions.map((ver) => (
                <li key={ver.id} className="rounded-lg border border-line bg-surface p-4">
                  <div className="mb-2 flex items-center gap-2"><span className="font-semibold">Version {ver.version}</span>{ver.version === ds.current_version && <Badge tone="accent">Current</Badge>}</div>
                  <KeyValue items={[
                    ["Created", formatDateTime(ver.created_at)], ["Rows × columns", `${formatNumber(ver.row_count, "integer")} × ${ver.column_count}`],
                    ["Size", `${formatBytes(ver.size_bytes)} (${ver.storage_format})`], ["Content SHA-256", <span key="h" className="font-mono text-xs break-all">{ver.content_hash}</span>],
                    ["Import job", <span key="j" className="font-mono text-xs">{ver.job_id ?? "—"}</span>],
                  ]} />
                </li>
              ))}
            </ol>
          </TabPanel>
        </Tabs>
      )}
      <Dialog open={editing} onOpenChange={setEditing} title="Edit dataset" size="sm"
        footer={<><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={update.isPending}
            onClick={() => update.mutate({ id: ds.id, name, description: desc }, { onSuccess: () => { toast.success("Dataset updated"); setEditing(false); }, onError: (e) => toast.error(errorMessage(e)) })}>Save</Button></>}>
        <div className="space-y-3">
          <Input aria-label="Dataset name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <Textarea aria-label="Description" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <p className="text-xs text-subtle">The SQL table name <span className="font-mono">{ds.table_name}</span> does not change, so saved queries keep working.</p>
        </div>
      </Dialog>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="Delete dataset?" destructive confirmLabel="Delete dataset"
        description={<>All versions and stored Parquet files of <strong>{ds.name}</strong> will be deleted. Datasets used by dashboards cannot be deleted until those widgets are removed.</>}
        onConfirm={() => del.mutateAsync(ds.id).then(() => { toast.success("Dataset deleted"); navigate(`/projects/${projectId}/data`); }).catch((e: unknown) => {
          const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as { dashboard: string; title: string }[]).map((d) => `${d.dashboard} › ${d.title}`).join(", ") : "";
          toast.error(errorMessage(e), { description: details || undefined });
        })} />
      <ImportWizard projectId={projectId} open={newVersion} onOpenChange={setNewVersion} versionOf={{ id: ds.id, name: ds.name }} />
    </div>
  );
}
