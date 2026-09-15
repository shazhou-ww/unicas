/** `unicas principal` - App administrator Principal, Profile, and memberships. */

import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { withAdminClient } from "./common.js";

export async function principalCommand(ctx: CliContext): Promise<void> {
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.getCurrentPrincipal());
  });
}