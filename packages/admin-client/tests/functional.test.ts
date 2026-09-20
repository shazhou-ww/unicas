import { beforeEach, describe, expect, it } from "vitest";
import { appAdminRoutes } from "@unicas/admin-protocol";
import type { CasAdminPage } from "@unicas/admin-protocol";
import { createAdminClient } from "../src/index.js";
import type { AdminHttpFetcher, AdminClientSession } from "../src/index.js";

const STACK = "cas_stack_a";
const APP = "cas_app_a";
const ACCOUNT = `acct_${"a".repeat(22)}`;

it("persists rotated cookies and CSRF before the next request", async () => {
  let saved: AdminClientSession | null = null;
  const requests: Headers[] = [];
  const service = new MockAdminService();
  service.appVocabulary = true;
  const client = createAdminClient({
    baseUrl: "https://admin.test",
    getSession: async () => ({ cookie: "cas_admin_session=old", csrfToken: "old-csrf" }),
    onSessionChanged: async next => { saved = next; },
    fetcher: async (input, init) => {
      requests.push(new Headers(init?.headers));
      const response = await service.fetch(input, init);
      if (requests.length === 1) {
        response.headers.set("Set-Cookie", "cas_admin_session=new; HttpOnly; Path=/admin");
        response.headers.set("X-CSRF-Token", "new-csrf");
      }
      return response;
    },
  });
  await client.getCurrentAdministrator();
  expect(saved).toEqual({ cookie: "cas_admin_session=new", csrfToken: "new-csrf" });
  await client.getCurrentAdministrator();
  expect(requests[1]!.get("Cookie")).toBe("cas_admin_session=new");
});

