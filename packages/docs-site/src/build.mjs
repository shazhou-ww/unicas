import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as buildBundle } from "esbuild";
import { Marked } from "marked";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(SITE_ROOT, "dist");
/**
 * @typedef {"generated" | "glossary" | "markdown" | "openapi" | "package-reference"} PageKind
 * @typedef {"historical-or-legacy-reference" | "integration-guidance" | "operations-guidance" | "published-service-standard"} Lifecycle
 * @typedef {{
 *   route: string,
 *   title: string,
 *   navigation: string,
 *   lifecycle: Lifecycle,
 *   sourcePath: string,
 *   sourceOwner: string,
 *   kind: PageKind,
 * }} PageEntry
 */
const require = createRequire(import.meta.url);
const SPACE_OPENAPI_SOURCE = require.resolve("@unicas/space-protocol/openapi.json");

/** @type {PageEntry} */
const OVERVIEW = {
  route: "/",
  title: "Overview",
  navigation: "Overview",
  lifecycle: "published-service-standard",
  sourcePath: "packages/docs-site/src/build.mjs",
  sourceOwner: "@unicas/docs-site",
  kind: "generated",
};

/** @type {PageEntry} */
const API_REFERENCE = {
  route: "/app-user-api/reference/",
  title: "Space API Reference",
  navigation: "Integrate",
  lifecycle: "published-service-standard",
  sourcePath: "packages/space-protocol/openapi/app-space-v1.openapi.json",
  sourceOwner: "@unicas/space-protocol",
  kind: "openapi",
};

/** @type {PageEntry} */
const GLOSSARY = {
  route: "/glossary/",
  title: "UniCAS Glossary",
  navigation: "Reference",
  lifecycle: "published-service-standard",
  sourcePath: "GLOSSARY.md",
  sourceOwner: "repository",
  kind: "glossary",
};

