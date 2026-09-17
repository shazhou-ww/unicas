import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { AccountService } from "@unicas/service";
import { D1AccountRepository } from "../src/account-repository.js";
import { migrateControlSchema } from "../src/control-schema.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

async function fixture() {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "account-repository-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "account-repository-test" },
    }],
  }));
  await runtime.ready;
  const db = await runtime.getD1Database("DB", "account-repository-test");
  await migrateControlSchema(db);
  const repository = new D1AccountRepository(db);
  return { db, repository, service: new AccountService(repository, () => 1000) };
}

describe("D1 Account repository", () => {
  test("creates and resolves one Account for an exact external identity", async () => {
    const { db, service } = await fixture();
    const created = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "alice",
      displayName: "Alice",
    });
    expect(created.account).toMatchObject({ blockedAt: null, credentialVersion: 1, primaryVerifiedEmail: null });
    expect(created.platformAuthorities).toEqual([]);
    expect(await service.resolveExternalIdentity("https://accounts.google.com", "alice"))
      .toMatchObject({ account: { accountId: created.account.accountId } });
    expect(await db.prepare("SELECT display_name_source FROM cas_account_profiles").first())
      .toEqual({ display_name_source: created.authenticatedIdentity.externalIdentityId });
  });

  test("rejects a duplicate active identity without leaving an orphan Account", async () => {
    const { db, service } = await fixture();
    const input = { provider: "github" as const, issuer: "https://github.com", subject: "42" };
    await service.createForExternalIdentity(input);
    await expect(service.createForExternalIdentity(input)).rejects.toMatchObject({ code: "IDENTITY_LINK_CONFLICT" });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_accounts").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_account_profiles").first()).toEqual({ count: 1 });
  });

  test("enforces credential version and current identity ownership", async () => {
    const { db, service } = await fixture();
    const created = await service.createForExternalIdentity({
      provider: "microsoft",
      issuer: "https://login.microsoftonline.com/consumers/v2.0",
      subject: "pairwise-subject",
    });
    await expect(service.authorizeCredential({
      accountId: created.account.accountId,
      externalIdentityId: created.authenticatedIdentity.externalIdentityId,
      credentialVersion: 1,
    })).resolves.toMatchObject({ account: { accountId: created.account.accountId } });
    await db.prepare("UPDATE cas_accounts SET credential_version = 2 WHERE account_id = ?")
      .bind(created.account.accountId).run();
    await expect(service.authorizeCredential({
      accountId: created.account.accountId,
      externalIdentityId: created.authenticatedIdentity.externalIdentityId,
      credentialVersion: 1,
    })).rejects.toMatchObject({ code: "CREDENTIAL_VERSION_MISMATCH" });
  });
});