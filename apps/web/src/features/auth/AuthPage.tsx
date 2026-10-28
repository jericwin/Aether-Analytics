import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Check, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { ErrorState, Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
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

/** 0–4 heuristic strength score; the server only enforces length, this is guidance. */
export function passwordStrength(pw: string): number {
  if (!pw) return 0;
  let score = pw.length >= 10 ? 1 : 0;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const STRENGTH = ["Too short", "Fair", "Good", "Strong", "Excellent"];

// ------------------------------------------------------------------ form primitives
interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon: ReactNode;
  error?: string;
  trailing?: ReactNode;
  hint?: ReactNode;
}

const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(function AuthInput(
  { label, icon, error, trailing, hint, id, className, ...props },
  ref,
) {
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-fg">{label}</label>
      <div
        className={cn(
          "flex h-10 items-center gap-2.5 rounded-lg border bg-surface-2 px-3 transition-colors",
          "focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20",
          error ? "border-danger" : "border-line hover:border-line-strong",
        )}
      >
        <span className="text-subtle [&_svg]:size-4" aria-hidden>{icon}</span>
        <input
          ref={ref}
          id={id}
          aria-invalid={!!error}
          aria-describedby={descId}
          className={cn("h-full min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-subtle focus-visible:outline-none", className)}
          {...props}
        />
        {trailing}
      </div>
      {error ? (
        <p id={descId} role="alert" className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <div id={descId} className="text-xs text-subtle">{hint}</div>
      ) : null}
    </div>
  );
});

function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-subtle hover:text-fg [&_svg]:size-4"
      aria-label={shown ? "Hide characters" : "Reveal characters"}
      aria-pressed={shown}
    >
      {shown ? <EyeOff /> : <Eye />}
    </button>
  );
}

function StrengthMeter({ value }: { value: string }) {
  const score = passwordStrength(value);
  const colors = ["bg-danger", "bg-warning", "bg-warning", "bg-success", "bg-success"];
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full", i < Math.max(score, value ? 1 : 0) ? colors[score] : "bg-surface-3")} />
        ))}
      </div>
      <span className="w-20 text-right">{value ? STRENGTH[score] : "At least 10 characters"}</span>
    </div>
  );
}

// ------------------------------------------------------------------ forms
function LoginForm({ onDone }: { onDone: () => void }) {
  const login = useLogin();
  const [shown, setShown] = useState(false);
  const { register, handleSubmit, formState } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit((v) => login.mutate(v, { onSuccess: onDone }))} noValidate>
      <AuthInput id="login-email" label="Email" icon={<Mail />} type="email" autoComplete="email" placeholder="you@company.com"
        autoFocus error={formState.errors.email?.message} {...register("email")} />
      <AuthInput id="login-password" label="Password" icon={<Lock />} type={shown ? "text" : "password"} autoComplete="current-password"
        placeholder="Your password" error={formState.errors.password?.message}
        trailing={<RevealButton shown={shown} onToggle={() => setShown((s) => !s)} />} {...register("password")} />
      {login.error && <ErrorState error={login.error} compact />}
      <Button type="submit" variant="primary" loading={login.isPending} className="mt-1 h-10 justify-center text-[14px]">Sign in</Button>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const reg = useRegister();
  const [shown, setShown] = useState(false);
  const { register, handleSubmit, formState, watch } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });
  const pw = watch("password") ?? "";
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit((v) => reg.mutate(v, { onSuccess: onDone }))} noValidate>
      <AuthInput id="reg-name" label="Name" icon={<User />} autoComplete="name" placeholder="Ada Lovelace" autoFocus
        error={formState.errors.display_name?.message} {...register("display_name")} />
      <AuthInput id="reg-email" label="Email" icon={<Mail />} type="email" autoComplete="email" placeholder="you@company.com"
        error={formState.errors.email?.message} {...register("email")} />
      <AuthInput id="reg-password" label="Password" icon={<Lock />} type={shown ? "text" : "password"} autoComplete="new-password"
        placeholder="Create a password" error={formState.errors.password?.message}
        hint={<StrengthMeter value={pw} />}
        trailing={<RevealButton shown={shown} onToggle={() => setShown((s) => !s)} />} {...register("password")} />
      {reg.error && <ErrorState error={reg.error} compact />}
      <Button type="submit" variant="primary" loading={reg.isPending} className="mt-1 h-10 justify-center text-[14px]">Create account</Button>
    </form>
  );
}

