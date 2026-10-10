import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function runGit(args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
  return result;
}

function validateCommitSha(revision) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision)) {
    throw new Error("release revision must be a full lowercase commit ID");
  }
  return revision;
}

function validateRef(ref) {
  if (!ref || ref.startsWith("-")) throw new Error("main ref is invalid");
  return ref;
}

export function verifyReleaseRevision({
  revision,
  mainRef = "origin/main",
  cwd = process.cwd(),
}) {
  const expectedRevision = validateCommitSha(revision);
  const authoritativeMain = validateRef(mainRef);
  const checkedOutRevision = runGit(["rev-parse", "HEAD"], { cwd }).stdout.trim();
  if (checkedOutRevision !== expectedRevision) {
    throw new Error(
      `checked-out revision ${checkedOutRevision} differs from release revision ${expectedRevision}`,
    );
  }

  const [commit, ...parents] = runGit(
    ["rev-list", "--parents", "-n", "1", expectedRevision],
    { cwd },
  ).stdout.trim().split(/\s+/);
  if (commit !== expectedRevision || parents.length !== 2) {
    throw new Error("release revision must be a two-parent promotion merge");
  }

  const [releaseParent, mainParent] = parents;
  const ancestry = runGit(
    ["merge-base", "--is-ancestor", mainParent, authoritativeMain],
    { cwd, allowFailure: true },
  );
  if (ancestry.status !== 0) {
    throw new Error(
      `promotion main parent ${mainParent} is not reachable from ${authoritativeMain}`,
    );
  }

  const treeComparison = runGit(
    ["diff", "--quiet", mainParent, expectedRevision],
    { cwd, allowFailure: true },
  );
  if (treeComparison.status !== 0) {
    throw new Error("release promotion tree differs from its main parent");
  }

  return { releaseParent, mainParent };
}

function main() {
  const [revision, mainRef, ...extra] = process.argv.slice(2);
  if (!revision || !mainRef || extra.length > 0) {
    throw new Error("usage: verify-release-revision.mjs <release-revision> <main-ref>");
  }
  const result = verifyReleaseRevision({ revision, mainRef });
  console.log(
    `Verified release promotion ${revision} from main parent ${result.mainParent}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
