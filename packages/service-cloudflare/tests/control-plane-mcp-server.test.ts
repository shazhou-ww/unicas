import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import type { D1Database } from "@cloudflare/workers-types";
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { APP_ADMIN_MCP_TOOL_LIST } from "@unicas/admin-protocol";
import { AccountService, PlatformAccessService, PlatformAuditService, PlatformInvitationService } from "@unicas/service";
import { createControlPlaneMcpServer } from "../src/mcp/server.js";
import type { ControlPlaneMcpGrantProps } from "../src/mcp/server.js";
import { migrateControlSchema } from "../src/control-schema.js";
import { createControlPlaneOperations } from "../src/control-operations.js";
import { D1PlatformAccessRepository } from "../src/platform-access-repository.js";
import { D1AccountRepository } from "../src/account-repository.js";

let miniflare: Miniflare;
let db: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "control-plane-mcp-server-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "control-plane-mcp-server-test-db" },
    }]
  }));
  await miniflare.ready;
  db = await miniflare.getD1Database("DB", "control-plane-mcp-server-test");
  await migrateControlSchema(db);
});
afterEach(async () => miniflare.dispose());

describe("adapter-hosted control-plane MCP server", () => {
  test("lists only current tools and returns the Account identity", async () => {
    const accountService = new AccountService(new D1AccountRepository(db));
    const actor = await accountService.createForExternalIdentity({ provider: "google", issuer: "https://accounts.google.com", subject: "alice-sub", displayName: "Alice" });
    const handler = handlerFor(grant(["control:read"]), { accountService });
    const listed = await mcpRequest(handler, "tools/list", {});
    const body = await listed.json() as { result: { tools: Array<{ name: string; description?: string }> } };
    expect(body.result.tools.map((tool) => tool.name)).toEqual(APP_ADMIN_MCP_TOOL_LIST.map((tool) => tool.name));
    for (const definition of APP_ADMIN_MCP_TOOL_LIST) {
      expect(body.result.tools.find((tool) => tool.name === definition.name)?.description)
        .toBe(definition.registration.description);
    }
    const current = await callTool(handler, "get_current_account", {});
    expect(current.structuredContent).toMatchObject({
      account: { accountId: actor.account.accountId, displayName: "Alice" },
      memberships: [],
    });
  });

  test("enforces read, write, security, and deployment-policy gates", async () => {
    expect((await callTool(handlerFor(grant([])), "get_current_account", {})).content[0]?.text).toContain("control:read");
    expect((await callTool(handlerFor(grant(["control:write"])), "create_app", {
      displayName: "Operations", idempotencyKey: "create-ops-1",
    })).content[0]?.text).toContain("disabled by deployment policy");
    expect((await callTool(handlerFor(grant(["control:write"]), { mutationsEnabled: true }), "invite_app_member", {
      appId: "cas_app", email: "bob@example.com", confirmEmail: "bob@example.com", idempotencyKey: "invite-1",
    })).content[0]?.text).toContain("control:security");
    expect((await callTool(handlerFor(grant(["control:security"])), "mint_managed_space_capability", {
      appId: "cas_app",
    })).content[0]?.text).toContain("disabled by deployment policy");
  });

  test("mints managed Space capabilities for the stable Account through MCP", async () => {
    const repository = new D1AccountRepository(db);
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const publicJwk = { ...(await exportJWK(publicKey)), kid: "issuer-key", alg: "ES256" };
    const issuerRecord = (appId: string) => ({
      stackId: appId,
      mode: "managed" as const,
      issuer: `https://cas.example/managed-issuers/${appId}`,
      audience: `https://cas.example/stacks/${appId}`,
      metadataUrl: `https://cas.example/managed-issuers/${appId}/.well-known/oauth-authorization-server`,
      metadataType: "oauth" as const,
      authorizationEndpoint: `https://cas.example/managed-issuers/${appId}/authorize`,
      tokenEndpoint: `https://cas.example/managed-issuers/${appId}/token`,
      jwksUri: `https://cas.example/managed-issuers/${appId}/jwks.json`,
      registrationEndpoint: null,
      scopesSupported: ["cas:read", "cas:write", "cas:manage"],
      codeChallengeMethodsSupported: ["S256"],
      status: "active" as const,
      verifiedAt: 1000,
      lastRefreshAt: 1000,
      lastRefreshError: null,
      jwksDigest: "digest",
      capabilityMaxLifetimeSeconds: 3600,
      revision: 1,
    });
    const issueAccountSpace = vi.fn(async ({ app, accountId }) => ({
      accessToken: "account-space-token",
      tokenType: "Bearer" as const,
      expiresIn: 3600,
      expiresAt: 3_601_000,
      issuer: `https://cas.example/managed-issuers/${app.appId}`,
      audience: `https://cas.example/stacks/${app.appId}`,
      spaceId: `member_${accountId.slice(5)}`,
      permissions: [`spaces:member_${accountId.slice(5)}:cas:manage`],
    }));
    const accountService = new AccountService(repository, () => 1000, {
      provision: async appId => issuerRecord(appId),
      issueAccountSpace,
    }, {
      oauthResourcePublicOrigin: "https://cas.example",
      oauthDiscovery: {
        inspectIssuer: async ({ issuer }) => ({
          metadata: {
            issuer,
            metadataUrl: `${issuer}/metadata`,
            metadataType: "oauth" as const,
            authorizationEndpoint: `${issuer}/authorize`,
            tokenEndpoint: `${issuer}/token`,
            jwksUri: `${issuer}/jwks`,
            registrationEndpoint: null,
            scopesSupported: ["openid"],
            codeChallengeMethodsSupported: ["S256"],
          },
          metadataDigest: "replacement-metadata",
          jwksDigest: "replacement-jwks",
          keys: [{ kid: "issuer-key", algorithm: "ES256" as const, publicJwk }],
        }),
      },
    });
    const actor = await accountService.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "alice-sub",
      displayName: "Alice",
    });
    await db.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'apps.create', 1000)",
    ).bind(actor.account.accountId).run();
    const app = await accountService.createApp({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      displayName: "Managed",
    });
    const legacyMint = vi.fn(async () => {
      throw new Error("legacy managed capability path must not be called");
    });
    const legacyGet = vi.fn(async () => {
      throw new Error("legacy managed issuer read must not be called");
    });
    const legacyExternalGet = vi.fn(async () => {
      throw new Error("legacy external issuer read must not be called");
    });
    const legacyPatch = vi.fn(async () => {
      throw new Error("legacy managed issuer update must not be called");
    });
    const legacyInspect = vi.fn(async () => {
      throw new Error("legacy external issuer inspection must not be called");
    });
    const legacyActivate = vi.fn(async () => {
      throw new Error("legacy external issuer activation must not be called");
    });
    const handler = createMcpHandler(
      () => createControlPlaneMcpServer(
        {
          ...createControlPlaneOperations(db),
          getOAuthIssuer: legacyExternalGet,
          getManagedOAuthIssuer: legacyGet,
          patchManagedOAuthIssuer: legacyPatch,
          mintManagedSpaceCapability: legacyMint,
          inspectAppOAuthIssuer: legacyInspect,
          activateAppOAuthIssuer: legacyActivate,
        },
        { mutationsEnabled: true, accountService },
      ),
      { route: "/mcp", authContext: { props: grant(["control:read", "control:security"]) } },
    );

    const minted = await callTool(handler, "mint_managed_space_capability", { appId: app.appId });

    expect(minted.structuredContent).toMatchObject({
      accessToken: "account-space-token",
      spaceId: `member_${actor.account.accountId.slice(5)}`,
    });
    expect(issueAccountSpace).toHaveBeenCalledWith(expect.objectContaining({
      accountId: actor.account.accountId,
      app: expect.objectContaining({ appId: app.appId }),
    }));
    expect((await callTool(handler, "get_app_managed_issuer", { appId: app.appId })).structuredContent)
      .toMatchObject({ appId: app.appId, status: "active", etag: '"1"' });
    await db.prepare(
      `INSERT INTO cas_app_oauth_issuers
        (app_id, mode, issuer, audience, metadata_url, metadata_type,
         authorization_endpoint, token_endpoint, jwks_uri, scopes_supported,
         code_challenge_methods_supported, status, verified_at, last_refresh_at,
         jwks_digest, capability_max_lifetime_seconds, revision)
       VALUES (?, 'external', 'https://issuer.example', 'https://api.example/app',
         'https://issuer.example/.well-known/openid-configuration', 'oidc',
         'https://issuer.example/authorize', 'https://issuer.example/token',
         'https://issuer.example/jwks', '["openid"]', '["S256"]', 'active',
         1000, 1000, 'digest', 3600, 3)`,
    ).bind(app.appId).run();
    expect((await callTool(handler, "get_app_oauth_issuer", { appId: app.appId })).structuredContent)
      .toMatchObject({ appId: app.appId, issuer: "https://issuer.example", etag: '"3"' });
    const inspected = await callTool(handler, "inspect_app_oauth_issuer", {
      appId: app.appId,
      issuer: "https://replacement.example",
    });
    const challenge = String(inspected.structuredContent.challenge);
    const proof = await new CompactSign(new TextEncoder().encode(challenge))
      .setProtectedHeader({ alg: "ES256", kid: "issuer-key" }).sign(privateKey);
    expect((await callTool(handler, "activate_app_oauth_issuer", {
      appId: app.appId,
      inspectionId: inspected.structuredContent.inspectionId,
      activationProof: proof,
      etag: '"3"',
    })).structuredContent).toEqual({ etag: '"4"' });
    expect((await callTool(handler, "update_app_managed_issuer", {
      appId: app.appId,
      enabled: false,
      etag: '"1"',
    })).structuredContent).toMatchObject({ appId: app.appId, status: "disabled", etag: '"2"' });
    expect(await db.prepare(
      "SELECT caller_channel, oauth_client_handle, tool_name FROM cas_control_audit_events WHERE action = 'managed_issuer.disabled'",
    ).first()).toEqual({
      caller_channel: "mcp",
      oauth_client_handle: "a".repeat(64),
      tool_name: "update_app_managed_issuer",
    });
    expect(legacyGet).not.toHaveBeenCalled();
    expect(legacyExternalGet).not.toHaveBeenCalled();
    expect(legacyInspect).not.toHaveBeenCalled();
    expect(legacyActivate).not.toHaveBeenCalled();
    expect(legacyPatch).not.toHaveBeenCalled();
    expect(legacyMint).not.toHaveBeenCalled();
  });

  test("requires apps.create authority in addition to the delegated write scope", async () => {
    const authorizePlatformOperation = vi.fn(async () => ({
      error: "APP_CREATION_AUTHORITY_REQUIRED" as const,
    }));
    const handler = handlerFor(grant(["control:write"]), {
      mutationsEnabled: true,
      authorizePlatformOperation,
    });

    const denied = await callTool(handler, "create_app", {
      displayName: "Denied App",
      idempotencyKey: "denied-app-1",
    });

    expect(denied).toMatchObject({
      isError: true,
      structuredContent: { error: "APP_CREATION_AUTHORITY_REQUIRED" },
    });
    expect(authorizePlatformOperation).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "alice-sub" }),
      "apps.create",
    );
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_apps").first()).toEqual({ count: 0 });
  });

  test("serves App CRUD and audit without exposing Stack-shaped fields", async () => {
    const accountService = new AccountService(new D1AccountRepository(db), () => 1000);
    const actorAccount = await accountService.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "alice-sub",
      displayName: "Alice",
    });
    const handler = handlerFor(
      grant(["control:read", "control:write", "control:security"]),
      { mutationsEnabled: true, accountService },
    );
    const created = await callTool(handler, "create_app", {
      displayName: "Documents",
      idempotencyKey: "create-app-1",
    });
    expect(created.structuredContent).toEqual({
      appId: expect.any(String),
      etag: '"1"',
    });
    expect(created.structuredContent).not.toHaveProperty("stackId");
    const appId = String(created.structuredContent.appId);

    expect((await callTool(handler, "create_app", { displayName: "Documents", idempotencyKey: "create-app-1" })).structuredContent).toEqual(created.structuredContent);
    expect((await callTool(handler, "update_app", { appId, description: "Stale", etag: '"0"' })).structuredContent).toMatchObject({ error: "REVISION_MISMATCH" });

    const listed = await callTool(handler, "list_apps", { limit: 10 });
    expect(listed.structuredContent).toMatchObject({ items: [{ appId, displayName: "Documents" }] });
    expect((listed.structuredContent.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty("stackId");

    const updated = await callTool(handler, "update_app", {
      appId,
      description: "Production documents",
      etag: '"1"',
    });
    expect(updated.structuredContent).toEqual({ etag: '"2"' });
    expect((await callTool(handler, "get_app", { appId })).structuredContent)
      .toMatchObject({ appId, description: "Production documents", revision: 2 });
    expect((await callTool(handler, "update_app", { appId, status: "suspended", etag: '"2"' })).structuredContent)
      .toEqual({ etag: '"3"' });
    expect((await callTool(handler, "get_app", { appId })).structuredContent).toMatchObject({ status: "suspended" });
    expect((await callTool(handler, "update_app", { appId, status: "suspended", etag: '"3"' })).structuredContent)
      .toEqual({ etag: '"3"' });
    expect((await callTool(handler, "update_app", { appId, status: "active", etag: '"2"' })).structuredContent)
      .toMatchObject({ error: "REVISION_MISMATCH" });
    expect((await callTool(handler, "update_app", { appId, status: "active", etag: '"3"' })).structuredContent)
      .toEqual({ etag: '"4"' });
    expect((await callTool(handler, "get_app", { appId })).structuredContent).toMatchObject({ status: "active" });

    const audit = await callTool(handler, "list_app_control_audit_events", { appId, limit: 10 });
    const events = audit.structuredContent.items as Array<Record<string, unknown>>;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "app.suspended" }),
      expect.objectContaining({ action: "app.restored" }),
      expect.objectContaining({
        appId,
        actorAccount: expect.objectContaining({ accountId: actorAccount.account.accountId }),
        authenticatedIdentity: expect.objectContaining({
          externalIdentityId: actorAccount.authenticatedIdentity.externalIdentityId,
          issuer: "https://accounts.google.com",
          subject: "alice-sub",
        }),
      }),
    ]));
    expect(events.every((event) => !("stackId" in event))).toBe(true);
  });

  test("lists and revokes App invitations with security scope and exact confirmation", async () => {
    const accountService = new AccountService(new D1AccountRepository(db), () => 1000);
    const actor = await accountService.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "alice-sub",
      displayName: "Alice",
    });
    const appId = "cas_app_invitations";
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES (?, 'Invitations', '', 'active', 1, 1)",
    ).bind(appId).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES (?, ?, ?, 1, ?)",
    ).bind(appId, actor.authenticatedIdentity.issuer, actor.authenticatedIdentity.subject, actor.account.accountId).run();
    const legacyCreate = vi.fn(async () => { throw new Error("legacy invitation create must not be called"); });
    const legacyList = vi.fn(async () => { throw new Error("legacy invitation list must not be called"); });
    const legacyRevoke = vi.fn(async () => { throw new Error("legacy invitation revoke must not be called"); });
    const legacyAccept = vi.fn(async () => { throw new Error("legacy invitation accept must not be called"); });
    const handler = createMcpHandler(
      () => createControlPlaneMcpServer({
        ...createControlPlaneOperations(db),
        createMemberInvitation: legacyCreate,
        listAppMemberInvitations: legacyList,
        revokeAppMemberInvitation: legacyRevoke,
        acceptMemberInvitation: legacyAccept,
      }, { mutationsEnabled: true, publicOrigin: "https://console.unicas.work", accountService }),
      { route: "/mcp", authContext: { props: grant(["control:security"]) } },
    );
    const invitation = await callTool(handler, "invite_app_member", {
      appId,
      email: "synthetic@example.test",
      confirmEmail: "synthetic@example.test",
      idempotencyKey: "inv-create",
    });
    const createdInvitationId = String(invitation.structuredContent.invitationId);
    expect(createdInvitationId).toBeTruthy();
    expect((await callTool(handler, "invite_app_member", {
      appId,
      email: "synthetic@example.test",
      confirmEmail: "synthetic@example.test",
      idempotencyKey: "inv-create",
    })).structuredContent).toEqual(invitation.structuredContent);
    const list = await callTool(handler, "list_app_member_invitations", { appId, status: "pending" });
    expect(list.structuredContent).toMatchObject({ items: [{ invitationId: createdInvitationId, status: "pending" }] });
    expect(JSON.stringify(list.structuredContent)).not.toMatch(/tokenHash|acceptUrl/);
    expect((await callTool(handlerFor(grant(["control:read"])), "list_app_member_invitations", { appId })).content[0]?.text).toContain("control:security");
    expect((await callTool(handler, "revoke_app_member_invitation", { appId, invitationId: createdInvitationId, confirmInvitationId: "wrong", etag: '"1"' })).isError).toBe(true);
    expect((await callTool(handler, "revoke_app_member_invitation", { appId, invitationId: createdInvitationId, confirmInvitationId: createdInvitationId, etag: '"1"' })).structuredContent).toEqual({ etag: '"2"' });
    expect((await callTool(handler, "list_app_member_invitations", { appId, status: "revoked" })).structuredContent).toMatchObject({ items: [{ invitationId: createdInvitationId, status: "revoked" }] });
    const acceptedInvitation = await callTool(handler, "invite_app_member", {
      appId,
      email: "alice@example.com",
      confirmEmail: "alice@example.com",
      idempotencyKey: "inv-accept",
    });
    const acceptedToken = new URL(String(acceptedInvitation.structuredContent.acceptUrl)).pathname.split("/").at(-1)!;
    expect((await callTool(handler, "accept_app_member_invitation", { token: acceptedToken })).structuredContent)
      .toEqual({ appId });
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(legacyList).not.toHaveBeenCalled();
    expect(legacyRevoke).not.toHaveBeenCalled();
    expect(legacyAccept).not.toHaveBeenCalled();
  });

  test("creates, lists, and revokes platform invitations with current platform authority", async () => {
    const accountService = new AccountService(new D1AccountRepository(db), () => 1000);
    const alice = await accountService.createForExternalIdentity({ provider: "google", issuer: "https://accounts.google.com", subject: "alice-sub", displayName: "Alice" });
    const target = await accountService.createForExternalIdentity({ provider: "google", issuer: "https://accounts.google.com", subject: "target-sub", displayName: "Target" });
    await db.prepare("INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'platform.admin', 1)")
      .bind(alice.account.accountId).run();
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at, account_id) VALUES ('alice-ref', ?, ?, 'active', 1, 0, 1, 1, 1, ?)")
      .bind("https://accounts.google.com", "alice-sub", alice.account.accountId).run();
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at, account_id) VALUES ('target-ref', ?, 'target-sub', 'active', 0, 0, 1, 1, 1, ?)")
      .bind("https://accounts.google.com", target.account.accountId).run();
    const repository = new D1PlatformAccessRepository(db);
    const platformAccess = new PlatformAccessService(repository);
    const platformInvitations = new PlatformInvitationService(
      repository,
      platformAccess,
      { seal: async token => `sealed:${token}`, open: async sealed => sealed.slice(7) },
    );
    const handler = handlerFor(grant(["control:security"]), {
      mutationsEnabled: true,
      publicOrigin: "https://console.unicas.work",
      platformInvitations,
      platformAudit: new PlatformAuditService(repository, platformAccess),
      platformAccess,
      accountService,
    });

    expect((await callTool(handler, "create_platform_invitation", {
      email: "developer@example.com",
      confirmEmail: "wrong@example.com",
      authorities: ["apps.create"],
      idempotencyKey: "platform-invite-1",
    })).isError).toBe(true);
    const created = await callTool(handler, "create_platform_invitation", {
      email: "developer@example.com",
      confirmEmail: "developer@example.com",
      authorities: ["apps.create"],
      idempotencyKey: "platform-invite-1",
    });
    expect(created.structuredContent).toMatchObject({
      invitationId: expect.any(String),
      acceptUrl: expect.stringMatching(/^https:\/\/console\.unicas\.work\/admin\/platform-invitations\//),
      etag: '"1"',
    });
    const invitationId = String(created.structuredContent.invitationId);
    expect((await callTool(handler, "list_platform_accounts", { authority: "platform.admin" })).structuredContent)
      .toMatchObject({ items: [{ accountId: alice.account.accountId }] });
    expect((await callTool(handler, "get_platform_account", { accountId: target.account.accountId })).structuredContent)
      .toMatchObject({ accountId: target.account.accountId, platformAuthorities: [] });
    expect((await callTool(handler, "grant_platform_authority", {
      accountId: target.account.accountId,
      confirmAccountId: "wrong",
      authority: "apps.create",
    })).isError).toBe(true);
    expect((await callTool(handler, "grant_platform_authority", {
      accountId: target.account.accountId,
      confirmAccountId: target.account.accountId,
      authority: "apps.create",
    })).structuredContent).toEqual({ ok: true });
    expect((await callTool(handler, "block_platform_account", {
      accountId: target.account.accountId,
      confirmAccountId: target.account.accountId,
    })).structuredContent).toEqual({ ok: true });
    expect((await callTool(handler, "restore_platform_account", {
      accountId: target.account.accountId,
      confirmAccountId: target.account.accountId,
    })).structuredContent).toEqual({ ok: true });
    const listed = await callTool(handler, "list_platform_invitations", { status: "pending" });
    expect(listed.structuredContent).toMatchObject({
      items: [{ invitationId, emailConstraint: "developer@example.com", authorities: ["apps.create"] }],
    });
    expect(JSON.stringify(listed.structuredContent)).not.toMatch(/acceptUrl|tokenHash|sealedToken/);
    expect((await callTool(handler, "list_platform_audit_events", {
      action: "platform_invitation.created",
      actorAccountId: alice.account.accountId,
      limit: 10,
    })).structuredContent).toMatchObject({
      items: [{
        action: "platform_invitation.created",
        actorAccount: { accountId: alice.account.accountId },
        authenticatedIdentity: { externalIdentityId: alice.authenticatedIdentity.externalIdentityId },
        targetInvitationId: invitationId,
      }],
    });
    expect((await callTool(handler, "revoke_platform_invitation", {
      invitationId,
      confirmInvitationId: "wrong",
      etag: '"1"',
    })).isError).toBe(true);
    expect((await callTool(handler, "revoke_platform_invitation", {
      invitationId,
      confirmInvitationId: invitationId,
      etag: '"1"',
    })).structuredContent).toEqual({ etag: '"2"' });
  });

  test("serves Account-keyed App memberships without retired Playground tools", async () => {
    const accountService = new AccountService(new D1AccountRepository(db), () => 1000);
    const aliceAccount = await accountService.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "alice-sub",
      displayName: "Alice",
    });
    const aliceHandler = handlerFor(
      grant(["control:read", "control:write", "control:security"]),
      { mutationsEnabled: true, publicOrigin: "https://console.unicas.work", accountService },
    );
    expect((await callTool(aliceHandler, "get_current_account", {})).structuredContent).toMatchObject({
      account: { accountId: aliceAccount.account.accountId },
      authenticatedIdentity: { provider: "google" },
      memberships: [],
    });
    const created = await callTool(aliceHandler, "create_app", {
      displayName: "Collaboration",
      idempotencyKey: "create-collaboration-1",
    });
    const appId = String(created.structuredContent.appId);
    const invitation = await callTool(aliceHandler, "invite_app_member", {
      appId,
      email: "bob@example.com",
      confirmEmail: "bob@example.com",
      idempotencyKey: "invite-bob-app-1",
    });
    expect(invitation.structuredContent).toMatchObject({ invitationId: expect.any(String), expiresAt: expect.any(Number), etag: '"1"' });
    expect(invitation.structuredContent).not.toHaveProperty("invitation");
    const token = String(invitation.structuredContent.acceptUrl).split("/").pop()!;

    const bobAccount = await accountService.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "bob-sub",
      displayName: "Bob",
    });
    const bobHandler = handlerFor({
      ...grant(["control:read", "control:security"]),
      subject: "bob-sub",
      displayName: "Bob",
      emailForDisplay: "bob@example.com",
      verifiedEmailEvidence: [emailEvidence("bob@example.com", "bob-auth")],
    }, { mutationsEnabled: true, accountService });
    expect((await callTool(bobHandler, "accept_app_member_invitation", { token })).structuredContent)
      .toEqual({ appId });

    const members = await callTool(aliceHandler, "list_app_members", { appId, limit: 10 });
    expect(members.structuredContent.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        appId,
        account: expect.objectContaining({ accountId: aliceAccount.account.accountId }),
      }),
      expect.objectContaining({
        appId,
        account: expect.objectContaining({ accountId: bobAccount.account.accountId, displayName: "Bob" }),
      }),
    ]));
    expect((await callTool(aliceHandler, "remove_app_member", {
      appId,
      accountId: bobAccount.account.accountId,
      confirmAccountId: bobAccount.account.accountId,
    })).structuredContent).toEqual({ ok: true });
    expect((await callTool(aliceHandler, "list_app_members", { appId, limit: 10 })).structuredContent)
      .toMatchObject({ items: [{ account: { accountId: aliceAccount.account.accountId } }] });
    expect(APP_ADMIN_MCP_TOOL_LIST.map(tool => tool.name)).not.toEqual(expect.arrayContaining([
      "list_app_playground_file_roots",
      "create_app_playground_file_root",
      "update_app_playground_file_root",
      "delete_app_playground_file_root",
    ]));
  });

  test("maps physical audit dimensions to App and Space MCP output", async () => {
    const accountService = new AccountService(new D1AccountRepository(db), () => 1000);
    const actor = await accountService.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "alice-sub",
      displayName: "Alice",
    });
    const appId = "cas_audit_app";
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES (?, 'Audit App', '', 'active', 1, 1)",
    ).bind(appId).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES (?, ?, ?, 1, ?)",
    ).bind(appId, actor.authenticatedIdentity.issuer, actor.authenticatedIdentity.subject, actor.account.accountId).run();
    const requests: URL[] = [];
    const auditReader = {
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url);
        if (url.pathname === "/_internal/audit/domains") {
          return Response.json({ domains: [{ stackId: url.searchParams.get("stackId"), refDomain: "doc", revision: 2 }] });
        }
        if (url.pathname === "/_internal/audit/refs") {
          return Response.json({
            revision: 2,
            refs: [{ tenantId: url.searchParams.get("tenantId"), hash: "a".repeat(64), count: 1 }],
            nextCursor: null,
          });
        }
        return Response.json({
          events: [{ revision: 2, tenantId: url.searchParams.get("tenantId"), requestId: "request-1", changes: {}, appliedAt: 1 }],
          latestRevision: 2,
          nextAfter: 2,
        });
      },
    };
    const handler = handlerFor(
      grant(["control:read"]),
      { auditReader, accountService },
    );

    expect((await callTool(handler, "list_app_ref_domains", { appId })).structuredContent)
      .toEqual({ domains: [{ appId, refDomain: "doc", revision: 2 }] });
    expect((await callTool(handler, "list_space_root_domain_refs", {
      appId,
      refDomain: "doc",
      spaceId: "space-1",
    })).structuredContent).toMatchObject({ refs: [{ spaceId: "space-1", count: 1 }] });
    expect((await callTool(handler, "list_space_root_domain_events", {
      appId,
      refDomain: "doc",
      spaceId: "space-1",
    })).structuredContent).toMatchObject({ events: [{ spaceId: "space-1", revision: 2 }] });

    expect(requests.map((url) => ({
      pathname: url.pathname,
      stackId: url.searchParams.get("stackId"),
      tenantId: url.searchParams.get("tenantId"),
      spaceId: url.searchParams.get("spaceId"),
    }))).toEqual([
      { pathname: "/_internal/audit/domains", stackId: appId, tenantId: null, spaceId: null },
      { pathname: "/_internal/audit/refs", stackId: appId, tenantId: "space-1", spaceId: null },
      { pathname: "/_internal/audit/events", stackId: appId, tenantId: "space-1", spaceId: null },
    ]);
  });
});

