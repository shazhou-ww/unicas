import { afterEach, expect, test } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { PeopleService } from "@unicas/service";
import { D1PeopleRepository } from "../src/people-repository.js";
import { migrateControlSchema } from "../src/control-schema.js";
import { D1ControlPlaneAdminRepository } from "../src/control-admin-repository.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); });

test("D1 combines people before filtering and paging without merging shared emails or subjects", async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "people", modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2025-08-17", d1Databases: { DB: "people" } }] }));
  await runtime.ready;
  const db = await runtime.getD1Database("DB", "people");
  await migrateControlSchema(db);
  for (const issuer of ["issuer-a", "issuer-b"]) {
    await db.prepare("INSERT INTO cas_operator_identities (identity_issuer, subject, display_name, email_for_display, created_at) VALUES (?, 'same', 'Alice', 'same@example.test', 1)").bind(issuer).run();
    await db.prepare("INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at) VALUES ('cas_one', ?, 'same', 100)").bind(issuer).run();
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES (?, ?, 'same', 'active', 0, 1, 1, 100, 100)").bind(issuer, issuer).run();
  }
  for (const [invitationId, status, expiry] of [["pending", "pending", 3000], ["expired", "pending", 500], ["accepted", "accepted", 3000]] as const) {
    await db.prepare("INSERT INTO cas_app_member_invitations (invitation_id, app_id, status, email_constraint, token_hash, expires_at, created_at, revision) VALUES (?, 'cas_one', ?, 'same@example.test', ?, ?, 100, 1)").bind(invitationId, status, invitationId, expiry).run();
    await db.prepare("INSERT INTO cas_platform_invitations (invitation_id, email_constraint, platform_admin, apps_create, status, token_hash, expires_at, created_at, created_by_issuer, created_by_subject, revision) VALUES (?, 'same@example.test', 1, 0, ?, ?, ?, 100, 'issuer-a', 'same', 1)").bind(invitationId, status, invitationId, expiry).run();
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
    expect((await service.list(scope, { query: "issuer-b" })).items).toHaveLength(1);
  }
  expect((await service.list({ platform: true }, { authority: "platform.admin" })).items).toHaveLength(1);
  expect((await service.list({ platform: true }, { effectiveAccess: "active" })).items).toHaveLength(2);
  expect((await service.list({ appId: "cas_other" }, {})).items).toHaveLength(0);
  const beforeProfileChange = await service.list({ platform: true }, { limit: 1 });
  const profiles = new D1ControlPlaneAdminRepository(db);
  await profiles.commitIdentity({
    kind: "update",
    identity: { identityIssuer: "issuer-a", subject: "same", displayName: "Updated", emailForDisplay: "new@example.test", createdAt: 1 },
    audit: { eventId: "profile-change", stackId: null, identityIssuer: "issuer-a", subject: "same", action: "operator.login", target: "same", requestId: null, traceId: null, callerChannel: null, oauthClientHandle: null, toolName: null, createdAt: 1000 },
  });
  await expect(service.list({ platform: true }, { cursor: beforeProfileChange.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  expect((await service.list({ platform: true }, { query: "new@example.test" })).items).toHaveLength(1);
}, 15000);