import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SITE_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(SITE_ROOT, "dist");

export const DOCUMENTS = [
  ["cas-architecture", "CAS Architecture", "Architecture"],
  ["cas-binary-format", "CAS Binary Format", "Architecture"],
  ["cas-state-protection-and-gc", "State Protection and GC", "Architecture"],
  ["domain-topology", "Domain Topology", "Architecture"],
  ["terminology", "Terminology", "Architecture"],
  ["cas-control-plane-cli", "Control-Plane CLI", "Control plane"],
  ["cas-control-plane-mcp", "Control-Plane MCP", "Control plane"],
  ["cas-oauth-discovery-and-issuer-migration", "OAuth Discovery and Issuer Migration", "Control plane"],
  ["cas-operations", "Operations", "Operate"],
  ["deployment-and-local-configuration", "Deployment and Local Configuration", "Operate"],
  ["observability", "Observability", "Operate"],
  ["cas-tenant-debug-tools", "Tenant Debug Tools", "Operate"],
];

const PACKAGE_REFERENCES = [
  ["packages", "Package Boundaries", "packages/README.md"],
  ["admin-protocol", "Admin Protocol", "packages/admin-protocol/README.md"],
  ["tenant-protocol", "Tenant Protocol", "packages/tenant-protocol/README.md"],
  ["admin-cli", "Administrator CLI", "packages/admin-cli/README.md"],
];

const knownSources = new Map([
  ...DOCUMENTS.map(([slug]) => [`docs/${slug}.md`, `/${slug}/`]),
  ...PACKAGE_REFERENCES.map(([slug, , source]) => [source, `/reference/${slug}/`]),
  ["GLOSSARY.md", "/glossary/"],
]);

class Slugger {
  #seen = new Map();

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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function plainText(tokens) {
  return tokens.map((token) => {
    if (typeof token.text === "string") return token.text;
    return Array.isArray(token.tokens) ? plainText(token.tokens) : "";
  }).join("");
}

function resolveMarkdownHref(sourcePath, href) {
  if (/^(?:https?:|mailto:)/.test(href) || href.startsWith("#")) return href;
  const [pathPart, fragment = ""] = href.split("#", 2);
  const normalized = relative(ROOT, resolve(dirname(join(ROOT, sourcePath)), pathPart)).replaceAll("\\", "/");
  const target = knownSources.get(normalized);
  if (target) return `${target}${fragment ? `#${fragment}` : ""}`;
  if (!existsSync(join(ROOT, normalized))) {
    throw new Error(`${sourcePath}: missing local link ${href}`);
  }
  return `https://github.com/shazhou-ww/unicas/blob/main/${normalized}${fragment ? `#${fragment}` : ""}`;
}

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
  return marked.parse(markdown);
}

function navigation() {
  const groups = new Map();
  for (const [slug, title, group] of DOCUMENTS) {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push([slug, title]);
  }
  const documentGroups = [...groups.entries()].map(([group, entries]) => `
    <section class="nav-group">
      <h2>${group}</h2>
      ${entries.map(([slug, title]) => `<a href="/${slug}/">${title}</a>`).join("\n")}
    </section>`).join("\n");
  const references = PACKAGE_REFERENCES.map(([slug, title]) => (
    `<a href="/reference/${slug}/">${title}</a>`
  )).join("\n");
  return `${documentGroups}
    <section class="nav-group reference-links">
      <h2>Reference</h2>
      <a href="/glossary/">Glossary</a>
      ${references}
    </section>`;
}

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
  const cards = DOCUMENTS.map(([slug, title, group]) => `
    <a class="doc-card" href="/${slug}/">
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

async function writePage(outputDir, route, html) {
  const directory = route === "/" ? outputDir : join(outputDir, route.slice(1));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), html);
}

function anchors(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

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
        const asset = targetPath.startsWith("/assets/") || targetPath === "/favicon.svg";
        if (!asset) failures.push(`${route} -> ${href}`);
        continue;
      }
      if (fragment && !anchors(target).has(fragment)) failures.push(`${route} -> ${href}`);
    }
  }
  if (failures.length > 0) throw new Error(`generated links failed:\n${failures.join("\n")}`);
  await writeFile(join(outputDir, "link-check.json"), JSON.stringify({ pages: pages.size, failures: [] }, null, 2));
}

export async function buildDocsSite(outputDir = DEFAULT_OUTPUT) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(join(outputDir, "assets"), { recursive: true });
  const pages = new Map();
  pages.set("/", overviewPage());

  for (const [slug, title] of DOCUMENTS) {
    const sourcePath = `docs/${slug}.md`;
    const markdown = await readFile(join(ROOT, sourcePath), "utf8");
    const route = `/${slug}/`;
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

  for (const [slug, title, sourcePath] of PACKAGE_REFERENCES) {
    const markdown = await readFile(join(ROOT, sourcePath), "utf8");
    const route = `/reference/${slug}/`;
    pages.set(route, articlePage(title, title, renderMarkdown(markdown, sourcePath), sourcePath, route));
  }

  for (const [route, html] of pages) await writePage(outputDir, route, html);
  for (const file of ["docs.css", "docs.js"]) {
    await copyFile(join(SITE_ROOT, "static", file), join(outputDir, "assets", file));
  }
  await copyFile(join(SITE_ROOT, "static", "favicon.svg"), join(outputDir, "favicon.svg"));
  await writeFile(join(outputDir, "404.html"), shell({
    title: "Not found",
    description: "The requested UniCAS documentation page was not found.",
    content: '<section class="not-found"><p class="kicker">404 / NOT FOUND</p><h1>No document at this address.</h1><a href="/">Return to the documentation index</a></section>',
  }));
  await validateGeneratedLinks(outputDir, pages);
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