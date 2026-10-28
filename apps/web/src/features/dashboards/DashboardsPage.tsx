import { Copy, LayoutDashboard, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { errorMessage } from "@/lib/api";
import { pluralize, timeAgo } from "@/lib/format";
import { useCreateDashboard, useDashboards, useDeleteDashboard, useDuplicateDashboard, useProject } from "@/services/hooks";
import type { Dashboard } from "@/types/api";

export default function DashboardsPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { data: project } = useProject(projectId);
  const { data, isLoading, error, refetch } = useDashboards(projectId);
  const create = useCreateDashboard(projectId);
  const dup = useDuplicateDashboard(projectId);
  const del = useDeleteDashboard(projectId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Dashboard | null>(null);
  const canEdit = project?.role !== "viewer";

  const submit = () =>
    create.mutate({ name: name.trim() }, {
      onSuccess: (d) => { setCreating(false); setName(""); navigate(d.id); },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <div>
      <PageHeader title="Dashboards" description="Layouts and chart configurations are saved; data is recomputed from the current dataset versions."
        actions={canEdit && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New dashboard</Button>} />
      <div className="p-4 sm:px-6">
        {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <Skeleton className="h-32" /> : !data?.length ? (
          <EmptyState icon={<LayoutDashboard />} title="No dashboards yet" description="Create a dashboard and add charts built on your datasets."
            action={canEdit && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New dashboard</Button>} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.map((d) => (
              <li key={d.id} className="relative rounded-lg border border-line bg-surface p-4 shadow-panel hover:border-line-strong">
                <Link to={d.id} className="absolute inset-0 rounded-lg" aria-label={`Open ${d.name}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="truncate text-[14px] font-semibold">{d.name}</h3>
                    <p className="mt-1 text-xs text-muted">{pluralize(d.widget_count, "widget")} · updated {timeAgo(d.updated_at)}</p></div>
                  {canEdit && (
                    <MenuRoot>
                      <MenuTrigger asChild><Button variant="ghost" size="icon-sm" className="relative z-10" aria-label={`Actions for ${d.name}`}><MoreHorizontal /></Button></MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<Copy />} onSelect={() => dup.mutate(d.id, { onSuccess: () => toast.success("Dashboard duplicated") })}>Duplicate</MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(d)}>Delete</MenuItem>
                      </MenuContent>
                    </MenuRoot>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={creating} onOpenChange={setCreating} title="New dashboard" size="sm"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={submit}>Create</Button></>}>
        <Input aria-label="Dashboard name" placeholder="Dashboard name" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} />
      </Dialog>
      {deleting && (
        <ConfirmDialog open onOpenChange={(o) => !o && setDeleting(null)} title="Delete dashboard?" destructive confirmLabel="Delete"
          description={<>“{deleting.name}” and its widget configurations will be deleted. Datasets are not affected.</>}
          onConfirm={() => del.mutateAsync(deleting.id).then(() => toast.success("Dashboard deleted")).catch((e) => { toast.error(errorMessage(e)); })} />
      )}
    </div>
  );
}
