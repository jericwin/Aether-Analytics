import { Archive, ArchiveRestore, FolderKanban, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { errorMessage } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { useDeleteProject, useProjects, useUpdateProject } from "@/services/hooks";
import type { Project } from "@/types/api";

import { CreateProjectDialog } from "./CreateProjectDialog";

function RenameDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(project.name);
  const update = useUpdateProject();
  const save = () =>
    update.mutate({ id: project.id, name }, { onSuccess: () => { toast.success("Project renamed"); onClose(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Rename project" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={update.isPending} onClick={save}>Save</Button></>}>
      <Input aria-label="Project name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} autoFocus />
    </Dialog>
  );
}

export function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "">("active");
  const deferred = useDeferredValue(search);
  const { data, isLoading, error, refetch } = useProjects({ search: deferred, status: status || undefined });
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const update = useUpdateProject();
  const del = useDeleteProject();

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Each project has its own datasets, queries, dashboards and members."
        actions={<Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New project</Button>}
      />
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-subtle" aria-hidden />
          <Input className="pl-8" placeholder="Search projects" aria-label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Status filter" className="w-36" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="">All</option>
        </Select>
      </div>
      <div className="px-4 pb-6 sm:px-6">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : !data?.items.length ? (
          <EmptyState
            icon={<FolderKanban />}
            title={search ? "No matching projects" : status === "archived" ? "No archived projects" : "No projects yet"}
            description={search ? "Try a different search." : "Create a project to start importing data."}
            action={!search && status !== "archived" && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New project</Button>}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((p) => (
              <li key={p.id} className="group relative rounded-lg border border-line bg-surface p-4 shadow-panel transition-colors hover:border-line-strong">
                <Link to={`/projects/${p.id}`} className="absolute inset-0 rounded-lg" aria-label={`Open ${p.name}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-semibold">{p.name}</h3>
                    <p className="mt-1 line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{p.description || "No description"}</p>
                  </div>
                  <MenuRoot>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="relative z-10" aria-label={`Actions for ${p.name}`}><MoreHorizontal /></Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<Pencil />} onSelect={() => setRenaming(p)} disabled={p.role === "viewer"}>Rename</MenuItem>
                      <MenuItem
                        icon={p.status === "active" ? <Archive /> : <ArchiveRestore />}
                        disabled={p.role !== "owner"}
                        onSelect={() => update.mutate({ id: p.id, status: p.status === "active" ? "archived" : "active" }, {
                          onSuccess: (r) => toast.success(r.status === "archived" ? "Project archived" : "Project restored"),
                          onError: (e) => toast.error(errorMessage(e)),
                        })}
                      >
                        {p.status === "active" ? "Archive" : "Restore"}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 />} danger disabled={p.role !== "owner"} onSelect={() => setDeleting(p)}>Delete</MenuItem>
                    </MenuContent>
                  </MenuRoot>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-subtle">
                  {p.is_demo && <Badge tone="accent">Synthetic demo</Badge>}
                  {p.status === "archived" && <Badge>Archived</Badge>}
                  <Badge>{p.role}</Badge>
                  <span title={`Created ${formatDate(p.created_at)}`}>Updated {timeAgo(p.updated_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
      {renaming && <RenameDialog project={renaming} onClose={() => setRenaming(null)} />}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title="Delete project?"
          description={<>This permanently deletes <strong>{deleting.name}</strong>, its datasets, stored files, queries and dashboards. This cannot be undone.</>}
          confirmLabel="Delete project"
          destructive
          onConfirm={() => del.mutateAsync(deleting.id).then(() => toast.success("Project deleted")).catch((e) => { toast.error(errorMessage(e)); })}
        />
      )}
    </div>
  );
}
