/** API contract types — mirror apps/api/app/schemas. */

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface AuthStatus {
  user: User | null;
  registration_open: boolean;
  has_users: boolean;
}

export type Role = "viewer" | "editor" | "owner";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  role: Role | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  summary: string | null;
  user_id: string | null;
  created_at: string;
}

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: string;
  project_id: string | null;
  job_type: string;
  status: JobStatus;
  progress: number | null;
  progress_message: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  cancel_requested: boolean;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ProjectOverview {
  project: Project;
  dataset_count: number;
  dashboard_count: number;
  saved_query_count: number;
  query_count: number;
  total_rows: number;
  avg_quality_score: number | null;
  datasets_with_issues: number;
  failed_datasets: number;
  activity: AuditEntry[];
  recent_jobs: Job[];
}

export interface Member {
  user_id: string;
  role: Role;
  created_at: string;
  email: string;
  display_name: string;
}

// ---------------------------------------------------------------- datasets
export type LogicalType = "string" | "integer" | "float" | "decimal" | "boolean" | "date" | "timestamp" | "unknown";

export interface Upload {
  id: string;
  original_filename: string;
  file_format: "csv" | "parquet" | "xlsx" | "xls" | "json";
  size_bytes: number;
  detected: { delimiter?: string; encoding?: string; sheets?: string[]; json_format?: string; columns?: number };
  created_at: string;
}

export interface ImportOptions {
  delimiter?: string | null;
  encoding?: "utf-8" | "utf-8-sig" | "latin-1" | "windows-1252" | "utf-16";
  has_header?: boolean;
  null_values?: string[];
  skip_rows?: number;
  sheet?: string | null;
  json_format?: "auto" | "records" | "ndjson";
  detect_dates?: boolean;
  type_overrides?: Record<string, LogicalType>;
}

export interface PreviewColumn {
  name: string;
  logical_type: LogicalType;
  physical_type: string;
}

export interface Preview {
  columns: PreviewColumn[];
  rows: unknown[][];
  warnings: string[];
  sample_size: number;
}

export interface DatasetColumn {
  position: number;
  name: string;
  logical_type: LogicalType;
  physical_type: string;
  null_count: number;
}

export interface DatasetVersion {
  id: string;
  version: number;
  storage_format: string;
  size_bytes: number;
  row_count: number;
  column_count: number;
  content_hash: string;
  source_id: string | null;
  import_options: ImportOptions;
  warnings: string[];
  job_id: string | null;
  profiled_at: string | null;
  created_at: string;
  columns?: DatasetColumn[];
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  table_name: string;
  description: string | null;
  status: "importing" | "ready" | "failed";
  current_version: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  row_count: number | null;
  column_count: number | null;
  size_bytes: number | null;
  quality_score: number | null;
  source_filename: string | null;
  source_format: string | null;
}

export interface DatasetDetail extends Dataset {
  version: (DatasetVersion & { columns: DatasetColumn[] }) | null;
  versions: DatasetVersion[];
}

export interface QualityIssue {
  severity: "high" | "medium" | "low" | "info";
  message: string;
}

export interface ColumnProfile {
  name: string;
  logical_type: LogicalType;
  physical_type: string;
  null_count: number;
  null_pct: number;
  distinct_count: number;
  distinct_approximate: boolean;
  min?: number | string | null;
  max?: number | string | null;
  mean?: number | null;
  std?: number | null;
  median?: number | null;
  quantiles?: Record<"p05" | "p25" | "p50" | "p75" | "p95", number | null>;
  histogram?: { start: number | string; end: number | string; count: number }[];
  top_values?: { value: unknown; count: number }[];
  outlier_count?: number;
  outlier_bounds?: { lower: number; upper: number };
  infinite_count?: number;
  nan_count?: number;
  empty_string_count?: number;
  invalid_count?: number;
  invalid_examples?: string[];
  min_length?: number | null;
  max_length?: number | null;
  mean_length?: number | null;
  true_count?: number | null;
  quality: { completeness: number; validity: number; score: number; issues: QualityIssue[] };
}

export interface Profile {
  row_count: number;
  column_count: number;
  duplicate_rows: number;
  duplicate_pct: number;
  missing_cells: number;
  missing_pct: number;
  quality_score: number | null;
  distinct_method: "exact" | "hyperloglog";
  computed_at: string;
  columns: ColumnProfile[];
}

export type FilterOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "between" | "contains" | "starts_with"
  | "is_null" | "not_null";

export interface ColumnFilter {
  column: string;
  op: FilterOp;
  value?: unknown;
  values?: unknown[];
}

export interface ResultColumn {
  name: string;
  type: string;
}

export interface RowsResult {
  columns: ResultColumn[];
  rows: unknown[][];
  total: number;
  offset: number;
  limit: number;
  duration_ms: number;
}

// ---------------------------------------------------------------- SQL
export interface SchemaTable {
  dataset_id: string;
  table_name: string;
  name: string;
  version: number;
  row_count: number;
  columns: { name: string; logical_type: LogicalType; physical_type: string }[];
}

export interface QueryResult {
  history_id: string;
  columns: ResultColumn[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  max_rows: number;
  duration_ms: number;
  tables: string[];
}

export interface SavedQuery {
  id: string;
  name: string;
  description: string | null;
  sql: string;
  created_at: string;
  updated_at: string;
}

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  status: "succeeded" | "failed" | "rejected" | "cancelled";
  duration_ms: number | null;
  row_count: number | null;
  truncated: boolean;
  error_message: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- dashboards
export type ChartType =
  | "kpi" | "bar" | "stacked_bar" | "line" | "area" | "pie" | "donut" | "scatter" | "histogram" | "table"
  | "heatmap" | "boxplot";
export type Aggregation = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "median";
export type DateGrain = "none" | "day" | "week" | "month" | "quarter" | "year";

export interface Measure {
  column: string | null;
  agg: Aggregation;
  label?: string | null;
}

export interface ChartQuery {
  chart_type: ChartType;
  dimension?: string | null;
  date_grain?: DateGrain;
  series?: string | null;
  measures: Measure[];
  x?: string | null;
  y?: string | null;
  bins?: number;
  sort?: { by: "dimension" | "measure"; direction: "asc" | "desc" } | null;
  limit?: number;
  include_nulls?: boolean;
  filters?: ColumnFilter[];
}

export type NumberFormat = "auto" | "compact" | "integer" | "decimal" | "percent" | "currency";

export interface WidgetDisplay {
  number_format?: NumberFormat;
  currency?: string;
  show_legend?: boolean;
  show_labels?: boolean;
  x_label?: string;
  y_label?: string;
  color_slot?: number;
}

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Widget {
  id: string;
  dataset_id: string | null;
  chart_type: ChartType;
  title: string;
  position: number;
  config: { query: ChartQuery; display: WidgetDisplay };
  layout: LayoutBox;
}

export interface DashboardFilterDef {
  id: string;
  dataset_id: string;
  column: string;
  filter_type: "date_range" | "category";
  label: string;
  position: number;
  default_value: Record<string, unknown> | null;
}

export interface Dashboard {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  widget_count: number;
}

export interface DashboardDetail extends Dashboard {
  widgets: Widget[];
  filters: DashboardFilterDef[];
}

export interface ActiveFilter {
  dataset_id: string;
  filter: ColumnFilter;
}

export interface ChartData {
  columns: ResultColumn[];
  rows: unknown[][];
  truncated: boolean;
  duration_ms: number;
  sql: string;
  applied_filters: number;
  dataset: { id: string; name: string; table_name: string; version: number };
}
