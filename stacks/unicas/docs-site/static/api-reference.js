import { createApiReference } from "@scalar/api-reference";
import "@scalar/api-reference/style.css";

createApiReference("#api-reference", {
  url: "/openapi/space-v2.openapi.json",
  theme: "default",
  layout: "modern",
  darkMode: false,
  hideDarkModeToggle: true,
  hideDownloadButton: false,
  showSidebar: true,
  showDeveloperTools: "never",
  defaultOpenAllTags: false,
  persistAuth: false,
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  customCss: `
    :root {
      --scalar-color-accent: #315fe8;
      --scalar-background-1: #fffefa;
      --scalar-background-2: #f7f6f1;
      --scalar-background-3: #ecebe4;
      --scalar-border-color: #d7d5cc;
      --scalar-radius: 4px;
      --scalar-font: "Manrope", sans-serif;
      --scalar-font-code: "IBM Plex Mono", monospace;
    }
  `,
  metaData: {
    title: "UniCAS Space API Reference",
    description: "Interactive OpenAPI reference for the UniCAS App-user Space API.",
  },
});