/** Visual review captures for public pages. Run: AETHER_DESIGN=1 npx playwright test design */
import { test } from "@playwright/test";

test.skip(!process.env.AETHER_DESIGN, "set AETHER_DESIGN=1 to capture design review screenshots");
const OUT = process.env.AETHER_DESIGN_OUT ?? "test-results/design";

test("public pages", async ({ page, context }) => {
  for (const theme of ["dark", "light"] as const) {
    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("aether.theme", t), theme);
    await page.goto("/");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/landing-${theme}.png`, fullPage: true });
  }
  // An account must exist for the sign-in / register tabs to appear.
  await page.request.post("/api/v1/auth/register", { data: { email: `d${Date.now()}@example.com`, display_name: "D", password: "correct-horse-battery" } });
  await context.clearCookies();
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((t) => localStorage.setItem("aether.theme", t), theme);
    await page.goto("/login");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/login-${theme}.png` });
  }
  await page.goto("/login?mode=register");
  await page.getByLabel("Password", { exact: true }).fill("Correct-Horse-9!");
  await page.screenshot({ path: `${OUT}/register-light.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("aether.theme", "dark"));
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/landing-mobile.png`, fullPage: true });
  await page.goto("/login");
  await page.screenshot({ path: `${OUT}/login-mobile.png` });
});
