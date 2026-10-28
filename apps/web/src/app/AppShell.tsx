import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Database,
  FolderKanban,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  SquareTerminal,
  Sun,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/menu";
import { useTheme } from "@/hooks/useTheme";
import { cn, safeStorage } from "@/lib/utils";
import { useAuthStatus, useJobs, useLogout, useProject } from "@/services/hooks";

import { Breadcrumbs } from "./Breadcrumbs";

function NavItem({ to, icon, label, collapsed, end }: { to: string; icon: ReactNode; label: string; collapsed: boolean; end?: boolean }) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
          isActive ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-3 hover:text-fg",
          collapsed && "justify-center px-0",
        )
      }
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="mx-2 my-2 h-px bg-line" />;
  return <div className="px-2.5 pt-4 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">{children}</div>;
}

function JobIndicator() {
  const { data } = useJobs({ status: "active", limit: 20 });
  const active = data?.items ?? [];
  if (!active.length) return null;
  const running = active.find((j) => j.status === "running");
  return (
    <Link
      to="/jobs"
      className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-fg"
      aria-live="polite"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-accent" />
      </span>
      <span className="hidden sm:inline">
        {active.length} job{active.length > 1 ? "s" : ""} {running ? "running" : "queued"}
        {running?.progress != null && ` · ${Math.round(running.progress * 100)}%`}
      </span>
    </Link>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => safeStorage.get("aether.sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { data: auth } = useAuthStatus();
  const logout = useLogout();
  const { resolved, setPref } = useTheme();
  const projectMatch = useMatch("/projects/:projectId/*");
  const projectId = projectMatch?.params.projectId;
  const { data: project } = useProject(projectId);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => safeStorage.set("aether.sidebar", collapsed ? "collapsed" : "expanded"), [collapsed]);

  const isCollapsed = collapsed && !mobileOpen;
  const base = projectId ? `/projects/${projectId}` : null;

  const sidebar = (
    <nav
      aria-label="Primary"
      className={cn(
        "flex h-full flex-col border-r border-line bg-surface transition-[width] duration-150",
        isCollapsed ? "w-14" : "w-60",
      )}
    >
      <div className={cn("flex h-12 items-center gap-2 border-b border-line px-3", isCollapsed && "justify-center px-0")}>
        <img src="/favicon.svg" alt="" className="size-6" />
        {!isCollapsed && <span className="text-[14px] font-semibold tracking-tight">Aether Analytics</span>}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <NavItem to="/" end icon={<Home />} label="Home" collapsed={isCollapsed} />
        <NavItem to="/projects" end icon={<FolderKanban />} label="Projects" collapsed={isCollapsed} />
        {base && (
          <>
            <SectionLabel collapsed={isCollapsed}>
              <span className="block truncate normal-case">{project?.name ?? "Project"}</span>
            </SectionLabel>
            <NavItem to={base} end icon={<Activity />} label="Overview" collapsed={isCollapsed} />
            <NavItem to={`${base}/data`} icon={<Database />} label="Data" collapsed={isCollapsed} />
            <NavItem to={`${base}/sql`} icon={<SquareTerminal />} label="SQL Workbench" collapsed={isCollapsed} />
            <NavItem to={`${base}/dashboards`} icon={<LayoutDashboard />} label="Dashboards" collapsed={isCollapsed} />
            <NavItem to={`${base}/members`} icon={<Users />} label="Members" collapsed={isCollapsed} />
          </>
        )}
        <SectionLabel collapsed={isCollapsed}>Workspace</SectionLabel>
        <NavItem to="/jobs" icon={<Activity />} label="Activity & Jobs" collapsed={isCollapsed} />
        <NavItem to="/settings" icon={<Settings />} label="Settings" collapsed={isCollapsed} />
      </div>
      <div className="hidden border-t border-line p-2 lg:block">
        <Button
          variant="ghost"
          size="sm"
          className={cn("w-full", isCollapsed ? "justify-center px-0" : "justify-start")}
          onClick={() => setCollapsed((c) => !c)}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          icon={isCollapsed ? <ChevronRight /> : <ChevronLeft />}
        >
          {!isCollapsed && "Collapse"}
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full overflow-hidden print:h-auto print:overflow-visible">
      <a href="#main" className="sr-only z-50 rounded bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <div className="hidden lg:block print:hidden">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="relative h-full w-60">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4 print:hidden">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <Breadcrumbs projectName={project?.name} />
          <div className="ml-auto flex items-center gap-2">
            <JobIndicator />
            <Tooltip content={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle theme"
                onClick={() => setPref(resolved === "dark" ? "light" : "dark")}
              >
                {resolved === "dark" ? <Sun /> : <Moon />}
              </Button>
            </Tooltip>
            <MenuRoot>
              <MenuTrigger asChild>
                <button
                  className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                  aria-label="Account menu"
                >
                  {auth?.user?.display_name.slice(0, 1).toUpperCase() ?? "?"}
                </button>
              </MenuTrigger>
              <MenuContent>
                <div className="px-2 py-1.5">
                  <div className="text-[13px] font-medium">{auth?.user?.display_name}</div>
                  <div className="text-xs text-muted">{auth?.user?.email}</div>
                </div>
                <MenuSeparator />
                <MenuItem icon={<Settings />} onSelect={() => navigate("/settings")}>
                  Settings
                </MenuItem>
                <MenuItem
                  icon={<LogOut />}
                  onSelect={() =>
                    logout.mutate(undefined, {
                      onSuccess: () => navigate("/login"),
                      onError: () => toast.error("Sign out failed"),
                    })
                  }
                >
                  Sign out
                </MenuItem>
              </MenuContent>
            </MenuRoot>
          </div>
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-auto print:overflow-visible">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
