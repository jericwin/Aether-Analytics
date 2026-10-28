import { ArrowRight, Database, FlaskConical, FolderPlus, LayoutDashboard, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/layout";
import { errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useAuthStatus, useCreateDemoProject, useProjects } from "@/services/hooks";

import { CreateProjectDialog } from "../projects/CreateProjectDialog";

const STEPS = [
  { icon: <FolderPlus />, title: "Create a project", text: "A workspace for related datasets, queries and dashboards." },
  { icon: <Database />, title: "Import a dataset", text: "CSV, Excel, JSON or Parquet. Preview the schema, then import and profile it." },
  { icon: <SquareTerminal />, title: "Query with SQL", text: "Run DuckDB SQL against your tables in a sandboxed, read-only engine." },
  { icon: <LayoutDashboard />, title: "Build a dashboard", text: "Drag, resize and filter charts that recompute from your data." },
];

export function HomePage() {
  const { data: auth } = useAuthStatus();
  const { data, isLoading, error } = useProjects({ status: "active" });
  const demo = useCreateDemoProject();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const firstRun = !isLoading && !data?.items.length;

  return (
    <div>
      <PageHeader title={`Welcome${auth?.user ? `, ${auth.user.display_name}` : ""}`} description="Everything runs on this machine. No cloud services or paid APIs are required." />
      <div className="grid gap-4 p-4 sm:px-6 xl:grid-cols-3">
        <Panel title={firstRun ? "Get started" : "Workflow"} className="xl:col-span-2" bodyClassName="p-4">
          <ol className="grid gap-3 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 rounded-md border border-line bg-surface-2 p-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent [&_svg]:size-4">{s.icon}</div>
                <div><div className="text-[13px] font-semibold">{i + 1}. {s.title}</div><p className="mt-0.5 text-xs text-muted">{s.text}</p></div>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon={<FolderPlus />} onClick={() => setCreating(true)}>Create project</Button>
            <Button icon={<FlaskConical />} loading={demo.isPending}
              onClick={() => demo.mutate(undefined, { onSuccess: (p) => { toast.success("Demo project created. Imports are running."); navigate(`/projects/${p.id}`); }, onError: (e) => toast.error(errorMessage(e)) })}>
              Explore with demo data
            </Button>
          </div>
          <p className="mt-2 text-xs text-subtle">The demo creates a separate project with synthetic, clearly labelled retail data. It never touches your existing projects.</p>
        </Panel>
        <Panel title="Recent projects" actions={<Link to="/projects" className="text-xs text-accent hover:underline">All projects</Link>}>
          {error ? <div className="p-4"><ErrorState error={error} /></div> : isLoading ? <div className="p-4"><Skeleton className="h-20" /></div> : !data?.items.length ? (
            <p className="p-4 text-[13px] text-muted">No projects yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.items.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-surface-2">
                    <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{p.name}</div><div className="text-[11px] text-subtle">Updated {timeAgo(p.updated_at)}</div></div>
                    {p.is_demo && <Badge tone="accent">Demo</Badge>}
                    <ArrowRight className="size-3.5 text-subtle" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
