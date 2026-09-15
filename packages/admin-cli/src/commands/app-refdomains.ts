/** `unicas app-ref-domains list`. */

import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { requireSubcommand, withAdminClient } from "./common.js";

export async function appRefDomainsCommand(ctx: CliContext, subcommand: string | undefined, argv: string[]): Promise<void> {
  requireSubcommand(subcommand, "usage: unicas app-ref-domains list", ["list"]);
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  const appId = positionals[0];
  if (!appId) throw new Error("usage: unicas app-ref-domains list <appId>");
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.listAppRefDomains({ appId }));
  });
}