import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateCommitSha(sha) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
    throw new Error("GITHUB_SHA is not a full lowercase commit ID");
  }
  return sha;
}

export function productionTagName(createdAt, runNumber) {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("workflow created_at is not a valid timestamp");
  }

  const normalizedRunNumber = String(runNumber);
  if (!/^[1-9]\d*$/.test(normalizedRunNumber)) {
    throw new Error("GITHUB_RUN_NUMBER is not a positive integer");
  }

  const date = [
    timestamp.getUTCFullYear(),
    String(timestamp.getUTCMonth() + 1).padStart(2, "0"),
    String(timestamp.getUTCDate()).padStart(2, "0"),
  ].join("");
  return `production-${date}-${normalizedRunNumber}`;
}

export function remoteTagTarget(output, tagName) {
  const directRef = `refs/tags/${tagName}`;
  const peeledRef = `${directRef}^{}`;
  let directTarget;
  let peeledTarget;

  for (const line of output.split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/, 2);
    if (ref === directRef) directTarget = sha;
    if (ref === peeledRef) peeledTarget = sha;
  }

  return peeledTarget ?? directTarget;
}

export function assertTagTarget(tagName, actualTarget, expectedTarget) {
  if (actualTarget !== expectedTarget) {
    throw new Error(
      `tag ${tagName} already targets ${actualTarget}; refusing to move it to ${expectedTarget}`,
    );
  }
}

function runGit(args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
  return result;
}

function readRemoteTagTarget(tagName, { cwd, remote }) {
  const ref = `refs/tags/${tagName}`;
  const result = runGit(["ls-remote", "--tags", remote, ref, `${ref}^{}`], { cwd });
  return remoteTagTarget(result.stdout, tagName);
}

export function tagProductionDeployment({
  createdAt,
  runNumber,
  deployedSha,
  runUrl,
  cwd = process.cwd(),
  remote = "origin",
}) {
  const tagName = productionTagName(createdAt, runNumber);
  const expectedTarget = validateCommitSha(deployedSha);
  const existingTarget = readRemoteTagTarget(tagName, { cwd, remote });

  if (existingTarget) {
    assertTagTarget(tagName, existingTarget, expectedTarget);
    return { status: "existing", tagName };
  }

  runGit(["cat-file", "-e", `${expectedTarget}^{commit}`], { cwd });
  const message = [
    `Production deployment ${tagName}`,
    "",
    `Commit: ${expectedTarget}`,
    `Workflow run: ${runUrl}`,
  ].join("\n");
  runGit([
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "tag",
    "--annotate",
    "--message",
    message,
    tagName,
    expectedTarget,
  ], { cwd });

  const push = runGit(["push", remote, `refs/tags/${tagName}`], { cwd, allowFailure: true });
  if (push.status === 0) return { status: "created", tagName };

  const racedTarget = readRemoteTagTarget(tagName, { cwd, remote });
  if (racedTarget) {
    assertTagTarget(tagName, racedTarget, expectedTarget);
    return { status: "existing-after-race", tagName };
  }

  const detail = push.stderr.trim() || push.stdout.trim() || `exit ${push.status}`;
  throw new Error(`failed to create tag ${tagName}: ${detail}`);
}

export async function fetchWorkflowCreatedAt({
  apiUrl,
  repository,
  runId,
  token,
  fetchImpl = fetch,
}) {
  if (!/^\d+$/.test(runId)) throw new Error("GITHUB_RUN_ID is not numeric");
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("GITHUB_REPOSITORY is not owner/repository");
  const endpoint = [
    apiUrl.replace(/\/$/, ""),
    "repos",
    encodeURIComponent(owner),
    encodeURIComponent(repo),
    "actions/runs",
    runId,
  ].join("/");
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "unicas-production-tag",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`failed to read workflow run creation time: HTTP ${response.status}`);
  }
  const run = await response.json();
  return required(run.created_at, "workflow created_at");
}

async function main() {
  const repository = required(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  const runId = required(process.env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  const token = required(process.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const serverUrl = required(process.env.GITHUB_SERVER_URL, "GITHUB_SERVER_URL").replace(/\/$/, "");
  const createdAt = await fetchWorkflowCreatedAt({
    apiUrl: required(process.env.GITHUB_API_URL, "GITHUB_API_URL"),
    repository,
    runId,
    token,
  });
  const result = tagProductionDeployment({
    createdAt,
    runNumber: required(process.env.GITHUB_RUN_NUMBER, "GITHUB_RUN_NUMBER"),
    deployedSha: required(process.env.GITHUB_SHA, "GITHUB_SHA"),
    runUrl: `${serverUrl}/${repository}/actions/runs/${runId}`,
  });
  console.log(`${result.tagName}: ${result.status}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}