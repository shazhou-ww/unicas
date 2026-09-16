import { parseArgs } from "node:util";
import type { PlatformAuthority } from "@unicas/admin-client";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { confirmOrPrompt, requireSubcommand, withAdminClient } from "./common.js";
import { parseBoundedLimit } from "./stacks.js";

export async function platformAccessCommand(ctx: CliContext, subcommand: string | undefined, argv: string[]): Promise<void> {
  requireSubcommand(subcommand, "usage: unicas platform-access list|get|update", ["list", "get", "update"]);
  switch (subcommand) {
    case "list": return list(ctx, argv);
    case "get": return get(ctx, argv);
    case "update": return update(ctx, argv);
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
    printJson(await admin.listPlatformPrincipals({
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
  const principalRef = positionals[0];
  if (!principalRef) throw new Error("usage: unicas platform-access get <principalRef>");
  await withAdminClient(ctx, async admin => printJson(await admin.getPlatformPrincipal({ principalRef })));
}

async function update(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      status: { type: "string" },
      authority: { type: "string", multiple: true },
      "clear-authorities": { type: "boolean" },
      etag: { type: "string" },
      "confirm-principal-ref": { type: "string" },
    },
    allowPositionals: true,
  });
  const principalRef = positionals[0];
  if (!principalRef) throw new Error("usage: unicas platform-access update <principalRef> [--status active|blocked] [--authority platform.admin|apps.create ... | --clear-authorities] [--etag E]");
  if (values.status !== undefined && values.status !== "active" && values.status !== "blocked") throw new Error("status must be active or blocked");
  const status = values.status as "active" | "blocked" | undefined;
  if (values.authority && values["clear-authorities"]) throw new Error("authority and clear-authorities are mutually exclusive");
  if (values.authority?.some(authority => authority !== "platform.admin" && authority !== "apps.create")) throw new Error("authority must be platform.admin or apps.create");
  if (status === undefined && values.authority === undefined && !values["clear-authorities"]) throw new Error("at least one access change is required");
  if (status === "blocked") {
    await confirmOrPrompt({ flag: values["confirm-principal-ref"], expected: principalRef, label: "confirm-principal-ref" });
  }
  await withAdminClient(ctx, async admin => {
    const etag = values.etag ?? (await admin.getPlatformAccess({ principalRef })).etag;
    printJson(await admin.patchPlatformAccess(
      { principalRef },
      {
        ...(status ? { status } : {}),
        ...(values.authority ? { authorities: [...new Set(values.authority)] as PlatformAuthority[] } : {}),
        ...(values["clear-authorities"] ? { authorities: [] } : {}),
      },
      etag,
    ));
  });
}