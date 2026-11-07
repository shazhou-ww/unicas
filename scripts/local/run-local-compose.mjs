import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

export function localComposePlan(composeFile, args = [], environment = process.env) {
  return {
    command: "docker",
    args: ["compose", "-f", composeFile, "up", "--build", "--remove-orphans"],
    options: {
      cwd: dirname(composeFile),
      env: { ...environment, UNICAS_LOCAL_ARGS_JSON: JSON.stringify(args) },
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  };
}

export function runLocalCompose(composeFile, args = [], spawn = spawnSync) {
  const plan = localComposePlan(composeFile, args);
  const result = spawn(plan.command, plan.args, plan.options);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}