function grant(scopes: readonly string[]): ControlPlaneMcpGrantProps {
  return {
    identityIssuer: "https://accounts.google.com", subject: "alice-sub", displayName: "Alice",
    emailForDisplay: "alice@example.com", verifiedEmailEvidence: [emailEvidence("alice@example.com", "alice-auth")],
    scopes, oauthClientId: "github-copilot", oauthClientHandle: "a".repeat(64),
  };
}
function emailEvidence(normalizedEmail: string, authenticationEventId: string) {
  return {
    normalizedEmail,
    source: "google-oidc" as const,
    verifiedAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
    authenticationEventId,
  };
}
function handlerFor(props: ControlPlaneMcpGrantProps, options: Parameters<typeof createControlPlaneMcpServer>[1] = {}) {
  return createMcpHandler(
    () => createControlPlaneMcpServer(createControlPlaneOperations(db), options),
    { route: "/mcp", authContext: { props } },
  );
}
function mcpRequest(handler: ReturnType<typeof createMcpHandler>, method: string, params: Record<string, unknown>): Promise<Response> {
  const headers = new Headers({
    Accept: "application/json, text/event-stream", "Content-Type": "application/json", Host: "localhost",
    "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method,
  });
  if (method === "tools/call" && typeof params.name === "string") headers.set("Mcp-Name", params.name);
  return handler.fetch(new Request("https://localhost/mcp", {
    method: "POST", headers, body: JSON.stringify({
      jsonrpc: "2.0", id: crypto.randomUUID(), method, params: {
        ...params, _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "control-plane-mcp-test", version: "1.0.0" },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        }
      }
    }),
  }));
}
async function callTool(handler: ReturnType<typeof createMcpHandler>, name: string, argumentsValue: Record<string, unknown>): Promise<{
  isError?: boolean; content: Array<{ text: string }>; structuredContent: Record<string, unknown>;
}> {
  const response = await mcpRequest(handler, "tools/call", { name, arguments: argumentsValue });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json() as { result: { isError?: boolean; content: Array<{ text: string }>; structuredContent: Record<string, unknown> } };
  return body.result;
}
