/** `unicas principal` - App administrator Principal, Profile, and memberships. */

import { printJson } from "../output.js";
import type { CliContext } from "./common.js";
import { withAdminClient } from "./common.js";

export async function principalCommand(ctx: CliContext): Promise<void> {
  await withAdminClient(ctx, async (admin) => {
    printJson(await admin.getCurrentPrincipal());
  });
}

export async function accountCommand(ctx: CliContext): Promise<void> {
  await withAdminClient(ctx, async (admin) => {
    const current = await admin.getCurrentPrincipal();
    printJson({
      account: {
        accountId: current.account.accountId,
        displayName: current.account.displayName,
        primaryVerifiedEmail: current.account.primaryVerifiedEmail,
        avatar: current.account.avatar,
      },
      authenticatedIdentity: current.authenticatedIdentity,
      platformAuthorities: current.account.platformAuthorities,
      memberships: current.memberships,
    });
  });
}