import { buildOption, colorMap, type ChartTokens, pivot } from "@/components/charts/chartOptions";
import { toActiveFilters } from "@/features/dashboards/FilterBar";
import { validateQuery } from "@/features/dashboards/WidgetConfigPanel";
import type { ChartData } from "@/types/api";

const tokens: ChartTokens = {
  surface: "#fff", text: "#111", muted: "#555", grid: "#eee", line: "#ccc", other: "#888",
  series: ["#s1", "#s2", "#s3", "#s4", "#s5", "#s6", "#s7", "#s8"],
};

function data(columns: [string, string][], rows: unknown[][]): ChartData {
  return { columns: columns.map(([name, type]) => ({ name, type })), rows, truncated: false, duration_ms: 1, sql: "", applied_filters: 0,
    dataset: { id: "d", name: "D", table_name: "d", version: 1 } };
}

describe("colorMap", () => {
  it("assigns colours by entity name, not by rank, so filtering never repaints survivors", () => {
    const all = colorMap(["South", "North", "East"], tokens);
    const filtered = colorMap(["North", "East"], tokens);
    expect(all.get("East")).toBe("#s1");
    expect(all.get("North")).toBe("#s2");
    expect(filtered.get("East")).toBe(all.get("East"));
    expect(filtered.get("North")).toBe(all.get("North"));
    expect(all.get("Other")).toBe("#888");
  });
});

describe("pivot", () => {
  it("pivots long rows and folds series beyond 7 into Other", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ["A", `s${i}`, 10 - i]);
    const { categories, series } = pivot(rows);
    expect(categories).toEqual(["A"]);
    expect(series.size).toBe(8);
    expect(series.get("Other")).toEqual([3 + 2 + 1]);
  });

  it("keeps all series when there are 8 or fewer", () => {
    const { series } = pivot([["A", "x", 1], ["B", "y", 2], ["B", "x", 3]]);
    expect(series.get("x")).toEqual([1, 3]);
    expect(series.get("y")).toEqual([null, 2]);
  });
});

describe("buildOption", () => {
  it("builds a single-series bar chart without a legend and with rounded data ends", () => {
    const opt = buildOption({ chart_type: "bar", dimension: "region", measures: [{ column: null, agg: "count" }] }, {},
      data([["region", "String"], ["count", "Int64"]], [["North", 3], ["East", 2]]), tokens) as Record<string, any>;
    expect(opt.legend.show).toBe(false);
    expect(opt.xAxis.data).toEqual(["North", "East"]);
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0].itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
    expect(opt.yAxis).not.toBeInstanceOf(Array); // never a dual axis
  });

  it("shows a legend for multi-series charts and stacks stacked bars", () => {
    const opt = buildOption({ chart_type: "stacked_bar", dimension: "r", series: "s", measures: [{ column: null, agg: "count" }] }, {},
      data([["r", "String"], ["s", "String"], ["count", "Int64"]], [["A", "x", 1], ["A", "y", 2]]), tokens) as Record<string, any>;
    expect(opt.legend.show).toBe(true);
    expect(opt.series.every((s: any) => s.stack === "total")).toBe(true);
  });

  it("renders donut slices with surface-coloured gaps", () => {
    const opt = buildOption({ chart_type: "donut", dimension: "c", measures: [{ column: null, agg: "count" }] }, {},
      data([["c", "String"], ["count", "Int64"]], [["Online", 5], [null, 1]]), tokens) as Record<string, any>;
    expect(opt.series[0].radius).toEqual(["52%", "78%"]);
    expect(opt.series[0].itemStyle.borderColor).toBe("#fff");
    expect(opt.series[0].data.map((d: any) => d.name)).toEqual(["Online", "(null)"]);
  });
});

describe("validateQuery", () => {
  const types = { region: "string", amount: "float", day: "date" };
  it("mirrors backend validation", () => {
    expect(validateQuery({ chart_type: "bar", measures: [{ column: null, agg: "count" }] }, types)).toMatch(/dimension/);
    expect(validateQuery({ chart_type: "bar", dimension: "region", measures: [{ column: "region", agg: "sum" }] }, types)).toMatch(/numeric/);
    expect(validateQuery({ chart_type: "line", dimension: "region", date_grain: "month", measures: [{ column: null, agg: "count" }] }, types)).toMatch(/date/);
    expect(validateQuery({ chart_type: "histogram", y: "amount", measures: [{ column: null, agg: "count" }] }, types)).toBeNull();
    expect(validateQuery({ chart_type: "bar", dimension: "gone", measures: [{ column: null, agg: "count" }] }, types)).toMatch(/no longer exists/);
  });
});

describe("toActiveFilters", () => {
  it("converts filter values into API filters", () => {
    const defs = [
      { id: "a", dataset_id: "d", column: "day", filter_type: "date_range" as const, label: "Day" },
      { id: "b", dataset_id: "d", column: "region", filter_type: "category" as const, label: "Region" },
      { id: "c", dataset_id: "d", column: "x", filter_type: "category" as const, label: "X" },
    ];
    const out = toActiveFilters(defs, { a: { from: "2024-01-01", to: "2024-03-31" }, b: { values: ["North"] }, c: { values: [] } });
    expect(out).toEqual([
      { dataset_id: "d", filter: { column: "day", op: "between", values: ["2024-01-01", "2024-03-31"] } },
      { dataset_id: "d", filter: { column: "region", op: "in", values: ["North"] } },
    ]);
    expect(toActiveFilters(defs, { a: { from: "2024-01-01" } })[0]?.filter).toEqual({ column: "day", op: "gte", value: "2024-01-01" });
  });
});
