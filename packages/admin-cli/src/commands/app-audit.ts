/** `unicas app-audit control|root-refs|root-events`. */

import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { requireSubcommand, withAdminClient } from "./common.js";
import { parseBoundedLimit } from "./common.js";

export async function appAuditCommand(ctx: CliContext, subcommand: string | undefined, argv: string[]): Promise<void> {
  requireSubcommand(
    subcommand,
    "usage: unicas app-audit control|root-refs|root-events",
    ["control", "root-refs", "root-events"],
  );
  switch (subcommand) {
    case "control":
      return appAuditControl(ctx, argv);
    case "root-refs":
      return appAuditRootRefs(ctx, argv);
    case "root-events":
      return appAuditRootEvents(ctx, argv);
    default:
      throw new Error("usage: unicas app-audit control|root-refs|root-events");
  }
}

async function appAuditControl(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      limit: { type: "string" },
      cursor: { type: "string" },
      after: { type: "string" },
      "actor-account-id": { type: "string" },
      "target-account-id": { type: "string" },
    },
    allowPositionals: true,
  });
  const appId = positionals[0];
  if (!appId) throw new Error("usage: unicas app-audit control <appId> [--limit N] [--cursor C] [--after ID]");
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.listAppControlAuditEvents(
      { appId },
      {
        ...(values.limit !== undefined ? { limit: parseBoundedLimit(values.limit) } : {}),
        ...(values.cursor !== undefined ? { cursor: values.cursor } : {}),
        ...(values.after !== undefined ? { after: values.after } : {}),
        ...(values["actor-account-id"] !== undefined ? { actorAccountId: values["actor-account-id"] } : {}),
        ...(values["target-account-id"] !== undefined ? { targetAccountId: values["target-account-id"] } : {}),
      },
    ));
  });
}

async function appAuditRootRefs(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "space-id": { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
    },
    allowPositionals: true,
  });
  const [appId] = positionals;
  if (!appId || positionals.length !== 1) {
    throw new Error("usage: unicas app-audit root-refs <appId> [--space-id S] [--limit N] [--cursor C]");
  }
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.listAppRootRefs(
      { appId },
      {
        ...(values["space-id"] !== undefined ? { spaceId: values["space-id"] } : {}),
        ...(values.limit !== undefined ? { limit: parseBoundedLimit(values.limit) } : {}),
        ...(values.cursor !== undefined ? { cursor: values.cursor } : {}),
      },
    ));
  });
}

async function appAuditRootEvents(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "space-id": { type: "string" },
      after: { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });
  const [appId] = positionals;
  if (!appId || positionals.length !== 1) {
    throw new Error("usage: unicas app-audit root-events <appId> [--space-id S] [--after N] [--limit N]");
  }
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.listAppRootEvents(
      { appId },
      {
        ...(values["space-id"] !== undefined ? { spaceId: values["space-id"] } : {}),
        ...(values.after !== undefined ? { after: parseAfter(values.after) } : {}),
        ...(values.limit !== undefined ? { limit: parseBoundedLimit(values.limit) } : {}),
      },
    ));
  });
}

function parseAfter(value: string): number {
  const after = Number(value);
  if (!Number.isSafeInteger(after) || after < 0) {
    throw new Error(`invalid --after '${value}'; expected a non-negative integer`);
  }
  return after;
}