import { Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/layout";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuthStatus, useMembers, useProject, useRemoveMember, useUpsertMember } from "@/services/hooks";
import type { Member, Role } from "@/types/api";

const ROLE_HELP: Record<Role, string> = {
  viewer: "Can view data, run queries and view dashboards",
  editor: "Can also import data and edit queries and dashboards",
  owner: "Full control, including members, archive and delete",
};

export function MembersPage() {
  const { projectId = "" } = useParams();
  const { data: project } = useProject(projectId);
  const { data: auth } = useAuthStatus();
  const { data, isLoading, error } = useMembers(projectId);
  const upsert = useUpsertMember(projectId);
  const remove = useRemoveMember(projectId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [removing, setRemoving] = useState<Member | null>(null);
  const isOwner = project?.role === "owner";

  return (
    <div>
      <PageHeader title="Members" description="Access is checked on the server for every project operation." />
      <div className="grid gap-4 p-4 sm:px-6 lg:grid-cols-3">
        <Panel title="People with access" className="lg:col-span-2">
          {error ? <div className="p-4"><ErrorState error={error} /></div> : isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : (
            <ul className="divide-y divide-line">
              {data?.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="flex size-7 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold">{m.display_name.slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{m.display_name}{m.user_id === auth?.user?.id && <span className="text-subtle"> (you)</span>}</div>
                    <div className="text-xs text-muted">{m.email} · added {formatDate(m.created_at)}</div>
                  </div>
                  {isOwner ? (
                    <Select aria-label={`Role for ${m.email}`} className="w-28" value={m.role}
                      onChange={(e) => upsert.mutate({ email: m.email, role: e.target.value as Role }, { onSuccess: () => toast.success("Role updated"), onError: (er) => toast.error(errorMessage(er)) })}>
                      <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="owner">Owner</option>
                    </Select>
                  ) : <Badge>{m.role}</Badge>}
                  {isOwner && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.email}`} onClick={() => setRemoving(m)}><Trash2 /></Button>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Add member">
          {isOwner ? (
            <form className="flex flex-col gap-3 p-4" onSubmit={(e) => {
              e.preventDefault();
              upsert.mutate({ email, role }, { onSuccess: () => { toast.success("Member added"); setEmail(""); }, onError: (er) => toast.error(errorMessage(er)) });
            }}>
              <Field label="Email of an existing account">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
              <Field label="Role" hint={ROLE_HELP[role]}>{(id, d) => (
                <Select id={id} aria-describedby={d} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="owner">Owner</option>
                </Select>)}</Field>
              <Button type="submit" variant="primary" icon={<UserPlus />} loading={upsert.isPending} disabled={!email}>Add member</Button>
            </form>
          ) : <p className="p-4 text-[13px] text-muted">Only project owners can manage members.</p>}
        </Panel>
      </div>
      {removing && (
        <ConfirmDialog open onOpenChange={(o) => !o && setRemoving(null)} title="Remove member?" destructive confirmLabel="Remove"
          description={`${removing.email} will lose access to this project.`}
          onConfirm={() => remove.mutateAsync(removing.user_id).then(() => toast.success("Member removed")).catch((e) => { toast.error(errorMessage(e)); })} />
      )}
    </div>
  );
}
