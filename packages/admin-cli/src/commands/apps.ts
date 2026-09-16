/** `unicas apps list|get|create|update`. */

import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import {
  idempotencyKeyFromFlag,
  requireSubcommand,
  resolveAppEtag,
  withAdminClient,
} from "./common.js";
import { parseBoundedLimit } from "./stacks.js";

export async function appsCommand(ctx: CliContext, subcommand: string | undefined, argv: string[]): Promise<void> {
  requireSubcommand(subcommand, "usage: unicas apps list|get|create|update", ["list", "get", "create", "update"]);
  switch (subcommand) {
    case "list":
      return appsList(ctx, argv);
    case "get":
      return appsGet(ctx, argv);
    case "create":
      return appsCreate(ctx, argv);
    case "update":
      return appsUpdate(ctx, argv);
    default:
      throw new Error("usage: unicas apps list|get|create|update");
  }
}

async function appsList(ctx: CliContext, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { limit: { type: "string" }, cursor: { type: "string" } },
    allowPositionals: false,
  });
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.listApps({
      ...(values.limit !== undefined ? { limit: parseBoundedLimit(values.limit) } : {}),
      ...(values.cursor !== undefined ? { cursor: values.cursor } : {}),
    }));
  });
}

async function appsGet(ctx: CliContext, argv: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  const appId = positionals[0];
  if (!appId) throw new Error("usage: unicas apps get <appId>");
  await withAdminClient(ctx, async (admin) => {
    printJson((await admin.getApp({ appId })).value);
  });
}

async function appsCreate(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { "idempotency-key": { type: "string" } },
    allowPositionals: true,
  });
  const displayName = positionals[0];
  if (!displayName) throw new Error("usage: unicas apps create <displayName> [--idempotency-key K]");
  await withAdminClient(ctx, async (admin) => {
    const { value } = await admin.createApp(
      { displayName },
      { idempotencyKey: idempotencyKeyFromFlag(values["idempotency-key"]) },
    );
    printJson(value);
  });
}

async function appsUpdate(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      description: { type: "string" },
      status: { type: "string" },
      etag: { type: "string" },
    },
    allowPositionals: true,
  });
  const [appId, displayName] = positionals;
  const status = values.status;
  if (status !== undefined && status !== "active" && status !== "suspended") {
    throw new Error("status must be active or suspended");
  }
  if (!appId || (!displayName && values.description === undefined && status === undefined)) {
    throw new Error("usage: unicas apps update <appId> [displayName] [--description D] [--status active|suspended] [--etag E]");
  }
  await withAdminClient(ctx, async (admin) => {
    const etag = values.etag ?? (await resolveAppEtag(admin, appId));
    const result = await admin.patchApp(
      { appId },
      {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(values.description !== undefined ? { description: values.description } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      etag,
    );
    printJson(result);
  });
}