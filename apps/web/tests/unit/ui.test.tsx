import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { DataGrid } from "@/components/DataGrid";
import { StatusBadge } from "@/components/ui/feedback";
import { TooltipProvider } from "@/components/ui/menu";
import { loginSchema, passwordStrength, registerSchema } from "@/features/auth/AuthPage";
import { suggestTableName } from "@/features/datasets/ImportWizard";
import { CreateProjectDialog } from "@/features/projects/CreateProjectDialog";
import { ApiError, api } from "@/lib/api";
import { formatBytes, formatNumber } from "@/lib/format";

// jsdom lacks ResizeObserver, used by the virtualiser
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("formatting", () => {
  it("formats numbers and bytes", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(1234.567, "integer")).toBe("1,235");
    expect(formatNumber(0.256, "percent")).toBe("25.6%");
    expect(formatNumber(2_500_000, "compact")).toBe("2.5M");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
  it("derives safe SQL table names", () => {
    expect(suggestTableName("Q1 Sales (final).csv")).toBe("q1_sales_final");
    expect(suggestTableName("2024 orders")).toBe("t_2024_orders");
  });
});

describe("form schemas", () => {
  it("validates login and registration", () => {
    expect(loginSchema.safeParse({ email: "bad", password: "" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.co", password: "short", display_name: "A" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.co", password: "long-enough-pw", display_name: "A" }).success).toBe(true);
  });
});

describe("StatusBadge", () => {
  it("never relies on colour alone", () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});

describe("DataGrid", () => {
  it("renders headers, null markers and reports sorting with shift state", async () => {
    const onSort = vi.fn();
    render(<DataGrid label="Results" columns={[{ name: "region", type: "String" }, { name: "n", type: "Int64" }]} rows={[["North", 3], [null, 1]]} onSort={onSort} />);
    expect(screen.getByRole("grid", { name: "Results" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /region/ }));
    expect(onSort).toHaveBeenCalledWith("region", false);
  });
});

describe("CreateProjectDialog", () => {
  it("shows a validation error and does not submit an empty name", async () => {
    const spy = vi.spyOn(api, "post");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <MemoryRouter><CreateProjectDialog open onOpenChange={() => {}} /></MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("api client", () => {
  afterEach(() => vi.restoreAllMocks());
  it("sends the CSRF token on mutations and normalises errors", async () => {
    document.cookie = "aether_csrf=tok123";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "forbidden", message: "Nope", request_id: "r1", details: null } }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await api.post("/projects", { name: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("forbidden");
    expect((err as ApiError).requestId).toBe("r1");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok123");
  });
});

describe("passwordStrength", () => {
  it("scores length and character variety", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("short")).toBe(0);
    expect(passwordStrength("longenough")).toBe(1);
    expect(passwordStrength("longenoughpassw")).toBe(2);
    expect(passwordStrength("Longenough-Pass9")).toBe(4);
  });
});
