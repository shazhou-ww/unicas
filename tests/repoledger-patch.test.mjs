import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { checkRepository } from "repoledger";

let directory;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

async function write(root, path, content) {
  const target = join(root, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content);
}

describe("repoledger forward-revert patch", () => {
  test("batches primary progress history into one Git log scan", async () => {
    const source = await readFile(new URL("../node_modules/repoledger/src/index.js", import.meta.url), "utf8");
    expect(source).toContain('"--format=%x00%x00%H%x00%B%x00"');
    expect(source).not.toContain('runGit(root, ["show", "-s", "--format=%B", commit])');
    expect(source).not.toContain('runGit(root, ["diff", "--name-only", parent.stdout, commit])');
  });

  test("accepts an explicit standard revert of a bookkeeping-only Progress commit", async () => {
    directory = await mkdtemp(join(tmpdir(), "repoledger-revert-"));
    const repository = join(directory, "repository");
    const remote = join(directory, "remote.git");
    const primaryRepository = "https://example.com/owner/repository.git";
    await mkdir(repository);
    git(repository, "init", "-b", "main");
    git(repository, "config", "user.name", "Repoledger Test");
    git(repository, "config", "user.email", "repoledger@example.test");
    git(repository, "init", "--bare", remote);
    git(repository, "remote", "add", "origin", remote);
    git(
      repository,
      "config",
      `url.file:///${remote.replaceAll("\\", "/")}.insteadOf`,
      primaryRepository,
    );
    await write(repository, "repoledger.yaml", [
      "version: 2",
      "tasksDirectory: tasks",
      `primaryRepository: ${primaryRepository}`,
      "primaryBranch: main",
      "",
    ].join("\n"));
    await write(repository, "tasks/status.yaml", "version: 2\ntasks: {}\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "initialize ledger");
    git(repository, "push", "-u", "origin", "main");

    await write(repository, "tasks/example/Progress.md", "# Progress\n\nBookkeeping only.\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "docs: add bookkeeping progress");
    const bookkeepingCommit = git(repository, "rev-parse", "HEAD");
    git(repository, "push", "origin", "main");

    const rejected = await checkRepository({ root: repository, remote: true });
    expect(rejected.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "progress.history.bookkeeping-only", actual: { commit: bookkeepingCommit, paths: ["tasks/example/Progress.md"] } }),
    ]));

    await write(repository, "README.md", "Unrelated change.\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "docs: unrelated change", "-m", `This reverts commit ${bookkeepingCommit}.`);
    git(repository, "push", "origin", "main");
    const forged = await checkRepository({ root: repository, remote: true });
    expect(forged.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "progress.history.bookkeeping-only", actual: { commit: bookkeepingCommit, paths: ["tasks/example/Progress.md"] } }),
    ]));

    git(repository, "revert", "--no-edit", bookkeepingCommit);
    git(repository, "push", "origin", "main");
    const repaired = await checkRepository({ root: repository, remote: true });
    expect(repaired.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "progress.history.bookkeeping-only" }),
    ]));
  }, 15_000);
});
