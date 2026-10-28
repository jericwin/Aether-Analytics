/** TanStack Query hooks for every API domain. Components never call fetch directly. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  AuditEntry,
  AuthStatus,
  ChartData,
  ChartQuery,
  ActiveFilter,
  Dashboard,
  DashboardDetail,
  Dataset,
  DatasetDetail,
  ImportOptions,
  Job,
  Member,
  Page,
  Preview,
  Profile,
  Project,
  ProjectOverview,
  QueryHistoryEntry,
  Role,
  RowsResult,
  SavedQuery,
  SchemaTable,
  Upload,
  User,
  ColumnFilter,
} from "@/types/api";

export const keys = {
  auth: ["auth"] as const,
  projects: (params: object) => ["projects", params] as const,
  project: (id: string) => ["project", id] as const,
  overview: (id: string) => ["project", id, "overview"] as const,
  members: (id: string) => ["project", id, "members"] as const,
  activity: (id: string) => ["project", id, "activity"] as const,
  datasets: (pid: string) => ["project", pid, "datasets"] as const,
  dataset: (pid: string, id: string) => ["project", pid, "dataset", id] as const,
  profile: (pid: string, id: string, v?: number) => ["project", pid, "dataset", id, "profile", v ?? "current"] as const,
  rows: (pid: string, id: string, params: object) => ["project", pid, "dataset", id, "rows", params] as const,
  schema: (pid: string) => ["project", pid, "schema"] as const,
  saved: (pid: string) => ["project", pid, "saved-queries"] as const,
  history: (pid: string) => ["project", pid, "query-history"] as const,
  dashboards: (pid: string) => ["project", pid, "dashboards"] as const,
  dashboard: (pid: string, id: string) => ["project", pid, "dashboard", id] as const,
  chart: (pid: string, body: object) => ["project", pid, "chart", body] as const,
  values: (pid: string, ds: string, col: string, search: string) => ["project", pid, "values", ds, col, search] as const,
  jobs: (params: object) => ["jobs", params] as const,
};

// ---------------------------------------------------------------- auth
export function useAuthStatus() {
  return useQuery({ queryKey: keys.auth, queryFn: () => api.get<AuthStatus>("/auth/status"), staleTime: 60_000 });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<User>("/auth/login", body),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string; display_name: string }) => api.post<User>("/auth/register", body),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSuccess: () => {
      qc.clear();
      void qc.invalidateQueries({ queryKey: keys.auth });
    },
  });
}

// ---------------------------------------------------------------- projects
export function useProjects(params: { search?: string; status?: string } = {}) {
  const qs = new URLSearchParams({ limit: "200" });
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  return useQuery({
    queryKey: keys.projects(params),
    queryFn: () => api.get<Page<Project>>(`/projects?${qs.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({ queryKey: keys.project(id ?? ""), queryFn: () => api.get<Project>(`/projects/${id}`), enabled: !!id });
}

export function useOverview(id: string) {
  return useQuery({ queryKey: keys.overview(id), queryFn: () => api.get<ProjectOverview>(`/projects/${id}/overview`) });
}

export function useActivity(id: string) {
  return useQuery({
    queryKey: keys.activity(id),
    queryFn: () => api.get<Page<AuditEntry>>(`/projects/${id}/activity?limit=100`),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) => api.post<Project>("/projects", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useCreateDemoProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Project>("/projects/demo"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string | null; status?: "active" | "archived" }) =>
      api.patch<Project>(`/projects/${id}`, body),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: keys.project(p.id) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: keys.project(id) });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useMembers(pid: string) {
  return useQuery({ queryKey: keys.members(pid), queryFn: () => api.get<Member[]>(`/projects/${pid}/members`) });
}

export function useUpsertMember(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; role: Role }) => api.put<Member>(`/projects/${pid}/members`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(pid) }),
  });
}

export function useRemoveMember(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/projects/${pid}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(pid) }),
  });
}

// ---------------------------------------------------------------- datasets
export function useDatasets(pid: string) {
  return useQuery({
    queryKey: keys.datasets(pid),
    queryFn: () => api.get<Dataset[]>(`/projects/${pid}/datasets`),
    // Keep polling while any import is in flight.
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "importing") ? 1500 : false),
  });
}

export function useDataset(pid: string, id: string) {
  return useQuery({
    queryKey: keys.dataset(pid, id),
    queryFn: () => api.get<DatasetDetail>(`/projects/${pid}/datasets/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "importing" ? 1500 : false),
  });
}

export function useProfile(pid: string, id: string, version?: number, enabled = true) {
  const qs = version ? `?version=${version}` : "";
  return useQuery({
    queryKey: keys.profile(pid, id, version),
    queryFn: () =>
      api.get<{ version: number; profiled_at: string | null; profile: Profile | null }>(`/projects/${pid}/datasets/${id}/profile${qs}`),
    enabled,
  });
}

export interface RowsParams {
  version?: number;
  offset: number;
  limit: number;
  sort: [string, "asc" | "desc"][];
  filters: ColumnFilter[];
  columns?: string[] | null;
}

export function useRows(pid: string, id: string, params: RowsParams, enabled = true) {
  return useQuery({
    queryKey: keys.rows(pid, id, params),
    queryFn: ({ signal }) => api.post<RowsResult>(`/projects/${pid}/datasets/${id}/rows`, { ...params }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useUpload(pid: string) {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.post<Upload>(`/projects/${pid}/uploads`, form);
    },
  });
}

export function usePreview(pid: string) {
  return useMutation({
    mutationFn: ({ sourceId, options }: { sourceId: string; options: ImportOptions }) =>
      api.post<Preview>(`/projects/${pid}/uploads/${sourceId}/preview`, { options }),
  });
}

export function useStartImport(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { source_id: string; name: string; table_name?: string; description?: string; options: ImportOptions }) =>
      api.post<{ dataset: Dataset; job: Job }>(`/projects/${pid}/datasets`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.datasets(pid) });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useNewVersion(pid: string, datasetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { source_id: string; options: ImportOptions }) =>
      api.post<Job>(`/projects/${pid}/datasets/${datasetId}/versions`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.dataset(pid, datasetId) });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useUpdateDataset(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string | null }) =>
      api.patch<Dataset>(`/projects/${pid}/datasets/${id}`, body),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: keys.datasets(pid) });
      void qc.invalidateQueries({ queryKey: keys.dataset(pid, d.id) });
    },
  });
}

export function useDeleteDataset(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${pid}/datasets/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.datasets(pid) });
      void qc.invalidateQueries({ queryKey: keys.schema(pid) });
    },
  });
}

export function useReprofile(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Job>(`/projects/${pid}/datasets/${id}/profile`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

// ---------------------------------------------------------------- SQL
export function useSchema(pid: string) {
  return useQuery({ queryKey: keys.schema(pid), queryFn: () => api.get<SchemaTable[]>(`/projects/${pid}/schema`) });
}

export function useSavedQueries(pid: string) {
  return useQuery({ queryKey: keys.saved(pid), queryFn: () => api.get<SavedQuery[]>(`/projects/${pid}/saved-queries`) });
}

export function useQueryHistory(pid: string) {
  return useQuery({
    queryKey: keys.history(pid),
    queryFn: () => api.get<Page<QueryHistoryEntry>>(`/projects/${pid}/query-history?limit=100`),
  });
}

export function useSaveQuery(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string; name: string; sql: string; description?: string | null }) =>
      id ? api.patch<SavedQuery>(`/projects/${pid}/saved-queries/${id}`, body) : api.post<SavedQuery>(`/projects/${pid}/saved-queries`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.saved(pid) }),
  });
}

export function useDeleteSavedQuery(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${pid}/saved-queries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.saved(pid) }),
  });
}

// ---------------------------------------------------------------- dashboards
export function useDashboards(pid: string) {
  return useQuery({ queryKey: keys.dashboards(pid), queryFn: () => api.get<Dashboard[]>(`/projects/${pid}/dashboards`) });
}

export function useDashboard(pid: string, id: string) {
  return useQuery({
    queryKey: keys.dashboard(pid, id),
    queryFn: () => api.get<DashboardDetail>(`/projects/${pid}/dashboards/${id}`),
    staleTime: Infinity, // the editor owns local state once loaded
  });
}

export function useCreateDashboard(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) => api.post<DashboardDetail>(`/projects/${pid}/dashboards`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.dashboards(pid) }),
  });
}

export function useDeleteDashboard(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${pid}/dashboards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.dashboards(pid) }),
  });
}

export function useDuplicateDashboard(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<DashboardDetail>(`/projects/${pid}/dashboards/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.dashboards(pid) }),
  });
}

export function useChartData(pid: string, datasetId: string | null, query: ChartQuery | null, filters: ActiveFilter[]) {
  const body = { dataset_id: datasetId, query, dashboard_filters: filters };
  return useQuery({
    queryKey: keys.chart(pid, body),
    queryFn: ({ signal }) => api.post<ChartData>(`/projects/${pid}/charts/data`, body, { signal }),
    enabled: !!datasetId && !!query,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
}

export function useColumnValues(pid: string, datasetId: string, column: string, search: string, enabled = true) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return useQuery({
    queryKey: keys.values(pid, datasetId, column, search),
    queryFn: () =>
      api.get<{ value: unknown; count: number }[]>(
        `/projects/${pid}/datasets/${datasetId}/columns/${encodeURIComponent(column)}/values${qs}`,
      ),
    enabled: enabled && !!datasetId && !!column,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------- jobs
export function useJobs(params: { project_id?: string; status?: string; limit?: number } = {}) {
  const qs = new URLSearchParams({ limit: String(params.limit ?? 50) });
  if (params.project_id) qs.set("project_id", params.project_id);
  if (params.status) qs.set("status", params.status);
  return useQuery({
    queryKey: keys.jobs(params),
    queryFn: () => api.get<Page<Job>>(`/jobs?${qs.toString()}`),
    // Poll quickly while work is active, slowly otherwise.
    refetchInterval: (q) => (q.state.data?.items.some((j) => j.status === "pending" || j.status === "running") ? 1500 : 10_000),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Job>(`/jobs/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