/** Minimal in-memory fake of the /admin BFF API. */
class MockAdminService {
  readonly requests: { path: string; search: string; method: string; cookie: string | null; origin: string | null; csrf: string | null; ifMatch: string | null; idempotencyKey: string | null; body?: string }[] = [];
  readonly stack = {
    stackId: STACK,
    displayName: "Ops",
    description: "",
    status: "active" as const,
    createdAt: 1,
    revision: 3,
  };
  readonly app = {
    appId: APP,
    displayName: "App Ops",
    description: "",
    status: "active" as const,
    createdAt: 1,
    revision: 3,
  };
  session = true;
  appVocabulary = false;
  appResponseEtag = '"3"';
  fileRoot = {
    rootId: "root-1",
    name: "Files",
    manifestHash: "a".repeat(64),
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  readonly fetch: AdminHttpFetcher = async (input, init): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const cookie = request.headers.get("Cookie");
    const csrf = request.headers.get("X-CSRF-Token");
    const body = request.body ? await request.clone().text() : undefined;
    this.requests.push({
      path: url.pathname,
      search: url.search,
      method: request.method,
      cookie,
      origin: request.headers.get("Origin"),
      csrf,
      ifMatch: request.headers.get("If-Match"),
      ifNoneMatch: request.headers.get("If-None-Match"),
      idempotencyKey: request.headers.get("Idempotency-Key"),
      body,
    });
    if (!this.session) {
      return Response.json({ error: "ADMIN_AUTH_REQUIRED", message: "session required" }, { status: 401 });
    }
    const mutating = request.method !== "GET" && request.method !== "HEAD";
    if (mutating && (request.headers.get("Origin") !== "https://admin.test" || csrf !== "csrf-1")) {
      return Response.json({ error: "CSRF_REJECTED" }, { status: 403 });
    }
    const path = url.pathname;

    if (path === appAdminRoutes.people({ appId: APP }) || path === appAdminRoutes.platformPeople()) {
      return Response.json({ items: [], nextCursor: null });
    }

    const account = {
      accountId: `acct_${"a".repeat(22)}`,
      displayName: "Alice",
      primaryVerifiedEmail: {
        normalizedEmail: "alice@example.com",
        source: "google-oidc",
        verifiedAt: 1,
      },
      avatar: { kind: "fallback", initials: "AL", colorIndex: 1 },
      blockedAt: null,
      platformAuthorities: ["platform.admin", "apps.create"],
      identities: [{
        externalIdentityId: "ext-google",
        provider: "google",
        accountHint: "a***@example.com",
        linkedAt: 1,
        lastAuthenticatedAt: 2,
        currentLogin: true,
      }],
      linkableProviders: ["microsoft", "github"],
    };
    if (path === appAdminRoutes.account() && request.method === "GET") {
      return Response.json(account);
    }
    if (path === appAdminRoutes.accountIdentities() && request.method === "GET") {
      return Response.json({ identities: account.identities });
    }
    if (path === appAdminRoutes.accountProfile() && request.method === "PATCH") {
      return new Response(null, { status: 204 });
    }

    if (path === appAdminRoutes.me()) {
      if (this.appVocabulary) {
        return Response.json({
          account,
          authenticatedIdentity: account.identities[0],
          memberships: [{
            appId: APP,
            account: {
              accountId: account.accountId,
              displayName: account.displayName,
              primaryVerifiedEmail: account.primaryVerifiedEmail,
              avatar: account.avatar,
            },
          }],
        });
      }
      return Response.json({
        identity: { identityIssuer: "https://accounts.google.com", subject: "sub-1", displayName: "Alice", emailForDisplay: "alice@example.com" },
        memberships: [{ stackId: STACK, identityIssuer: "https://accounts.google.com", subject: "sub-1", displayName: "Alice", emailForDisplay: "alice@example.com" }],
      });
    }
    if (path === appAdminRoutes.acceptMemberInvitation({ token: "invite-1" }) && request.method === "POST") {
      return Response.json({ appId: APP });
    }
    const platformAccount = {
      accountId: ACCOUNT,
      displayName: "Alice",
      primaryVerifiedEmail: null,
      avatar: { kind: "fallback", initials: "AL", colorIndex: 1 },
      blockedAt: null,
      platformAuthorities: ["platform.admin", "apps.create"],
      createdAt: 1,
      updatedAt: 2,
      effectiveAccess: "active",
      appMembershipCount: 1,
      lastActiveAt: 2,
    };
    if (path === appAdminRoutes.platformAccounts() && request.method === "GET") {
      return Response.json({ items: [platformAccount], nextCursor: null });
    }
    if (path === appAdminRoutes.platformAccount({ accountId: ACCOUNT }) && request.method === "GET") {
      return Response.json({ ...platformAccount, memberships: [] });
    }
    if ((path === appAdminRoutes.platformAccountAuthority({ accountId: ACCOUNT, authority: "platform.admin" })
      || path === appAdminRoutes.platformAccountBlock({ accountId: ACCOUNT })) && request.method !== "GET") {
      return new Response(null, { status: 204 });
    }
    if (path === appAdminRoutes.platformInvitations() && request.method === "GET") {
      return Response.json({
        items: [{
          invitationId: "platform-invite-1",
          emailConstraint: "developer@example.com",
          authorities: ["apps.create"],
          status: "pending",
          expiresAt: 1000,
          createdAt: 1,
          createdByAccountId: ACCOUNT,
          revision: 1,
        }], nextCursor: null
      });
    }
    if (path === appAdminRoutes.platformInvitations() && request.method === "POST") {
      return Response.json({ invitationId: "platform-invite-1", acceptUrl: "https://admin.test/admin/platform-invitations/token-1", expiresAt: 1000 }, { status: 201, headers: { ETag: '"1"' } });
    }
    if (path === appAdminRoutes.platformInvitation({ invitationId: "platform-invite-1" }) && request.method === "DELETE") {
      return new Response(null, { status: 204, headers: { ETag: '"2"' } });
    }
    if (path === appAdminRoutes.acceptPlatformInvitation({ token: "platform-token" }) && request.method === "POST") {
      return new Response(null, { status: 204 });
    }
    if (path === appAdminRoutes.platformAuditEvents()) {
      return Response.json({
        items: [{
          eventId: "platform-event-1",
          action: "platform_invitation.created",
          actorAccount: {
            accountId: account.accountId,
            displayName: account.displayName,
            primaryVerifiedEmail: account.primaryVerifiedEmail,
            avatar: account.avatar,
          },
          authenticatedIdentity: {
            ...account.identities[0],
            issuer: "https://accounts.google.com",
            subject: "sub-1",
          },
          targetAccount: null,
          targetInvitationId: "platform-invite-1",
          result: "succeeded",
          requestId: "request-1",
          createdAt: 1,
          details: {},
        }], nextCursor: null
      });
    }
    if (path === appAdminRoutes.apps() && request.method === "GET") {
      return Response.json({ items: [this.app], nextCursor: null });
    }
    if (path === appAdminRoutes.apps() && request.method === "POST") {
      return Response.json(this.app, { status: 201, headers: { ETag: '"3"' } });
    }
    if (path === appAdminRoutes.app({ appId: APP }) && request.method === "GET") {
      return Response.json(this.app, { headers: { ETag: this.appResponseEtag } });
    }
    if (path === appAdminRoutes.app({ appId: APP }) && request.method === "PATCH") {
      this.app.revision += 1;
      return new Response(null, { status: 204, headers: { ETag: `"${this.app.revision}"` } });
    }
    if (path === appAdminRoutes.members({ appId: APP }) && request.method === "GET") {
      return Response.json({
        items: [{
          appId: APP,
          account: {
            accountId: `acct_${"a".repeat(22)}`,
            displayName: "Alice",
            primaryVerifiedEmail: null,
            avatar: { kind: "fallback", initials: "AL", colorIndex: 1 },
          },
        }],
        nextCursor: null,
      });
    }
    if (path === appAdminRoutes.members({ appId: APP }) && request.method === "DELETE") {
      return Response.json({ ok: true });
    }
    if (path === appAdminRoutes.memberInvitations({ appId: APP }) && request.method === "POST") {
      return Response.json({
        invitationId: "invite-1",
        expiresAt: 1000,
        acceptUrl: "https://admin.test/admin/invitations/invite-1",
      }, { status: 201, headers: { ETag: '"1"' } });
    }
    if (path === appAdminRoutes.memberInvitations({ appId: APP }) && request.method === "GET") {
      return Response.json({ items: [{ invitationId: "invite-1", appId: APP, status: "pending", emailConstraint: null, expiresAt: 1000, createdAt: 1, revision: 1 }], nextCursor: null });
    }
    if (path === appAdminRoutes.memberInvitation({ appId: APP, invitationId: "invite-1" }) && request.method === "DELETE") {
      return new Response(null, { status: 204, headers: { ETag: '"2"' } });
    }
    const appIssuer = {
      appId: APP,
      issuer: "https://issuer.example/oauth",
      audience: `https://cas.example/stacks/${APP}`,
      metadataUrl: "https://cas.example/metadata",
      metadataType: "oauth",
      authorizationEndpoint: "https://cas.example/authorize",
      tokenEndpoint: "https://cas.example/token",
      jwksUri: "https://cas.example/jwks",
      registrationEndpoint: null,
      scopesSupported: ["cas:manage"],
      codeChallengeMethodsSupported: ["S256"],
      status: "active",
      verifiedAt: 1,
      lastRefreshAt: 1,
      lastRefreshError: null,
      jwksDigest: "digest",
      capabilityMaxLifetimeSeconds: 3600,
      revision: 4,
    } as const;
    if (path === appAdminRoutes.oauthIssuer({ appId: APP }) && request.method === "GET") {
      return Response.json(appIssuer, { headers: { ETag: '"4"' } });
    }
    if (path === appAdminRoutes.oauthIssuer({ appId: APP }) && request.method === "PUT") {
      return new Response(null, { status: 204, headers: { ETag: '"5"' } });
    }
    if (path === appAdminRoutes.oauthIssuerInspections({ appId: APP }) && request.method === "POST") {
      return Response.json({
        inspectionId: "inspection-1",
        metadataUrl: appIssuer.metadataUrl,
        jwksUri: appIssuer.jwksUri,
        challenge: "challenge",
        expiresAt: 1000,
        keys: [],
      }, { status: 201 });
    }
    if (path === appAdminRoutes.refDomains({ appId: APP }) && request.method === "GET") {
      return Response.json({ domains: [{ appId: APP, refDomain: "doc", revision: 2 }] });
    }
    if (path === appAdminRoutes.controlAuditEvents({ appId: APP }) && request.method === "GET") {
      return Response.json({
        items: [{
          eventId: "event-1",
          appId: APP,
          actorAccount: {
            accountId: account.accountId,
            displayName: account.displayName,
            primaryVerifiedEmail: account.primaryVerifiedEmail,
            avatar: account.avatar,
          },
          authenticatedIdentity: {
            ...account.identities[0],
            issuer: "https://accounts.google.com",
            subject: "sub-1",
          },
          targetAccount: null,
          action: "app.updated",
          target: APP,
          requestId: null,
          traceId: null,
          caller: null,
          createdAt: 1,
        }],
        nextCursor: null,
      });
    }
    if (path === appAdminRoutes.rootDomainRefs({ appId: APP, refDomain: "doc" }) && request.method === "GET") {
      return Response.json({
        revision: 2,
        refs: [{ spaceId: "space-1", hash: "a".repeat(64), count: 1 }],
        nextCursor: null,
      });
    }
    if (path === appAdminRoutes.rootDomainEvents({ appId: APP, refDomain: "doc" }) && request.method === "GET") {
      return Response.json({
        events: [{ revision: 2, spaceId: "space-1", requestId: "request-1", changes: { ["a".repeat(64)]: 1 }, appliedAt: 1 }],
        latestRevision: 2,
        nextAfter: 2,
      });
    }
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  };
}

