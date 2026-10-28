import { AlertTriangle, Info } from "lucide-react";
import { useMemo, useState } from "react";

import { EChart } from "@/components/charts/EChart";
import { readTokens } from "@/components/charts/chartOptions";
import { Badge } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { Stat } from "@/components/ui/layout";
import { useTheme } from "@/hooks/useTheme";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ColumnProfile, Profile } from "@/types/api";

function scoreTone(s: number) {
  return s >= 90 ? "success" : s >= 70 ? "warning" : "danger";
}

function Histogram({ col }: { col: ColumnProfile }) {
  const { resolved } = useTheme();
  const option = useMemo(() => {
    const t = readTokens();
    const bins = col.histogram ?? [];
    const temporal = col.logical_type === "date" || col.logical_type === "timestamp";
    const lab = (v: number | string) => (temporal ? String(v).slice(0, 10) : formatNumber(v, "compact"));
    return {
      animation: false,
      grid: { left: 4, right: 4, top: 6, bottom: 4, containLabel: false },
      tooltip: {
        trigger: "item", backgroundColor: t.surface, borderColor: t.line, textStyle: { color: t.text, fontSize: 12 },
        formatter: (p: { dataIndex: number }) => { const b = bins[p.dataIndex]!; return `${lab(b.start)} – ${lab(b.end)}<br/><b>${formatNumber(b.count, "integer")}</b> rows`; },
      },
      xAxis: { type: "category", show: false, data: bins.map((b) => String(b.start)) },
      yAxis: { type: "value", show: false },
      series: [{ type: "bar", data: bins.map((b) => b.count), barCategoryGap: "6%", itemStyle: { color: t.series[0], borderRadius: [2, 2, 0, 0] } }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col, resolved]);
  if (!col.histogram?.length) return null;
  return <EChart option={option} ariaLabel={`Distribution of ${col.name}`} className="h-20 w-full" />;
}

function TopValues({ col }: { col: ColumnProfile }) {
  if (!col.top_values?.length) return null;
  const nonNull = col.top_values.reduce((m, v) => Math.max(m, v.count), 0);
  return (
    <ul className="space-y-1">
      {col.top_values.slice(0, 6).map((v) => (
        <li key={String(v.value)} className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs">
          <div className="relative h-5 overflow-hidden rounded-sm bg-surface-3">
            <div className="absolute inset-y-0 left-0 bg-accent/25" style={{ width: `${(100 * v.count) / nonNull}%` }} />
            <span className="relative block truncate px-1.5 leading-5">{String(v.value)}</span>
          </div>
          <span className="tabular text-muted">{formatNumber(v.count, "integer")}</span>
        </li>
      ))}
    </ul>
  );
}

function ColumnCard({ col, rows }: { col: ColumnProfile; rows: number }) {
  const stats: [string, string][] = [];
  const n = (v: unknown) => (typeof v === "number" ? formatNumber(v, "decimal") : v == null ? "—" : String(v).slice(0, 19));
  stats.push(["Missing", `${formatNumber(col.null_count, "integer")} (${col.null_pct.toFixed(1)}%)`]);
  stats.push(["Distinct", `${col.distinct_approximate ? "≈" : ""}${formatNumber(col.distinct_count, "integer")}`]);
  if (col.min !== undefined) stats.push(["Min", n(col.min)], ["Max", n(col.max)]);
  if (col.mean !== undefined) stats.push(["Mean", n(col.mean)], ["Median", n(col.median)], ["Std dev", n(col.std)]);
  if (col.quantiles) stats.push(["P25 / P75", `${n(col.quantiles.p25)} / ${n(col.quantiles.p75)}`], ["P05 / P95", `${n(col.quantiles.p05)} / ${n(col.quantiles.p95)}`]);
  if (col.min_length != null) stats.push(["Length", `${col.min_length}–${col.max_length} (avg ${n(col.mean_length)})`]);
  if (col.true_count != null) stats.push(["True", `${formatNumber(col.true_count, "integer")} of ${formatNumber(rows - col.null_count, "integer")}`]);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3.5 shadow-panel">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold" title={col.name}>{col.name}</h3>
          <span className="font-mono text-[11px] text-subtle">{col.logical_type} · {col.physical_type}</span>
        </div>
        <Badge tone={scoreTone(col.quality.score)}>Quality {col.quality.score.toFixed(0)}</Badge>
      </header>
      <Histogram col={col} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {stats.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="tabular truncate text-right" title={v}>{v}</dd></div>)}
      </dl>
      <TopValues col={col} />
      {col.quality.issues.length > 0 && (
        <ul className="space-y-1 border-t border-line pt-2 text-xs">
          {col.quality.issues.map((i) => (
            <li key={i.message} className="flex gap-1.5">
              {i.severity === "info" ? <Info className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden /> : <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", i.severity === "high" ? "text-danger" : "text-warning")} aria-hidden />}
              <span><span className="sr-only">{i.severity}: </span>{i.message}</span>
            </li>
          ))}
          {col.invalid_examples?.length ? <li className="pl-5 font-mono text-[11px] text-subtle">e.g. {col.invalid_examples.map((e) => JSON.stringify(e)).join(", ")}</li> : null}
          {col.outlier_bounds && col.outlier_count ? <li className="pl-5 text-[11px] text-subtle">Outside [{formatNumber(col.outlier_bounds.lower, "decimal")}, {formatNumber(col.outlier_bounds.upper, "decimal")}]. Outliers are statistical, not necessarily errors.</li> : null}
        </ul>
      )}
    </article>
  );
}

export function ProfileView({ profile }: { profile: Profile }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"position" | "quality" | "missing">("position");
  const cols = useMemo(() => {
    const filtered = profile.columns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
    if (sortBy === "quality") return [...filtered].sort((a, b) => a.quality.score - b.quality.score);
    if (sortBy === "missing") return [...filtered].sort((a, b) => b.null_pct - a.null_pct);
    return filtered;
  }, [profile, search, sortBy]);

  return (
    <div className="space-y-4 p-4 sm:px-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Rows" value={formatNumber(profile.row_count, "integer")} hint={`${profile.column_count} columns`} />
        <Stat label="Missing cells" value={`${profile.missing_pct.toFixed(2)}%`} hint={`${formatNumber(profile.missing_cells, "integer")} cells`} />
        <Stat label="Duplicate rows" value={formatNumber(profile.duplicate_rows, "integer")} hint={`${profile.duplicate_pct.toFixed(2)}% of rows`} />
        <Stat label="Quality score" value={profile.quality_score?.toFixed(1) ?? "—"} hint="60% completeness + 40% validity" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search columns" aria-label="Search profiled columns" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Sort columns" className="w-48" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="position">Original order</option><option value="quality">Lowest quality first</option><option value="missing">Most missing first</option>
        </Select>
        <span className="ml-auto text-xs text-subtle">Computed {formatDateTime(profile.computed_at)} · distinct counts {profile.distinct_method === "exact" ? "exact" : "approximate (HyperLogLog)"}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {cols.map((c) => <ColumnCard key={c.name} col={c} rows={profile.row_count} />)}
      </div>
    </div>
  );
}