/** @type {readonly PageEntry[]} */
export const DOCUMENTS = [
  { route: "/app-user-api/", title: "App-user API", navigation: "Integrate", lifecycle: "integration-guidance", sourcePath: "packages/docs-site/content/app-user-api/README.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/app-user-api/scenarios/", title: "App-user scenarios", navigation: "Integrate", lifecycle: "integration-guidance", sourcePath: "packages/docs-site/content/app-user-api/scenarios.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/app-user-api/http-api/", title: "App-user HTTP API", navigation: "Integrate", lifecycle: "integration-guidance", sourcePath: "packages/docs-site/content/app-user-api/http-api.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/app-user-api/authorization/", title: "App-user authorization", navigation: "Integrate", lifecycle: "integration-guidance", sourcePath: "packages/docs-site/content/app-user-api/authorization.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/app-user-api/migration-v2-to-v1/", title: "Prototype v2 migration", navigation: "Integrate", lifecycle: "historical-or-legacy-reference", sourcePath: "packages/docs-site/content/app-user-api/migration-v2-to-v1.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/cas-architecture/", title: "CAS Architecture", navigation: "Architecture", lifecycle: "published-service-standard", sourcePath: "packages/docs-site/content/cas-architecture.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/cas-binary-format/", title: "CAS Binary Format", navigation: "Architecture", lifecycle: "published-service-standard", sourcePath: "packages/docs-site/content/cas-binary-format.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/cas-state-protection-and-gc/", title: "State Protection and GC", navigation: "Architecture", lifecycle: "published-service-standard", sourcePath: "packages/docs-site/content/cas-state-protection-and-gc.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/domain-topology/", title: "Domain Topology", navigation: "Architecture", lifecycle: "published-service-standard", sourcePath: "packages/docs-site/content/domain-topology.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/terminology/", title: "Terminology", navigation: "Architecture", lifecycle: "published-service-standard", sourcePath: "packages/docs-site/content/terminology.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/cas-control-plane-cli/", title: "Control-Plane CLI", navigation: "Control plane", lifecycle: "integration-guidance", sourcePath: "packages/docs-site/content/cas-control-plane-cli.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/cas-control-plane-mcp/", title: "Control-Plane MCP", navigation: "Control plane", lifecycle: "integration-guidance", sourcePath: "packages/docs-site/content/cas-control-plane-mcp.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/cas-oauth-discovery-and-issuer-migration/", title: "OAuth Discovery and Issuer Migration", navigation: "Control plane", lifecycle: "operations-guidance", sourcePath: "packages/docs-site/content/cas-oauth-discovery-and-issuer-migration.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/cas-operations/", title: "Operations", navigation: "Operate", lifecycle: "operations-guidance", sourcePath: "packages/docs-site/content/cas-operations.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/deployment-and-local-configuration/", title: "Deployment and Local Configuration", navigation: "Operate", lifecycle: "operations-guidance", sourcePath: "packages/docs-site/content/deployment-and-local-configuration.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/observability/", title: "Observability", navigation: "Operate", lifecycle: "operations-guidance", sourcePath: "packages/docs-site/content/observability.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
  { route: "/cas-tenant-debug-tools/", title: "Legacy Tenant Debug Tools", navigation: "Operate", lifecycle: "historical-or-legacy-reference", sourcePath: "packages/docs-site/content/cas-tenant-debug-tools.md", sourceOwner: "@unicas/docs-site", kind: "markdown" },
];

/** @type {readonly PageEntry[]} */
const PACKAGE_REFERENCES = [
  { route: "/reference/packages/", title: "Package Boundaries", navigation: "Reference", lifecycle: "published-service-standard", sourcePath: "packages/README.md", sourceOwner: "repository", kind: "package-reference" },
  { route: "/reference/admin-protocol/", title: "Admin Protocol", navigation: "Reference", lifecycle: "published-service-standard", sourcePath: "packages/admin-protocol/README.md", sourceOwner: "@unicas/admin-protocol", kind: "package-reference" },
  { route: "/reference/space-protocol/", title: "Space Protocol", navigation: "Reference", lifecycle: "published-service-standard", sourcePath: "packages/space-protocol/README.md", sourceOwner: "@unicas/space-protocol", kind: "package-reference" },
  { route: "/reference/admin-cli/", title: "Administrator CLI", navigation: "Reference", lifecycle: "published-service-standard", sourcePath: "packages/admin-cli/README.md", sourceOwner: "@unicas/admin-cli", kind: "package-reference" },
];

/** @type {readonly PageEntry[]} */
export const PAGE_INVENTORY = [
  OVERVIEW,
  ...DOCUMENTS,
  API_REFERENCE,
  GLOSSARY,
  ...PACKAGE_REFERENCES,
];

/** @type {Map<string, string>} */
const knownSources = new Map([
  ...DOCUMENTS.map(({ sourcePath, route }) => /** @type {[string, string]} */(
    [sourcePath, route]
  )),
  ...PACKAGE_REFERENCES.map(({ sourcePath, route }) => /** @type {[string, string]} */(
    [sourcePath, route]
  )),
  /** @type {[string, string]} */ (["GLOSSARY.md", "/glossary/"]),
]);

class Slugger {
  /** @type {Map<string, number>} */
  #seen = new Map();

  /** @param {string} value */
  slug(value) {
    const base = value
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-|-$/g, "") || "section";
    const count = this.#seen.get(base) ?? 0;
    this.#seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  }
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {any[]} tokens
 * @returns {string}
 */
function plainText(tokens) {
  return tokens.map((token) => {
    if (typeof token.text === "string") return token.text;
    return Array.isArray(token.tokens) ? plainText(token.tokens) : "";
  }).join("");
}

/**
 * @param {string} sourcePath
 * @param {string} href
 */
function resolveMarkdownHref(sourcePath, href) {
  if (/^(?:https?:|mailto:)/.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [pathPart, fragment = ""] = href.split("#", 2);
  const normalized = relative(ROOT, resolve(dirname(join(ROOT, sourcePath)), pathPart)).replaceAll("\\", "/");
  const target = knownSources.get(normalized);
  if (target) return `${target}${fragment ? `#${fragment}` : ""}`;
  if (!existsSync(join(ROOT, normalized))) {
    throw new Error(`${sourcePath}: missing local link ${href}`);
  }
  return `https://github.com/shazhou-ww/unicas/blob/main/${normalized}${fragment ? `#${fragment}` : ""}`;
}

/**
 * @param {string} markdown
 * @param {string} sourcePath
 */
function renderMarkdown(markdown, sourcePath) {
  const slugger = new Slugger();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugger.slug(plainText(tokens));
        return `<h${depth} id="${id}"><a class="heading-link" href="#${id}" aria-label="Link to ${escapeHtml(plainText(tokens))}">#</a>${text}</h${depth}>`;
      },
      link({ href, title, tokens }) {
        const resolved = resolveMarkdownHref(sourcePath, href);
        const external = /^https?:/.test(resolved);
        const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
        const externalAttributes = external ? ' target="_blank" rel="noreferrer"' : "";
        return `<a href="${escapeHtml(resolved)}"${titleAttribute}${externalAttributes}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return /** @type {string} */ (marked.parse(markdown));
}

function navigation() {
  /** @type {Map<string, Array<readonly [string, string]>>} */
  const groups = new Map();
  for (const { route, title, navigation: group } of [...DOCUMENTS, API_REFERENCE]) {
    const entries = groups.get(group);
    if (entries) entries.push([route, title]);
    else groups.set(group, [[route, title]]);
  }
  const documentGroups = [...groups.entries()].map(([group, entries]) => `
    <section class="nav-group">
      <h2>${group}</h2>
      ${entries.map(([route, title]) => `<a href="${route}">${title}</a>`).join("\n")}
    </section>`).join("\n");
  const references = PACKAGE_REFERENCES.map(({ route, title }) => (
    `<a href="${route}">${title}</a>`
  )).join("\n");
  return `${documentGroups}
    <section class="nav-group reference-links">
      <h2>Reference</h2>
      <a href="/glossary/">Glossary</a>
      ${references}
    </section>`;
}

/**
 * @param {{ title: string, description: string, content: string, currentPath?: string }} options
 */
function shell({ title, description, content, currentPath = "" }) {
  const nav = navigation().replace(`href="${currentPath}"`, `href="${currentPath}" aria-current="page"`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${escapeHtml(description)}">
    <title>${escapeHtml(title)} | UniCAS Docs</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=Manrope:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/docs.css">
    <script src="/assets/docs.js" defer></script>
  </head>
  <body>
    <header class="topbar">
      <a class="wordmark" href="/"><span>U</span>UniCAS <b>DOCS</b></a>
      <div class="top-actions">
        <button class="menu-button" type="button" aria-label="Open documentation navigation" aria-expanded="false">Menu</button>
        <a href="https://console.unicas.work">Console</a>
        <a href="https://github.com/shazhou-ww/unicas">GitHub</a>
      </div>
    </header>
    <div class="layout">
      <aside class="sidebar" aria-label="Documentation navigation">
        <a class="overview-link" href="/">Overview</a>
        ${nav}
      </aside>
      <main class="content-shell">
        ${content}
      </main>
    </div>
  </body>
</html>`;
}

function overviewPage() {
  const cards = [...DOCUMENTS, API_REFERENCE].map(({ route, title, navigation: group }) => `
    <a class="doc-card" href="${route}">
      <span>${group}</span><strong>${title}</strong><small>Read document -&gt;</small>
    </a>`).join("\n");
  return shell({
    title: "Overview",
    description: "Architecture, protocol, deployment, and operations documentation for UniCAS.",
    currentPath: "/",
    content: `<section class="docs-hero">
      <p class="kicker">Content-addressed storage infrastructure</p>
      <h1>Build on the UniCAS contract.</h1>
      <p>Architecture, binary formats, access planes, deployment, and operations guidance from the repository's accepted documentation.</p>
      <div class="hero-links"><a href="/cas-architecture/">Start with architecture</a><a href="/deployment-and-local-configuration/">Deploy locally</a></div>
    </section>
    <section class="doc-grid" aria-label="Documentation index">${cards}</section>`,
  });
}

function apiReferencePage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Interactive OpenAPI reference for the UniCAS App-user Space API.">
    <title>Space API Reference | UniCAS Docs</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=Manrope:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/docs.css">
    <link rel="stylesheet" href="/assets/api-reference.css">
    <script type="module" src="/assets/api-reference.js"></script>
  </head>
  <body class="api-reference-page">
    <header class="topbar">
      <a class="wordmark" href="/"><span>U</span>UniCAS <b>DOCS</b></a>
      <nav class="top-actions" aria-label="API reference links">
        <a href="/app-user-api/">Integration guide</a>
        <a href="/openapi/app-space-v1.openapi.json">OpenAPI JSON</a>
        <a href="https://github.com/shazhou-ww/unicas">GitHub</a>
      </nav>
    </header>
    <main id="api-reference" aria-label="UniCAS Space API reference"></main>
  </body>
</html>`;
}

/**
 * @param {string} title
 * @param {string} description
 * @param {string} html
 * @param {string} sourcePath
 * @param {string} currentPath
 */
function articlePage(title, description, html, sourcePath, currentPath) {
  const tableOfContents = [...html.matchAll(/<h([23]) id="([^"]+)">.*?<\/h\1>/g)].map((match) => {
    const label = match[0].replace(/<[^>]+>/g, "").replace(/^#/, "");
    return `<a class="toc-depth-${match[1]}" href="#${match[2]}">${label}</a>`;
  }).join("\n");
  return shell({
    title,
    description,
    currentPath,
    content: `<div class="article-layout">
      <article class="document">
        <div class="document-meta"><span>UNICAS / DOCUMENTATION</span><a href="https://github.com/shazhou-ww/unicas/blob/main/${sourcePath}">Edit source</a></div>
        ${html}
      </article>
      <aside class="page-toc" aria-label="On this page"><strong>On this page</strong>${tableOfContents}</aside>
    </div>`,
  });
}

/** @param {string} source */
function glossaryMarkdown(source) {
  const sections = ["## Data model and storage", "## Identity and access"];
  const extracted = sections.map((heading) => {
    const start = source.indexOf(heading);
    if (start === -1) throw new Error(`GLOSSARY.md: missing ${heading}`);
    const next = source.indexOf("\n## ", start + heading.length);
    return source.slice(start, next === -1 ? undefined : next).trim();
  });
  const curated = extracted.join("\n\n").replace(
    /See \[Capability Key Operations\]\(docs\/capability-key-operations\.md\) and\r?\n/,
    "See ",
  );
  return `# UniCAS Glossary\n\nCanonical storage, identity, and access terms extracted from the repository-wide glossary.\n\n${curated}`;
}

/**
 * @param {string} outputDir
 * @param {string} route
 * @param {string} html
 */
async function writePage(outputDir, route, html) {
  const directory = route === "/" ? outputDir : join(outputDir, route.slice(1));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), html);
}

