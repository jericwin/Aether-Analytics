import {
  ArrowRight,
  Check,
  Database,
  FileSpreadsheet,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Lock,
  Moon,
  ShieldCheck,
  SquareTerminal,
  Sun,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <FileSpreadsheet />,
    title: "Import anything tabular",
    text: "CSV, Excel, JSON and Parquet, validated by content and previewed before anything is stored.",
  },
  {
    icon: <Gauge />,
    title: "Data quality at a glance",
    text: "Column profiles with distributions, missing values, outliers and plain-language quality scores.",
  },
  {
    icon: <SquareTerminal />,
    title: "A real SQL workbench",
    text: "DuckDB SQL with schema-aware autocompletion, history, saved queries and CSV export.",
  },
  {
    icon: <LayoutDashboard />,
    title: "Interactive dashboards",
    text: "Drag, resize and cross-filter charts that always recompute from your current data.",
  },
  {
    icon: <GitBranch />,
    title: "Versioned datasets",
    text: "Every import is an immutable, hashed Parquet snapshot. Re-import without losing history.",
  },
  {
    icon: <ShieldCheck />,
    title: "Sandboxed by design",
    text: "Queries are parsed, allow-listed and executed in a locked-down engine with no file access.",
  },
];

const STEPS = [
  { title: "Import", text: "Drop a file. Aether infers types carefully and never guesses ambiguous dates." },
  { title: "Profile", text: "See completeness, distributions and issues for every column automatically." },
  { title: "Query", text: "Explore with SQL across datasets: joins, CTEs and window functions." },
  { title: "Visualize", text: "Build a dashboard, add filters and share a view your team can trust." },
];

// Measured with `aether benchmark` (see docs/benchmarks); figures from one laptop, not guarantees.
const STATS = [
  { value: "~4 s", label: "to import 1M CSV rows" },
  { value: "~100 ms", label: "aggregate query on 1M rows" },
  { value: "0", label: "external network requests" },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Aether Analytics home">
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className="text-[15px] font-semibold tracking-tight">Aether Analytics</span>
    </Link>
  );
}

