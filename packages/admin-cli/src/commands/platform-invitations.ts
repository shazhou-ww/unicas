import { parseArgs } from "node:util";
import type { PlatformAuthority } from "@unicas/admin-client";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { confirmOrPrompt, idempotencyKeyFromFlag, requireSubcommand, withAdminClient } from "./common.js";
import { parseBoundedLimit } from "./common.js";

export async function platformInvitationsCommand(
  ctx: CliContext,
  subcommand: string | undefined,
  argv: string[],
): Promise<void> {
  requireSubcommand(subcommand, "usage: unicas platform-invitations list|create|revoke", ["list", "create", "revoke"]);
  switch (subcommand) {
    case "list": return list(ctx, argv);
    case "create": return create(ctx, argv);
    case "revoke": return revoke(ctx, argv);
  }
}

async function list(ctx: CliContext, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      query: { type: "string" },
      status: { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
    },
    allowPositionals: false,
  });
  const status = values.status;
  if (status !== undefined && !["pending", "accepted", "expired", "revoked"].includes(status)) {
    throw new Error("status must be pending, accepted, expired, or revoked");
  }
  await withAdminClient(ctx, async admin => {
    printJson(await admin.listPlatformInvitations({
      ...(values.query ? { query: values.query } : {}),
      ...(status ? { status: status as "pending" | "accepted" | "expired" | "revoked" } : {}),
      ...(values.limit ? { limit: parseBoundedLimit(values.limit) } : {}),
      ...(values.cursor ? { cursor: values.cursor } : {}),
    }));
  });
}

async function create(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      authority: { type: "string", multiple: true },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: true,
  });
  const email = positionals[0];
  const requested = values.authority ?? [];
  if (!email || requested.length === 0) {
    throw new Error("usage: unicas platform-invitations create <email> --authority platform.admin|apps.create [--authority ...] [--idempotency-key K]");
  }
  if (requested.some(authority => authority !== "platform.admin" && authority !== "apps.create")) {
    throw new Error("authority must be platform.admin or apps.create");
  }
  const authorities = [...new Set(requested)] as PlatformAuthority[];
  await withAdminClient(ctx, async admin => {
    printJson(await admin.createPlatformInvitation(
      { emailConstraint: email, authorities },
      idempotencyKeyFromFlag(values["idempotency-key"]),
    ));
  });
}

async function revoke(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      etag: { type: "string" },
      "confirm-invitation-id": { type: "string" },
    },
    allowPositionals: true,
  });
  const invitationId = positionals[0];
  if (!invitationId || !values.etag) {
    throw new Error("usage: unicas platform-invitations revoke <invitationId> --etag E [--confirm-invitation-id ID]");
  }
  await confirmOrPrompt({ flag: values["confirm-invitation-id"], expected: invitationId, label: "confirm-invitation-id" });
  await withAdminClient(ctx, async admin => {
    printJson(await admin.revokePlatformInvitation({ invitationId }, values.etag!));
  });
}