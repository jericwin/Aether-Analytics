/** Captures README screenshots from the synthetic demo project. Run: AETHER_SCREENSHOTS=1 npx playwright test screenshots */
import { expect, test } from "@playwright/test";

test.skip(!process.env.AETHER_SCREENSHOTS, "set AETHER_SCREENSHOTS=1 to capture screenshots");

const OUT = "../../docs/screenshots";

test("capture demo screenshots", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  const createLink = page.getByRole("button", { name: "Create one" });
  if (await createLink.isVisible().catch(() => false)) await createLink.click();
  await page.getByLabel("Name").fill("Demo");
  await page.getByLabel("Email").fill(`demo${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Explore with demo data" }).click();
  await expect(page.getByText("Synthetic demo data")).toBeVisible();
  const pid = page.url().split("/projects/")[1]!;

  await page.goto(`/projects/${pid}/data`);
  await expect(page.getByText("Importing")).toHaveCount(0, { timeout: 120_000 });

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((t) => { localStorage.setItem("aether.theme", t); }, theme);
    await page.goto(`/projects/${pid}/dashboards`);
    await page.getByRole("link", { name: /Open Retail performance/ }).click();
    await expect(page.getByRole("heading", { name: "Monthly revenue" })).toBeVisible();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/dashboard-${theme}.png` });
  }
  await page.goto(`/projects/${pid}/data`);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("tab", { name: /Profile/ }).click();
  await expect(page.getByText("Quality score")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/profile-light.png` });
  await page.evaluate(() => localStorage.setItem("aether.theme", "dark"));
  await page.goto(`/projects/${pid}/sql`);
  await page.getByRole("code").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("SELECT p.category,\n       round(sum(i.line_revenue), 2) AS revenue,\n       rank() OVER (ORDER BY sum(i.line_revenue) DESC) AS rnk\nFROM order_items i\nJOIN products p USING (product_id)\nGROUP BY 1\nORDER BY rnk");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("5 rows")).toBeVisible();
  await page.screenshot({ path: `${OUT}/sql-dark.png` });
});
