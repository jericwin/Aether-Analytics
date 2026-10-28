import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const SALES = [
  "order_id,order_date,region,product,quantity,unit_price",
  "1,2024-01-05,North,Widget,2,10.00",
  "2,2024-01-17,South,Gadget,1,25.50",
  "3,2024-02-03,North,Gadget,3,25.50",
  "4,2024-02-20,East,Widget,5,10.00",
  "5,2024-03-11,South,Widget,,10.00",
  "6,2024-03-28,North,Doohickey,1,99.99",
  "7,2024-04-02,East,Gadget,2,25.50",
  "8,2024-04-15,West,Widget,4,10.00",
].join("\n");

const PASSWORD = "correct-horse-battery";
let counter = 0;

/** Workflow F: fail if the app tries to reach anything other than the local server. */
async function isolateNetwork(context: BrowserContext, external: string[]) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    external.push(url.href);
    return route.abort();
  });
}

async function register(page: Page, name = "Ana") {
  counter += 1;
  const email = `${name.toLowerCase()}${Date.now()}${counter}@example.com`;
  await page.goto("/login");
  const createLink = page.getByRole("button", { name: "Create one" });
  if (await createLink.isVisible().catch(() => false)) await createLink.click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Welcome, ${name}`) })).toBeVisible();
  return email;
}

async function createProject(page: Page, name: string) {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return page.url().split("/projects/")[1]!.split("/")[0]!;
}

async function importCsv(page: Page, projectId: string, filename: string, content: string) {
  await page.goto(`/projects/${projectId}/data?import=1`);
  await page.getByLabel("Choose a file to import").setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from(content) });
  await expect(page.getByRole("grid", { name: "Import preview" })).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Ready").first()).toBeVisible({ timeout: 30_000 });
}

test("Workflow A + F: dataset to dashboard, persisted, fully offline", async ({ page, context }) => {
  const external: string[] = [];
  await isolateNetwork(context, external);
  await register(page);
  const pid = await createProject(page, "Sales analysis");
  await importCsv(page, pid, "sales.csv", SALES);

  // Inspect data: server-side grid + profile
  const grid = page.getByRole("grid", { name: "sales rows" });
  await expect(grid.getByText("Doohickey")).toBeVisible();
  await expect(page.getByText(/^8 rows · \d+ ms$/)).toBeVisible();
  await page.getByRole("tab", { name: /Profile/ }).click();
  await expect(page.getByText("Quality score")).toBeVisible();
  await expect(page.getByRole("heading", { name: "quantity" })).toBeVisible();

  // Create a dashboard with a configured chart and a category filter
  await page.goto(`/projects/${pid}/dashboards`);
  await page.getByRole("button", { name: "New dashboard" }).first().click();
  await page.getByLabel("Dashboard name").fill("Regional sales");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: "Add chart" }).first().click();
  const panel = page.getByRole("complementary", { name: "Widget configuration" });
  await panel.getByLabel("Title").fill("Units by region");
  await panel.getByLabel("Dimension").selectOption("region");
  await panel.getByLabel("Aggregation 1").selectOption("sum");
  await panel.getByLabel("Measure column 1").selectOption("quantity");
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("region");
  await page.getByRole("button", { name: "Add filter" }).last().click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Dashboard saved")).toBeVisible();

  // Reload: layout, widget config and filter persist; data is real
  await page.reload();
  await expect(page.getByRole("heading", { name: "Units by region" })).toBeVisible();
  await page.getByRole("button", { name: "Show as table" }).click();
  const table = page.getByRole("grid", { name: "Units by region data" });
  await expect(table.getByText("East")).toBeVisible();
  await expect(table.getByText("West")).toBeVisible();

  // Filter updates the chart through a real query
  await page.getByRole("toolbar", { name: "Dashboard filters" }).getByRole("button", { name: "region", exact: true }).click();
  await page.getByRole("checkbox", { name: "North" }).check();
  await page.keyboard.press("Escape");
  await expect(table.getByText("West")).toBeHidden();
  await expect(table.getByText("North")).toBeVisible();
  await expect(table.getByText("6", { exact: true })).toBeVisible();

  expect(external, "no external network requests").toEqual([]);
});

test("Workflow C: SQL analytics with saved query and export", async ({ page }) => {
  await register(page, "Sam");
  const pid = await createProject(page, "SQL project");
  await importCsv(page, pid, "sales.csv", SALES);
  await page.goto(`/projects/${pid}/sql`);
  const editor = page.getByRole("code").first();
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText("SELECT region, sum(quantity) AS units FROM sales GROUP BY region ORDER BY units DESC");
  await page.getByRole("button", { name: "Run" }).click();
  const results = page.getByRole("grid", { name: "Query results" });
  await expect(results.getByText("East")).toBeVisible();
  await expect(page.getByText("4 rows")).toBeVisible();

  // Malicious SQL is rejected by the backend
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("COPY sales TO 'C:/temp/x.csv'");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText(/not allowed/)).toBeVisible();

  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("SELECT region, count(*) AS n FROM sales GROUP BY 1 ORDER BY 1");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Query name").fill("Orders per region");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText('Saved "Orders per region"')).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /^Orders per region SELECT/ }).click();
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("grid", { name: "Query results" }).getByText("West")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const path = await file.path();
  const text = (await import("node:fs")).readFileSync(path!, "utf8");
  expect(text.trim().split(/\r?\n/)).toEqual(["region,n", "East,2", "North,3", "South,2", "West,1"]);
});

test("Workflow E: another user cannot access a private project", async ({ page, browser }) => {
  await register(page, "Owner");
  const pid = await createProject(page, "Confidential");
  const other = await browser.newContext();
  const intruder = await other.newPage();
  await register(intruder, "Mallory");
  await intruder.goto(`/projects/${pid}`);
  await expect(intruder.getByText("Project not found")).toBeVisible();
  const status = await intruder.evaluate(async (id) => (await fetch(`/api/v1/projects/${id}/datasets`)).status, pid);
  expect(status).toBe(404);
  await other.close();
});
