import { parseArgs } from "node:util";
import type { PlatformAuthority } from "@unicas/admin-client";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { confirmOrPrompt, requireSubcommand, withAdminClient } from "./common.js";
import { parseBoundedLimit } from "./stacks.js";

export async function platformAccessCommand(ctx: CliContext, subcommand: string | undefined, argv: string[]): Promise<void> {
  requireSubcommand(subcommand, "usage: unicas platform-access list|get|grant|revoke|block|restore", ["list", "get", "grant", "revoke", "block", "restore"]);
  switch (subcommand) {
    case "list": return list(ctx, argv);
    case "get": return get(ctx, argv);
    case "grant": return authority(ctx, argv, true);
    case "revoke": return authority(ctx, argv, false);
    case "block": return block(ctx, argv, true);
    case "restore": return block(ctx, argv, false);
  }
}

async function list(ctx: CliContext, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      query: { type: "string" },
      "effective-access": { type: "string" },
      authority: { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
    },
    allowPositionals: false,
  });
  const effectiveAccess = values["effective-access"];
  if (effectiveAccess !== undefined && !["active", "blocked", "no_access"].includes(effectiveAccess)) {
    throw new Error("effective-access must be active, blocked, or no_access");
  }
  const authority = values.authority;
  if (authority !== undefined && !["platform.admin", "apps.create", "none"].includes(authority)) {
    throw new Error("authority must be platform.admin, apps.create, or none");
  }
  await withAdminClient(ctx, async admin => {
    printJson(await admin.listPlatformAccounts({
      ...(values.query ? { query: values.query } : {}),
      ...(effectiveAccess ? { effectiveAccess: effectiveAccess as "active" | "blocked" | "no_access" } : {}),
      ...(authority ? { authority: authority as PlatformAuthority | "none" } : {}),
      ...(values.limit ? { limit: parseBoundedLimit(values.limit) } : {}),
      ...(values.cursor ? { cursor: values.cursor } : {}),
    }));
  });
}

async function get(ctx: CliContext, argv: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  const accountId = positionals[0];
  if (!accountId) throw new Error("usage: unicas platform-access get <accountId>");
  await withAdminClient(ctx, async admin => printJson(await admin.getPlatformAccount({ accountId })));
}

async function authority(ctx: CliContext, argv: string[], grant: boolean): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "confirm-account-id": { type: "string" },
    },
    allowPositionals: true,
  });
  const [accountId, authorityValue] = positionals;
  if (!accountId || (authorityValue !== "platform.admin" && authorityValue !== "apps.create")) {
    throw new Error(`usage: unicas platform-access ${grant ? "grant" : "revoke"} <accountId> <platform.admin|apps.create> [--confirm-account-id ID]`);
  }
  await confirmOrPrompt({ flag: values["confirm-account-id"], expected: accountId, label: "confirm-account-id" });
  await withAdminClient(ctx, async admin => {
    if (grant) await admin.grantPlatformAccountAuthority({ accountId, authority: authorityValue });
    else await admin.revokePlatformAccountAuthority({ accountId, authority: authorityValue });
    printJson({ ok: true });
  });
}

async function block(ctx: CliContext, argv: string[], blocked: boolean): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { "confirm-account-id": { type: "string" } },
    allowPositionals: true,
  });
  const accountId = positionals[0];
  if (!accountId) throw new Error(`usage: unicas platform-access ${blocked ? "block" : "restore"} <accountId> [--confirm-account-id ID]`);
  await confirmOrPrompt({ flag: values["confirm-account-id"], expected: accountId, label: "confirm-account-id" });
  await withAdminClient(ctx, async admin => {
    if (blocked) await admin.blockPlatformAccount({ accountId });
    else await admin.restorePlatformAccount({ accountId });
    printJson({ ok: true });
  });
}