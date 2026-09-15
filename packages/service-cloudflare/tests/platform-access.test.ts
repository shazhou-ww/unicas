import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { PlatformAccessService } from "@unicas/service";
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
    await expect(service.requireAccess(actor)).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_platform_principals").first()).toEqual({ count: 0 });
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES ('synthetic-ref', ?, ?, 'active', 1, 0, 1, 1, 1)").bind(actor.issuer, actor.subject).run();
    await service.requireAccess(actor, "platform.admin");
    await expect(service.requireAccess(actor, "apps.create")).rejects.toMatchObject({ code: "APP_CREATION_AUTHORITY_REQUIRED" });
    await expect(service.patchAccess(actor, "synthetic-ref", { authorities: [] }, '"1"')).rejects.toMatchObject({ code: "LAST_PLATFORM_ADMIN" });
    await expect(service.patchAccess(actor, "synthetic-ref", { status: "blocked" }, '"1"')).rejects.toMatchObject({ code: "SELF_BLOCK_FORBIDDEN" });
    await expect(service.patchAccess(actor, "synthetic-ref", { authorities: ["platform.admin", "apps.create"] }, '"1"')).resolves.toEqual({ revision: 2 });
    await expect(service.patchAccess(actor, "synthetic-ref", { authorities: [] }, '"1"')).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    await service.requireAccess(actor, "apps.create");
    const audit = await db.prepare("SELECT action, result FROM cas_platform_audit_events ORDER BY created_at").all();
    expect(audit.results).toEqual(expect.arrayContaining([{ action: "app.create_denied", result: "denied" }, { action: "platform_access.authority_changed", result: "succeeded" }]));
  });
});