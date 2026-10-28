import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { ErrorState, Spinner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { useAuthStatus, useLogin, useRegister } from "@/services/hooks";

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  display_name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters").max(256),
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

function LoginForm({ onDone }: { onDone: () => void }) {
  const login = useLogin();
  const { register, handleSubmit, formState } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit((v) => login.mutate(v, { onSuccess: onDone }))} noValidate>
      <Field label="Email" error={formState.errors.email?.message}>
        {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!formState.errors.email} type="email" autoComplete="email" autoFocus {...register("email")} />}
      </Field>
      <Field label="Password" error={formState.errors.password?.message}>
        {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!formState.errors.password} type="password" autoComplete="current-password" {...register("password")} />}
      </Field>
      {login.error && <ErrorState error={login.error} compact />}
      <Button type="submit" variant="primary" loading={login.isPending} className="justify-center">
        Sign in
      </Button>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const reg = useRegister();
  const { register, handleSubmit, formState } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit((v) => reg.mutate(v, { onSuccess: onDone }))} noValidate>
      <Field label="Name" error={formState.errors.display_name?.message}>
        {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!formState.errors.display_name} autoComplete="name" autoFocus {...register("display_name")} />}
      </Field>
      <Field label="Email" error={formState.errors.email?.message}>
        {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!formState.errors.email} type="email" autoComplete="email" {...register("email")} />}
      </Field>
      <Field label="Password" hint="At least 10 characters" error={formState.errors.password?.message}>
        {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!formState.errors.password} type="password" autoComplete="new-password" {...register("password")} />}
      </Field>
      {reg.error && <ErrorState error={reg.error} compact />}
      <Button type="submit" variant="primary" loading={reg.isPending} className="justify-center">
        Create account
      </Button>
    </form>
  );
}

export function AuthPage() {
  const { data, isLoading } = useAuthStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register" | null>(null);
  if (isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (data?.user) return <Navigate to={from} replace />;
  const effective = mode ?? (data?.has_users ? "login" : "register");
  const done = () => navigate(from, { replace: true });

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <div>
            <div className="text-[15px] font-semibold">Aether Analytics</div>
            <div className="text-xs text-muted">Local-first business intelligence</div>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-panel">
          <h1 className="text-base font-semibold">
            {effective === "login" ? "Sign in" : data?.has_users ? "Create an account" : "Set up your workspace"}
          </h1>
          <p className="mt-1 mb-5 text-[13px] text-muted">
            {effective === "login"
              ? "Your data stays on this machine."
              : data?.has_users
                ? "Accounts are stored locally on this instance."
                : "Create the first account. Everything runs and is stored locally."}
          </p>
          {effective === "login" ? <LoginForm onDone={done} /> : <RegisterForm onDone={done} />}
          {data?.registration_open && (
            <p className="mt-4 text-center text-xs text-muted">
              {effective === "login" ? "No account yet? " : "Already have an account? "}
              <button className="text-accent hover:underline" onClick={() => setMode(effective === "login" ? "register" : "login")}>
                {effective === "login" ? "Create one" : "Sign in"}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
