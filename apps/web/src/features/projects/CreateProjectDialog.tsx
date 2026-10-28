import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useCreateProject } from "@/services/hooks";

export const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Keep it under 120 characters"),
  description: z.string().max(2000).optional(),
});
type Values = z.infer<typeof projectSchema>;

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateProject();
  const navigate = useNavigate();
  const { register, handleSubmit, formState, reset } = useForm<Values>({ resolver: zodResolver(projectSchema) });
  const submit = handleSubmit((v) =>
    create.mutate(v, {
      onSuccess: (p) => {
        toast.success(`Project "${p.name}" created`);
        reset();
        onOpenChange(false);
        navigate(`/projects/${p.id}`);
      },
    }),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      description="Projects group datasets, queries and dashboards."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={() => void submit()}>Create project</Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Field label="Name" error={formState.errors.name?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!formState.errors.name} autoFocus {...register("name")} />}
        </Field>
        <Field label="Description (optional)">
          {(id) => <Textarea id={id} {...register("description")} />}
        </Field>
        {create.error && <ErrorState error={create.error} compact />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
