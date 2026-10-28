import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";

const LABELS: Record<string, string> = {
  projects: "Projects",
  data: "Data",
  sql: "SQL Workbench",
  dashboards: "Dashboards",
  members: "Members",
  jobs: "Activity & Jobs",
  settings: "Settings",
};

/** Derives breadcrumbs from the URL; IDs are shown as the project name or a short label. */
export function Breadcrumbs({ projectName }: { projectName?: string }) {
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; to: string }[] = [];
  parts.forEach((part, i) => {
    const to = "/" + parts.slice(0, i + 1).join("/");
    if (LABELS[part]) crumbs.push({ label: LABELS[part], to });
    else if (parts[i - 1] === "projects") crumbs.push({ label: projectName ?? "Project", to });
    else if (parts[i - 1] === "data") crumbs.push({ label: "Dataset", to });
    else if (parts[i - 1] === "dashboards") crumbs.push({ label: "Dashboard", to });
  });
  if (!crumbs.length) crumbs.push({ label: "Home", to: "/" });

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => (
          <Fragment key={c.to}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />}
            <li className="min-w-0">
              {i === crumbs.length - 1 ? (
                <span className="block truncate font-medium text-fg" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <Link to={c.to} className="block truncate text-muted hover:text-fg">
                  {c.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
