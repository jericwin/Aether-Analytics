/**
 * Pure transformation: (chart query, display settings, query result, theme tokens) -> ECharts option.
 *
 * Visual rules (see docs/DECISIONS/0004-chart-design.md):
 *  - categorical colours are assigned by entity name in a stable order, never by rank, so filtering
 *    never repaints the survivors; series beyond 7 fold into a neutral "Other";
 *  - one value axis only; thin marks (2px lines, 4px rounded bar ends at the data end);
 *  - 2px surface-coloured gaps between stacked/adjacent fills; recessive grid lines;
 *  - a legend whenever there are >= 2 series; text uses text tokens, never series colours.
 */
import { formatNumber } from "@/lib/format";
import type { ChartData, ChartQuery, WidgetDisplay } from "@/types/api";

import type { EChartsOption } from "./EChart";

export interface ChartTokens {
  surface: string;
  text: string;
  muted: string;
  grid: string;
  line: string;
  series: string[];
  other: string;
}

const MAX_SLOTS = 7;
const OTHER = "Other";

export function readTokens(): ChartTokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    surface: v("--surface", "#12161d"),
    text: v("--fg", "#e7eaf0"),
    muted: v("--fg-muted", "#a1a9b7"),
    grid: v("--grid-line", "#1f2530"),
    line: v("--line-strong", "#323a48"),
    series: Array.from({ length: 8 }, (_, i) => v(`--series-${i + 1}`, "#3987e5")),
    other: v("--fg-subtle", "#737c8c"),
  };
}

/** Stable colour per entity name: sorted names take slots in order. */
export function colorMap(names: string[], tokens: ChartTokens): Map<string, string> {
  const unique = [...new Set(names)].filter((n) => n !== OTHER).sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  unique.forEach((n, i) => map.set(n, tokens.series[i % MAX_SLOTS] ?? tokens.other));
  map.set(OTHER, tokens.other);
  return map;
}

const label = (v: unknown) => (v === null || v === undefined ? "(null)" : String(v));

function fmt(display: WidgetDisplay) {
  return (v: unknown) => formatNumber(v, display.number_format ?? "auto", display.currency ?? "USD");
}

function baseAxisStyle(t: ChartTokens) {
  return {
    axisLine: { lineStyle: { color: t.line } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: t.grid } },
    nameTextStyle: { color: t.muted, fontSize: 11 },
  };
}

function common(t: ChartTokens, showLegend: boolean) {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", color: t.text },
    grid: { left: 8, right: 16, top: showLegend ? 36 : 14, bottom: 8, containLabel: true },
    legend: showLegend
      ? { show: true, top: 0, left: 0, type: "scroll", icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 11 } }
      : { show: false },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.line,
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: "box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); border-radius: 6px;",
    },
  };
}

