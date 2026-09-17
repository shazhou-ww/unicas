import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { CompactSign, exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { CasAdminErrorCodes } from "@unicas/admin-protocol";
import type { CasAdminErrorResponse, CasOperatorIdentityKey } from "@unicas/admin-protocol";
import {
  AppSpaceCapabilityVerifier,
  ControlAuditActions,
  type ControlPlaneCallContext,
  type ControlPlaneOperations,
  type ManagedCapabilityIssuer,
  type OAuthDiscoveryPort,
} from "@unicas/service";
import { AppAuthorityRepository } from "../src/control-authority.js";
import { migrateControlSchema } from "../src/control-schema.js";
import { createControlPlaneOperations } from "../src/control-operations.js";
import { ControlSessionStore } from "../src/control-sessions.js";
import { CloudflareManagedIssuer } from "../src/managed-issuer.js";

let miniflare: Miniflare | undefined;
afterEach(async () => {
  await miniflare?.dispose();
  miniflare = undefined;
});

async function createService(
  now?: () => number,
  oauthDiscovery?: OAuthDiscoveryPort,
  managedOAuthIssuer?: ManagedCapabilityIssuer,
): Promise<{ db: D1Database; service: ControlPlaneOperations }> {
  miniflare = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "control-plane-service-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "control-plane-service-test-db" },
    }]
  }));
  await miniflare.ready;
  const db = await miniflare.getD1Database("DB", "control-plane-service-test");
  await migrateControlSchema(db);
  return {
    db,
    service: createControlPlaneOperations(db, {
      now,
      oauthDiscovery,
      oauthResourcePublicOrigin: "https://cas.example",
      managedOAuthIssuer,
    }),
  };
}

const ISSUER = "https://accounts.google.com";
const alice: CasOperatorIdentityKey = { identityIssuer: ISSUER, subject: "alice-sub" };
const bob: CasOperatorIdentityKey = { identityIssuer: ISSUER, subject: "bob-sub" };
function ctx(identity: CasOperatorIdentityKey, email = `${identity.subject}@example.com`): ControlPlaneCallContext {
  return {
    identity,
    profile: { displayName: identity.subject, emailForDisplay: email },
    verifiedEmailEvidence: [{
      normalizedEmail: email.trim().toLowerCase(),
      source: "google-oidc",
      verifiedAt: 900_000,
      expiresAt: 1_100_000,
      authenticationEventId: `auth-${identity.subject}`,
    }],
    requestId: "req-1",
    traceId: "trace-1",
  };
}
function expectError(value: unknown, error: CasAdminErrorResponse["error"]): void {
  expect(value).toMatchObject({ error });
}
async function createStack(service: ControlPlaneOperations, identity = alice, displayName = "Stack"): Promise<string> {
  const response = await service.createStack(ctx(identity), { body: { displayName } });
  if ("error" in response) throw new Error(response.error);
  return response.stackId;
}

