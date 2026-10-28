import { useQuery } from "@tanstack/react-query";

import { ErrorState, Skeleton, StatusBadge } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { KeyValue, PageHeader, Panel } from "@/components/ui/layout";
import { type ThemePref, useTheme } from "@/hooks/useTheme";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuthStatus } from "@/services/hooks";

interface Ready {
  status: string;
  checks: { database: { ok: boolean; backend?: string }; storage: { ok: boolean }; engine: { duckdb: string; polars: string }; worker_mode: string; jobs?: Record<string, number> };
}

export function SettingsPage() {
  const { pref, setPref } = useTheme();
  const { data: auth } = useAuthStatus();
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<Ready>("/health/ready"), refetchInterval: 15_000 });

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid max-w-5xl gap-4 p-4 sm:px-6 lg:grid-cols-2">
        <Panel title="Appearance" bodyClassName="p-4">
          <label className="flex items-center justify-between gap-4 text-[13px]">
            <span>Theme<span className="block text-xs text-muted">System follows your OS setting.</span></span>
            <Select className="w-36" value={pref} onChange={(e) => setPref(e.target.value as ThemePref)} aria-label="Theme">
              <option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option>
            </Select>
          </label>
        </Panel>
        <Panel title="Account" bodyClassName="p-4">
          {auth?.user && <KeyValue items={[["Name", auth.user.display_name], ["Email", auth.user.email], ["Member since", formatDate(auth.user.created_at)]]} />}
        </Panel>
        <Panel title="System status" className="lg:col-span-2" bodyClassName="p-4">
          {health.error ? <ErrorState error={health.error} /> : !health.data ? <Skeleton className="h-24" /> : (
            <KeyValue items={[
              ["Overall", <StatusBadge key="o" status={health.data.status === "ok" ? "succeeded" : "failed"} />],
              ["Metadata database", `${health.data.checks.database.backend ?? "?"} — ${health.data.checks.database.ok ? "reachable" : "unavailable"}`],
              ["Storage", health.data.checks.storage.ok ? "writable" : "not writable"],
              ["Analytics engine", `DuckDB ${health.data.checks.engine.duckdb} · Polars ${health.data.checks.engine.polars}`],
              ["Worker mode", health.data.checks.worker_mode],
              ["Active jobs", Object.entries(health.data.checks.jobs ?? {}).map(([k, v]) => `${v} ${k}`).join(", ") || "none"],
              ["Network", "Core features run fully offline; no external services are contacted."],
            ]} />
          )}
        </Panel>
      </div>
    </div>
  );
}