function sessionOf(): Promise<AdminClientSession> {
  return Promise.resolve({ cookie: "cas_admin_session=abc", csrfToken: "csrf-1" });
}

describe("functional admin client", () => {
  it("exposes typed unified people reads with filters and cursors", async () => {
    const service = new MockAdminService();
    const client = createAdminClient({ baseUrl: "https://admin.test", getSession: sessionOf, fetcher: service.fetch });
    expect(await client.listAppPeople({ appId: APP }, { filter: "pending", query: "alice", cursor: "next" })).toEqual({ items: [], nextCursor: null });
    expect(service.requests.at(-1)?.search).toContain("cursor=next");
    expect(await client.listPlatformPeople({ authority: "platform.admin", effectiveAccess: "blocked" })).toEqual({ items: [], nextCursor: null });
    expect(service.requests.at(-1)?.search).toContain("effectiveAccess=blocked");
  });

  let service: MockAdminService;
  let client: ReturnType<typeof createAdminClient>;

  beforeEach(() => {
    service = new MockAdminService();
    client = createAdminClient({ baseUrl: "https://admin.test", getSession: sessionOf, fetcher: service.fetch.bind(service) });
  });

  it("reads Account identity and typed App pages", async () => {
    service.appVocabulary = true;
    const me = await client.getCurrentAdministrator();
    expect(me.account.accountId).toBe(ACCOUNT);
    expect(me.memberships[0]!.appId).toBe(APP);
    const apps = await client.listApps();
    expect(apps.items[0]!.displayName).toBe("App Ops");
    expect(apps.nextCursor).toBeNull();
  });

  it("uses explicit App operations for shared routes", async () => {
    service.appVocabulary = true;
    const current = await client.getCurrentAdministrator();
    expect(current.account.displayName).toBe("Alice");
    expect(current.authenticatedIdentity.provider).toBe("google");
    expect(current).not.toHaveProperty("principal");
    expect(current.memberships[0]).toMatchObject({ appId: APP, account: { accountId: current.account.accountId } });

    const membership = await client.acceptAppMemberInvitation({ token: "invite-1" });
    expect(membership).toEqual({ appId: APP });

    expect(service.requests.filter((request) => request.method === "POST"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: appAdminRoutes.acceptMemberInvitation({ token: "invite-1" }),
          csrf: "csrf-1",
        }),
      ]));
  });

  it("reads the stable Account and updates only mutable profile fields", async () => {
    const account = await client.getCurrentAccount();
    expect(account).toMatchObject({
      displayName: "Alice",
      primaryVerifiedEmail: { normalizedEmail: "alice@example.com" },
      linkableProviders: ["microsoft", "github"],
    });
    expect(await client.listCurrentAccountIdentities()).toEqual(account.identities);
    await client.patchCurrentAccountProfile({ displayName: "Alice Updated", avatarExternalIdentityId: null });
    expect(service.requests.at(-1)).toMatchObject({
      path: appAdminRoutes.accountProfile(),
      method: "PATCH",
      origin: "https://admin.test",
      csrf: "csrf-1",
      body: JSON.stringify({ displayName: "Alice Updated", avatarExternalIdentityId: null }),
    });
  });

  it("transports App CRUD, membership, and invitation operations", async () => {
    expect(await client.listApps({ limit: 5, cursor: "next" })).toMatchObject({
      items: [{ appId: APP, displayName: "App Ops" }],
    });
    expect(await client.createApp(
      { displayName: "App Ops" },
      { idempotencyKey: "create-app-1" },
    )).toMatchObject({ value: { appId: APP }, etag: '"3"' });
    expect(await client.getApp({ appId: APP })).toMatchObject({ value: { appId: APP }, etag: '"3"' });
    expect(await client.patchApp({ appId: APP }, { description: "Production", status: "suspended" }, '"3"'))
      .toEqual({ etag: '"4"' });
    expect(await client.listAppMembers({ appId: APP }, { limit: 10 })).toMatchObject({
      items: [{ appId: APP, account: { accountId: `acct_${"a".repeat(22)}` } }],
    });
    expect(await client.deleteAppMember(
      { appId: APP, accountId: `acct_${"a".repeat(22)}` },
    )).toEqual({ ok: true });
    expect(service.requests.at(-1)).toMatchObject({ ifMatch: null, search: `?accountId=acct_${"a".repeat(22)}` });
    expect(await client.createAppMemberInvitation(
      { appId: APP },
      { emailConstraint: "alice@example.com" },
      { idempotencyKey: "invite-app-1" },
    )).toEqual({ invitationId: "invite-1", expiresAt: 1000, acceptUrl: "https://admin.test/admin/invitations/invite-1", etag: '"1"' });
    expect(await client.listAppMemberInvitations({ appId: APP }, { status: "pending", limit: 50 })).toMatchObject({ items: [{ invitationId: "invite-1" }], nextCursor: null });
    expect(await client.revokeAppMemberInvitation({ appId: APP, invitationId: "invite-1" }, '"1"')).toEqual({ etag: '"2"' });

    expect(service.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/admin/apps", search: "?limit=5&cursor=next" }),
      expect.objectContaining({ path: "/admin/apps", method: "POST", origin: "https://admin.test", csrf: "csrf-1", idempotencyKey: "create-app-1" }),
      expect.objectContaining({
        path: `/admin/apps/${APP}`,
        method: "PATCH",
        ifMatch: '"3"',
        body: JSON.stringify({ description: "Production", status: "suspended" }),
      }),
      expect.objectContaining({
        path: `/admin/apps/${APP}/members`,
        search: `?accountId=acct_${"a".repeat(22)}`,
        method: "DELETE",
        ifMatch: null,
      }),
    ]));
  });

  it("normalizes a transfer-weakened numeric revision ETag before reuse", async () => {
    service.appResponseEtag = 'W/"3"';
    const { etag } = await client.getApp({ appId: APP });
    expect(etag).toBe('"3"');

    await client.patchApp({ appId: APP }, { description: "Production" }, etag);
    expect(service.requests.at(-1)).toMatchObject({ method: "PATCH", ifMatch: '"3"' });
  });

  it("transports platform access and invitation operations with minimal receipts", async () => {
    expect(await client.listPlatformInvitations({ status: "pending", limit: 10 })).toMatchObject({
      items: [{ invitationId: "platform-invite-1" }],
    });
    expect(await client.createPlatformInvitation({
      emailConstraint: "developer@example.com",
      authorities: ["apps.create"],
    }, "platform-create-1")).toEqual({
      invitationId: "platform-invite-1",
      acceptUrl: "https://admin.test/admin/platform-invitations/token-1",
      expiresAt: 1000,
      etag: '"1"',
    });
    expect(await client.revokePlatformInvitation({ invitationId: "platform-invite-1" }, '"1"'))
      .toEqual({ etag: '"2"' });
    await expect(client.acceptPlatformInvitation({ token: "platform-token" })).resolves.toBeUndefined();
    expect(await client.listPlatformAuditEvents({ action: "platform_invitation.created", actorAccountId: ACCOUNT, createdAfter: 0, limit: 10 }))
      .toMatchObject({ items: [{ eventId: "platform-event-1", actorAccount: { accountId: ACCOUNT } }] });

    expect(service.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/admin/platform/invitations", search: "?status=pending&limit=10" }),
      expect.objectContaining({ path: "/admin/platform/invitations", method: "POST", idempotencyKey: "platform-create-1" }),
      expect.objectContaining({ path: "/admin/platform/invitations/platform-invite-1", method: "DELETE", ifMatch: '"1"' }),
      expect.objectContaining({ path: "/admin/platform-invitations/platform-token/accept", method: "POST" }),
      expect.objectContaining({ path: "/admin/platform/audit-events", search: `?action=platform_invitation.created&actorAccountId=${ACCOUNT}&createdAfter=0&limit=10` }),
    ]));
  });

  it("transports Account-keyed platform commands without resource revisions", async () => {
    expect(await client.listPlatformAccounts({ authority: "platform.admin" })).toMatchObject({ items: [{ accountId: ACCOUNT }] });
    expect(await client.getPlatformAccount({ accountId: ACCOUNT })).toMatchObject({ accountId: ACCOUNT, memberships: [] });
    await client.grantPlatformAccountAuthority({ accountId: ACCOUNT, authority: "platform.admin" });
    await client.revokePlatformAccountAuthority({ accountId: ACCOUNT, authority: "platform.admin" });
    await client.blockPlatformAccount({ accountId: ACCOUNT });
    await client.restorePlatformAccount({ accountId: ACCOUNT });
    expect(service.requests.slice(-4)).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "PUT", csrf: "csrf-1", ifMatch: null }),
      expect.objectContaining({ method: "DELETE", csrf: "csrf-1", ifMatch: null }),
    ]));
  });

  it("transports App issuer operations with ETags and CSRF", async () => {
    expect(await client.getAppOAuthIssuer({ appId: APP }, { optional: true }))
      .toMatchObject({ value: { appId: APP, status: "active" }, etag: '"4"' });
    expect(await client.inspectAppOAuthIssuer(
      { appId: APP },
      { issuer: "https://issuer.example/oauth" },
    )).toEqual({ inspectionId: "inspection-1", metadataUrl: "https://cas.example/metadata", jwksUri: "https://cas.example/jwks", challenge: "challenge", expiresAt: 1000, keys: [] });
    expect(await client.activateAppOAuthIssuer(
      { appId: APP },
      { inspectionId: "inspection-1", activationProof: "proof" },
      '"4"',
    )).toEqual({ etag: '"5"' });
    await client.activateAppOAuthIssuer({ appId: APP }, { inspectionId: "inspection-1", activationProof: "proof" }, { ifNoneMatch: "*" });
    expect(service.requests.at(-1)).toMatchObject({ ifMatch: null, ifNoneMatch: "*" });
    expect(service.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `/admin/apps/${APP}/oauth-issuer`, search: "?optional=true" }),
      expect.objectContaining({ path: `/admin/apps/${APP}/oauth-issuer/inspections`, method: "POST", csrf: "csrf-1" }),
    ]));
  });

  it("uses App and Space vocabulary for audit operations", async () => {
    expect(await client.listAppRefDomains({ appId: APP })).toMatchObject({
      domains: [{ appId: APP, refDomain: "doc" }],
    });
    expect(await client.listAppControlAuditEvents(
      { appId: APP },
      { limit: 10, cursor: "cursor-1", actorAccountId: ACCOUNT },
    )).toMatchObject({ items: [{ appId: APP, actorAccount: { accountId: ACCOUNT } }] });
    expect(await client.listSpaceRootDomainRefs(
      { appId: APP, refDomain: "doc" },
      { spaceId: "space-1", limit: 10, cursor: "cursor-1" },
    )).toMatchObject({ refs: [{ spaceId: "space-1", count: 1 }] });
    expect(await client.listSpaceRootDomainEvents(
      { appId: APP, refDomain: "doc" },
      { spaceId: "space-1", after: 1, limit: 10 },
    )).toMatchObject({ events: [{ spaceId: "space-1", revision: 2 }] });
    expect(service.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: `/admin/apps/${APP}/audit-events`,
        search: `?limit=10&cursor=cursor-1&actorAccountId=${ACCOUNT}`,
      }),
      expect.objectContaining({
        path: `/admin/apps/${APP}/root-ref-domains/doc/refs`,
        search: "?spaceId=space-1&limit=10&cursor=cursor-1",
      }),
      expect.objectContaining({
        path: `/admin/apps/${APP}/root-ref-domains/doc/events`,
        search: "?spaceId=space-1&after=1&limit=10",
      }),
    ]));
  });

  it("rejects the retired identity contract on the shared path", async () => {
    await expect(client.getCurrentAdministrator()).rejects.toMatchObject({
      status: 502,
      code: "ADMIN_CONTRACT_MISMATCH",
    });
  });

  it("forces re-login after a 401 session failure", async () => {
    service.session = false;
    await expect(client.getCurrentAdministrator()).rejects.toMatchObject({ status: 401, code: "ADMIN_AUTH_REQUIRED" });
    service.session = true;
    service.appVocabulary = true;
    const me = await client.getCurrentAdministrator();
    expect(me.account.accountId).toBe(ACCOUNT);
  });
});