/** @param {string} html */
function anchors(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

/**
 * @param {string} outputDir
 * @param {Map<string, string>} pages
 */
async function validateGeneratedLinks(outputDir, pages) {
  const failures = [];
  for (const [route, html] of pages) {
    for (const match of html.matchAll(/\shref="([^"]+)"/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:)/.test(href)) continue;
      const [targetPath, fragment = ""] = href.split("#", 2);
      const targetRoute = targetPath || route;
      const target = pages.get(targetRoute);
      if (!target) {
        const asset = targetPath.startsWith("/assets/") || targetPath.startsWith("/openapi/") || targetPath === "/favicon.svg";
        if (!asset) failures.push(`${route} -> ${href}`);
        continue;
      }
      if (fragment && !anchors(target).has(fragment)) failures.push(`${route} -> ${href}`);
    }
  }
  if (failures.length > 0) throw new Error(`generated links failed:\n${failures.join("\n")}`);
  await writeFile(join(outputDir, "link-check.json"), JSON.stringify({ pages: pages.size, failures: [] }, null, 2));
}

/** @param {string | undefined} configuredRevision */
function configuredSourceRevision(configuredRevision) {
  const revision = configuredRevision?.trim();
  if (!revision) return null;
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error("DOCS_SOURCE_REVISION must be a full 40-character Git commit");
  }
  return revision.toLowerCase();
}

