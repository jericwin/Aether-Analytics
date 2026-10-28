import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Every run gets a fresh metadata DB and storage directory; the API serves the built web app.
const dataDir = process.env.AETHER_E2E_DIR ?? mkdtempSync(join(tmpdir(), "aether-e2e-"));
process.env.AETHER_E2E_DIR = dataDir;
const PORT = 8765;
// Set E2E_BASE_URL to test an already-running deployment (e.g. the docker compose stack).
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: external ? undefined : {
    command: `uv run --directory ../api aether serve --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      AETHER_DATABASE_URL: `sqlite:///${join(dataDir, "e2e.db").replace(/\\/g, "/")}`,
      AETHER_STORAGE_DIR: join(dataDir, "storage"),
      AETHER_WORKER_MODE: "embedded",
      AETHER_LOG_LEVEL: "WARNING",
      AETHER_RATE_LIMIT_AUTH_PER_MINUTE: "1000",
    },
  },
});
