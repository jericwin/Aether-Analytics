import "./index.css";

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router-dom";
import { Toaster } from "sonner";

import { AppShell } from "@/app/AppShell";
import { Spinner } from "@/components/ui/feedback";
import { TooltipProvider } from "@/components/ui/menu";
import { AuthPage } from "@/features/auth/AuthPage";
import { HomePage } from "@/features/home/HomePage";
import { LandingPage } from "@/features/landing/LandingPage";
import { JobsPage } from "@/features/jobs/JobsPage";
import { MembersPage } from "@/features/projects/MembersPage";
import { ProjectOverviewPage } from "@/features/projects/ProjectOverviewPage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useTheme } from "@/hooks/useTheme";
import { ApiError } from "@/lib/api";
import { useAuthStatus } from "@/services/hooks";

// Heavy feature bundles (Monaco, ECharts, grid layout) load on demand.
const DatasetsPage = lazy(() => import("@/features/datasets/DatasetsPage"));
const DatasetDetailPage = lazy(() => import("@/features/datasets/DatasetDetailPage"));
const SqlWorkbench = lazy(() => import("@/features/sql-workbench/SqlWorkbench"));
const DashboardsPage = lazy(() => import("@/features/dashboards/DashboardsPage"));
const DashboardEditor = lazy(() => import("@/features/dashboards/DashboardEditor"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
  queryCache: new QueryCache(),
});

window.addEventListener("aether:unauthorized", () => {
  void queryClient.invalidateQueries({ queryKey: ["auth"] });
});

function RequireAuth() {
  const { data, isLoading, error } = useAuthStatus();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Starting Aether" />
      </div>
    );
  }
  if (error || !data?.user) {
    // Visitors see the landing page at the root; deep links still go to sign-in and return afterwards.
    if (location.pathname === "/") return <LandingPage />;
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <Spinner />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function NotFound() {
  return (
    <div className="p-10 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <a className="mt-2 inline-block text-accent hover:underline" href="/">
        Go home
      </a>
    </div>
  );
}

const router = createBrowserRouter([
  { path: "/login", element: <AuthPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "projects", element: <ProjectsPage /> },
          { path: "projects/:projectId", element: <ProjectOverviewPage /> },
          { path: "projects/:projectId/data", element: <Lazy><DatasetsPage /></Lazy> },
          { path: "projects/:projectId/data/:datasetId", element: <Lazy><DatasetDetailPage /></Lazy> },
          { path: "projects/:projectId/sql", element: <Lazy><SqlWorkbench /></Lazy> },
          { path: "projects/:projectId/dashboards", element: <Lazy><DashboardsPage /></Lazy> },
          { path: "projects/:projectId/dashboards/:dashboardId", element: <Lazy><DashboardEditor /></Lazy> },
          { path: "projects/:projectId/members", element: <MembersPage /> },
          { path: "jobs", element: <JobsPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" richColors closeButton />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <ThemedToaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
