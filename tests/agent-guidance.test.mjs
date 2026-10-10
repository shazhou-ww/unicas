import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  dirname,
  join,
  relative,
  resolve,
} from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..");
const AGENTS_DIR = join(ROOT, ".agents");
const SKILLS_DIR = join(AGENTS_DIR, "skills");
const AGENTS_GUIDE = join(ROOT, "AGENTS.md");
const GUIDANCE_README = join(AGENTS_DIR, "README.md");
const EXPECTED_SKILLS = [
  "business-data-model-review",
  "silvermoon",
  "ui-change-review",
  "unicas-cli",
  "unicas-observability",
  "unicas-package-boundaries",
];
const LOCKED_SKILLS = {
  "business-data-model-review": {
    source: "shazhou-ww/skills",
    sourceType: "github",
  },
  silvermoon: {
    source: "./node_modules/silvermoon/skills",
    sourceType: "local",
  },
  "ui-change-review": {
    source: "shazhou-ww/skills",
    sourceType: "github",
  },
};
const REPOSITORY_OWNED_SKILLS = [
  "unicas-cli",
  "unicas-observability",
  "unicas-package-boundaries",
];
const PROVIDER_PATH_PREFIXES = [
  ".claude/skills/",
  ".github/instructions/",
  ".github/skills/",
];

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/");
}

function walkFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(filePath, files);
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

function candidateFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "git ls-files failed");
  }
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map(toPosix)
    .filter((filePath) => existsSync(join(ROOT, filePath)));
}

function skillMetadata(skillName) {
  const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");
  const content = readFileSync(skillPath, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatter) throw new Error(`${skillName}/SKILL.md has no YAML frontmatter`);
  return parse(frontmatter[1]);
}

function relativeFiles(directory) {
  return walkFiles(directory)
    .map((filePath) => toPosix(relative(directory, filePath)))
    .sort();
}

function localMarkdownLinks(filePath) {
  const content = readFileSync(filePath, "utf8");
  const links = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(pattern)) {
    let target = match[1].trim();
    if (target.startsWith("<")) {
      target = target.slice(1, target.indexOf(">"));
    } else {
      target = target.split(/\s+/u)[0];
    }
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) {
      continue;
    }
    links.push(target.split("#")[0]);
  }
  return links;
}

describe("canonical Agent guidance", () => {
  test("keeps provider-specific projections and misplaced guidance out of the candidate", () => {
    const misplaced = candidateFiles().filter((filePath) => (
      PROVIDER_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix))
      || (filePath.endsWith("/SKILL.md") && !filePath.startsWith(".agents/skills/"))
      || (filePath.endsWith(".instructions.md") && !filePath.startsWith(".agents/"))
    ));
    expect(misplaced).toEqual([]);

    const ignoreResult = spawnSync(
      "git",
      ["check-ignore", "--quiet", "--no-index", ".claude/skills/example"],
      { cwd: ROOT },
    );
    expect(ignoreResult.status).toBe(0);
  });

  test("discovers the complete skill set with valid frontmatter", () => {
    const skillDirectories = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const skillDocuments = walkFiles(SKILLS_DIR)
      .filter((filePath) => filePath.endsWith("SKILL.md"))
      .map((filePath) => toPosix(relative(SKILLS_DIR, filePath)))
      .sort();

    expect(skillDirectories).toEqual(EXPECTED_SKILLS);
    expect(skillDocuments).toEqual(
      EXPECTED_SKILLS.map((skillName) => `${skillName}/SKILL.md`),
    );

    for (const skillName of EXPECTED_SKILLS) {
      const metadata = skillMetadata(skillName);
      expect(metadata.name).toBe(skillName);
      expect(metadata.description).toEqual(expect.any(String));
      expect(metadata.description.trim().length).toBeGreaterThan(0);
    }
  });

  test("keeps installed and repository-owned skill sources distinct", () => {
    const lock = JSON.parse(readFileSync(join(ROOT, "skills-lock.json"), "utf8"));
    expect(lock.version).toBe(1);
    expect(Object.keys(lock.skills).sort()).toEqual(Object.keys(LOCKED_SKILLS).sort());

    for (const [skillName, source] of Object.entries(LOCKED_SKILLS)) {
      expect(lock.skills[skillName]).toMatchObject(source);
      expect(lock.skills[skillName].computedHash).toMatch(/^[a-f0-9]{64}$/u);
    }
    for (const skillName of REPOSITORY_OWNED_SKILLS) {
      expect(lock.skills).not.toHaveProperty(skillName);
    }

    const guidance = readFileSync(GUIDANCE_README, "utf8");
    for (const skillName of EXPECTED_SKILLS) {
      expect(guidance).toContain(`\`${skillName}\``);
    }
    expect(guidance).toContain("--agent universal");
  });

  test("keeps the Silvermoon registration identical to its packaged canonical skill", () => {
    const registered = join(SKILLS_DIR, "silvermoon");
    const canonical = join(ROOT, "node_modules", "silvermoon", "skills", "silvermoon");
    const files = relativeFiles(canonical);

    expect(relativeFiles(registered)).toEqual(files);
    for (const filePath of files) {
      expect(readFileSync(join(registered, filePath), "utf8"))
        .toBe(readFileSync(join(canonical, filePath), "utf8"));
    }
  });

  test("resolves every local link in active Agent guidance", () => {
    const guidanceFiles = [
      AGENTS_GUIDE,
      ...walkFiles(AGENTS_DIR).filter((filePath) => filePath.endsWith(".md")),
    ];
    const brokenLinks = [];

    for (const filePath of guidanceFiles) {
      for (const target of localMarkdownLinks(filePath)) {
        const targetPath = target.startsWith("/")
          ? resolve(ROOT, target.slice(1))
          : resolve(dirname(filePath), target);
        if (!existsSync(targetPath)) {
          brokenLinks.push(
            `${toPosix(relative(ROOT, filePath))}: ${target}`,
          );
        }
      }
    }

    expect(brokenLinks).toEqual([]);
  });

  test("routes package and release edits through the complete boundary skill", () => {
    const agentsGuide = readFileSync(AGENTS_GUIDE, "utf8");
    const boundarySkill = readFileSync(
      join(SKILLS_DIR, "unicas-package-boundaries", "SKILL.md"),
      "utf8",
    );

    expect(agentsGuide).toContain(
      "Before changing any file under `packages/**` or `release/**`, load and",
    );
    expect(agentsGuide).toContain(
      ".agents/skills/unicas-package-boundaries/SKILL.md",
    );
    for (const requiredRule of [
      "`@unidocs/*`",
      "`[cli, webui] -> client -> protocol`",
      "`@unicas/admin-protocol` may depend on `@unicas/space-protocol`",
      "Deploy UniCAS as one service",
      "`@unicas/service` is the",
      "`@unicas/service-cloudflare` is the Cloudflare Worker",
      "keyed single-writer semantics",
      "must not become dependencies",
    ]) {
      expect(boundarySkill).toContain(requiredRule);
    }
  });

  test("does not reference provider-specific guidance locations from active guidance", () => {
    const guidanceFiles = [
      AGENTS_GUIDE,
      ...walkFiles(AGENTS_DIR).filter((filePath) => filePath.endsWith(".md")),
    ];
    const violations = [];

    for (const filePath of guidanceFiles) {
      const content = readFileSync(filePath, "utf8");
      for (const providerPath of PROVIDER_PATH_PREFIXES) {
        const reference = providerPath.slice(0, -1);
        if (content.includes(reference)) {
          violations.push(`${toPosix(relative(ROOT, filePath))}: ${reference}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