// ------------------------------------------------------------------ brand panel
/** Decorative, static mini-dashboard illustration (not data). */
function Illustration() {
  const bars = [38, 52, 44, 66, 58, 80, 72];
  return (
    <div className="relative w-full max-w-md" aria-hidden>
      <div className="rounded-xl border border-line bg-surface/90 p-4 shadow-pop backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted">Monthly revenue</div>
            <div className="tabular mt-0.5 text-[22px] font-semibold tracking-tight">$284.6K</div>
          </div>
          <span className="rounded-md bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">▲ 12.4%</span>
        </div>
        <svg viewBox="0 0 300 90" preserveAspectRatio="none" className="mt-3 h-24 w-full">
          <defs>
            <linearGradient id="auth-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[22, 45, 68].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="var(--grid-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          <path d="M0 70 L30 62 L60 66 L90 50 L120 54 L150 40 L180 44 L210 30 L240 34 L270 18 L300 22 L300 90 L0 90 Z" fill="url(#auth-area)" />
          <path d="M0 70 L30 62 L60 66 L90 50 L120 54 L150 40 L180 44 L210 30 L240 34 L270 18 L300 22" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="absolute -right-4 -bottom-10 w-44 rounded-xl border border-line bg-surface/95 p-3 shadow-pop sm:-right-8">
        <div className="text-[11px] text-muted">Orders by region</div>
        <div className="mt-2 flex h-14 items-end gap-1.5">
          {bars.map((h, i) => (
            <span key={i} className="flex-1 rounded-t-[3px]" style={{ height: `${h}%`, background: i === 5 ? "var(--accent)" : "var(--line-strong)" }} />
          ))}
        </div>
      </div>
      <div className="absolute -bottom-8 -left-4 flex items-center gap-2 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-pop sm:-left-8">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-[11px] font-semibold text-accent">99</span>
        <div>
          <div className="text-[11px] font-medium">Data quality</div>
          <div className="text-[10px] text-muted">0.15% missing cells</div>
        </div>
      </div>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:w-[52%] lg:flex-col">
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="pointer-events-none absolute -top-40 -left-40 size-[520px] rounded-full bg-accent/15 blur-[110px]" aria-hidden />
      <div className="relative flex flex-1 flex-col px-12 py-10 xl:px-16">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">Aether Analytics</span>
        </Link>
        <div className="mt-auto mb-auto py-12">
          <h2 className="max-w-md text-[30px] leading-tight font-semibold tracking-tight xl:text-[34px]">
            Your analytics workspace, <span className="text-accent">on your own machine.</span>
          </h2>
          <ul className="mt-6 space-y-2.5 text-[14px] text-muted">
            {["Import CSV, Excel, JSON and Parquet", "Profile quality, query with SQL", "Build dashboards that stay in sync"].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <span className="flex size-5 items-center justify-center rounded-full bg-accent-soft text-accent"><Check className="size-3" aria-hidden /></span>
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-12 pl-8"><Illustration /></div>
        </div>
        <p className="text-xs text-subtle">Runs locally. Your data never leaves this machine.</p>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ page
export function AuthPage() {
  const { data, isLoading } = useAuthStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  if (isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (data?.user) return <Navigate to={from} replace />;

  const requested = params.get("mode");
  const mode: "login" | "register" =
    !data?.has_users ? "register" : requested === "register" && data.registration_open ? "register" : "login";
  const setMode = (m: "login" | "register") => setParams(m === "register" ? { mode: "register" } : {}, { replace: true, state: location.state });
  const done = () => navigate(from, { replace: true });
  const canSwitch = !!data?.has_users && !!data.registration_open;

  return (
    <div className="flex min-h-full bg-bg">
      <BrandPanel />
      <main className="flex flex-1 flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
            <ArrowLeft className="size-4" aria-hidden /> Back to home
          </Link>
          <Link to="/" className="flex items-center gap-2 lg:hidden" aria-label="Aether Analytics home">
            <img src="/favicon.svg" alt="" className="size-6" />
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[24px] font-semibold tracking-tight">
            {mode === "login" ? "Welcome back" : data?.has_users ? "Create your account" : "Set up your workspace"}
          </h1>
          <p className="mt-1.5 text-[14px] text-muted">
            {mode === "login"
              ? "Sign in to continue to your projects."
              : data?.has_users
                ? "Accounts are stored locally on this instance."
                : "Create the first account. Everything runs and is stored locally."}
          </p>

          {canSwitch && (
            <div role="tablist" aria-label="Authentication mode" className="mt-6 grid grid-cols-2 rounded-lg border border-line bg-surface-2 p-1">
              {(["login", "register"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "h-8 rounded-md text-[13px] font-medium transition-colors",
                    mode === m ? "bg-surface-3 text-fg shadow-panel ring-1 ring-line-strong" : "text-muted hover:text-fg",
                  )}
                >
                  {m === "login" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>
          )}

          <div className="mt-6">{mode === "login" ? <LoginForm onDone={done} /> : <RegisterForm onDone={done} />}</div>

          {canSwitch && (
            <p className="mt-6 text-center text-[13px] text-muted">
              {mode === "login" ? "New to Aether? " : "Already have an account? "}
              <button className="font-medium text-accent hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
                {mode === "login" ? "Create one" : "Sign in"}
              </button>
            </p>
          )}
        </div>
        <p className="text-center text-xs text-subtle">Passwords are hashed with Argon2id. Sessions stay on this instance.</p>
      </main>
    </div>
  );
}
