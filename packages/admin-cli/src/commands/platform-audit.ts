import { parseArgs } from "node:util";
import type { PlatformAuditAction } from "@unicas/admin-client";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { withAdminClient } from "./common.js";
import { parseBoundedLimit } from "./common.js";

const actions = new Set<PlatformAuditAction>([
  "platform_invitation.created",
  "platform_invitation.revoked",
  "platform_invitation.accepted",
  "platform_access.authority_changed",
  "platform_access.blocked",
  "platform_access.restored",
  "platform_access.change_denied",
  "app.create_denied",
]);

export async function platformAuditCommand(ctx: CliContext, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      action: { type: "string" },
      "actor-account-id": { type: "string" },
      "target-account-id": { type: "string" },
      "created-after": { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.action !== undefined && !actions.has(values.action as PlatformAuditAction)) {
    throw new Error("invalid platform audit action");
  }
  const createdAfter = values["created-after"] === undefined ? undefined : Number(values["created-after"]);
  if (createdAfter !== undefined && (!Number.isSafeInteger(createdAfter) || createdAfter < 0)) {
    throw new Error("created-after must be a non-negative Unix epoch millisecond value");
  }
  await withAdminClient(ctx, async admin => {
    printJson(await admin.listPlatformAuditEvents({
      ...(values.action ? { action: values.action as PlatformAuditAction } : {}),
      ...(values["actor-account-id"] ? { actorAccountId: values["actor-account-id"] } : {}),
      ...(values["target-account-id"] ? { targetAccountId: values["target-account-id"] } : {}),
      ...(createdAfter !== undefined ? { createdAfter } : {}),
      ...(values.limit ? { limit: parseBoundedLimit(values.limit) } : {}),
      ...(values.cursor ? { cursor: values.cursor } : {}),
    }));
  });
}