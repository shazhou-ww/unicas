import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOOKS_PATH = ".githooks";
const PRE_PUSH_PATH = join(HOOKS_PATH, "pre-push");

function executeGit(args, { cwd = ROOT, env = process.env } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function runGit(args, options) {
  const result = executeGit(args, options);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with exit code ${result.status}: ${`${result.stdout}${result.stderr}`.trim()}`,
    );
  }
  return result.stdout.trim();
}

function readOptionalConfig(args, options) {
  const result = executeGit(["config", ...args], options);
  if (result.status === 1) return null;
  if (result.status !== 0) {
    throw new Error(
      `git config ${args.join(" ")} failed with exit code ${result.status}: ${`${result.stdout}${result.stderr}`.trim()}`,
    );
  }
  return result.stdout.trim();
}

function isRepositoryHooksPath(value) {
  return value === HOOKS_PATH || value === `./${HOOKS_PATH}`;
}

export function hooksStatus({ cwd = ROOT, env = process.env } = {}) {
  const localValue = readOptionalConfig(["--local", "--get", "core.hooksPath"], { cwd, env });
  const effectiveValue = readOptionalConfig(["--get", "core.hooksPath"], { cwd, env });
  const effectiveOrigin = readOptionalConfig(["--show-origin", "--get", "core.hooksPath"], {
    cwd,
    env,
  });

  if (localValue !== null) {
    if (!isRepositoryHooksPath(localValue)) {
      return {
        state: "local-conflict",
        value: localValue,
        detail: `local core.hooksPath is ${JSON.stringify(localValue)}`,
      };
    }
    if (!existsSync(join(cwd, PRE_PUSH_PATH))) {
      return {
        state: "invalid",
        value: localValue,
        detail: `${PRE_PUSH_PATH} is missing`,
      };
    }
    return {
      state: "installed",
      value: localValue,
      detail: `local core.hooksPath is ${JSON.stringify(localValue)}`,
    };
  }

  if (effectiveValue !== null) {
    return {
      state: "inherited-conflict",
      value: effectiveValue,
      detail: `effective core.hooksPath is ${JSON.stringify(effectiveValue)} from ${effectiveOrigin}`,
    };
  }

  return {
    state: "uninstalled",
    value: null,
    detail: "no core.hooksPath is configured",
  };
}

export function installHooks({
  cwd = ROOT,
  env = process.env,
  log = (message) => console.log(message),
} = {}) {
  const status = hooksStatus({ cwd, env });
  if (status.state === "installed") {
    log(`[git-hooks] Already installed: ${status.detail}.`);
    return { changed: false, status };
  }
  if (status.state !== "uninstalled") {
    throw new Error(
      `${status.detail}; existing hook configuration was preserved. Resolve it explicitly before running pnpm hooks:install.`,
    );
  }
  if (!existsSync(join(cwd, PRE_PUSH_PATH))) {
    throw new Error(`${PRE_PUSH_PATH} is missing from this checkout`);
  }

  runGit(["config", "--local", "core.hooksPath", HOOKS_PATH], { cwd, env });
  const installed = hooksStatus({ cwd, env });
  if (installed.state !== "installed") {
    throw new Error(`core.hooksPath was written but installation verification failed: ${installed.detail}`);
  }
  log(`[git-hooks] Installed local core.hooksPath=${HOOKS_PATH}.`);
  return { changed: true, status: installed };
}

export function uninstallHooks({
  cwd = ROOT,
  env = process.env,
  log = (message) => console.log(message),
} = {}) {
  const localValue = readOptionalConfig(["--local", "--get", "core.hooksPath"], { cwd, env });
  if (localValue === null) {
    log("[git-hooks] No repository-owned local core.hooksPath setting is installed.");
    return { changed: false, status: hooksStatus({ cwd, env }) };
  }
  if (!isRepositoryHooksPath(localValue)) {
    throw new Error(
      `local core.hooksPath is ${JSON.stringify(localValue)}; it is not repository-owned and was preserved`,
    );
  }

  runGit(["config", "--local", "--unset-all", "core.hooksPath"], { cwd, env });
  log(`[git-hooks] Removed repository-owned local core.hooksPath=${localValue}.`);
  return { changed: true, status: hooksStatus({ cwd, env }) };
}

function printStatus(status, log = (message) => console.log(message)) {
  log(`[git-hooks] ${status.state}: ${status.detail}.`);
}

const invokedUrl = process.argv[1] === undefined
  ? null
  : pathToFileURL(resolve(process.argv[1])).href;

if (invokedUrl === import.meta.url) {
  try {
    const action = process.argv[2];
    if (action === "install") {
      installHooks();
    } else if (action === "uninstall") {
      uninstallHooks();
    } else if (action === "status") {
      const status = hooksStatus();
      printStatus(status);
      if (status.state !== "installed") process.exitCode = 1;
    } else {
      throw new Error("usage: node scripts/git-hooks.mjs <install|uninstall|status>");
    }
  } catch (error) {
    console.error(`[git-hooks] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
