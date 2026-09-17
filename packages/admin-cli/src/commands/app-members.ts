/** `unicas app-members list|invite|remove`. */

import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import {
  confirmOrPrompt,
  idempotencyKeyFromFlag,
  requireSubcommand,
  withAdminClient,
} from "./common.js";
import { parseBoundedLimit } from "./common.js";

export async function appMembersCommand(ctx: CliContext, subcommand: string | undefined, argv: string[]): Promise<void> {
  requireSubcommand(subcommand, "usage: unicas app-members list|invite|remove|invitations|revoke-invitation", ["list", "invite", "remove", "invitations", "revoke-invitation"]);
  switch (subcommand) {
    case "list":
      return appMembersList(ctx, argv);
    case "invite":
      return appMembersInvite(ctx, argv);
    case "remove":
      return appMembersRemove(ctx, argv);
    case "invitations":
      return appInvitationsList(ctx, argv);
    case "revoke-invitation":
      return appInvitationRevoke(ctx, argv);
    default:
      throw new Error("usage: unicas app-members list|invite|remove");
  }
}

async function appInvitationsList(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, options: { status: { type: "string" }, limit: { type: "string" }, cursor: { type: "string" } }, allowPositionals: true });
  const appId = positionals[0];
  if (!appId) throw new Error("usage: unicas app-members invitations <appId> [--status pending|accepted|expired|revoked] [--limit N] [--cursor C]");
  const status = values.status;
  if (status !== undefined && status !== "pending" && status !== "accepted" && status !== "expired" && status !== "revoked") throw new Error("invalid invitation status");
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) throw new Error("limit must be 1..1000");
  await withAdminClient(ctx, async admin => {
    printJson(await admin.listAppMemberInvitations({ appId }, { status, limit, cursor: values.cursor }));
  });
}

async function appInvitationRevoke(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, options: { etag: { type: "string" }, "confirm-invitation-id": { type: "string" } }, allowPositionals: true });
  const [appId, invitationId] = positionals;
  const etag = values.etag;
  if (!appId || !invitationId || !etag) throw new Error("usage: unicas app-members revoke-invitation <appId> <invitationId> --etag E [--confirm-invitation-id ID]");
  await confirmOrPrompt({ flag: values["confirm-invitation-id"], expected: invitationId, label: "confirm-invitation-id" });
  await withAdminClient(ctx, async admin => {
    printJson(await admin.revokeAppMemberInvitation({ appId, invitationId }, etag));
  });
}

async function appMembersList(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { limit: { type: "string" }, cursor: { type: "string" } },
    allowPositionals: true,
  });
  const appId = positionals[0];
  if (!appId) throw new Error("usage: unicas app-members list <appId> [--limit N] [--cursor C]");
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.listAppMembers(
      { appId },
      {
        ...(values.limit !== undefined ? { limit: parseBoundedLimit(values.limit) } : {}),
        ...(values.cursor !== undefined ? { cursor: values.cursor } : {}),
      },
    ));
  });
}

async function appMembersInvite(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { "idempotency-key": { type: "string" } },
    allowPositionals: true,
  });
  const [appId, email] = positionals;
  if (!appId || !email) {
    throw new Error("usage: unicas app-members invite <appId> <email> [--idempotency-key K]");
  }
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.createAppMemberInvitation(
      { appId },
      { emailConstraint: email },
      { idempotencyKey: idempotencyKeyFromFlag(values["idempotency-key"]) },
    ));
  });
}

async function appMembersRemove(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "confirm-account-id": { type: "string" },
    },
    allowPositionals: true,
  });
  const [appId, accountId] = positionals;
  if (!appId || !accountId) {
    throw new Error("usage: unicas app-members remove <appId> <accountId> [--confirm-account-id ID]");
  }
  await confirmOrPrompt({
    flag: values["confirm-account-id"],
    expected: accountId,
    label: "confirm-account-id",
  });
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.deleteAppMember({ appId, accountId }));
  });
}