function ThemeToggle() {
  const { resolved, setPref } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
      onClick={() => setPref(resolved === "dark" ? "light" : "dark")}
    >
      {resolved === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

function BrowserFrame({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-pop", className)}>
      <div className="flex h-8 items-center gap-1.5 border-b border-line bg-surface-2 px-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 h-4 w-48 max-w-[40%] rounded bg-surface-3" />
      </div>
      <img src={src} alt={alt} className="block w-full" loading="lazy" width={1440} height={900} />
    </div>
  );
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">{title}</h2>
      {text && <p className="mt-3 text-[15px] leading-relaxed text-muted">{text}</p>}
    </div>
  );
}

export function LandingPage() {
  const { resolved } = useTheme();
  const shot = resolved === "dark" ? "/landing/dashboard-dark.png" : "/landing/dashboard-light.png";

  return (
    <div className="min-h-full overflow-x-hidden bg-bg text-fg">
      {/* Navigation */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6" aria-label="Main">
          <Logo />
          <div className="hidden items-center gap-5 text-[13px] text-muted md:flex">
            <a href="#features" className="hover:text-fg">Features</a>
            <a href="#workflow" className="hover:text-fg">How it works</a>
            <a href="#security" className="hover:text-fg">Security</a>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <Link to="/login" className="hidden sm:block"><Button variant="ghost">Sign in</Button></Link>
            <Link to="/login?mode=register"><Button variant="primary">Get started</Button></Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="relative">
          <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" aria-hidden />
          <div className="pointer-events-none absolute top-[-180px] left-1/2 h-[420px] w-[820px] max-w-full -translate-x-1/2 rounded-full bg-accent/15 blur-[120px]" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-muted">
              <WifiOff className="size-3.5 text-accent" aria-hidden />
              Local-first · Self-hosted · No cloud required
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-[36px] leading-[1.08] font-semibold tracking-tight sm:text-[54px]">
              Business intelligence that{" "}
              <span className="text-accent">runs on your machine</span>.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-muted sm:text-[17px]">
              Import files, check data quality, query with SQL and build interactive dashboards, all
              without sending a single row to the cloud.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link to="/login?mode=register">
                <Button variant="primary" className="h-10 px-5 text-[14px]">
                  Get started free <ArrowRight />
                </Button>
              </Link>
              <a href="#workflow"><Button variant="outline" className="h-10 px-5 text-[14px]">See how it works</Button></a>
            </div>
            <dl className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-4">
              {STATS.map((s) => (
                <div key={s.label}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="tabular text-[22px] font-semibold tracking-tight sm:text-[26px]">{s.value}</dd>
                  <dd className="mt-0.5 text-xs text-subtle">{s.label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative mx-auto max-w-6xl px-4 pb-20 sm:px-6">
            <BrowserFrame src={shot} alt="Aether dashboard showing revenue KPIs, a monthly revenue trend, revenue by channel and by segment" />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-16 border-t border-line bg-surface/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="Features" title="Everything between a raw file and a decision"
              text="One cohesive workspace instead of a spreadsheet, a SQL client and a charting tool stitched together." />
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="group rounded-xl border border-line bg-surface p-5 shadow-panel transition-colors hover:border-accent/50">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-[18px]">{f.icon}</div>
                  <h3 className="mt-4 text-[15px] font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Workflow */}
        <section id="workflow" className="scroll-mt-16 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="How it works" title="From file to dashboard in minutes" />
            <ol className="relative mt-12 grid gap-6 md:grid-cols-4">
              <div className="absolute top-5 right-[12%] left-[12%] hidden h-px bg-line md:block" aria-hidden />
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative text-center">
                  <div className="relative mx-auto flex size-10 items-center justify-center rounded-full border border-accent/40 bg-surface text-sm font-semibold text-accent">
                    {i + 1}
                  </div>
                  <h3 className="mt-4 text-[15px] font-semibold">{s.title}</h3>
                  <p className="mx-auto mt-1.5 max-w-[240px] text-[13.5px] leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-16 grid items-center gap-10 lg:grid-cols-2">
              <div>
                <h3 className="text-[22px] font-semibold tracking-tight">SQL without the guesswork</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">
                  Write analytical SQL against every dataset in your project. The schema browser and
                  autocompletion know your columns, and results stream into a fast, virtualized grid.
                </p>
                <ul className="mt-5 space-y-2 text-[14px]">
                  {["Joins, CTEs and window functions", "History and saved queries", "One-click CSV export"].map((t) => (
                    <li key={t} className="flex items-center gap-2"><Check className="size-4 text-accent" aria-hidden />{t}</li>
                  ))}
                </ul>
              </div>
              <BrowserFrame src="/landing/sql-dark.png" alt="SQL workbench with a query ranking product categories by revenue" />
            </div>
            <div className="mt-16 grid items-center gap-10 lg:grid-cols-2">
              <BrowserFrame src="/landing/profile-light.png" alt="Data profile showing quality scores and value distributions per column" className="lg:order-1" />
              <div className="lg:order-2">
                <h3 className="text-[22px] font-semibold tracking-tight">Know your data before you trust it</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">
                  Every import is profiled automatically: missing values, duplicates, outliers, invalid
                  entries in numeric columns and a quality score that explains itself.
                </p>
                <ul className="mt-5 space-y-2 text-[14px]">
                  {["Ambiguous dates are flagged, never guessed", "Strict type conversion with examples", "Version history with content hashes"].map((t) => (
                    <li key={t} className="flex items-center gap-2"><Check className="size-4 text-accent" aria-hidden />{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-16 border-y border-line bg-surface/40 py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">Security & privacy</p>
              <h2 className="mt-3 text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">Your data never leaves your machine</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">
                Aether runs entirely on your own computer or server. There are no paid APIs and no
                telemetry, and it works fully offline.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: <Lock />, title: "Two-layer SQL sandbox", text: "AST validation plus an engine with file and network access disabled." },
                { icon: <ShieldCheck />, title: "Hardened sign-in", text: "Argon2id passwords, HttpOnly sessions and CSRF protection." },
                { icon: <Database />, title: "Role-based projects", text: "Viewer, editor and owner roles, checked on every request." },
                { icon: <WifiOff />, title: "Offline & backed up", text: "Works without internet. One command backs up and restores." },
              ].map((s) => (
                <li key={s.title} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center gap-2 text-[14px] font-semibold"><span className="text-accent [&_svg]:size-4">{s.icon}</span>{s.title}</div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-20">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface px-6 py-12 text-center shadow-panel sm:px-12">
            <div className="bg-dots pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden />
            <div className="relative">
              <h2 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">Turn your next spreadsheet into a dashboard</h2>
              <p className="mx-auto mt-3 max-w-xl text-[15px] text-muted">Create an account in seconds, or explore a ready-made synthetic retail project first.</p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Link to="/login?mode=register"><Button variant="primary" className="h-10 px-5 text-[14px]">Create your workspace <ArrowRight /></Button></Link>
                <Link to="/login"><Button variant="outline" className="h-10 px-5 text-[14px]">Sign in</Button></Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-xs text-subtle sm:px-6">
          <div className="flex items-center gap-2"><img src="/favicon.svg" alt="" className="size-5" />Aether Analytics, a local-first BI platform</div>
          <div className="flex items-center gap-4">
            <span>FastAPI · DuckDB · Polars · React</span>
            <a href="https://github.com/jericwin/Aether-Analytics" target="_blank" rel="noreferrer" className="hover:text-fg">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
