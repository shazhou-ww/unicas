import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAIN_REF = "refs/heads/main";
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const ZERO_OBJECT_ID = /^0+$/u;

function execute(command, args, { cwd = ROOT, env = process.env, stdio = "pipe" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio,
    encoding: stdio === "pipe" ? "utf8" : undefined,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function commandOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function runGit(args, { cwd = ROOT, env = process.env } = {}) {
  const result = execute("git", args, { cwd, env });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with exit code ${result.status}: ${commandOutput(result)}`,
    );
  }
  return result.stdout.trim();
}

export function parsePrePushInput(input) {
  return input
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      const fields = line.trim().split(/\s+/u);
      if (fields.length !== 4) {
        throw new Error(`pre-push input line ${index + 1} must contain exactly four fields`);
      }
      const [localRef, localObject, remoteRef, remoteObject] = fields;
      if (!OBJECT_ID.test(localObject) || !OBJECT_ID.test(remoteObject)) {
        throw new Error(`pre-push input line ${index + 1} contains an invalid object ID`);
      }
      return { localRef, localObject, remoteRef, remoteObject };
    });
}

export function selectMainUpdate(updates) {
  const mainUpdates = updates.filter(({ remoteRef }) => remoteRef === MAIN_REF);
  if (mainUpdates.length === 0) return null;

  const localObjects = new Set(mainUpdates.map(({ localObject }) => localObject));
  if (localObjects.size !== 1) {
    throw new Error(`one push contains conflicting updates for ${MAIN_REF}`);
  }
  return mainUpdates[0];
}

function assertCommitExists(localObject, { cwd, env }) {
  const result = execute("git", ["cat-file", "-e", `${localObject}^{commit}`], { cwd, env });
  if (result.status !== 0) {
    throw new Error(
      `${MAIN_REF} local object ${localObject} is not an available commit; fetch or restore it before retrying`,
    );
  }
}

function assertCleanWorktree({ cwd, env, phase }) {
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"], { cwd, env });
  if (status !== "") {
    throw new Error(
      `${phase}: the worktree is not clean; commit or stash every tracked and untracked change before pushing ${MAIN_REF}`,
    );
  }
}

export function runCanonicalValidation({ cwd = ROOT, env = process.env } = {}) {
  const command = process.platform === "win32" ? (env.ComSpec ?? "cmd.exe") : "pnpm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "pnpm validate"]
    : ["validate"];
  const result = execute(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`pnpm validate failed with exit code ${result.status}`);
  }
}

export function runMainPrePush({
  input,
  cwd = ROOT,
  env = process.env,
  validate = runCanonicalValidation,
  log = (message) => console.log(message),
} = {}) {
  const update = selectMainUpdate(parsePrePushInput(input ?? ""));
  if (update === null) {
    log(`[pre-push] No ${MAIN_REF} update; skipping pnpm validate.`);
    return { validated: false, reason: "no-main-update" };
  }
  if (ZERO_OBJECT_ID.test(update.localObject)) {
    throw new Error(`deleting ${MAIN_REF} is refused by the repository pre-push hook`);
  }

  assertCommitExists(update.localObject, { cwd, env });
  const headBefore = runGit(["rev-parse", "HEAD"], { cwd, env });
  if (headBefore !== update.localObject) {
    throw new Error(
      `${MAIN_REF} would receive ${update.localObject}, but checked-out HEAD is ${headBefore}; check out the exact pushed commit before retrying`,
    );
  }
  assertCleanWorktree({ cwd, env, phase: "before validation" });

  log(`[pre-push] Running pnpm validate for ${MAIN_REF} at ${update.localObject}.`);
  validate({ cwd, env, localObject: update.localObject });

  const headAfter = runGit(["rev-parse", "HEAD"], { cwd, env });
  if (headAfter !== update.localObject) {
    throw new Error(
      `HEAD changed from ${update.localObject} to ${headAfter} during pnpm validate; the push is not proven`,
    );
  }
  assertCleanWorktree({ cwd, env, phase: "after validation" });
  log(`[pre-push] pnpm validate passed for ${MAIN_REF} at ${update.localObject}.`);
  return { validated: true, localObject: update.localObject };
}

async function readStandardInput() {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

const invokedUrl = process.argv[1] === undefined
  ? null
  : pathToFileURL(resolve(process.argv[1])).href;

if (invokedUrl === import.meta.url) {
  try {
    runMainPrePush({ input: await readStandardInput() });
  } catch (error) {
    console.error(`[pre-push] ${error instanceof Error ? error.message : String(error)}`);
    console.error("[pre-push] Fix the reported state and retry. --no-verify is an explicit bypass, not validation evidence.");
    process.exitCode = 1;
  }
}
