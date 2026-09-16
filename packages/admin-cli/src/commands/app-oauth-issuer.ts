/** `unicas app-oauth-issuer get|inspect|activate`. */

import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { requireSubcommand, resolveAppOAuthIssuerEtag, withAdminClient } from "./common.js";

export async function appOAuthIssuerCommand(ctx: CliContext, subcommand: string | undefined, argv: string[]): Promise<void> {
  requireSubcommand(subcommand, "usage: unicas app-oauth-issuer get|inspect|activate", ["get", "inspect", "activate"]);
  switch (subcommand) {
    case "get":
      return appOAuthIssuerGet(ctx, argv);
    case "inspect":
      return appOAuthIssuerInspect(ctx, argv);
    case "activate":
      return appOAuthIssuerActivate(ctx, argv);
  }
}

async function appOAuthIssuerGet(ctx: CliContext, argv: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  const appId = positionals[0];
  if (!appId) throw new Error("usage: unicas app-oauth-issuer get <appId>");
  await withAdminClient(ctx, async (admin) => {
    const result = await admin.getAppOAuthIssuer({ appId });
    printJson(result.value === null ? null : { ...result.value, etag: result.etag });
  });
}

async function appOAuthIssuerInspect(ctx: CliContext, argv: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  const [appId, issuer] = positionals;
  if (!appId || !issuer || positionals.length !== 2) {
    throw new Error("usage: unicas app-oauth-issuer inspect <appId> <issuer>");
  }
  await withAdminClient(ctx, async (admin) => {
    const result = await admin.inspectAppOAuthIssuer({ appId }, { issuer });
    printJson(result);
  });
}

async function appOAuthIssuerActivate(ctx: CliContext, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { etag: { type: "string" }, "if-none-match": { type: "string" }, "activation-proof": { type: "string" } },
    allowPositionals: true,
  });
  const [appId, inspectionId] = positionals;
  const activationProof = values["activation-proof"];
  if (values["if-none-match"] !== undefined && (values["if-none-match"] !== "*" || values.etag !== undefined)) {
    throw new Error("use either --if-none-match '*' for initial activation or --etag for replacement");
  }
  if (!appId || !inspectionId || !activationProof) {
    throw new Error("usage: unicas app-oauth-issuer activate <appId> <inspectionId> --activation-proof <jws> [--etag E]");
  }
  await withAdminClient(ctx, async (admin) => {
    const precondition = values["if-none-match"] === "*" ? { ifNoneMatch: "*" as const } : values.etag ?? await resolveAppOAuthIssuerEtag(admin, appId);
    const result = await admin.activateAppOAuthIssuer(
      { appId },
      { inspectionId, activationProof },
      precondition,
    );
    printJson(result);
  });
}