describe("D1-backed control-plane service", () => {
  test("manages identities, stack visibility, metadata revisions, and membership authorization", async () => {
    const { service } = await createService();
    expect(await service.me(ctx(alice))).toMatchObject({ memberships: [], identity: { subject: "alice-sub" } });
    expect(await service.me(ctx(alice, "new@example.com"))).toMatchObject({ identity: { emailForDisplay: "new@example.com" } });
    const stackId = await createStack(service, alice, "Alice Stack");
    expect(await service.listStacks(ctx(alice), {})).toMatchObject({ items: [{ stackId, displayName: "Alice Stack", description: "", revision: 1 }] });
    expect(await service.listStacks(ctx(bob), {})).toMatchObject({ items: [] });
    expectError(await service.getStack(ctx(bob), { path: { stackId } }), CasAdminErrorCodes.STACK_MEMBERSHIP_REQUIRED);
    expectError(await service.patchStack(ctx(alice), { path: { stackId }, body: { displayName: "Renamed" } }, {}), CasAdminErrorCodes.PRECONDITION_REQUIRED);
    expectError(await service.patchStack(ctx(alice), { path: { stackId }, body: { displayName: "Renamed" } }, { ifMatch: '"99"' }), CasAdminErrorCodes.REVISION_MISMATCH);
    expect(await service.patchStack(ctx(alice), { path: { stackId }, body: { displayName: "Renamed", description: "Production" } }, { ifMatch: '"1"' }))
      .toMatchObject({ displayName: "Renamed", description: "Production", revision: 2 });
  }, 10_000);

  test("isolates Playground file roots per member and enforces root revisions", async () => {
    const { db, service } = await createService(() => 10_000);
    const stackId = await createStack(service);
    await db.prepare("INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at) VALUES (?, ?, ?, ?)")
      .bind(stackId, bob.identityIssuer, bob.subject, 1)
      .run();
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    const request = { path: { stackId }, body: { rootId: "root-1", name: "Files", manifestHash: firstHash } };

    expect(await service.createPlaygroundFileRoot(ctx(alice), request)).toMatchObject({ rootId: "root-1", revision: 1 });
    expect(await service.createPlaygroundFileRoot(ctx(bob), request)).toMatchObject({ rootId: "root-1", revision: 1 });
    expect(await service.listPlaygroundFileRoots(ctx(alice), { path: { stackId } })).toMatchObject({ items: [{ name: "Files" }] });
    expect(await service.listPlaygroundFileRoots(ctx(bob), { path: { stackId } })).toMatchObject({ items: [{ name: "Files" }] });

    const patch = { path: { stackId, rootId: "root-1" }, body: { name: "Renamed", manifestHash: secondHash } };
    expectError(await service.patchPlaygroundFileRoot(ctx(alice), patch, {}), CasAdminErrorCodes.PRECONDITION_REQUIRED);
    expect(await service.patchPlaygroundFileRoot(ctx(alice), patch, { ifMatch: '"1"' })).toMatchObject({ name: "Renamed", revision: 2 });
    expectError(await service.patchPlaygroundFileRoot(ctx(alice), patch, { ifMatch: '"1"' }), CasAdminErrorCodes.REVISION_MISMATCH);
    expect(await service.listPlaygroundFileRoots(ctx(bob), { path: { stackId } })).toMatchObject({ items: [{ name: "Files", revision: 1 }] });
  });

  test("mints a managed Space capability accepted by the App authority adapter", async () => {
    let clock = 1_700_000_000_000;
    const now = () => clock;
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const managedIssuer = new CloudflareManagedIssuer({
      publicOrigin: "https://cas.example",
      privateKeyPkcs8: await exportPKCS8(privateKey),
      keyId: "managed-integration",
      now,
    });
    const { db, service } = await createService(now, undefined, managedIssuer);
    const appId = await createStack(service, alice, "Managed App");
    const capability = await service.mintManagedSpaceCapability(ctx(alice), appId);
    if ("error" in capability) throw new Error(capability.error);

    expect(capability).not.toHaveProperty("tenantId");
    expect(capability.permissions).toEqual([
      `spaces:${capability.spaceId}:cas:read`,
      `spaces:${capability.spaceId}:cas:write`,
      `spaces:${capability.spaceId}:cas:manage`,
    ]);

    const verifier = new AppSpaceCapabilityVerifier({
      repository: new AppAuthorityRepository(db),
      now,
      jwksFetcher: async () => Response.json(await managedIssuer.jwks()),
    });
    await expect(verifier.verify(new Request(
      `https://cas.example/v2/apps/${appId}/spaces/${capability.spaceId}/cas/usage`,
      { headers: { Authorization: `Bearer ${capability.accessToken}` } },
    ), {
      operation: "usage",
      appId,
      spaceId: capability.spaceId,
    })).resolves.toMatchObject({
      appId,
      spaceId: capability.spaceId,
      permissions: capability.permissions,
    });
    const request = new Request(`https://cas.example/v2/apps/${appId}/spaces/${capability.spaceId}/cas/usage`, {
      headers: { Authorization: `Bearer ${capability.accessToken}` },
    });
    const route = { operation: "usage" as const, appId, spaceId: capability.spaceId };
    expect(await service.patchApp(ctx(alice), appId, { status: "suspended" }, { ifMatch: '"1"' })).toEqual({ revision: 2 });
    expect(await service.mintManagedSpaceCapability(ctx(alice), appId)).toMatchObject({ error: "APP_SUSPENDED" });
    clock += 30_000;
    await expect(verifier.verify(request, route)).rejects.toMatchObject({ code: "APP_SUSPENDED" });
    expect(await service.getManagedOAuthIssuer(ctx(alice), { path: { stackId: appId } })).toMatchObject({ status: "active" });
    expect(await service.patchApp(ctx(alice), appId, { status: "active" }, { ifMatch: '"2"' })).toEqual({ revision: 3 });
    clock += 30_000;
    await expect(verifier.verify(request, route)).resolves.toMatchObject({ appId, spaceId: capability.spaceId });
    const audit = await db.prepare(
      "SELECT action, identity_issuer, subject FROM cas_control_audit_events WHERE app_id = ? AND action IN ('app.suspended', 'app.restored')",
    ).bind(appId).all();
    expect(audit.results).toEqual(expect.arrayContaining([
      { action: "app.suspended", identity_issuer: alice.identityIssuer, subject: alice.subject },
      { action: "app.restored", identity_issuer: alice.identityIssuer, subject: alice.subject },
    ]));
  }, 10_000);

  test("enforces invitation constraints, expiry, one-time use, and last-member transfer", async () => {
    let clock = 1_000_000;
    const { db, service } = await createService(() => clock);
    const stackId = await createStack(service);
    expectError(await service.deleteMember(ctx(alice), { path: { stackId }, query: alice }, { ifMatch: '"1"' }), CasAdminErrorCodes.LAST_MEMBER);
    const invitationRequest = { path: { stackId }, body: { emailConstraint: " BOB-SUB@example.com " } };
    const invitation = await service.createMemberInvitation(ctx(alice), invitationRequest, { idempotencyKey: "invite-bob-1" });
    expect(await service.createMemberInvitation(ctx(alice), invitationRequest, { idempotencyKey: "invite-bob-1" })).toEqual(invitation);
    expectError(
      await service.createMemberInvitation(ctx(alice), { path: { stackId }, body: { emailConstraint: "other@example.com" } }, { idempotencyKey: "invite-bob-1" }),
      CasAdminErrorCodes.IDEMPOTENCY_CONFLICT,
    );
    if (!("invitation" in invitation)) throw new Error("invite failed");
    const token = invitation.acceptUrl.split("/").pop()!;
    expectError(await service.acceptMemberInvitation(ctx(bob, "wrong@example.com"), { path: { token } }), CasAdminErrorCodes.NOT_FOUND);
    expect(await service.acceptMemberInvitation(ctx(bob), { path: { token } })).toMatchObject({ stackId, subject: "bob-sub" });
    expect(await db.prepare(
      "SELECT principal_ref, status, platform_admin, apps_create FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ?",
    ).bind(bob.identityIssuer, bob.subject).first()).toEqual({
      principal_ref: expect.stringMatching(/^prn_[A-Za-z0-9_-]{16}$/),
      status: "active",
      platform_admin: 0,
      apps_create: 0,
    });
    expectError(await service.acceptMemberInvitation(ctx(bob), { path: { token } }), CasAdminErrorCodes.NOT_FOUND);
    expect(await service.listMembers(ctx(alice), { path: { stackId }, query: { limit: 1 } })).toMatchObject({
      items: [{ subject: "alice-sub", displayName: null, emailForDisplay: null }],
      nextCursor: expect.any(String),
    });
    const members = await service.listMembers(ctx(alice), { path: { stackId }, query: { limit: 10 } });
    expect(members).toMatchObject({
      items: [
        { subject: "alice-sub" },
        { subject: "bob-sub", displayName: "bob-sub", emailForDisplay: "bob-sub@example.com" },
      ],
    });
    await service.patchStack(ctx(alice), { path: { stackId }, body: { description: "revision two" } }, { ifMatch: '"1"' });
    expectError(await service.deleteMember(ctx(alice), { path: { stackId }, query: alice }, { ifMatch: '"1"' }), CasAdminErrorCodes.REVISION_MISMATCH);
    expect(await service.deleteMember(ctx(alice), { path: { stackId }, query: alice }, { ifMatch: '"2"' })).toEqual({ ok: true });

    const expiring = await service.createMemberInvitation(ctx(bob), { path: { stackId } });
    if (!("invitation" in expiring)) throw new Error("invite failed");
    clock += 25 * 60 * 60 * 1000;
    expectError(await service.acceptMemberInvitation(ctx(alice), { path: { token: expiring.acceptUrl.split("/").pop()! } }), CasAdminErrorCodes.NOT_FOUND);
  }, 10_000);

  test("lists non-secret App invitations and conditionally revokes without deleting history", async () => {
    const { service } = await createService(() => 5_000);
    const appId = await createStack(service);
    const invitation = await service.createMemberInvitation(ctx(alice), { path: { stackId: appId } });
    if (!("invitation" in invitation)) throw new Error("invite failed");
    const page = await service.listAppMemberInvitations(ctx(alice), appId, {});
    expect(page).toMatchObject({ items: [{ appId, invitationId: invitation.invitation.invitationId, status: "pending", revision: 1 }], nextCursor: null });
    expect(JSON.stringify(page)).not.toMatch(/tokenHash|token_hash|acceptUrl/);
    expect(await service.revokeAppMemberInvitation(ctx(alice), appId, invitation.invitation.invitationId, { ifMatch: '"1"' })).toEqual({ revision: 2 });
    expect(await service.revokeAppMemberInvitation(ctx(alice), appId, invitation.invitation.invitationId, { ifMatch: '"2"' })).toEqual({ revision: 2 });
    expect(await service.revokeAppMemberInvitation(ctx(alice), appId, invitation.invitation.invitationId, { ifMatch: '"1"' })).toMatchObject({ error: "REVISION_MISMATCH" });
    expect(await service.listAppMemberInvitations(ctx(alice), appId, { status: "revoked" })).toMatchObject({ items: [{ status: "revoked", revision: 2 }] });
    expect(await service.listAppMemberInvitations(ctx(bob), appId, {})).toMatchObject({ error: "STACK_MEMBERSHIP_REQUIRED" });
    expect(await service.acceptMemberInvitation(ctx(bob), { path: { token: invitation.acceptUrl.split("/").pop()! } })).toMatchObject({ error: "NOT_FOUND" });
  });

  test("binds invitation pages to App, filter, and snapshot and reconciles expiry once", async () => {
    let clock = 5_000;
    const { db, service } = await createService(() => clock);
    const appId = await createStack(service);
    const otherAppId = await createStack(service);
    for (let index = 0; index < 2; index += 1) await service.createMemberInvitation(ctx(alice), { path: { stackId: appId } });
    const first = await service.listAppMemberInvitations(ctx(alice), appId, { limit: 1, status: "pending" });
    if (!("items" in first) || !first.nextCursor) throw new Error("missing invitation cursor");
    expect(await service.listAppMemberInvitations(ctx(alice), otherAppId, { status: "pending", cursor: first.nextCursor })).toMatchObject({ error: "INVALID_CURSOR" });
    expect(await service.listAppMemberInvitations(ctx(alice), appId, { status: "revoked", cursor: first.nextCursor })).toMatchObject({ error: "INVALID_CURSOR" });
    expect(await service.listAppMemberInvitations(ctx(alice), appId, { status: "pending", cursor: first.nextCursor })).toMatchObject({ items: [expect.any(Object)], nextCursor: null });
    clock = first.items[0]!.expiresAt;
    expect(await service.listAppMemberInvitations(ctx(alice), appId, { status: "pending", cursor: first.nextCursor })).toMatchObject({ error: "INVALID_CURSOR" });
    const expired = await service.listAppMemberInvitations(ctx(alice), appId, { status: "expired" });
    expect(expired).toMatchObject({ items: [{ status: "expired", revision: 2 }, { status: "expired", revision: 2 }] });
    expect(await service.revokeAppMemberInvitation(ctx(alice), appId, first.items[0]!.invitationId, { ifMatch: '"2"' })).toMatchObject({ error: "INVITATION_NOT_PENDING" });
    expect(await db.prepare("SELECT count(*) AS count FROM cas_control_audit_events WHERE app_id = ? AND action = 'member.invitation.expired'").bind(appId).first()).toEqual({ count: 2 });
    expect(await service.revokeAppMemberInvitation(ctx(alice), otherAppId, first.items[0]!.invitationId, { ifMatch: '"2"' })).toMatchObject({ error: "NOT_FOUND" });
  }, 10_000);

  test("acceptance and revocation cannot both win the same invitation", async () => {
    const { db, service } = await createService(() => 5_000);
    const appId = await createStack(service);
    const created = await service.createMemberInvitation(ctx(alice), { path: { stackId: appId } });
    if (!("invitation" in created)) throw new Error("invitation failed");
    const [accept, revoke] = await Promise.all([
      service.acceptMemberInvitation(ctx(bob), { path: { token: created.acceptUrl.split("/").pop()! } }),
      service.revokeAppMemberInvitation(ctx(alice), appId, created.invitation.invitationId, { ifMatch: '"1"' }),
    ]);
    expect([accept, revoke].filter(result => !("error" in result))).toHaveLength(1);
    const state = await db.prepare("SELECT status, revision FROM cas_app_member_invitations WHERE invitation_id = ?").bind(created.invitation.invitationId).first();
    expect(state).toEqual({ status: "error" in accept ? "revoked" : "accepted", revision: 2 });
  });

  test("atomically lets exactly one concurrent claimant consume a pending invitation", async () => {
    const { db, service } = await createService(() => 5_000);
    const stackId = await createStack(service);
    const invitation = await service.createMemberInvitation(ctx(alice), { path: { stackId } });
    if (!("acceptUrl" in invitation)) throw new Error("invite failed");
    const token = invitation.acceptUrl.split("/").pop()!;
    const [left, right] = await Promise.all([
      service.acceptMemberInvitation(ctx(bob), { path: { token } }),
      service.acceptMemberInvitation(ctx(bob), { path: { token } }),
    ]);
    expect([left, right].filter((result) => "stackId" in result)).toHaveLength(1);
    expect([left, right].filter((result) => "error" in result)).toEqual([
      expect.objectContaining({ error: CasAdminErrorCodes.NOT_FOUND }),
    ]);
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM cas_app_members WHERE app_id = ? AND identity_issuer = ? AND subject = ?",
    ).bind(stackId, bob.identityIssuer, bob.subject).first()).toEqual({ count: 1 });
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM cas_control_audit_events WHERE app_id = ? AND action = 'member.invitation.accepted'",
    ).bind(stackId).first()).toEqual({ count: 1 });
  });

  test("reads persisted OAuth issuer state only for Stack members", async () => {
    const { db, service } = await createService();
    const stackId = await createStack(service);
    await db.prepare(
      "INSERT INTO cas_app_oauth_issuers (app_id, issuer, audience, metadata_url, metadata_type, authorization_endpoint, token_endpoint, jwks_uri, registration_endpoint, scopes_supported, code_challenge_methods_supported, status, verified_at, last_refresh_at, last_refresh_error, jwks_digest, capability_max_lifetime_seconds, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      stackId,
      "https://issuer.example/oauth",
      `https://cas.example/stacks/${stackId}`,
      "https://issuer.example/.well-known/oauth-authorization-server/oauth",
      "oauth",
      "https://issuer.example/oauth/authorize",
      "https://issuer.example/oauth/token",
      "https://issuer.example/oauth/jwks",
      "https://issuer.example/oauth/register",
      JSON.stringify(["cas:read", "cas:write"]),
      JSON.stringify(["S256"]),
      "active",
      100,
      110,
      null,
      "sha256:test",
      28800,
      3,
    ).run();
    expectError(
      await service.getOAuthIssuer(ctx(bob), { path: { stackId } }),
      CasAdminErrorCodes.STACK_MEMBERSHIP_REQUIRED,
    );
    expect(await service.getOAuthIssuer(ctx(alice), { path: { stackId } })).toMatchObject({
      stackId,
      metadataType: "oauth",
      status: "active",
      scopesSupported: ["cas:read", "cas:write"],
      codeChallengeMethodsSupported: ["S256"],
      revision: 3,
    });
  });

  test("atomically persists an OAuth issuer inspection snapshot", async () => {
    const pair = await generateKeyPair("ES256");
    const publicJwk = { ...await exportJWK(pair.publicKey), kid: "key-1", alg: "ES256" };
    const oauthDiscovery: OAuthDiscoveryPort = {
      inspectIssuer: async ({ issuer }) => ({
        metadata: {
          issuer,
          metadataUrl: "https://issuer.example/.well-known/oauth-authorization-server/oauth",
          metadataType: "oauth",
          authorizationEndpoint: "https://issuer.example/oauth/authorize",
          tokenEndpoint: "https://issuer.example/oauth/token",
          jwksUri: "https://issuer.example/oauth/jwks",
          registrationEndpoint: null,
          scopesSupported: ["cas:read"],
          codeChallengeMethodsSupported: ["S256"],
        },
        metadataDigest: "a".repeat(64),
        jwksDigest: "b".repeat(64),
        keys: [{
          kid: "key-1",
          algorithm: "ES256",
          publicJwk,
        }],
      }),
    };
    const { db, service } = await createService(() => 1_000, oauthDiscovery);
    const stackId = await createStack(service);
    const result = await service.inspectOAuthIssuer(ctx(alice), {
      path: { stackId },
      body: { issuer: "https://issuer.example/oauth" },
    });
    if (!("challenge" in result)) throw new Error("inspection failed");
    expect(await service.getOAuthIssuer(ctx(alice), { path: { stackId } })).toMatchObject({
      status: "pending",
      audience: `https://cas.example/stacks/${stackId}`,
      capabilityMaxLifetimeSeconds: 1800,
      jwksDigest: "b".repeat(64),
      revision: 1,
    });
    const inspection = await db.prepare(
      "SELECT challenge_hash, expires_at, used_at FROM cas_oauth_issuer_inspections WHERE inspection_id = ?",
    ).bind(result.inspectionId).first();
    expect(inspection).toMatchObject({
      challenge_hash: await import("@unicas/service").then(({ sha256Hex }) => sha256Hex(result.challenge)),
      expires_at: 601_000,
      used_at: null,
    });
    expect(await db.prepare(
      "SELECT kid, algorithm FROM cas_oauth_issuer_inspection_keys WHERE inspection_id = ?",
    ).bind(result.inspectionId).first()).toEqual({ kid: "key-1", algorithm: "ES256" });
    expect(await db.prepare(
      "SELECT action FROM cas_control_audit_events WHERE app_id = ? AND action = 'oauth_issuer.inspection.created'",
    ).bind(stackId).first()).toEqual({ action: "oauth_issuer.inspection.created" });
    const activationProof = await new CompactSign(new TextEncoder().encode(result.challenge))
      .setProtectedHeader({ alg: "ES256", kid: "key-1" })
      .sign(pair.privateKey);
    expect(await service.activateOAuthIssuer(ctx(alice), {
      path: { stackId },
      body: { inspectionId: result.inspectionId, activationProof },
    }, { ifMatch: '"1"' })).toMatchObject({ status: "active", revision: 2, verifiedAt: 1_000 });
    expect(await db.prepare(
      "SELECT used_at FROM cas_oauth_issuer_inspections WHERE inspection_id = ?",
    ).bind(result.inspectionId).first()).toEqual({ used_at: 1_000 });
    expect(await db.prepare(
      "SELECT jwks_uri FROM cas_app_oauth_issuers WHERE app_id = ?",
    ).bind(stackId).first()).toEqual({ jwks_uri: "https://issuer.example/oauth/jwks" });
    expect(await db.prepare(
      "SELECT action FROM cas_control_audit_events WHERE app_id = ? AND action = 'oauth_issuer.activated'",
    ).bind(stackId).first()).toEqual({ action: "oauth_issuer.activated" });
    expectError(await service.activateOAuthIssuer(ctx(alice), {
      path: { stackId },
      body: { inspectionId: result.inspectionId, activationProof },
    }, { ifMatch: '"2"' }), CasAdminErrorCodes.NOT_FOUND);
    const replacement = await service.inspectAppOAuthIssuer(ctx(alice), stackId, "https://replacement.example/oauth");
    if (!("challenge" in replacement)) throw new Error("replacement inspection failed");
    expect(replacement).not.toHaveProperty("revision");
    expect(replacement).not.toHaveProperty("appId");
    expect(await service.getOAuthIssuer(ctx(alice), { path: { stackId } })).toMatchObject({ issuer: "https://issuer.example/oauth", status: "active", revision: 2 });
    const replacementProof = await new CompactSign(new TextEncoder().encode(replacement.challenge)).setProtectedHeader({ alg: "ES256", kid: "key-1" }).sign(pair.privateKey);
    expect(await service.activateAppOAuthIssuer(ctx(alice), stackId, { inspectionId: replacement.inspectionId, activationProof: replacementProof }, { ifMatch: '"1"' })).toMatchObject({ error: "REVISION_MISMATCH" });
    expect(await service.activateAppOAuthIssuer(ctx(alice), stackId, { inspectionId: replacement.inspectionId, activationProof: replacementProof }, { ifMatch: '"2"' })).toEqual({ revision: 3 });
    expect(await service.getOAuthIssuer(ctx(alice), { path: { stackId } })).toMatchObject({ issuer: "https://replacement.example/oauth", status: "active", revision: 3 });
    expect(await new AppAuthorityRepository(db).resolveIssuer("https://issuer.example/oauth")).toBeNull();
    expect(await new AppAuthorityRepository(db).resolveIssuer("https://replacement.example/oauth")).toMatchObject({ appId: stackId });
  });

  test("initial App activation and replacement fail atomically on proof, expiry, and issuer races", async () => {
    let clock = 1_000;
    const pair = await generateKeyPair("ES256");
    const publicJwk = { ...await exportJWK(pair.publicKey), kid: "candidate-key", alg: "ES256" };
    const discovery: OAuthDiscoveryPort = {
      inspectIssuer: async ({ issuer }) => ({
        metadata: { issuer, metadataUrl: `${issuer}/metadata`, metadataType: "oauth", authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`, jwksUri: `${issuer}/jwks`, registrationEndpoint: null, scopesSupported: [], codeChallengeMethodsSupported: ["S256"] },
        metadataDigest: "a".repeat(64), jwksDigest: "b".repeat(64), keys: [{ kid: "candidate-key", algorithm: "ES256", publicJwk }],
      })
    };
    const { db, service } = await createService(() => clock, discovery);
    const firstApp = await createStack(service);
    const secondApp = await createStack(service);
    async function candidate(appId: string, issuer: string) {
      const result = await service.inspectAppOAuthIssuer(ctx(alice), appId, issuer);
      if ("error" in result) throw new Error(result.error);
      return { result, body: { inspectionId: result.inspectionId, activationProof: await new CompactSign(new TextEncoder().encode(result.challenge)).setProtectedHeader({ alg: "ES256", kid: "candidate-key" }).sign(pair.privateKey) } };
    }
    const first = await candidate(firstApp, "https://initial.example");
    expect(await service.getOAuthIssuer(ctx(alice), { path: { stackId: firstApp }, query: { optional: true } })).toBeNull();
    expect(await service.activateAppOAuthIssuer(ctx(alice), firstApp, first.body, {})).toMatchObject({ error: "PRECONDITION_REQUIRED" });
    expect(await service.activateAppOAuthIssuer(ctx(alice), firstApp, first.body, { ifMatch: '"1"', ifNoneMatch: "*" })).toMatchObject({ error: "INVALID_REQUEST" });
    expect(await service.activateAppOAuthIssuer(ctx(alice), firstApp, { ...first.body, activationProof: "invalid" }, { ifNoneMatch: "*" })).toMatchObject({ error: "INVALID_REQUEST" });
    expect(await service.activateAppOAuthIssuer(ctx(alice), firstApp, first.body, { ifNoneMatch: "*" })).toEqual({ revision: 1 });
    const second = await candidate(secondApp, "https://other.example");
    expect(await service.activateAppOAuthIssuer(ctx(alice), secondApp, second.body, { ifNoneMatch: "*" })).toEqual({ revision: 1 });
    const contenderOne = await candidate(firstApp, "https://shared-replacement.example");
    const contenderTwo = await candidate(secondApp, "https://shared-replacement.example");
    const results = await Promise.all([
      service.activateAppOAuthIssuer(ctx(alice), firstApp, contenderOne.body, { ifMatch: '"1"' }),
      service.activateAppOAuthIssuer(ctx(alice), secondApp, contenderTwo.body, { ifMatch: '"1"' }),
    ]);
    expect(results.filter(result => !("error" in result))).toEqual([{ revision: 2 }]);
    expect(results.filter(result => "error" in result)).toEqual([expect.objectContaining({ error: "ISSUER_CONFLICT" })]);
    const loserIndex = results.findIndex(result => "error" in result);
    const loserApp = loserIndex === 0 ? firstApp : secondApp;
    const loserCandidate = loserIndex === 0 ? contenderOne : contenderTwo;
    expect(await service.getOAuthIssuer(ctx(alice), { path: { stackId: loserApp } })).toMatchObject({ issuer: loserIndex === 0 ? "https://initial.example" : "https://other.example", status: "active", revision: 1 });
    expect(await db.prepare("SELECT used_at FROM cas_oauth_issuer_inspections WHERE inspection_id = ?").bind(loserCandidate.result.inspectionId).first()).toEqual({ used_at: null });
    const expiring = await candidate(loserApp, "https://expired.example");
    clock = expiring.result.expiresAt;
    expect(await service.activateAppOAuthIssuer(ctx(alice), loserApp, expiring.body, { ifMatch: '"1"' })).toMatchObject({ error: "INVALID_REQUEST" });
    expect(await service.getOAuthIssuer(ctx(alice), { path: { stackId: loserApp } })).toMatchObject({ status: "active", revision: 1 });
  }, 20_000);

  test("enforces issuer ownership across stacks in the OAuth registry", async () => {
    const oauthDiscovery: OAuthDiscoveryPort = {
      inspectIssuer: async ({ issuer }) => ({
        metadata: {
          issuer,
          metadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
          metadataType: "oauth",
          authorizationEndpoint: `${issuer}/authorize`,
          tokenEndpoint: `${issuer}/token`,
          jwksUri: `${issuer}/jwks`,
          registrationEndpoint: null,
          scopesSupported: [],
          codeChallengeMethodsSupported: ["S256"],
        },
        metadataDigest: "a".repeat(64),
        jwksDigest: "b".repeat(64),
        keys: [{ kid: "key-1", algorithm: "ES256", publicJwk: { kid: "key-1", alg: "ES256", kty: "EC", crv: "P-256", x: "x", y: "y" } }],
      }),
    };
    const { service } = await createService(() => 1_000, oauthDiscovery);
    const firstStack = await createStack(service, alice, "First");
    const secondStack = await createStack(service, alice, "Second");
    const inspected = await service.inspectOAuthIssuer(ctx(alice), {
      path: { stackId: firstStack },
      body: { issuer: "https://oauth.example" },
    });
    if (!("challenge" in inspected)) throw new Error("first inspection failed");
    expectError(await service.inspectOAuthIssuer(ctx(alice), {
      path: { stackId: secondStack },
      body: { issuer: "https://oauth.example" },
    }), CasAdminErrorCodes.ISSUER_CONFLICT);
  });

  test("maps concurrent first OAuth issuer inspections to a revision mismatch", async () => {
    let inspectionCount = 0;
    let releaseInspections: (() => void) | undefined;
    const inspectionsReady = new Promise<void>((resolve) => {
      releaseInspections = resolve;
    });
    const oauthDiscovery: OAuthDiscoveryPort = {
      inspectIssuer: async ({ issuer }) => {
        inspectionCount += 1;
        if (inspectionCount === 2) releaseInspections?.();
        await inspectionsReady;
        return {
          metadata: {
            issuer,
            metadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
            metadataType: "oauth",
            authorizationEndpoint: `${issuer}/authorize`,
            tokenEndpoint: `${issuer}/token`,
            jwksUri: `${issuer}/jwks`,
            registrationEndpoint: null,
            scopesSupported: ["cas:read"],
            codeChallengeMethodsSupported: ["S256"],
          },
          metadataDigest: "a".repeat(64),
          jwksDigest: "b".repeat(64),
          keys: [{
            kid: "key-1",
            algorithm: "ES256",
            publicJwk: { kid: "key-1", alg: "ES256", kty: "EC", crv: "P-256", x: "x", y: "y" },
          }],
        };
      },
    };
    const { service } = await createService(() => 1_000, oauthDiscovery);
    const stackId = await createStack(service);
    const request = {
      path: { stackId },
      body: { issuer: "https://issuer.example/oauth" },
    };

    const results = await Promise.all([
      service.inspectOAuthIssuer(ctx(alice), request),
      service.inspectOAuthIssuer(ctx(alice), request),
    ]);

    expect(results.filter((result) => "challenge" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toEqual([
      expect.objectContaining({ error: CasAdminErrorCodes.REVISION_MISMATCH }),
    ]);
  }, 10_000);

  test("records audit context, makes creates idempotent, and snapshot-binds cursors", async () => {
    const { service } = await createService();
    const first = await service.createStack(ctx(alice), { body: { displayName: "Same" } }, { idempotencyKey: "create-1" });
    expect(await service.createStack(ctx(alice), { body: { displayName: "Same" } }, { idempotencyKey: "create-1" })).toEqual(first);
    expectError(await service.createStack(ctx(alice), { body: { displayName: "Different" } }, { idempotencyKey: "create-1" }), CasAdminErrorCodes.IDEMPOTENCY_CONFLICT);
    if ("error" in first) throw new Error(first.error);
    const events = await service.listControlAuditEvents(ctx(alice), { path: { stackId: first.stackId }, query: { limit: 10 } });
    expect(events).toMatchObject({ items: [{ action: "stack.created", requestId: "req-1", traceId: "trace-1" }] });
    await createStack(service, alice, "Two");
    await createStack(service, alice, "Three");
    const page = await service.listStacks(ctx(alice), { query: { limit: 2 } });
    if (!("items" in page) || !page.nextCursor) throw new Error("cursor missing");
    await createStack(service, bob, "Concurrent");
    expectError(await service.listStacks(ctx(alice), { query: { limit: 2, cursor: page.nextCursor } }), CasAdminErrorCodes.INVALID_CURSOR);
    expectError(await service.listStacks(ctx(alice), { query: { cursor: "!!!" } }), CasAdminErrorCodes.INVALID_CURSOR);
  });

  test("records session audit without advancing the control snapshot", async () => {
    const { db, service } = await createService(() => 123_456);
    await service.recordSessionAudit(
      ctx(alice),
      ControlAuditActions.sessionLogin,
      `${alice.identityIssuer}:${alice.subject}`,
    );
    expect(await db.prepare(
      "SELECT action, target, request_id, trace_id, created_at FROM cas_control_audit_events",
    ).first()).toEqual({
      action: "session.login",
      target: `${alice.identityIssuer}:${alice.subject}`,
      request_id: "req-1",
      trace_id: "trace-1",
      created_at: 123_456,
    });
    expect(await db.prepare("SELECT value FROM cas_control_meta WHERE key = 'snapshot'").first()).toBeNull();
  });

  test("stores, touches, expires, deletes, and prunes encrypted sessions", async () => {
    let clock = 1_000_000;
    const { db } = await createService();
    const store = new ControlSessionStore(db, () => clock);
    await store.create("one", "encrypted", 60_000);
    expect(await store.read("one")).toMatchObject({ encryptedPayload: "encrypted", expiresAt: 1_060_000 });
    clock = 1_010_000;
    await store.touch("one", 60_000);
    expect((await store.read("one"))?.expiresAt).toBe(1_070_000);
    await store.create("expired", "old", 1);
    clock = 1_020_000;
    expect(await store.read("expired")).toBeNull();
    await store.create("prune", "old", 1);
    clock = 1_030_000;
    expect(await store.pruneExpired()).toBe(1);
    await store.delete("one");
    expect(await store.read("one")).toBeNull();
  });
});
