/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.AETHER_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": "/src" } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Same-origin proxy: session cookies and CSRF work without cross-site configuration.
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
  build: {
    // Monaco is ~2.7 MB but only loads on the SQL route (lazy); see docs/DEVELOPMENT.md.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("monaco-editor")) return "monaco";
          if (id.includes("echarts") || id.includes("zrender")) return "echarts";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    css: false,
  },
});
