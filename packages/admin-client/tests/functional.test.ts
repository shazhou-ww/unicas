import { beforeEach, describe, expect, it } from "vitest";
import { appAdminRoutes, casAdminRoutes } from "@unicas/admin-protocol";
import type { CasAdminPage } from "@unicas/admin-protocol";
import { createAdminClient } from "../src/index.js";
import type { AdminHttpFetcher, AdminClientSession } from "../src/index.js";

const STACK = "cas_stack_a";
const APP = "cas_app_a";

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

    if (path === casAdminRoutes.me()) {
      if (this.appVocabulary) {
        return Response.json({
          principal: { issuer: "https://accounts.google.com", subject: "sub-1" },
          profile: { displayName: "Alice", emailForDisplay: "alice@example.com" },
          memberships: [{
            appId: APP,
            principal: { issuer: "https://accounts.google.com", subject: "sub-1" },
            profile: { displayName: "Alice", emailForDisplay: "alice@example.com" },
          }],
        });
      }
      return Response.json({
        identity: { identityIssuer: "https://accounts.google.com", subject: "sub-1", displayName: "Alice", emailForDisplay: "alice@example.com" },
        memberships: [{ stackId: STACK, identityIssuer: "https://accounts.google.com", subject: "sub-1", displayName: "Alice", emailForDisplay: "alice@example.com" }],
      });
    }
    if (path === appAdminRoutes.acceptMemberInvitation({ token: "invite-1" }) && request.method === "POST") {
      return Response.json({
        appId: APP,
        principal: { issuer: "https://accounts.google.com", subject: "sub-1" },
        profile: { displayName: "Alice", emailForDisplay: "alice@example.com" },
      });
    }
    if (path === appAdminRoutes.apps() && request.method === "GET") {
      return Response.json({ items: [this.app], nextCursor: null });
    }
    if (path === appAdminRoutes.apps() && request.method === "POST") {
      return Response.json(this.app, { status: 201, headers: { ETag: '"3"' } });
    }
    if (path === appAdminRoutes.app({ appId: APP }) && request.method === "GET") {
      return Response.json(this.app, { headers: { ETag: '"3"' } });
    }
    if (path === appAdminRoutes.app({ appId: APP }) && request.method === "PATCH") {
      this.app.revision += 1;
      return new Response(null, { status: 204, headers: { ETag: `"${this.app.revision}"` } });
    }
    if (path === appAdminRoutes.members({ appId: APP }) && request.method === "GET") {
      return Response.json({
        items: [{
          appId: APP,
          principal: { issuer: "https://accounts.google.com", subject: "sub-1" },
          profile: { displayName: "Alice", emailForDisplay: "alice@example.com" },
        }],
        nextCursor: null,
      });
    }
    if (path === appAdminRoutes.members({ appId: APP }) && request.method === "DELETE") {
      return Response.json({ ok: true });
    }
    if (path === appAdminRoutes.memberInvitations({ appId: APP }) && request.method === "POST") {
      return Response.json({
        invitation: {
          invitationId: "invite-1",
          appId: APP,
          status: "pending",
          emailConstraint: "alice@example.com",
          expiresAt: 1000,
          createdAt: 1,
          revision: 1,
        },
        acceptUrl: "https://admin.test/admin/invitations/invite-1",
      }, { status: 201 });
    }
    if (path === appAdminRoutes.playgroundFileRoots({ appId: APP }) && request.method === "GET") {
      return Response.json({ items: [this.fileRoot] });
    }
    if (path === appAdminRoutes.playgroundFileRoots({ appId: APP }) && request.method === "POST") {
      return Response.json(this.fileRoot, { status: 201, headers: { ETag: '"1"' } });
    }
    if (path === appAdminRoutes.playgroundFileRoot({ appId: APP, rootId: "root-1" }) && request.method === "PATCH") {
      this.fileRoot = { ...this.fileRoot, ...(await request.json()), revision: 2, updatedAt: 2 };
      return Response.json(this.fileRoot, { headers: { ETag: '"2"' } });
    }
    if (path === appAdminRoutes.playgroundFileRoot({ appId: APP, rootId: "root-1" }) && request.method === "DELETE") {
      return Response.json({ ok: true });
    }
    const appIssuer = {
      appId: APP,
      mode: "managed",
      issuer: `https://cas.example/managed-issuers/${APP}`,
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
      return Response.json({ ...appIssuer, revision: 5 }, { headers: { ETag: '"5"' } });
    }
    if (path === appAdminRoutes.oauthIssuerInspections({ appId: APP }) && request.method === "POST") {
      return Response.json({
        inspectionId: "inspection-1",
        ...appIssuer,
        metadataDigest: "metadata",
        challenge: "challenge",
        expiresAt: 1000,
        keys: [],
        revision: 1,
      }, { status: 201, headers: { ETag: '"1"' } });
    }
    if (path === appAdminRoutes.managedIssuer({ appId: APP }) && request.method === "GET") {
      return Response.json(appIssuer, { headers: { ETag: '"4"' } });
    }
    if (path === appAdminRoutes.managedIssuer({ appId: APP }) && request.method === "PATCH") {
      return Response.json({ ...appIssuer, revision: 5 }, { headers: { ETag: '"5"' } });
    }
    if (path === appAdminRoutes.managedCapability({ appId: APP }) && request.method === "POST") {
      return Response.json({
        accessToken: "space-token",
        tokenType: "Bearer",
        expiresIn: 3600,
        expiresAt: 3_600_000,
        issuer: `https://cas.example/managed-issuers/${APP}`,
        audience: `https://cas.example/stacks/${APP}`,
        spaceId: "member_test",
        permissions: ["spaces:member_test:cas:manage"],
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
          actor: { issuer: "https://accounts.google.com", subject: "sub-1" },
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
    if (path === casAdminRoutes.stacks() && request.method === "GET") {
      const page: CasAdminPage<typeof this.stack> = { items: [this.stack], nextCursor: null };
      return Response.json(page);
    }
    if (path === casAdminRoutes.stack({ stackId: STACK }) && request.method === "GET") {
      return Response.json(this.stack, { headers: { ETag: `"rev-${this.stack.revision}"` } });
    }
    if (path === casAdminRoutes.stack({ stackId: STACK }) && request.method === "PATCH") {
      this.stack.revision += 1;
      return Response.json(this.stack, { headers: { ETag: `"rev-${this.stack.revision}"` } });
    }
    if (path === casAdminRoutes.playgroundFileRoots({ stackId: STACK }) && request.method === "GET") {
      return Response.json({ items: [this.fileRoot] });
    }
    if (path === casAdminRoutes.playgroundFileRoots({ stackId: STACK }) && request.method === "POST") {
      return Response.json(this.fileRoot, { headers: { ETag: '"1"' } });
    }
    if (path === casAdminRoutes.playgroundFileRoot({ stackId: STACK, rootId: "root-1" }) && request.method === "PATCH") {
      this.fileRoot = { ...this.fileRoot, ...(await request.json()), revision: 2, updatedAt: 2 };
      return Response.json(this.fileRoot, { headers: { ETag: '"2"' } });
    }
    if (path === casAdminRoutes.playgroundFileRoot({ stackId: STACK, rootId: "root-1" }) && request.method === "DELETE") {
      return Response.json({ ok: true });
    }
    if (path === casAdminRoutes.oauthIssuer({ stackId: STACK }) && request.method === "GET") {
      return Response.json({
        stackId: STACK,
        issuer: "https://issuer.example/oauth",
        audience: "https://cas.example/stacks/cas_stack_a",
        metadataUrl: "https://issuer.example/.well-known/oauth-authorization-server/oauth",
        metadataType: "oauth",
        authorizationEndpoint: "https://issuer.example/oauth/authorize",
        tokenEndpoint: "https://issuer.example/oauth/token",
        jwksUri: "https://issuer.example/oauth/jwks",
        registrationEndpoint: "https://issuer.example/oauth/register",
        scopesSupported: ["cas:read"],
        codeChallengeMethodsSupported: ["S256"],
        status: "active",
        verifiedAt: 10,
        lastRefreshAt: 11,
        lastRefreshError: null,
        jwksDigest: "sha256:test",
        capabilityMaxLifetimeSeconds: 1800,
        revision: 4,
      }, { headers: { ETag: `"rev-4"` } });
    }
    if (path === casAdminRoutes.oauthIssuer({ stackId: STACK }) && request.method === "PUT") {
      return Response.json({ stackId: STACK, status: "active", revision: 2 }, { headers: { ETag: `"rev-2"` } });
    }
    if (path === casAdminRoutes.oauthIssuerInspections({ stackId: STACK }) && request.method === "POST") {
      const body = await request.json() as { issuer: string };
      return Response.json({
        inspectionId: "oinsp_test",
        stackId: STACK,
        ...body,
        audience: `https://cas.example/stacks/${STACK}`,
        metadataUrl: "https://issuer.example/.well-known/oauth-authorization-server/oauth",
        metadataType: "oauth",
        authorizationEndpoint: "https://issuer.example/oauth/authorize",
        tokenEndpoint: "https://issuer.example/oauth/token",
        jwksUri: "https://issuer.example/oauth/jwks",
        registrationEndpoint: null,
        scopesSupported: ["cas:read"],
        codeChallengeMethodsSupported: ["S256"],
        metadataDigest: "metadata",
        jwksDigest: "jwks",
        capabilityMaxLifetimeSeconds: 1800,
        challenge: "challenge",
        expiresAt: 1000,
        keys: [],
        revision: 1,
      }, { headers: { ETag: `"rev-1"` } });
    }
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  };
}

function sessionOf(): Promise<AdminClientSession> {
  return Promise.resolve({ cookie: "cas_admin_session=abc", csrfToken: "csrf-1" });
}

describe("functional admin client", () => {
  let service: MockAdminService;
  let client: ReturnType<typeof createAdminClient>;

  beforeEach(() => {
    service = new MockAdminService();
    client = createAdminClient({ baseUrl: "https://admin.test", getSession: sessionOf, fetcher: service.fetch.bind(service) });
  });

  it("reads identity and typed pages", async () => {
    const me = await client.me();
    expect(me.identity.subject).toBe("sub-1");
    expect(me.memberships[0]!.stackId).toBe(STACK);

    const stacks = await client.listStacks();
    expect(stacks.items[0]!.displayName).toBe("Ops");
    expect(stacks.nextCursor).toBeNull();
  });

  it("uses explicit App operations for shared routes and managed Space issuance", async () => {
    service.appVocabulary = true;
    const current = await client.getCurrentPrincipal();
    expect(current.principal.subject).toBe("sub-1");
    expect(current.memberships[0]!.appId).toBe(APP);

    const membership = await client.acceptAppMemberInvitation({ token: "invite-1" });
    expect(membership).toMatchObject({ appId: APP, principal: { subject: "sub-1" } });

    const capability = await client.mintManagedSpaceCapability({ appId: APP });
    expect(capability).toMatchObject({
      spaceId: "member_test",
      permissions: ["spaces:member_test:cas:manage"],
    });
    expect(service.requests.filter((request) => request.method === "POST"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: appAdminRoutes.acceptMemberInvitation({ token: "invite-1" }),
          csrf: "csrf-1",
        }),
        expect.objectContaining({
          path: appAdminRoutes.managedCapability({ appId: APP }),
          csrf: "csrf-1",
        }),
      ]));
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
      items: [{ appId: APP, principal: { subject: "sub-1" } }],
    });
    expect(await client.deleteAppMember(
      { appId: APP },
      { issuer: "https://accounts.google.com", subject: "sub-1" },
      '"4"',
    )).toEqual({ ok: true });
    expect(await client.createAppMemberInvitation(
      { appId: APP },
      { emailConstraint: "alice@example.com" },
      { idempotencyKey: "invite-app-1" },
    )).toMatchObject({ invitation: { appId: APP, status: "pending" } });

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
        search: "?issuer=https%3A%2F%2Faccounts.google.com&subject=sub-1",
        method: "DELETE",
        ifMatch: '"4"',
      }),
    ]));
  });

  it("transports App Playground control records with ETags", async () => {
    expect((await client.listAppPlaygroundFileRoots({ appId: APP })).items).toHaveLength(1);
    expect(await client.createAppPlaygroundFileRoot(
      { appId: APP },
      { rootId: "root-1", name: "Files", manifestHash: "a".repeat(64) },
    )).toMatchObject({ value: { rootId: "root-1" }, etag: '"1"' });
    expect(await client.patchAppPlaygroundFileRoot(
      { appId: APP, rootId: "root-1" },
      { name: "Renamed", manifestHash: "b".repeat(64) },
      '"1"',
    )).toMatchObject({ value: { name: "Renamed", revision: 2 }, etag: '"2"' });
    expect(await client.deleteAppPlaygroundFileRoot(
      { appId: APP, rootId: "root-1" },
      '"2"',
    )).toEqual({ ok: true });
  });

  it("transports App issuer operations with ETags and CSRF", async () => {
    expect(await client.getAppOAuthIssuer({ appId: APP }, { optional: true }))
      .toMatchObject({ value: { appId: APP, status: "active" }, etag: '"4"' });
    expect(await client.getAppManagedIssuer({ appId: APP }))
      .toMatchObject({ value: { appId: APP, mode: "managed" }, etag: '"4"' });
    expect(await client.patchAppManagedIssuer({ appId: APP }, { enabled: false }, '"4"'))
      .toMatchObject({ value: { revision: 5 }, etag: '"5"' });
    expect(await client.inspectAppOAuthIssuer(
      { appId: APP },
      { issuer: "https://issuer.example/oauth" },
    )).toMatchObject({ value: { inspectionId: "inspection-1", appId: APP }, etag: '"1"' });
    expect(await client.activateAppOAuthIssuer(
      { appId: APP },
      { inspectionId: "inspection-1", activationProof: "proof" },
      '"4"',
    )).toMatchObject({ value: { revision: 5 }, etag: '"5"' });
    expect(service.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `/admin/apps/${APP}/oauth-issuer`, search: "?optional=true" }),
      expect.objectContaining({ path: `/admin/apps/${APP}/managed-issuer`, method: "PATCH", csrf: "csrf-1", ifMatch: '"4"' }),
      expect.objectContaining({ path: `/admin/apps/${APP}/oauth-issuer/inspections`, method: "POST", csrf: "csrf-1" }),
    ]));
  });

  it("uses App and Space vocabulary for audit operations", async () => {
    expect(await client.listAppRefDomains({ appId: APP })).toMatchObject({
      domains: [{ appId: APP, refDomain: "doc" }],
    });
    expect(await client.listAppControlAuditEvents(
      { appId: APP },
      { limit: 10, cursor: "cursor-1", after: "event-0" },
    )).toMatchObject({ items: [{ appId: APP, actor: { subject: "sub-1" } }] });
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
        search: "?limit=10&cursor=cursor-1&after=event-0",
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

  it("rejects the opposite identity contract on the shared path", async () => {
    await expect(client.getCurrentPrincipal()).rejects.toMatchObject({
      status: 502,
      code: "ADMIN_CONTRACT_MISMATCH",
    });
    service.appVocabulary = true;
    await expect(client.me()).rejects.toMatchObject({
      status: 502,
      code: "ADMIN_CONTRACT_MISMATCH",
    });
  });

  it("returns ETag on etag-sensitive reads and sends it as If-Match on mutations", async () => {
    const { value, etag } = await client.getStack({ stackId: STACK });
    expect(value.revision).toBe(3);
    expect(etag).toBe('"rev-3"');
    expect(service.requests[0]!.cookie).toBe("cas_admin_session=abc");
  });

  it("reads discovered OAuth issuer state with its ETag", async () => {
    const { value, etag } = await client.getOAuthIssuer({ stackId: STACK });
    expect(value).toMatchObject({ metadataType: "oauth", status: "active", jwksUri: "https://issuer.example/oauth/jwks" });
    expect(etag).toBe('"rev-4"');
  });

  it("transports Playground file-root catalog mutations with ETags", async () => {
    expect((await client.listPlaygroundFileRoots({ stackId: STACK })).items).toHaveLength(1);
    expect(await client.createPlaygroundFileRoot(
      { stackId: STACK },
      { rootId: "root-1", name: "Files", manifestHash: "a".repeat(64) },
    )).toMatchObject({ etag: '"1"' });
    expect(await client.patchPlaygroundFileRoot(
      { stackId: STACK, rootId: "root-1" },
      { name: "Renamed", manifestHash: "b".repeat(64) },
      '"1"',
    )).toMatchObject({ value: { name: "Renamed", revision: 2 }, etag: '"2"' });
    expect(await client.deletePlaygroundFileRoot({ stackId: STACK, rootId: "root-1" }, '"2"')).toEqual({ ok: true });
    expect(service.requests.at(-1)).toMatchObject({ method: "DELETE", csrf: "csrf-1", ifMatch: '"2"' });
  });

  it("posts OAuth issuer inspections with CSRF", async () => {
    const result = await client.inspectOAuthIssuer(
      { stackId: STACK },
      { issuer: "https://issuer.example/oauth" },
    );
    expect(result).toMatchObject({ value: { inspectionId: "oinsp_test" }, etag: '"rev-1"' });
    const request = service.requests.find((entry) => entry.path.endsWith("/oauth-issuer/inspections"))!;
    expect(request).toMatchObject({ method: "POST", csrf: "csrf-1" });
    expect(JSON.parse(request.body!)).toEqual({ issuer: "https://issuer.example/oauth" });
  });

  it("activates an OAuth issuer with CSRF and If-Match", async () => {
    const result = await client.activateOAuthIssuer(
      { stackId: STACK },
      { inspectionId: "oinsp_test", activationProof: "proof" },
      '"rev-1"',
    );
    expect(result).toMatchObject({ value: { status: "active", revision: 2 }, etag: '"rev-2"' });
    const request = service.requests.find((entry) => entry.path.endsWith("/oauth-issuer") && entry.method === "PUT")!;
    expect(request).toMatchObject({ method: "PUT", csrf: "csrf-1" });
  });

  it("attaches CSRF to mutations", async () => {
    await client.patchStack({ stackId: STACK }, { description: "x" }, '"rev-3"');
    const mutation = service.requests.find(r => r.method === "PATCH")!;
    expect(mutation.csrf).toBe("csrf-1");
    expect(mutation.path).toBe(casAdminRoutes.stack({ stackId: STACK }));
  });

  it("forces re-login after a 401 session failure", async () => {
    service.session = false;
    await expect(client.me()).rejects.toMatchObject({ status: 401, code: "ADMIN_AUTH_REQUIRED" });
    service.session = true;
    const me = await client.me();
    expect(me.identity.subject).toBe("sub-1");
  });
});
