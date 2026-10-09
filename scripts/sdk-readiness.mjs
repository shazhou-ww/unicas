import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export const SDK_DOCUMENTS = [
  "packages/docs-site/content/app-user-api/sdk.md",
  "packages/docs-site/content/app-user-api/quickstart.md",
  "packages/docs-site/content/app-user-api/compatibility.md",
  "packages/docs-site/content/app-user-api/versioning.md",
  "packages/docs-site/content/app-user-api/sdk-reference.md",
  "packages/docs-site/content/app-user-api/troubleshooting.md",
  "packages/docs-site/content/app-user-api/changelog.md",
];

const SDK_ADDITIONAL_SNIPPET_DOCUMENTS = [
  "packages/docs-site/content/cas-architecture.md",
];

export function sdkMarkdownPaths(matrix) {
  return [
    ...matrix.packages.map(({ directory }) => `${directory}/README.md`),
    ...SDK_DOCUMENTS,
  ];
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function parseSnippetBlocks(markdown, sourcePath, requireEveryTypeScriptFence) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const snippets = [];
  let marker = null;
  for (let index = 0; index < lines.length; index += 1) {
    const markerMatch = /^<!-- sdk-snippet: ([a-z0-9]+(?:-[a-z0-9]+)*) -->$/u.exec(lines[index]);
    if (markerMatch) {
      if (marker !== null) throw new Error(`${sourcePath}:${index + 1}: nested sdk-snippet marker`);
      marker = { group: markerMatch[1], line: index + 1 };
      continue;
    }
    const fenceMatch = /^```(ts|typescript)\s*$/u.exec(lines[index]);
    if (!fenceMatch) {
      if (marker !== null && lines[index].trim() !== "") {
        throw new Error(`${sourcePath}:${marker.line}: sdk-snippet marker must immediately precede a TypeScript fence`);
      }
      continue;
    }
    if (marker === null) {
      if (requireEveryTypeScriptFence) {
        throw new Error(`${sourcePath}:${index + 1}: TypeScript fence is missing an sdk-snippet marker`);
      }
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index])) index += 1;
      if (index === lines.length) throw new Error(`${sourcePath}: unclosed TypeScript fence`);
      continue;
    }
    const code = [];
    const fenceLine = index + 1;
    index += 1;
    while (index < lines.length && !/^```\s*$/u.test(lines[index])) {
      code.push(lines[index]);
      index += 1;
    }
    if (index === lines.length) throw new Error(`${sourcePath}:${fenceLine}: unclosed TypeScript fence`);
    snippets.push({ group: marker.group, sourcePath, line: fenceLine, code: code.join("\n") });
    marker = null;
  }
  if (marker !== null) throw new Error(`${sourcePath}:${marker.line}: sdk-snippet marker has no TypeScript fence`);
  return snippets;
}

export async function collectSdkSnippets(root, matrix) {
  const grouped = new Map();
  const documents = [
    ...sdkMarkdownPaths(matrix).map((sourcePath) => ({ sourcePath, requireEveryTypeScriptFence: true })),
    ...SDK_ADDITIONAL_SNIPPET_DOCUMENTS.map((sourcePath) => ({
      sourcePath,
      requireEveryTypeScriptFence: false,
    })),
  ];
  for (const { sourcePath, requireEveryTypeScriptFence } of documents) {
    const markdown = await readFile(join(root, sourcePath), "utf8");
    for (const snippet of parseSnippetBlocks(markdown, sourcePath, requireEveryTypeScriptFence)) {
      const existing = grouped.get(snippet.group);
      if (existing !== undefined && existing.sourcePath !== sourcePath) {
        throw new Error(
          `sdk-snippet group ${snippet.group} is shared by ${existing.sourcePath} and ${sourcePath}`,
        );
      }
      if (existing === undefined) {
        grouped.set(snippet.group, { sourcePath, blocks: [snippet] });
      } else {
        existing.blocks.push(snippet);
      }
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, { sourcePath, blocks }]) => ({
      group,
      sourcePath,
      source: `${blocks.map(({ line, code }) => (
        `// ${normalizePath(sourcePath)}:${line}\n${code}`
      )).join("\n\n")}\n`,
    }));
}

export async function writeSdkSnippetFixtures(root, matrix, destination) {
  const snippets = await collectSdkSnippets(root, matrix);
  await mkdir(destination, { recursive: true });
  await Promise.all(snippets.map(({ group, source }) => (
    writeFile(join(destination, `${group}.ts`), source, "utf8")
  )));
  return snippets;
}

function markdownLinkTargets(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu)]
    .map((match) => match[1].replace(/^<|>$/gu, ""));
}

export async function validateLocalMarkdownLinks(root, sourcePaths) {
  const failures = [];
  for (const sourcePath of sourcePaths) {
    const markdown = await readFile(join(root, sourcePath), "utf8");
    for (const target of markdownLinkTargets(markdown)) {
      if (/^(?:[a-z]+:|#|\/)/iu.test(target)) continue;
      const decoded = decodeURIComponent(target.split("#", 1)[0]);
      if (decoded.length === 0) continue;
      const absolute = resolve(root, dirname(sourcePath), decoded);
      if (!absolute.startsWith(`${resolve(root)}${sep}`) && absolute !== resolve(root)) {
        failures.push(`${sourcePath}: link escapes the repository: ${target}`);
        continue;
      }
      try {
        await stat(absolute);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        failures.push(`${sourcePath}: missing local link target ${target}`);
      }
    }
  }
  return failures;
}
