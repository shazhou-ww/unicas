import { afterEach, expect, test } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { AccountService, PeopleService } from "@unicas/service";
import { D1PeopleRepository } from "../src/people-repository.js";
import { D1AccountRepository } from "../src/account-repository.js";
import { migrateControlSchema } from "../src/control-schema.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); });

test("D1 combines people before filtering and paging without merging shared emails or subjects", async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "people", modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2025-08-17", d1Databases: { DB: "people" } }] }));
  await runtime.ready;
  const db = await runtime.getD1Database("DB", "people");
  await migrateControlSchema(db);
  const accounts = new AccountService(new D1AccountRepository(db), () => 1);
  await db.prepare(
    "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_one', 'One', '', 'active', 1, 1)",
  ).run();
  const createdAccounts = [];
  for (const [issuer, provider] of [["issuer-a", "google"], ["issuer-b", "github"]] as const) {
    const created = await accounts.createForExternalIdentity({ provider, issuer, subject: "same", displayName: "Alice" });
    createdAccounts.push(created);
    await db.prepare("UPDATE cas_accounts SET primary_verified_email = 'same@example.test', email_verification_source = 'google-oidc', email_verified_at = 1 WHERE account_id = ?").bind(created.account.accountId).run();
    await db.prepare("INSERT INTO cas_app_members (app_id, account_id, joined_at) VALUES ('cas_one', ?, 100)").bind(created.account.accountId).run();
    await db.prepare("INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'apps.create', 100)").bind(created.account.accountId).run();
  }
  const creator = createdAccounts[0]!;
  for (const [invitationId, status, expiry] of [["pending", "pending", 3000], ["expired", "pending", 500], ["accepted", "accepted", 3000]] as const) {
    await db.prepare("INSERT INTO cas_app_member_invitations (invitation_id, app_id, status, email_constraint, token_hash, expires_at, created_at, revision) VALUES (?, 'cas_one', ?, 'same@example.test', ?, ?, 100, 1)").bind(invitationId, status, invitationId, expiry).run();
    await db.prepare("INSERT INTO cas_platform_invitations (invitation_id, email_constraint, platform_admin, apps_create, status, token_hash, expires_at, created_at, created_by_account_id, created_by_external_identity_id, revision) VALUES (?, 'same@example.test', 1, 0, ?, ?, ?, 100, ?, ?, 1)").bind(invitationId, status, invitationId, expiry, creator.account.accountId, creator.authenticatedIdentity.externalIdentityId).run();
  }
  const service = new PeopleService(new D1PeopleRepository(db), async () => { }, () => 1000);
  for (const scope of [{ appId: "cas_one" }, { platform: true as const }]) {
    const all = await service.list(scope, { query: "same@example.test" });
    expect(all.items).toHaveLength(3);
    expect(JSON.stringify(all)).not.toMatch(/token|acceptUrl|sealed/i);
    const first = await service.list(scope, { limit: 1 });
    const second = await service.list(scope, { limit: 1, cursor: first.nextCursor });
    const third = await service.list(scope, { limit: 1, cursor: second.nextCursor });
    expect([first.items[0], second.items[0], third.items[0]]).toEqual(all.items);
    expect(third.nextCursor).toBeNull();
    expect((await service.list(scope, { filter: "history" })).items).toHaveLength(2);
    expect((await service.list(scope, { query: "issuer-b" })).items).toHaveLength(0);
  }
  const appMembers = await service.list({ appId: "cas_one" }, { filter: "members" });
  expect(JSON.stringify(appMembers)).not.toMatch(/issuer-[ab]|"subject"/);
  const platformAccounts = await service.list({ platform: true }, { filter: "accounts" });
  expect(JSON.stringify(platformAccounts)).not.toMatch(/issuer-[ab]|"subject"|principalRef/);
  const platformCurrent = await service.list({ platform: true }, { filter: "current" });
  expect(JSON.stringify(platformCurrent)).not.toMatch(/issuer-[ab]|"subject"|principalRef|createdBy/);
  expect((await service.list({ platform: true }, { authority: "platform.admin" })).items).toHaveLength(1);
  expect((await service.list({ platform: true }, { effectiveAccess: "active" })).items).toHaveLength(2);
  expect((await service.list({ appId: "cas_other" }, {})).items).toHaveLength(0);
  const beforeProfileChange = await service.list({ platform: true }, { limit: 1 });
  const updatedIdentity = await new D1AccountRepository(db).getActiveIdentity("issuer-a", "same");
  await accounts.updateProfile({ accountId: updatedIdentity!.accountId, displayName: "Updated" });
  await expect(service.list({ platform: true }, { cursor: beforeProfileChange.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  expect((await service.list({ platform: true }, { query: "updated" })).items).toHaveLength(1);
}, 15000);