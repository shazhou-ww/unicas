#!/usr/bin/env node
/**
 * UniCAS control-plane CLI entry point.
 *
 * Plain commands print JSON to stdout and diagnostics to stderr; `unicas mcp`
 * speaks the MCP stdio protocol on stdout and must never print anything else
 * there.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appAuditCommand } from "./commands/app-audit.js";
import { appMembersCommand } from "./commands/app-members.js";
import { appOAuthIssuerCommand } from "./commands/app-oauth-issuer.js";
import { appRefDomainsCommand } from "./commands/app-refdomains.js";
import { appsCommand } from "./commands/apps.js";
import { createContext } from "./commands/common.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { accountCommand } from "./commands/principal.js";
import { platformInvitationsCommand } from "./commands/platform-invitations.js";
import { platformAuditCommand } from "./commands/platform-audit.js";
import { platformAccessCommand } from "./commands/platform-access.js";
import { statusCommand } from "./commands/status.js";
import { CliError } from "./errors.js";
import { runMcpStdioServer } from "./mcp/stdio-server.js";
import { printError, printText } from "./output.js";

const HELP = `UniCAS control-plane management CLI

Usage:
  unicas login [--port N] [--no-browser]                      Provider login, then exchange for an admin session
  unicas logout                                            End the admin session and clear it locally
  unicas status                                             Show local session state
  unicas account                                            Current Account, login method, authorities, and App memberships

  unicas apps list [--limit N] [--cursor C]
  unicas apps get <appId>
  unicas apps create <displayName> [--idempotency-key K]
  unicas apps update <appId> [displayName] [--description D] [--etag E]

  unicas app-members list <appId> [--limit N] [--cursor C]
  unicas app-members invite <appId> <email> [--idempotency-key K]
  unicas app-members remove <appId> <accountId> [--confirm-account-id ID]

  unicas app-oauth-issuer get <appId>
  unicas app-oauth-issuer inspect <appId> <issuer>
  unicas app-oauth-issuer activate <appId> <inspectionId> --activation-proof <jws> [--etag E]

  unicas app-ref-domains list <appId>
  unicas app-audit control <appId> [--actor-account-id ID] [--target-account-id ID] [--limit N] [--cursor C] [--after ID]
  unicas app-audit root-domain-refs <appId> <refDomain> [--space-id S] [--limit N] [--cursor C]
  unicas app-audit root-domain-events <appId> <refDomain> [--space-id S] [--after N] [--limit N]

  unicas platform-invitations list [--query Q] [--status pending|accepted|expired|revoked] [--limit N] [--cursor C]
  unicas platform-invitations create <email> --authority platform.admin|apps.create [--authority ...] [--idempotency-key K]
  unicas platform-invitations revoke <invitationId> --etag E [--confirm-invitation-id ID]
  unicas platform-audit [--action A] [--actor-account-id ID] [--target-account-id ID] [--created-after MS] [--limit N] [--cursor C]
  unicas platform-access list [--query Q] [--effective-access active|blocked|no_access] [--authority platform.admin|apps.create|none] [--limit N] [--cursor C]
  unicas platform-access get <accountId>
  unicas platform-access grant|revoke <accountId> <platform.admin|apps.create> [--confirm-account-id ID]
  unicas platform-access block|restore <accountId> [--confirm-account-id ID]

  unicas mcp                                                  Run as a stdio MCP server (DSH integration)
  unicas help                                                 Show this help

Environment:
  UNICAS_ADMIN_URL          /admin API origin (default https://console.unicas.work)
  UNICAS_CONFIG_DIR         session directory (default ~/.unicas)

Where a mutation needs a current ETag and none is passed, the CLI reads it
first. Destructive operations require their explicit --confirm-* flag when run
non-interactively.`;

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const ctx = createContext();
  switch (command) {
    case "login":
      await loginCommand(ctx, rest);
      return;
    case "logout":
      await logoutCommand(ctx);
      return;
    case "status":
      await statusCommand(ctx);
      return;
    case "account":
      await accountCommand(ctx);
      return;
    case "apps": {
      const [subcommand, ...subArgs] = rest;
      await appsCommand(ctx, subcommand, subArgs);
      return;
    }
    case "app-members": {
      const [subcommand, ...subArgs] = rest;
      await appMembersCommand(ctx, subcommand, subArgs);
      return;
    }
    case "app-oauth-issuer": {
      const [subcommand, ...subArgs] = rest;
      await appOAuthIssuerCommand(ctx, subcommand, subArgs);
      return;
    }
    case "app-ref-domains": {
      const [subcommand, ...subArgs] = rest;
      await appRefDomainsCommand(ctx, subcommand, subArgs);
      return;
    }
    case "app-audit": {
      const [subcommand, ...subArgs] = rest;
      await appAuditCommand(ctx, subcommand, subArgs);
      return;
    }
    case "platform-invitations": {
      const [subcommand, ...subArgs] = rest;
      await platformInvitationsCommand(ctx, subcommand, subArgs);
      return;
    }
    case "platform-audit":
      await platformAuditCommand(ctx, rest);
      return;
    case "platform-access": {
      const [subcommand, ...subArgs] = rest;
      await platformAccessCommand(ctx, subcommand, subArgs);
      return;
    }
    case "mcp":
      await runMcpStdioServer({
        adminOrigin: ctx.config.adminOrigin,
        store: ctx.store,
        fetchImpl: ctx.fetchImpl,
      });
      return;
    case "help":
    case "--help":
    case "-h":
      printText(HELP);
      return;
    case undefined:
      printText(HELP);
      return;
    default:
      throw new CliError(`unknown command '${command}'; run \`unicas help\` for usage`, 1);
  }
}

// Guard: only run when invoked as a binary (not when imported by tests).
// Realpath comparison keeps the guard working when the script is reached
// through a symlink (e.g. `pnpm install --global ./packages/admin-cli`),
// because `import.meta.url` resolves to the real path while `process.argv[1]`
// keeps the symlink path.
function invokedAsBinary(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invokedAsBinary()) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    printError(message);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  });
}
