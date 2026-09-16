import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { PlatformAccessService, sha256Hex } from "@unicas/service";
import { D1PlatformAccessRepository } from "../src/platform-access-repository.js";
import { migrateControlSchema } from "../src/control-schema.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

describe("persistent platform access", () => {
  test("requires explicit bootstrap and protects the last administrator atomically", async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "platform-test", modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2025-08-17", d1Databases: { DB: "platform-test" } }] }));
    await runtime.ready;
    const db = await runtime.getD1Database("DB", "platform-test");
    await migrateControlSchema(db);
    const repository = new D1PlatformAccessRepository(db);
    const service = new PlatformAccessService(repository, () => 1000);
    const actor = { issuer: "https://identity.example.test", subject: "synthetic-operator" };
    await db.prepare("INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('legacy-app', 'Legacy', '', 'active', 1, 1)").run();
    await db.prepare("INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at) VALUES ('legacy-app', ?, 'legacy-member', 2)").bind(actor.issuer).run();
    await migrateControlSchema(db);
    expect(await repository.getAccess({ issuer: actor.issuer, subject: "legacy-member" })).toMatchObject({
      principalRef: expect.stringMatching(/^prn_[0-9a-f]{32}$/),
      status: "active",
      authorities: [],
      revision: 1,
    });
    await expect(service.requireAccess(actor)).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_platform_principals").first()).toEqual({ count: 1 });
    expect(await repository.getAccess(actor)).toBeNull();
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES ('synthetic-ref', ?, ?, 'active', 1, 0, 1, 1, 1)").bind(actor.issuer, actor.subject).run();
    await service.requireAccess(actor, "platform.admin");
    await expect(service.requireAccess(actor, "apps.create")).rejects.toMatchObject({ code: "APP_CREATION_AUTHORITY_REQUIRED" });
    await expect(service.patchAccess(actor, "synthetic-ref", { authorities: [] }, '"1"')).rejects.toMatchObject({ code: "LAST_PLATFORM_ADMIN" });
    await expect(service.patchAccess(actor, "synthetic-ref", { status: "blocked" }, '"1"')).rejects.toMatchObject({ code: "SELF_BLOCK_FORBIDDEN" });
    await expect(service.patchAccess(actor, "synthetic-ref", { authorities: ["platform.admin", "apps.create"] }, '"1"')).resolves.toEqual({ revision: 2 });
    await expect(service.patchAccess(actor, "synthetic-ref", { authorities: [] }, '"1"')).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    await service.requireAccess(actor, "apps.create");
    const invitationToken = "i".repeat(32);
    await db.prepare("INSERT INTO cas_app_member_invitations (invitation_id, app_id, status, email_constraint, token_hash, expires_at, created_at, revision) VALUES ('invitation-1', 'app-1', 'pending', 'invitee@example.com', ?, 2000, 1, 1)").bind(await sha256Hex(invitationToken)).run();
    await expect(service.resolveAppInvitation(invitationToken)).resolves.toMatchObject({
      invitationId: "invitation-1",
      appId: "app-1",
      emailConstraint: "invitee@example.com",
    });
    const audit = await db.prepare("SELECT action, result FROM cas_platform_audit_events ORDER BY created_at").all();
    expect(audit.results).toEqual(expect.arrayContaining([
      { action: "app.create_denied", result: "denied" },
      { action: "platform_access.authority_changed", result: "succeeded" },
      { action: "platform_access.change_denied", result: "denied" },
    ]));
  });
});