/** `unicas app-members list|invite|remove`. */

import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import {
  confirmOrPrompt,
  idempotencyKeyFromFlag,
  requireSubcommand,
  resolveAppEtag,
  withAdminClient,
} from "./common.js";
import { parseBoundedLimit } from "./stacks.js";

export async function appMembersCommand(ctx: CliContext, subcommand: string | undefined, argv: string[]): Promise<void> {
  requireSubcommand(subcommand, "usage: unicas app-members list|invite|remove", ["list", "invite", "remove"]);
  switch (subcommand) {
    case "list":
      return appMembersList(ctx, argv);
    case "invite":
      return appMembersInvite(ctx, argv);
    case "remove":
      return appMembersRemove(ctx, argv);
    default:
      throw new Error("usage: unicas app-members list|invite|remove");
  }
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
      issuer: { type: "string" },
      subject: { type: "string" },
      etag: { type: "string" },
      "confirm-subject": { type: "string" },
    },
    allowPositionals: true,
  });
  const appId = positionals[0];
  const issuer = values.issuer;
  const subject = values.subject;
  if (!appId || !issuer || !subject) {
    throw new Error("usage: unicas app-members remove <appId> --issuer <url> --subject <sub> [--etag E] [--confirm-subject S]");
  }
  await confirmOrPrompt({
    flag: values["confirm-subject"],
    expected: subject,
    label: "confirm-subject",
  });
  await withAdminClient(ctx, async (admin) => {
    const etag = values.etag ?? (await resolveAppEtag(admin, appId));
    printJson(await admin.deleteAppMember({ appId }, { issuer, subject }, etag));
  });
}