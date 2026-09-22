import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: "./.playwright/test-results",
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
  },
});