/**
 * @param {string} [outputDir]
 * @param {{ sourceRevision?: string }} [options]
 */
export async function buildDocsSite(outputDir = DEFAULT_OUTPUT, options = {}) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(join(outputDir, "assets"), { recursive: true });
  const pages = new Map();
  pages.set("/", overviewPage());
  pages.set("/app-user-api/reference/", apiReferencePage());

  for (const { route, title, sourcePath } of DOCUMENTS) {
    const markdown = await readFile(join(ROOT, sourcePath), "utf8");
    pages.set(route, articlePage(title, title, renderMarkdown(markdown, sourcePath), sourcePath, route));
  }

  const glossary = glossaryMarkdown(await readFile(join(ROOT, "GLOSSARY.md"), "utf8"));
  pages.set("/glossary/", articlePage(
    "UniCAS Glossary",
    "Canonical UniCAS storage and access terms.",
    renderMarkdown(glossary, "GLOSSARY.md"),
    "GLOSSARY.md",
    "/glossary/",
  ));

  for (const { route, title, sourcePath } of PACKAGE_REFERENCES) {
    const markdown = await readFile(join(ROOT, sourcePath), "utf8");
    pages.set(route, articlePage(title, title, renderMarkdown(markdown, sourcePath), sourcePath, route));
  }

  for (const [route, html] of pages) await writePage(outputDir, route, html);
  for (const file of ["docs.css", "docs.js"]) {
    await copyFile(join(SITE_ROOT, "static", file), join(outputDir, "assets", file));
  }
  await mkdir(join(outputDir, "openapi"), { recursive: true });
  const openApi = await readFile(SPACE_OPENAPI_SOURCE);
  await writeFile(join(outputDir, "openapi", "app-space-v1.openapi.json"), openApi);
  await buildBundle({
    entryPoints: [join(SITE_ROOT, "static", "api-reference.js")],
    bundle: true,
    format: "esm",
    legalComments: "none",
    minify: true,
    outfile: join(outputDir, "assets", "api-reference.js"),
    platform: "browser",
  });
  await copyFile(join(SITE_ROOT, "static", "favicon.svg"), join(outputDir, "favicon.svg"));
  await writeFile(join(outputDir, "404.html"), shell({
    title: "Not found",
    description: "The requested UniCAS documentation page was not found.",
    content: '<section class="not-found"><p class="kicker">404 / NOT FOUND</p><h1>No document at this address.</h1><a href="/">Return to the documentation index</a></section>',
  }));
  await validateGeneratedLinks(outputDir, pages);
  const packageJson = JSON.parse(await readFile(join(SITE_ROOT, "package.json"), "utf8"));
  const artifactManifest = {
    schemaVersion: 1,
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    sourceRevision: configuredSourceRevision(options.sourceRevision ?? process.env.DOCS_SOURCE_REVISION),
    pages: PAGE_INVENTORY.map(({ route, title, navigation, sourcePath, sourceOwner, lifecycle }) => ({
      route,
      title,
      navigation,
      sourcePath,
      sourceOwner,
      lifecycle,
    })),
    openapi: {
      path: "openapi/app-space-v1.openapi.json",
      sha256: createHash("sha256").update(openApi).digest("hex"),
    },
    linkCheck: "link-check.json",
  };
  await writeFile(
    join(outputDir, "artifact-manifest.json"),
    `${JSON.stringify(artifactManifest, null, 2)}\n`,
  );
  return { outputDir, pageCount: pages.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildDocsSite().then(({ pageCount }) => {
    console.log(`Built ${pageCount} documentation pages in ${relative(ROOT, DEFAULT_OUTPUT)}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}