/** Pivot [dim, series, value] rows into category list + per-series arrays, folding overflow into Other. */
export function pivot(rows: unknown[][]): { categories: string[]; series: Map<string, (number | null)[]> } {
  const categories: string[] = [];
  const catIndex = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const c = label(r[0]);
    if (!catIndex.has(c)) {
      catIndex.set(c, categories.length);
      categories.push(c);
    }
    totals.set(label(r[1]), (totals.get(label(r[1])) ?? 0) + Math.abs(Number(r[2]) || 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const keep = new Set(ranked.length > MAX_SLOTS + 1 ? ranked.slice(0, MAX_SLOTS) : ranked);
  const series = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const name = keep.has(label(r[1])) ? label(r[1]) : OTHER;
    if (!series.has(name)) series.set(name, Array<number | null>(categories.length).fill(null));
    const arr = series.get(name)!;
    const i = catIndex.get(label(r[0]))!;
    arr[i] = (arr[i] ?? 0) + (Number(r[2]) || 0);
  }
  return { categories, series };
}

export function buildOption(query: ChartQuery, display: WidgetDisplay, data: ChartData, t: ChartTokens): EChartsOption {
  const f = fmt(display);
  const rows = data.rows;
  const type = query.chart_type;
  const axis = baseAxisStyle(t);
  const timeLike = (query.date_grain && query.date_grain !== "none") || /date|timestamp/i.test(data.columns[0]?.type ?? "");

  if (type === "pie" || type === "donut") {
    const slices = rows.map((r) => ({ name: label(r[0]), value: Number(r[1]) || 0 }));
    const colors = colorMap(slices.map((s) => s.name), t);
    return {
      ...common(t, display.show_legend !== false),
      tooltip: { ...common(t, false).tooltip, trigger: "item", valueFormatter: f },
      series: [{
        type: "pie",
        radius: type === "donut" ? ["52%", "78%"] : [0, "78%"],
        center: ["50%", "56%"],
        data: slices.map((s) => ({ ...s, itemStyle: { color: colors.get(s.name) } })),
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: display.show_labels ?? false, color: t.muted, fontSize: 11, formatter: "{b}: {d}%" },
        labelLine: { lineStyle: { color: t.line } },
      }],
    };
  }

  if (type === "scatter") {
    const hasSeries = data.columns.length > 2;
    const groups = new Map<string, [number, number][]>();
    for (const r of rows) {
      const k = hasSeries ? label(r[2]) : data.columns[1]?.name ?? "value";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push([Number(r[0]), Number(r[1])]);
    }
    // Scatter colours are validated for <= 3 simultaneous series; beyond that, use the series breakdown sparingly.
    const colors = colorMap([...groups.keys()], t);
    return {
      ...common(t, groups.size > 1),
      tooltip: { ...common(t, false).tooltip, trigger: "item" },
      xAxis: { type: "value", name: display.x_label ?? query.x ?? "", nameLocation: "middle", nameGap: 24, scale: true, ...axis },
      yAxis: { type: "value", name: display.y_label ?? query.y ?? "", scale: true, ...axis, axisLabel: { ...axis.axisLabel, formatter: f } },
      series: [...groups.entries()].map(([name, pts]) => ({
        name, type: "scatter", data: pts, symbolSize: 8,
        itemStyle: { color: colors.get(name), opacity: 0.75, borderColor: t.surface, borderWidth: 1 },
      })),
    };
  }

  if (type === "histogram") {
    return {
      ...common(t, false),
      tooltip: {
        ...common(t, false).tooltip, trigger: "item",
        formatter: (p: { dataIndex: number }) => {
          const r = rows[p.dataIndex] ?? [];
          return `${f(r[1])} – ${f(r[2])}<br/><b>${formatNumber(r[3], "integer")}</b> rows`;
        },
      },
      xAxis: { type: "category", data: rows.map((r) => f(r[1])), name: display.x_label ?? query.y ?? "", ...axis, splitLine: { show: false } },
      yAxis: { type: "value", name: display.y_label ?? "", ...axis },
      series: [{ type: "bar", data: rows.map((r) => Number(r[3])), barCategoryGap: "4%", itemStyle: { color: t.series[display.color_slot ?? 0], borderRadius: [4, 4, 0, 0] } }],
    };
  }

  if (type === "boxplot") {
    return {
      ...common(t, false),
      tooltip: { ...common(t, false).tooltip, trigger: "item" },
      xAxis: { type: "category", data: rows.map((r) => label(r[0])), ...axis, splitLine: { show: false } },
      yAxis: { type: "value", scale: true, ...axis, axisLabel: { ...axis.axisLabel, formatter: f } },
      series: [{
        type: "boxplot",
        data: rows.map((r) => [r[1], r[2], r[3], r[4], r[5]].map(Number)),
        itemStyle: { color: "transparent", borderColor: t.series[display.color_slot ?? 0], borderWidth: 2 },
      }],
    };
  }

  if (type === "heatmap") {
    const xs = [...new Set(rows.map((r) => label(r[0])))];
    const ys = [...new Set(rows.map((r) => label(r[1])))];
    const values = rows.map((r) => Number(r[2]) || 0);
    return {
      ...common(t, false),
      grid: { left: 8, right: 16, top: 14, bottom: 48, containLabel: true },
      tooltip: { ...common(t, false).tooltip, trigger: "item", valueFormatter: f },
      xAxis: { type: "category", data: xs, ...axis, splitLine: { show: false } },
      yAxis: { type: "category", data: ys, ...axis, splitLine: { show: false } },
      visualMap: {
        min: Math.min(0, ...values), max: Math.max(1, ...values), calculable: true, orient: "horizontal", left: "center", bottom: 0,
        itemHeight: 120, textStyle: { color: t.muted, fontSize: 11 },
        inRange: { color: ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"] }, // single-hue sequential ramp
      },
      series: [{
        type: "heatmap",
        data: rows.map((r) => [xs.indexOf(label(r[0])), ys.indexOf(label(r[1])), Number(r[2]) || 0]),
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 2 },
      }],
    };
  }

  // bar / stacked_bar / line / area
  const isBar = type === "bar" || type === "stacked_bar";
  const stacked = type === "stacked_bar" || (type === "area" && !!query.series);
  let categories: string[];
  let seriesData: Map<string, (number | null)[]>;
  if (query.series) {
    ({ categories, series: seriesData } = pivot(rows));
  } else {
    categories = rows.map((r) => label(r[0]));
    seriesData = new Map(data.columns.slice(1).map((c, i) => [c.name, rows.map((r) => (r[i + 1] === null ? null : Number(r[i + 1])))]));
  }
  const names = [...seriesData.keys()];
  const colors = colorMap(names, t);
  if (names.length === 1 && display.color_slot != null) colors.set(names[0]!, t.series[display.color_slot] ?? t.series[0]!);
  const showLegend = names.length > 1 && display.show_legend !== false;
  const lastIndex = names.length - 1;

  return {
    ...common(t, showLegend),
    tooltip: {
      ...common(t, false).tooltip,
      trigger: "axis",
      axisPointer: { type: isBar ? "shadow" : "line", lineStyle: { color: t.line }, shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      valueFormatter: f,
    },
    xAxis: {
      type: "category", data: categories, name: display.x_label ?? "", nameLocation: "middle", nameGap: 26,
      boundaryGap: isBar, ...axis, splitLine: { show: false },
    },
    yAxis: { type: "value", name: display.y_label ?? "", ...axis, axisLabel: { ...axis.axisLabel, formatter: f } },
    dataZoom: categories.length > 60 && timeLike ? [{ type: "inside" }] : [],
    series: names.map((name, i) => ({
      name,
      type: isBar ? "bar" : "line",
      data: seriesData.get(name),
      stack: stacked ? "total" : undefined,
      smooth: false,
      showSymbol: !isBar && categories.length <= 24,
      symbolSize: 8,
      connectNulls: false,
      lineStyle: isBar ? undefined : { width: 2 },
      areaStyle: type === "area" ? { opacity: stacked ? 0.85 : 0.18 } : undefined,
      barMaxWidth: 48,
      // Rounded ends only on the data end of the outermost stacked segment; 2px surface gaps between fills.
      itemStyle: {
        color: colors.get(name),
        borderColor: isBar ? t.surface : undefined,
        borderWidth: isBar ? (stacked ? 1 : 0) : 0,
        borderRadius: isBar ? (!stacked || i === lastIndex ? [4, 4, 0, 0] : 0) : undefined,
      },
      emphasis: { focus: "series" },
      label: display.show_labels ? { show: true, position: isBar && !stacked ? "top" : "inside", color: t.muted, fontSize: 10, formatter: (p: { value: unknown }) => f(p.value) } : undefined,
    })),
  };
}
