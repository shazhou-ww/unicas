import { afterEach, describe, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { s256Challenge } from "@unicas/control-auth";
import { effectivePlatformAccess } from "@unicas/admin-protocol";
import type {
  PlatformAccessState,
  PlatformAuthority,
  PlatformPrincipalDetail,
  PlatformPrincipalListItem,
  Principal,
} from "@unicas/admin-protocol";
import type {
  ControlPlaneCallContext,
  ControlPlaneOperations,
  ControlSessionRepository,
  EmailChallengeBinding,
  EmailChallengeRecord,
  EmailChallengeRepository,
  AccountRecord,
  AccountRepository,
  ExternalIdentityRecord,
  PeopleRepository,
  PlatformAccessRepository,
  PlatformAuditRepository,
  PlatformInvitationIdempotencyRecord,
  PlatformInvitationRepository,
  ProviderAdapter,
  StoredPlatformInvitation,
  StoredSession,
} from "@unicas/service";
import { ProviderRegistry, sha256Hex } from "@unicas/service";
import { createAdminBff, OidcClient, SessionCrypto, uiAssets } from "../src/admin-bff/index.js";
import type { AdminBffConfig } from "../src/admin-bff/config.js";

const PUBLIC_ORIGIN = "https://cas.example";
const CLIENT_ID = "test-client";
const CLIENT_SECRET = "test-secret";
const ISSUER = "https://mock-provider.example";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const AUTHORIZE_URL = `${ISSUER}/authorize`;
const TOKEN_URL = `${ISSUER}/token`;
const JWKS_URL = `${ISSUER}/jwks`;

interface FakeStack {
  stackId: string;
  displayName: string;
  description: string;
  status: "active" | "suspended";
  createdAt: number;
  revision: number;
  members: Map<string, ControlPlaneCallContext>;
}

const fakeStacks = new Map<string, FakeStack>();
const fakeSessions = new Map<string, StoredSession>();
const fakeFileRoots = new Map<string, Map<string, {
  rootId: string;
  name: string;
  manifestHash: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}>>();
let nextStackId = 1;

afterEach(() => {
  fakeStacks.clear();
  fakeSessions.clear();
  fakeFileRoots.clear();
  nextStackId = 1;
});

test("stable admin asset URLs revalidate across deployments", async () => {
  for (const pathname of ["/assets/index.js", "/assets/index.css", "/assets/skills/unicas-cli/SKILL.md"]) {
    const response = await uiAssets(pathname);
    expect(response?.headers.get("Cache-Control")).toBe("no-cache");
  }
  await expect(uiAssets("/assets/missing.js")).resolves.toBeNull();
});

function identityKey(ctx: ControlPlaneCallContext): string {
  return `${ctx.identity.identityIssuer}\n${ctx.identity.subject}`;
}

function fileRootsKey(ctx: ControlPlaneCallContext, stackId: string): string {
  return `${stackId}\n${identityKey(ctx)}`;
}

class MemorySessionRepository implements ControlSessionRepository {
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  async create(sessionId: string, encryptedPayload: string, ttlMs: number): Promise<void> {
    const now = this.#now();
    fakeSessions.set(sessionId, { sessionId, encryptedPayload, expiresAt: now + ttlMs, createdAt: now, lastSeenAt: now });
  }

  async read(sessionId: string): Promise<StoredSession | null> {
    const session = fakeSessions.get(sessionId) ?? null;
    if (session && session.expiresAt <= this.#now()) {
      fakeSessions.delete(sessionId);
      return null;
    }
    return session;
  }

  async touch(sessionId: string, ttlMs: number): Promise<void> {
    const session = fakeSessions.get(sessionId);
    if (!session) return;
    const now = this.#now();
    fakeSessions.set(sessionId, { ...session, expiresAt: now + ttlMs, lastSeenAt: now });
  }

  async delete(sessionId: string): Promise<void> {
    fakeSessions.delete(sessionId);
  }

  async pruneExpired(): Promise<number> {
    const expired = [...fakeSessions.values()].filter((session) => session.expiresAt <= this.#now());
    for (const session of expired) fakeSessions.delete(session.sessionId);
    return expired.length;
  }
}

function fakeControlPlane(): ControlPlaneOperations {
  const error = async () => ({ error: "NOT_FOUND" as const, message: "not implemented by this BFF fake" });
  const requireStack = (ctx: ControlPlaneCallContext, stackId: string): FakeStack | null => {
    const stack = fakeStacks.get(stackId) ?? null;
    return stack?.members.has(identityKey(ctx)) ? stack : null;
  };
  return {
    me: async (ctx) => ({
      identity: {
        ...ctx.identity,
        displayName: ctx.profile?.displayName ?? null,
        emailForDisplay: ctx.profile?.emailForDisplay ?? null,
      },
      memberships: [...fakeStacks.values()]
        .filter((stack) => stack.members.has(identityKey(ctx)))
        .map((stack) => ({
          stackId: stack.stackId,
          ...ctx.identity,
          displayName: ctx.profile?.displayName ?? null,
          emailForDisplay: ctx.profile?.emailForDisplay ?? null,
        })),
    }),
    listStacks: async (ctx) => ({
      items: [...fakeStacks.values()]
        .filter((stack) => stack.members.has(identityKey(ctx)))
        .map(({ members: _members, ...stack }) => stack),
      nextCursor: null,
    }),
    createStack: async (ctx, request) => {
      const stack: FakeStack = {
        stackId: `cas_fake_${nextStackId++}`,
        displayName: request.body.displayName,
        description: "",
        status: "active",
        createdAt: Date.now(),
        revision: 1,
        members: new Map([[identityKey(ctx), ctx]]),
      };
      fakeStacks.set(stack.stackId, stack);
      const { members: _members, ...response } = stack;
      return response;
    },
    getStack: async (ctx, request) => {
      const stack = requireStack(ctx, request.path.stackId);
      if (!stack) return { error: "STACK_MEMBERSHIP_REQUIRED", message: "stack membership required" };
      const { members: _members, ...response } = stack;
      return response;
    },
    patchStack: async (ctx, request, mutation) => {
      const stack = requireStack(ctx, request.path.stackId);
      if (!stack) return { error: "STACK_MEMBERSHIP_REQUIRED", message: "stack membership required" };
      if (mutation.ifMatch !== `"${stack.revision}"`) {
        return { error: "REVISION_MISMATCH", message: "revision mismatch" };
      }
      stack.displayName = request.body.displayName ?? stack.displayName;
      stack.description = request.body.description ?? stack.description;
      stack.revision += 1;
      const { members: _members, ...response } = stack;
      return response;
    },
    patchApp: async (ctx, appId, patch, mutation) => {
      const app = requireStack(ctx, appId);
      if (!app) return { error: "STACK_MEMBERSHIP_REQUIRED", message: "stack membership required" };
      if (mutation.ifMatch !== `"${app.revision}"`) return { error: "REVISION_MISMATCH", message: "revision mismatch" };
      Object.assign(app, patch);
      app.revision += 1;
      return { revision: app.revision };
    },
    listMembers: error as ControlPlaneOperations["listMembers"],
    listPlaygroundFileRoots: async (ctx, request) => ({
      items: [...(fakeFileRoots.get(fileRootsKey(ctx, request.path.stackId))?.values() ?? [])],
    }),
    createPlaygroundFileRoot: async (ctx, request) => {
      if (!requireStack(ctx, request.path.stackId)) return { error: "STACK_MEMBERSHIP_REQUIRED", message: "stack membership required" };
      const roots = fakeFileRoots.get(fileRootsKey(ctx, request.path.stackId)) ?? new Map();
      fakeFileRoots.set(fileRootsKey(ctx, request.path.stackId), roots);
      const now = Date.now();
      const root = { ...request.body, revision: 1, createdAt: now, updatedAt: now };
      roots.set(root.rootId, root);
      return root;
    },
    patchPlaygroundFileRoot: async (ctx, request, mutation) => {
      const root = fakeFileRoots.get(fileRootsKey(ctx, request.path.stackId))?.get(request.path.rootId);
      if (!root) return { error: "NOT_FOUND", message: "file root not found" };
      if (mutation.ifMatch !== `"${root.revision}"`) return { error: "REVISION_MISMATCH", message: "revision mismatch" };
      Object.assign(root, request.body, { revision: root.revision + 1, updatedAt: Date.now() });
      return root;
    },
    deletePlaygroundFileRoot: async (ctx, request, mutation) => {
      const roots = fakeFileRoots.get(fileRootsKey(ctx, request.path.stackId));
      const root = roots?.get(request.path.rootId);
      if (!root) return { error: "NOT_FOUND", message: "file root not found" };
      if (mutation.ifMatch !== `"${root.revision}"`) return { error: "REVISION_MISMATCH", message: "revision mismatch" };
      roots!.delete(request.path.rootId);
      return { ok: true };
    },
    deleteMember: error as ControlPlaneOperations["deleteMember"],
    createMemberInvitation: error as ControlPlaneOperations["createMemberInvitation"],
    acceptMemberInvitation: error as ControlPlaneOperations["acceptMemberInvitation"],
    listAppMemberInvitations: async (ctx, appId) => {
      if (!requireStack(ctx, appId)) return { error: "STACK_MEMBERSHIP_REQUIRED" };
      return { items: [{ appId, invitationId: "inv-test", status: "pending", emailConstraint: null, expiresAt: 4102444800000, createdAt: 1, revision: 7 }], nextCursor: null };
    },
    revokeAppMemberInvitation: async (ctx, appId, invitationId, mutation) => {
      if (!requireStack(ctx, appId)) return { error: "STACK_MEMBERSHIP_REQUIRED" };
      if (invitationId !== "inv-test") return { error: "NOT_FOUND" };
      if (mutation.ifMatch !== '"7"') return { error: "REVISION_MISMATCH" };
      return { revision: 8 };
    },
    getOAuthIssuer: async (ctx, request) => {
      if (!requireStack(ctx, request.path.stackId)) return { error: "STACK_MEMBERSHIP_REQUIRED", message: "stack membership required" };
      return request.query?.optional ? null : { error: "NOT_FOUND", message: "OAuth issuer is not configured" };
    },
    getManagedOAuthIssuer: error,
    inspectAppOAuthIssuer: async (ctx, appId) => {
      if (!requireStack(ctx, appId)) return { error: "STACK_MEMBERSHIP_REQUIRED" };
      return { inspectionId: "candidate", metadataUrl: "https://candidate.example/metadata", jwksUri: "https://candidate.example/jwks", challenge: "synthetic", expiresAt: 4102444800000, keys: [{ kid: "key", algorithm: "ES256" }] };
    },
    activateAppOAuthIssuer: async (ctx, appId, _body, mutation) => {
      if (!requireStack(ctx, appId)) return { error: "STACK_MEMBERSHIP_REQUIRED" };
      if (mutation.ifNoneMatch !== "*" && mutation.ifMatch !== '"9"') return { error: "PRECONDITION_REQUIRED" };
      return { revision: mutation.ifNoneMatch === "*" ? 1 : 10 };
    },
    patchManagedOAuthIssuer: error,
    mintManagedCapability: async (ctx, request) => {
      const stack = requireStack(ctx, request.path.stackId);
      if (!stack) return { error: "STACK_MEMBERSHIP_REQUIRED", message: "stack membership required" };
      return {
        accessToken: "short-lived-token",
        tokenType: "Bearer",
        expiresIn: 120,
        expiresAt: Date.now() + 120_000,
        issuer: `https://cas.example/managed-issuers/${stack.stackId}`,
        audience: `https://cas.example/stacks/${stack.stackId}`,
        tenantId: "member_test",
        permissions: ["tenants:member_test:cas:manage"],
      };
    },
    mintManagedSpaceCapability: async (ctx, appId) => {
      const app = requireStack(ctx, appId);
      if (!app) return { error: "STACK_MEMBERSHIP_REQUIRED", message: "app membership required" };
      return {
        accessToken: "short-lived-space-token",
        tokenType: "Bearer",
        expiresIn: 120,
        expiresAt: Date.now() + 120_000,
        issuer: `https://cas.example/managed-issuers/${app.stackId}`,
        audience: `https://cas.example/stacks/${app.stackId}`,
        spaceId: "member_test",
        permissions: ["spaces:member_test:cas:manage"],
      };
    },
    inspectOAuthIssuer: error as ControlPlaneOperations["inspectOAuthIssuer"],
    activateOAuthIssuer: error as ControlPlaneOperations["activateOAuthIssuer"],
    listControlAuditEvents: error as ControlPlaneOperations["listControlAuditEvents"],
    recordSessionAudit: async () => undefined,
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

interface MockProvider {
  readonly privateKey: CryptoKey;
  readonly publicJwk: Record<string, unknown>;
  /** Claims the provider puts in the id_token it issues (nonce must echo the
   *  authorization request). */
  pendingClaims: Record<string, unknown> | null;
  /** Signed id_token the provider would issue; set per test. */
  issueIdToken: (claims: Record<string, unknown>) => Promise<string>;
  /** Token endpoint assertions for the current test. */
  expectTokenBody: ((body: URLSearchParams) => void) | null;
}

import type {
  PlatformAuditRecord,
} from "@unicas/service";

/** Minimal in-memory PlatformAccessRepository for BFF integration tests. */
class MemoryPlatformAccessRepository implements PlatformAccessRepository, PlatformInvitationRepository, PlatformAuditRepository {
  private readonly states = new Map<string, PlatformAccessState>();
  private readonly members = new Set<string>();
  private readonly invitations = new Map<string, {
    invitationId: string;
    appId: string;
    status: "pending" | "accepted" | "expired" | "revoked";
    emailConstraint: string | null;
    expiresAt: number;
  }>();
  private readonly platformInvitations = new Map<string, StoredPlatformInvitation>();
  private readonly platformInvitationIdempotency = new Map<string, PlatformInvitationIdempotencyRecord>();
  private readonly platformAudits: PlatformAuditRecord[] = [];

  async readSnapshot(): Promise<number> { return 0; }

  private key(p: Principal): string {
    return `${p.issuer}\0${p.subject}`;
  }

  /** Bootstrap: mark a principal as active with apps.create authority. */
  grant(issuer: string, subject: string): void {
    const k = this.key({ issuer, subject });
    this.states.set(k, {
      principalRef: k,
      principal: { issuer, subject },
      status: "active",
      authorities: ["apps.create"],
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
    });
  }

  /** Bootstrap: mark a principal as active with platform.admin authority. */
  grantAdmin(issuer: string, subject: string): void {
    const k = this.key({ issuer, subject });
    this.states.set(k, {
      principalRef: k,
      principal: { issuer, subject },
      status: "active",
      authorities: ["platform.admin", "apps.create"],
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
    });
  }

  /** Mark a granted principal as having App membership (passes via hasMembership). */
  grantViaMembership(issuer: string, subject: string): void {
    const k = this.key({ issuer, subject });
    this.members.add(k);
    if (!this.states.has(k)) {
      this.states.set(k, {
        principalRef: k,
        principal: { issuer, subject },
        status: "active",
        authorities: [],
        revision: 1,
        createdAt: 0,
        updatedAt: 0,
      });
    }
  }

  revokeMembership(issuer: string, subject: string): void {
    this.members.delete(this.key({ issuer, subject }));
  }

  async addInvitation(token: string, emailConstraint: string | null, expiresAt = Date.now() + 60_000): Promise<void> {
    this.invitations.set(await sha256Hex(token), {
      invitationId: "invitation-1",
      appId: "app-invited",
      status: "pending",
      emailConstraint,
      expiresAt,
    });
  }

  block(issuer: string, subject: string): void {
    const k = this.key({ issuer, subject });
    const existing = this.states.get(k);
    if (existing) {
      this.states.set(k, { ...existing, status: "blocked" });
    }
  }

  revokeAuthorities(issuer: string, subject: string): void {
    const k = this.key({ issuer, subject });
    const existing = this.states.get(k);
    if (existing) {
      this.states.set(k, { ...existing, authorities: [], revision: existing.revision + 1 });
    }
  }

  async getAccess(principal: Principal): Promise<PlatformAccessState | null> {
    return this.states.get(this.key(principal)) ?? null;
  }

  async hasMembership(principal: Principal): Promise<boolean> {
    return this.members.has(this.key(principal));
  }

  async getAppInvitationByTokenHash(tokenHash: string) {
    return this.invitations.get(tokenHash) ?? null;
  }

  async getInvitation(invitationId: string, now: number) {
    const invitation = this.platformInvitations.get(invitationId) ?? null;
    return invitation?.status === "pending" && invitation.expiresAt <= now
      ? { ...invitation, status: "expired" as const }
      : invitation;
  }

  async getInvitationByTokenHash(tokenHash: string, now: number) {
    const invitation = [...this.platformInvitations.values()].find(value => value.tokenHash === tokenHash) ?? null;
    return invitation?.status === "pending" && invitation.expiresAt <= now
      ? { ...invitation, status: "expired" as const }
      : invitation;
  }

  async listInvitations(input: Parameters<PlatformInvitationRepository["listInvitations"]>[0]) {
    const rows: StoredPlatformInvitation[] = [];
    for (const invitation of this.platformInvitations.values()) {
      const projected = invitation.status === "pending" && invitation.expiresAt <= input.now
        ? { ...invitation, status: "expired" as const }
        : invitation;
      if (projected.invitationId <= input.afterInvitationId) continue;
      if (input.query !== undefined && !projected.emailConstraint.includes(input.query)) continue;
      if (input.status !== undefined && projected.status !== input.status) continue;
      rows.push(projected);
    }
    return rows.sort((left, right) => left.invitationId.localeCompare(right.invitationId)).slice(0, input.limit);
  }

  async getInvitationIdempotency(input: Parameters<PlatformInvitationRepository["getInvitationIdempotency"]>[0]) {
    const record = this.platformInvitationIdempotency.get(`${this.key(input.actor)}\0${input.key}`) ?? null;
    return record && record.expiresAt > input.now ? record : null;
  }

  async commitCreateInvitation(input: Parameters<PlatformInvitationRepository["commitCreateInvitation"]>[0]) {
    const actor = this.states.get(this.key(input.actor));
    if (!actor?.authorities.includes("platform.admin") || actor.status !== "active") return "forbidden" as const;
    const idempotencyKey = `${this.key(input.actor)}\0${input.idempotency.key}`;
    if (this.platformInvitationIdempotency.has(idempotencyKey)) return "idempotency-conflict" as const;
    this.platformInvitations.set(input.invitation.invitationId, input.invitation);
    this.platformInvitationIdempotency.set(idempotencyKey, input.idempotency);
    this.platformAudits.push(input.audit);
    return "created" as const;
  }

  async commitRevokeInvitation(input: Parameters<PlatformInvitationRepository["commitRevokeInvitation"]>[0]) {
    const actor = this.states.get(this.key(input.actor));
    if (!actor?.authorities.includes("platform.admin") || actor.status !== "active") return "forbidden" as const;
    const invitation = this.platformInvitations.get(input.invitationId);
    if (!invitation) return "not-found" as const;
    if (invitation.revision !== input.expectedRevision) return "revision-mismatch" as const;
    if (invitation.status !== "pending" || invitation.expiresAt <= input.now) return "not-pending" as const;
    this.platformInvitations.set(input.invitationId, { ...invitation, status: "revoked", revision: invitation.revision + 1 });
    this.platformAudits.push(input.audit);
    return "updated" as const;
  }

  async commitAcceptInvitation(input: Parameters<PlatformInvitationRepository["commitAcceptInvitation"]>[0]) {
    const invitation = this.platformInvitations.get(input.invitation.invitationId);
    if (!invitation || invitation.status !== "pending" || invitation.tokenHash !== input.tokenHash || invitation.expiresAt <= input.now) {
      return "not-pending" as const;
    }
    const principalKey = this.key(input.principal);
    const current = this.states.get(principalKey);
    if (current?.status === "blocked") return "blocked" as const;
    const authorities = (["platform.admin", "apps.create"] as const)
      .filter(authority => current?.authorities.includes(authority) || invitation.authorities.includes(authority));
    this.states.set(principalKey, current
      ? { ...current, authorities, revision: current.revision + 1 }
      : { principalRef: input.principalRef, principal: input.principal, status: "active", authorities, revision: 1, createdAt: input.now, updatedAt: input.now });
    this.platformInvitations.set(invitation.invitationId, { ...invitation, status: "accepted", revision: invitation.revision + 1 });
    this.platformAudits.push(input.audit);
    return "accepted" as const;
  }

  async listAuditEvents(input: Parameters<PlatformAuditRepository["listAuditEvents"]>[0]) {
    return this.platformAudits
      .map(event => ({
        eventId: event.eventId,
        action: event.action as "platform_invitation.created" | "platform_invitation.revoked" | "platform_invitation.accepted" | "platform_access.authority_changed" | "platform_access.blocked" | "platform_access.restored" | "platform_access.change_denied" | "app.create_denied",
        actorPrincipalRef: this.states.get(this.key(event.actorPrincipal))?.principalRef ?? null,
        actorPrincipal: event.actorPrincipal,
        targetPrincipalRef: event.targetPrincipal ? this.states.get(this.key(event.targetPrincipal))?.principalRef ?? null : null,
        targetPrincipal: event.targetPrincipal,
        targetInvitationId: event.targetInvitationId ?? null,
        result: event.result,
        requestId: event.requestId ?? null,
        createdAt: event.createdAt,
        details: event.details ?? {},
      }))
      .filter(event => input.action === undefined || event.action === input.action)
      .filter(event => input.actorPrincipalRef === undefined || event.actorPrincipalRef === input.actorPrincipalRef)
      .filter(event => input.targetPrincipalRef === undefined || event.targetPrincipalRef === input.targetPrincipalRef)
      .filter(event => input.createdAfter === undefined || event.createdAt > input.createdAfter)
      .filter(event => input.beforeCreatedAt === undefined || event.createdAt < input.beforeCreatedAt
        || (event.createdAt === input.beforeCreatedAt && event.eventId < input.beforeEventId!))
      .sort((left, right) => right.createdAt - left.createdAt || right.eventId.localeCompare(left.eventId))
      .slice(0, input.limit);
  }

  async getPrincipal(principalRef: string): Promise<PlatformPrincipalDetail | null> {
    const state = this.states.get(principalRef);
    if (!state) return null;
    const hasMember = this.members.has(principalRef);
    return {
      ...state,
      profile: { displayName: `User ${state.principal.subject}`, emailForDisplay: `${state.principal.subject}@example.com` },
      appMembershipCount: hasMember ? 1 : 0,
      effectiveAccess: effectivePlatformAccess(state, hasMember),
      lastActiveAt: null,
      memberships: [],
    };
  }

  async listPrincipals(input: Parameters<PlatformAccessRepository["listPrincipals"]>[0]): Promise<readonly PlatformPrincipalListItem[]> {
    const all = [...this.states.entries()]
      .filter(([ref]) => ref > input.after)
      .filter(([, state]) => input.query === undefined
        || state.principal.subject.toLowerCase().includes(input.query)
        || `${state.principal.subject}@example.com`.includes(input.query))
      .filter(([ref, state]) => input.effectiveAccess === undefined
        || effectivePlatformAccess(state, this.members.has(ref)) === input.effectiveAccess)
      .filter(([, state]) => input.authority === undefined
        || input.authority === "none" && state.authorities.length === 0
        || input.authority !== "none" && state.authorities.includes(input.authority))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .slice(0, input.limit);
    return all.map(([ref, state]) => {
      const hasMember = this.members.has(ref);
      return {
        ...state,
        profile: { displayName: `User ${state.principal.subject}`, emailForDisplay: `${state.principal.subject}@example.com` },
        appMembershipCount: hasMember ? 1 : 0,
        effectiveAccess: effectivePlatformAccess(state, hasMember),
        lastActiveAt: null,
      };
    });
  }

  async getAccessSummary(): Promise<{ activePrincipalCount: number; platformAdminCount: number; appCreatorCount: number; blockedPrincipalCount: number }> {
    let activePrincipalCount = 0;
    let platformAdminCount = 0;
    let appCreatorCount = 0;
    let blockedPrincipalCount = 0;
    for (const state of this.states.values()) {
      if (state.status === "active") {
        activePrincipalCount++;
        if (state.authorities.includes("platform.admin")) platformAdminCount++;
        if (state.authorities.includes("apps.create")) appCreatorCount++;
      } else {
        blockedPrincipalCount++;
      }
    }
    return { activePrincipalCount, platformAdminCount, appCreatorCount, blockedPrincipalCount };
  }

  async patchAccess(input: Parameters<PlatformAccessRepository["patchAccess"]>[0]): Promise<"updated" | "revision-mismatch" | "last-admin" | "forbidden"> {
    const actorState = this.states.get(this.key(input.actor));
    if (!actorState || actorState.status !== "active" || !actorState.authorities.includes("platform.admin")) {
      return "forbidden";
    }
    if (input.current.revision !== (this.states.get(input.current.principalRef)?.revision ?? -1)) {
      return "revision-mismatch";
    }
    this.states.set(input.current.principalRef, {
      ...input.current,
      status: input.status,
      authorities: input.authorities,
      revision: input.current.revision + 1,
    });
    this.platformAudits.push(input.audit);
    return "updated";
  }

  async appendAudit(event: PlatformAuditRecord): Promise<void> { this.platformAudits.push(event); }
}

class MemoryEmailChallengeRepository implements EmailChallengeRepository {
  readonly records = new Map<string, EmailChallengeRecord>();

  async create(record: EmailChallengeRecord): Promise<"created" | "conflict" | "rate-limited"> {
    if (this.records.has(record.challengeId)) return "conflict";
    this.records.set(record.challengeId, record);
    return "created";
  }

  async get(challengeId: string): Promise<EmailChallengeRecord | null> {
    return this.records.get(challengeId) ?? null;
  }

  async invalidate(input: Parameters<EmailChallengeRepository["invalidate"]>[0]): Promise<void> {
    const record = this.records.get(input.challengeId);
    if (record && sameChallengeBinding(record, input.binding) && record.consumedAt === null) {
      this.records.set(record.challengeId, { ...record, invalidatedAt: input.now });
    }
  }

  async verify(input: Parameters<EmailChallengeRepository["verify"]>[0]): ReturnType<EmailChallengeRepository["verify"]> {
    const record = this.records.get(input.challengeId);
    if (!record || !sameChallengeBinding(record, input.binding) || record.verifiedAt !== null
      || record.invalidatedAt !== null
      || record.consumedAt !== null || record.expiresAt <= input.now
      || record.attemptCount >= record.maxAttempts) return { kind: "failed" };
    const verifiedAt = record.codeHash === input.codeHash ? input.now : null;
    this.records.set(record.challengeId, {
      ...record,
      attemptCount: record.attemptCount + 1,
      verifiedAt,
    });
    return verifiedAt === null
      ? { kind: "failed" }
      : { kind: "verified", verifiedAt, expiresAt: record.expiresAt };
  }

  async resend(input: Parameters<EmailChallengeRepository["resend"]>[0]): ReturnType<EmailChallengeRepository["resend"]> {
    const record = this.records.get(input.challengeId);
    if (!record || !sameChallengeBinding(record, input.binding) || record.verifiedAt !== null
      || record.invalidatedAt !== null
      || record.consumedAt !== null || record.expiresAt <= input.now
      || record.attemptCount >= record.maxAttempts || record.sendCount >= input.maxSends
      || record.lastSentAt + input.minimumIntervalMs > input.now) return { kind: "failed" };
    this.records.set(record.challengeId, {
      ...record,
      codeHash: input.codeHash,
      sendCount: record.sendCount + 1,
      lastSentAt: input.now,
    });
    return { kind: "resent", expiresAt: record.expiresAt };
  }
}

function sameChallengeBinding(left: EmailChallengeBinding, right: EmailChallengeBinding): boolean {
  return left.invitationKind === right.invitationKind
    && left.invitationId === right.invitationId
    && left.invitationTokenHash === right.invitationTokenHash
    && left.issuer === right.issuer
    && left.subject === right.subject
    && left.authenticationEventId === right.authenticationEventId
    && left.normalizedEmail === right.normalizedEmail;
}

function testAccountId(subject: string): `acct_${string}` {
  const normalized = subject.replace(/[^A-Za-z0-9_-]/g, "_").padEnd(22, "_").slice(0, 22);
  return `acct_${normalized}`;
}

function memoryAccountRepository(
  platform: MemoryPlatformAccessRepository,
  subject: string,
): AccountRepository {
  const accounts = new Map<string, AccountRecord>();
  const profiles = new Map<string, { accountId: string; displayName: string | null; avatarUrl: string | null; displayNameSource: string | null; avatarSource: string | null; updatedAt: number }>();
  const identities = new Map<string, ExternalIdentityRecord>();
  const identityKeys = new Map<string, ExternalIdentityRecord>();
  function add(
    account: AccountRecord,
    profile: { accountId: string; displayName: string | null; avatarUrl: string | null; displayNameSource: string | null; avatarSource: string | null; updatedAt: number },
    identity: ExternalIdentityRecord,
  ) {
    accounts.set(account.accountId, account);
    profiles.set(profile.accountId, profile);
    identities.set(identity.externalIdentityId, identity);
    identityKeys.set(`${identity.issuer}\0${identity.subject}`, identity);
  }
  const accountId = testAccountId(subject);
  const seedIdentity: ExternalIdentityRecord = {
    externalIdentityId: `ext-${subject}`, accountId, provider: "google", issuer: ISSUER, subject,
    linkedAt: 1, lastAuthenticatedAt: 1, unlinkedAt: null, accountHint: null, displayName: subject, avatarUrl: null,
  };
  add(
    { accountId, blockedAt: null, credentialVersion: 1, primaryVerifiedEmail: null, createdAt: 1, updatedAt: 1 },
    { accountId, displayName: subject, avatarUrl: null, displayNameSource: seedIdentity.externalIdentityId, avatarSource: null, updatedAt: 1 },
    seedIdentity,
  );
  const identityForAccount = (requested: string) => [...identities.values()].find(value => value.accountId === requested && value.unlinkedAt === null) ?? null;
  return {
    getAccount: async requested => accounts.get(requested) ?? null,
    getAliasTarget: async () => null,
    getActiveIdentity: async (issuer, candidateSubject) => identityKeys.get(`${issuer}\0${candidateSubject}`) ?? null,
    getIdentity: async externalIdentityId => identities.get(externalIdentityId) ?? null,
    getProfile: async requested => profiles.get(requested) ?? null,
    listActiveIdentities: async requested => [...identities.values()].filter(value => value.accountId === requested && value.unlinkedAt === null),
    listPlatformAuthorities: async requested => {
      const identity = identityForAccount(requested);
      if (!identity) return [];
      return (await platform.getAccess({ issuer: identity.issuer, subject: identity.subject }))?.authorities ?? [];
    },
    hasAppMembership: async requested => {
      const identity = identityForAccount(requested);
      return identity ? platform.hasMembership({ issuer: identity.issuer, subject: identity.subject }) : false;
    },
    listAccountMembershipAppIds: async () => [],
    readControlSnapshot: () => platform.readSnapshot(),
    listPlatformAccountAuditEvents: async input => {
      const events = await platform.listAuditEvents({
        action: input.action,
        createdAfter: input.createdAfter,
        beforeCreatedAt: input.beforeCreatedAt,
        beforeEventId: input.beforeEventId,
        limit: input.limit,
      });
      return events.flatMap(event => {
        const actorIdentity = identityKeys.get(`${event.actorPrincipal.issuer}\0${event.actorPrincipal.subject}`);
        if (!actorIdentity) return [];
        const actorAccount = accounts.get(actorIdentity.accountId)!;
        const actorProfile = profiles.get(actorIdentity.accountId)!;
        const targetIdentity = event.targetPrincipal
          ? identityKeys.get(`${event.targetPrincipal.issuer}\0${event.targetPrincipal.subject}`) ?? null
          : null;
        if (input.actorAccountId !== undefined && input.actorAccountId !== actorAccount.accountId) return [];
        if (input.targetAccountId !== undefined && input.targetAccountId !== targetIdentity?.accountId) return [];
        return [{
          account: actorAccount,
          profile: actorProfile,
          identity: actorIdentity,
          eventId: event.eventId,
          action: event.action,
          targetAccount: targetIdentity ? accounts.get(targetIdentity.accountId) ?? null : null,
          targetProfile: targetIdentity ? profiles.get(targetIdentity.accountId) ?? null : null,
          targetInvitationId: event.targetInvitationId,
          result: event.result,
          requestId: event.requestId,
          createdAt: event.createdAt,
          details: event.details,
        }];
      });
    },
    createAccountWithIdentity: async input => {
      if (identityKeys.has(`${input.identity.issuer}\0${input.identity.subject}`)) return "identity-conflict";
      add(input.account, input.profile, input.identity);
      return "created";
    },
  } as AccountRepository;
}

async function createMockProvider(): Promise<MockProvider> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = (await exportJWK(publicKey)) as Record<string, unknown>;
  return {
    privateKey,
    publicJwk,
    pendingClaims: null,
    issueIdToken: (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "mock-kid" })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
        .sign(privateKey),
    expectTokenBody: null,
  };
}

async function createBff(
  provider: MockProvider,
  auditReader?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> },
  configOverrides: Partial<AdminBffConfig> = {},
  platformAccessRepository?: PlatformAccessRepository,
  controlPlane: ControlPlaneOperations = fakeControlPlane(),
  platformInvitationRepository?: PlatformInvitationRepository,
  platformAuditRepository?: PlatformAuditRepository,
  peopleRepository?: PeopleRepository,
  accountRepository?: AccountRepository,
): Promise<(request: Request) => Promise<Response>> {
  const providerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    if (url.toString() === DISCOVERY_URL) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: AUTHORIZE_URL,
        token_endpoint: TOKEN_URL,
        jwks_uri: JWKS_URL,
      });
    }
    if (url.toString() === JWKS_URL) {
      return Response.json({ keys: [{ ...provider.publicJwk, kid: "mock-kid", alg: "RS256", use: "sig" }] });
    }
    if (url.toString() === TOKEN_URL) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      if (provider.expectTokenBody) provider.expectTokenBody(body);
      const idToken = await provider.issueIdToken(provider.pendingClaims!);
      return Response.json({ id_token: idToken, access_token: "mock-access" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const config: AdminBffConfig = {
    googleClientId: CLIENT_ID,
    googleClientSecret: CLIENT_SECRET,
    sessionEncryptionKeys: { v1: randomKey() },
    oidcIssuer: ISSUER,
    oidcDiscoveryUrl: DISCOVERY_URL,
    publicOrigin: PUBLIC_ORIGIN,
    sessionCookieSecure: false,
    auditReaderKey: "audit-reader-secret",
    ...configOverrides,
  };
  const oidc = new OidcClient(
    {
      issuer: ISSUER,
      discoveryUrl: DISCOVERY_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: `${PUBLIC_ORIGIN}/admin/auth/callback`,
    },
    { fetchImpl: providerFetch },
  );
  return createAdminBff({
    config,
    controlPlane,
    sessionStore: new MemorySessionRepository(config.now),
    oidc,
    auditReader,
    platformAccessRepository,
    platformInvitationRepository,
    platformAuditRepository,
    peopleRepository,
    accountRepository,
  });
}

function cookieFrom(response: Response): string | null {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0]!.trim();
}

function authRequest(
  bff: (request: Request) => Promise<Response>,
  path: string,
  cookie: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  headers.set("Origin", PUBLIC_ORIGIN);
  return bff(new Request(`${PUBLIC_ORIGIN}${path}`, { ...init, headers }));
}

async function signIn(bff: (request: Request) => Promise<Response>, provider: MockProvider): Promise<{ cookie: string; csrf: string }> {
  // 1. Start login.
  const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc?returnTo=/admin/`));
  expect(login.status).toBe(302);
  const preLoginCookie = cookieFrom(login)!;
  const location = new URL(login.headers.get("Location")!);
  expect(location.origin).toBe(ISSUER);
  const state = location.searchParams.get("state")!;
  const nonce = location.searchParams.get("nonce")!;
  const codeChallenge = location.searchParams.get("code_challenge")!;
  expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(location.searchParams.get("prompt")).toBe("select_account");
  expect(location.searchParams.get("redirect_uri")).toBe(`${PUBLIC_ORIGIN}/admin/auth/callback`);
  expect(state).toBeTruthy();
  expect(nonce).toBeTruthy();
  expect(codeChallenge).toBeTruthy();

  // 2. Provider issues an id_token (nonce echoed back).
  provider.pendingClaims = {
    iss: ISSUER,
    sub: "google-user-123",
    aud: CLIENT_ID,
    nonce,
    email: "alice@example.com",
    email_verified: true,
    name: "Alice",
  };

  // 3. Callback with the authorization code.
  const callback = await bff(new Request(
    `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: preLoginCookie } },
  ));
  expect(callback.status).toBe(302);
  expect(callback.headers.get("Location")).toBe("/admin/");
  const cookie = cookieFrom(callback)!;

  // 4. Load the shell to obtain the CSRF token.
  const shell = await authRequest(bff, "/admin/", cookie);
  expect(shell.status).toBe(200);
  const html = await shell.text();
  expect(html).toContain("/admin/assets/index.css?v=issuer-discovery-v1");
  expect(html).toContain("/admin/assets/index.js?v=issuer-discovery-v1");
  const match = /<meta name="x-csrf-token" content="([^"]+)"/.exec(html);
  expect(match).not.toBeNull();
  return { cookie, csrf: match![1]! };
}

/** Sign in as an arbitrary Google subject (for non-member checks). */
async function signInAs(
  bff: (request: Request) => Promise<Response>,
  provider: MockProvider,
  subject: string,
): Promise<{ cookie: string; csrf: string }> {
  const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc?returnTo=/admin/`));
  const preLoginCookie = cookieFrom(login)!;
  const location = new URL(login.headers.get("Location")!);
  const state = location.searchParams.get("state")!;
  const nonce = location.searchParams.get("nonce")!;
  provider.pendingClaims = {
    iss: ISSUER,
    sub: subject,
    aud: CLIENT_ID,
    nonce,
    email: `${subject}@example.com`,
    email_verified: true,
    name: subject,
  };
  const callback = await bff(new Request(
    `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: preLoginCookie } },
  ));
  const cookie = cookieFrom(callback)!;
  const shell = await authRequest(bff, "/admin/", cookie);
  const html = await shell.text();
  const match = /<meta name="x-csrf-token" content="([^"]+)"/.exec(html);
  return { cookie, csrf: match![1]! };
}

describe("cas-admin-webui BFF", () => {
  test("rejects retired sessions without upgrading them or executing mutations", async () => {
    const platform = new MemoryPlatformAccessRepository();
    platform.grant(ISSUER, "legacy-subject");
    const repository = memoryAccountRepository(platform, "legacy-subject");
    const sessions = new MemorySessionRepository();
    const keys = { current: randomKey() };
    const cryptography = new SessionCrypto(keys);
    const controlPlane = fakeControlPlane();
    const patch = vi.spyOn(repository, "getAccount");
    const bff = createAdminBff({
      config: { googleClientId: CLIENT_ID, googleClientSecret: CLIENT_SECRET, sessionEncryptionKeys: keys, publicOrigin: PUBLIC_ORIGIN, sessionCookieSecure: false },
      sessionStore: sessions, controlPlane, platformAccessRepository: platform, accountRepository: repository,
    });
    const legacy = { v: 1 as const, authenticated: true, identityIssuer: ISSUER, subject: "legacy-subject", displayName: "Legacy", emailForDisplay: null, csrfToken: "old-csrf" };
    await sessions.create("old-session", await cryptography.encrypt(legacy), 60_000);
    const read = await authRequest(bff, "/admin/account", "cas_admin_session=old-session");
    expect(read.status).toBe(401);
    expect(read.headers.get("Set-Cookie")).toBeNull();
    expect(fakeSessions.has("old-session")).toBe(false);
    await sessions.create("old-session", await cryptography.encrypt(legacy), 60_000);
    expect((await authRequest(bff, "/admin/account/profile", "cas_admin_session=old-session", {
      method: "PATCH", headers: { "X-CSRF-Token": "old-csrf", "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Changed" }),
    })).status).toBe(401);
    expect(patch).not.toHaveBeenCalled();
    expect(fakeSessions.size).toBe(0);
  });

  test("unauthenticated visitors land on a login page before OIDC", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);

    const shell = await bff(new Request(`${PUBLIC_ORIGIN}/admin/`));
    expect(shell.status).toBe(302);
    expect(shell.headers.get("Location")).toBe("/admin/auth/login?returnTo=%2Fadmin%2F");

    const login = await bff(new Request(`${PUBLIC_ORIGIN}${shell.headers.get("Location")!}`));
    expect(login.status).toBe(200);
    expect(login.headers.get("Location")).toBeNull();
    expect(login.headers.get("Set-Cookie")).toBeNull();
    const html = await login.text();
    expect(html).toContain("Sign in");
    expect(html).toContain("/admin/auth/oidc?returnTo=%2Fadmin%2F");
    expect(html).toContain("Continue with Google");
    expect(html).toContain("/admin/assets/index.css?v=issuer-discovery-v1");
  });

  test("renders configured providers and binds browser and CLI callbacks to the selected provider", async () => {
    const provider = (kind: "google" | "microsoft", email: string): ProviderAdapter => ({
      kind,
      displayName: kind === "google" ? "Google" : "Microsoft",
      begin: vi.fn(async context => `https://${kind}.example/authorize?state=${encodeURIComponent(context.state)}`),
      complete: vi.fn(async input => ({
        provider: kind,
        issuer: `https://${kind}.example`,
        subject: `${kind}-subject`,
        displayName: `${kind} user`,
        avatarUrl: null,
        accountHint: email,
        verifiedEmailEvidence: kind === "google" ? [{
          normalizedEmail: email,
          source: "google-oidc",
          verifiedAt: 1,
          expiresAt: Number.MAX_SAFE_INTEGER,
          authenticationEventId: input.authenticationEventId,
        }] : [],
        authenticatedAt: 1,
        authenticationEventId: input.authenticationEventId,
      })),
    });
    const registry = new ProviderRegistry([
      provider("google", "google@example.com"),
      provider("microsoft", "microsoft@example.com"),
    ]);
    const config: AdminBffConfig = {
      googleClientId: CLIENT_ID,
      googleClientSecret: CLIENT_SECRET,
      sessionEncryptionKeys: { v1: randomKey() },
      publicOrigin: PUBLIC_ORIGIN,
      sessionCookieSecure: false,
    };
    const bff = createAdminBff({
      config,
      controlPlane: fakeControlPlane(),
      sessionStore: new MemorySessionRepository(),
      providerRegistry: registry,
    });

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/login`));
    const html = await login.text();
    expect(html).toContain("Continue with Google");
    expect(html).toContain("Continue with Microsoft");
    expect(html).not.toContain("Continue with GitHub");

    const started = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/microsoft`));
    const preLoginCookie = cookieFrom(started)!;
    const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    const mismatch = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/github?code=code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(mismatch.headers.get("Location")).toBe("/admin/auth/login?error=oidc-failed");
    expect((await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/github`))).status).toBe(404);

    const restarted = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/microsoft`));
    const restartedCookie = cookieFrom(restarted)!;
    const restartedState = new URL(restarted.headers.get("Location")!).searchParams.get("state")!;
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/microsoft?code=code&state=${encodeURIComponent(restartedState)}`,
      { headers: { Cookie: restartedCookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/");

    const cli = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/cli/authorize?client_id=unicas-cli&provider=microsoft&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&state=cli-state&code_challenge=${await s256Challenge("verifier")}&code_challenge_method=S256`,
    ));
    expect(new URL(cli.headers.get("Location")!).origin).toBe("https://microsoft.example");
  });

  test("shows provider choices for invitations and preserves the selected continuation", async () => {
    const token = "t".repeat(32);
    const repository = new MemoryPlatformAccessRepository();
    await repository.addInvitation(token, "alice@example.com");
    const provider = (kind: "google" | "microsoft"): ProviderAdapter => ({
      kind,
      displayName: kind === "google" ? "Google" : "Microsoft",
      begin: vi.fn(async context => `https://${kind}.example/authorize?state=${encodeURIComponent(context.state)}`),
      complete: vi.fn(async input => ({
        provider: kind,
        issuer: `https://${kind}.example`,
        subject: "alice",
        displayName: "Alice",
        avatarUrl: null,
        accountHint: "alice@example.com",
        verifiedEmailEvidence: kind === "google" ? [{
          normalizedEmail: "alice@example.com",
          source: "google-oidc",
          verifiedAt: 1,
          expiresAt: Number.MAX_SAFE_INTEGER,
          authenticationEventId: input.authenticationEventId,
        }] : [],
        authenticatedAt: 1,
        authenticationEventId: input.authenticationEventId,
      })),
    });
    const bff = createAdminBff({
      config: {
        googleClientId: CLIENT_ID,
        googleClientSecret: CLIENT_SECRET,
        sessionEncryptionKeys: { v1: randomKey() },
        publicOrigin: PUBLIC_ORIGIN,
        sessionCookieSecure: false,
      },
      controlPlane: fakeControlPlane(),
      sessionStore: new MemorySessionRepository(),
      platformAccessRepository: repository,
      providerRegistry: new ProviderRegistry([provider("google"), provider("microsoft")]),
    });

    const selector = await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/${token}`));
    expect(selector.status).toBe(200);
    const html = await selector.text();
    expect(html).toContain(`/admin/invitations/${token}?provider=google`);
    expect(html).toContain(`/admin/invitations/${token}?provider=microsoft`);
    expect((await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/${token}?provider=github`))).status).toBe(404);

    const started = await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/${token}?provider=google`));
    const cookie = cookieFrom(started)!;
    const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: cookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe(`/admin/#/invitations/${token}`);
  });

  test("requires an invitation-bound email challenge for Microsoft and rejects replay", async () => {
    let clock = Date.now();
    const token = "m".repeat(32);
    const platform = new MemoryPlatformAccessRepository();
    await platform.addInvitation(token, "alice@example.com", clock + 600_000);
    const challengeRepository = new MemoryEmailChallengeRepository();
    const deliveries: { to: string; code: string }[] = [];
    const microsoft: ProviderAdapter = {
      kind: "microsoft",
      displayName: "Microsoft",
      begin: async context => `https://microsoft.example/authorize?state=${encodeURIComponent(context.state)}`,
      complete: async input => ({
        provider: "microsoft",
        issuer: "https://login.microsoftonline.com/consumers/v2.0",
        subject: "microsoft-subject",
        displayName: "Alice",
        avatarUrl: null,
        accountHint: "alice@example.com",
        verifiedEmailEvidence: [],
        authenticatedAt: Date.now(),
        authenticationEventId: input.authenticationEventId,
      }),
    };
    const config: AdminBffConfig = {
      googleClientId: CLIENT_ID,
      googleClientSecret: CLIENT_SECRET,
      sessionEncryptionKeys: { v1: randomKey() },
      publicOrigin: PUBLIC_ORIGIN,
      sessionCookieSecure: false,
      now: () => clock,
    };
    const bff = createAdminBff({
      config,
      controlPlane: fakeControlPlane(),
      sessionStore: new MemorySessionRepository(),
      platformAccessRepository: platform,
      accountRepository: memoryAccountRepository(platform, "seed-admin"),
      providerRegistry: new ProviderRegistry([microsoft]),
      emailChallengeRepository: challengeRepository,
      emailChallengeSender: {
        send: async delivery => { deliveries.push({ to: delivery.to, code: delivery.code }); },
      },
    });

    const started = await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/${token}`));
    const preLoginCookie = cookieFrom(started)!;
    const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/microsoft?code=code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/auth/email-challenge");
    const challengeCookie = cookieFrom(callback)!;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.to).toBe("alice@example.com");

    const page = await authRequest(bff, "/admin/auth/email-challenge", challengeCookie);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("al***@example.com");
    expect(html).not.toContain("alice@example.com");
    const csrf = /const csrf = "([^"]+)"/.exec(html)![1]!;

    const missingOrigin = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/email-challenge/verify`, {
      method: "POST",
      headers: { Cookie: challengeCookie, "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ code: deliveries[0]!.code }),
    }));
    expect(missingOrigin.status).toBe(400);

    const rateLimitedResend = await authRequest(bff, "/admin/auth/email-challenge/resend", challengeCookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
    });
    expect(rateLimitedResend.status).toBe(204);
    expect(deliveries).toHaveLength(1);
    clock += 60_000;
    const resent = await authRequest(bff, "/admin/auth/email-challenge/resend", challengeCookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
    });
    expect(resent.status).toBe(204);
    expect(deliveries).toHaveLength(2);
    const resentCookie = cookieFrom(resent)!;
    expect((await authRequest(bff, "/admin/auth/email-challenge", challengeCookie)).status).toBe(400);

    const wrong = await authRequest(bff, "/admin/auth/email-challenge/verify", resentCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ code: deliveries[0]!.code }),
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "EMAIL_CHALLENGE_FAILED", message: "email verification failed" });

    const verified = await authRequest(bff, "/admin/auth/email-challenge/verify", resentCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ code: deliveries[1]!.code }),
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ next: `/admin/#/invitations/${token}` });
    const invitationCookie = cookieFrom(verified)!;
    expect(invitationCookie).not.toBe(resentCookie);
    const limited = await authRequest(bff, "/admin/me", invitationCookie);
    expect(limited.status).toBe(403);
    expect(await limited.json()).toMatchObject({ error: "INVITATION_SESSION_REQUIRED" });

    const replay = await authRequest(bff, "/admin/auth/email-challenge/verify", resentCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ code: deliveries[0]!.code }),
    });
    expect(replay.status).toBe(400);
  });

  test("invalidates challenge state when email delivery fails without logging secrets", async () => {
    const token = "d".repeat(32);
    const platform = new MemoryPlatformAccessRepository();
    await platform.addInvitation(token, "private@example.com");
    const challengeRepository = new MemoryEmailChallengeRepository();
    let attemptedCode = "";
    const microsoft: ProviderAdapter = {
      kind: "microsoft",
      displayName: "Microsoft",
      begin: async context => `https://microsoft.example/authorize?state=${encodeURIComponent(context.state)}`,
      complete: async input => ({
        provider: "microsoft",
        issuer: "https://login.microsoftonline.com/consumers/v2.0",
        subject: "delivery-failure-subject",
        displayName: "Private Invitee",
        avatarUrl: null,
        accountHint: "untrusted@example.com",
        verifiedEmailEvidence: [],
        authenticatedAt: Date.now(),
        authenticationEventId: input.authenticationEventId,
      }),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bff = createAdminBff({
      config: {
        googleClientId: CLIENT_ID,
        googleClientSecret: CLIENT_SECRET,
        sessionEncryptionKeys: { v1: randomKey() },
        publicOrigin: PUBLIC_ORIGIN,
        sessionCookieSecure: false,
      },
      controlPlane: fakeControlPlane(),
      sessionStore: new MemorySessionRepository(),
      platformAccessRepository: platform,
      accountRepository: memoryAccountRepository(platform, "seed-admin"),
      providerRegistry: new ProviderRegistry([microsoft]),
      emailChallengeRepository: challengeRepository,
      emailChallengeSender: {
        send: async delivery => {
          attemptedCode = delivery.code;
          throw new Error(`delivery failed for ${delivery.to} using ${delivery.code}`);
        },
      },
    });

    const started = await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/${token}`));
    const preLoginCookie = cookieFrom(started)!;
    const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/microsoft?code=code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=access-denied");
    expect(callback.headers.get("Set-Cookie")).toBeNull();
    expect([...challengeRepository.records.values()]).toEqual([
      expect.objectContaining({ consumedAt: null, invalidatedAt: expect.any(Number) }),
    ]);
    const logs = JSON.stringify(consoleError.mock.calls);
    expect(logs).not.toContain("private@example.com");
    expect(logs).not.toContain(attemptedCode);
    expect(logs).not.toContain(token);
    consoleError.mockRestore();
  });

  test("admits linked providers through one Account and rejects stale credential versions", async () => {
    const accountId = `acct_${"a".repeat(22)}`;
    let account: AccountRecord = {
      accountId,
      blockedAt: null,
      credentialVersion: 1,
      primaryVerifiedEmail: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const identities = new Map<string, ExternalIdentityRecord>([
      ["https://google.example\0google-subject", {
        externalIdentityId: "ext-google",
        accountId,
        provider: "google",
        issuer: "https://google.example",
        subject: "google-subject",
        linkedAt: 1,
        lastAuthenticatedAt: 1,
        unlinkedAt: null,
        accountHint: null,
        displayName: "google user",
        avatarUrl: null,
      }],
      ["https://github.example\0github-subject", {
        externalIdentityId: "ext-github",
        accountId,
        provider: "github",
        issuer: "https://github.example",
        subject: "github-subject",
        linkedAt: 1,
        lastAuthenticatedAt: 1,
        unlinkedAt: null,
        accountHint: null,
        displayName: "github user",
        avatarUrl: null,
      }],
    ]);
    const accountRepository: AccountRepository = {
      getAccount: async requested => requested === accountId ? account : null,
      getAliasTarget: async () => null,
      getActiveIdentity: async (issuer, subject) => identities.get(`${issuer}\0${subject}`) ?? null,
      getIdentity: async externalIdentityId => [...identities.values()].find(identity => identity.externalIdentityId === externalIdentityId) ?? null,
      getProfile: async () => ({ accountId, displayName: "Account User", avatarUrl: null, displayNameSource: "user", avatarSource: "user", updatedAt: 1 }),
      listActiveIdentities: async () => [...identities.values()],
      listPlatformAuthorities: async () => ["platform.admin"],
      hasAppMembership: async () => false,
      listAccountMembershipAppIds: async () => [],
      createAccountWithIdentity: async () => "identity-conflict",
    };
    const adapter = (kind: "google" | "github"): ProviderAdapter => ({
      kind,
      displayName: kind,
      begin: async context => `https://${kind}.example/authorize?state=${context.state}`,
      complete: async input => ({
        provider: kind,
        issuer: `https://${kind}.example`,
        subject: `${kind}-subject`,
        displayName: kind,
        avatarUrl: null,
        accountHint: null,
        verifiedEmailEvidence: [],
        authenticatedAt: 1,
        authenticationEventId: input.authenticationEventId,
      }),
    });
    const bff = createAdminBff({
      config: {
        googleClientId: CLIENT_ID,
        googleClientSecret: CLIENT_SECRET,
        sessionEncryptionKeys: { v1: randomKey() },
        publicOrigin: PUBLIC_ORIGIN,
        sessionCookieSecure: false,
      },
      controlPlane: fakeControlPlane(),
      sessionStore: new MemorySessionRepository(),
      providerRegistry: new ProviderRegistry([adapter("google"), adapter("github")]),
      accountRepository,
    });

    async function login(kind: "google" | "github") {
      const started = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/${kind}`));
      const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
      return bff(new Request(
        `${PUBLIC_ORIGIN}/admin/auth/callback/${kind}?code=code&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: cookieFrom(started)! } },
      ));
    }

    expect((await login("google")).status).toBe(302);
    const githubLogin = await login("github");
    expect(githubLogin.status).toBe(302);
    const githubCookie = cookieFrom(githubLogin)!;
    expect((await authRequest(bff, "/admin/me", githubCookie)).status).toBe(200);

    account = { ...account, credentialVersion: 2, updatedAt: 2 };
    expect((await authRequest(bff, "/admin/me", githubCookie)).status).toBe(401);
  });

  test("CLI login: authorize redirects to Google, callback hands a one-time code, exchange issues a session", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const cliCodeChallenge = await s256Challenge("cli-verifier-1");

    // 1. CLI authorize: fixed public client id + loopback redirect + PKCE.
    const authorize = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/cli/authorize?client_id=unicas-cli&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&state=cli-state-1&code_challenge=${cliCodeChallenge}&code_challenge_method=S256`,
    ));
    expect(authorize.status).toBe(302);
    const preLoginCookie = cookieFrom(authorize)!;
    const googleUrl = new URL(authorize.headers.get("Location")!);
    expect(googleUrl.origin).toBe(ISSUER);
    // The BFF is a separate OAuth client of Google. Its PKCE transaction must
    // not reuse the CLI's challenge because Google later receives the BFF's
    // independently generated verifier.
    expect(googleUrl.searchParams.get("code_challenge")).not.toBe(cliCodeChallenge);
    const oidcState = googleUrl.searchParams.get("state")!;
    const nonce = googleUrl.searchParams.get("nonce")!;

    // 2. Google redirects back to the BFF callback.
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "cli-user-1",
      aud: CLIENT_ID,
      nonce,
      email: "alice@example.com",
      email_verified: true,
      name: "Alice",
    };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(oidcState)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.status).toBe(302);
    // The browser is redirected to the CLI's loopback with the one-time code.
    const redirect = new URL(callback.headers.get("Location")!);
    expect(redirect.origin + redirect.pathname).toBe("http://127.0.0.1:9999/callback");
    const oneTimeCode = redirect.searchParams.get("code")!;
    expect(redirect.searchParams.get("state")).toBe("cli-state-1");

    // 3. The CLI exchanges the code (PKCE) for a session.
    const challenge = await s256Challenge("cli-verifier-1");
    const exchange = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/cli/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: oneTimeCode, codeVerifier: "cli-verifier-1" }),
    }));
    expect(exchange.status).toBe(200);
    const cookie = cookieFrom(exchange)!;
    const body = await exchange.json() as { csrfToken?: string; identity?: { subject?: string } };
    expect(body.csrfToken).toBeTruthy();
    expect(body.identity?.subject).toBe("cli-user-1");

    // 4. The issued session works for API reads.
    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(200);
  });

  test("CLI exchange rejects a wrong PKCE verifier", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const authorize = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/cli/authorize?client_id=unicas-cli&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&state=s&code_challenge=${await s256Challenge("real-verifier")}&code_challenge_method=S256`,
    ));
    const preLoginCookie = cookieFrom(authorize)!;
    const googleUrl = new URL(authorize.headers.get("Location")!);
    const nonce = googleUrl.searchParams.get("nonce")!;
    provider.pendingClaims = { iss: ISSUER, sub: "cli-user-1", aud: CLIENT_ID, nonce, email: "alice@example.com", email_verified: true };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(googleUrl.searchParams.get("state")!)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    const oneTimeCode = new URL(callback.headers.get("Location")!).searchParams.get("code")!;
    const exchange = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/cli/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: oneTimeCode, codeVerifier: "wrong-verifier" }),
    }));
    expect(exchange.status).toBe(401);
  });

  test("CLI login returns OIDC failures to the loopback callback immediately", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const authorize = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/cli/authorize?client_id=unicas-cli&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&state=cli-state-failure&code_challenge=${await s256Challenge("cli-verifier")}&code_challenge_method=S256`,
    ));
    const preLoginCookie = cookieFrom(authorize)!;
    const googleUrl = new URL(authorize.headers.get("Location")!);
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "cli-user-1",
      aud: CLIENT_ID,
      nonce: "wrong-nonce",
      email: "alice@example.com",
      email_verified: true,
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(googleUrl.searchParams.get("state")!)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    logged.mockRestore();

    expect(callback.status).toBe(302);
    const redirect = new URL(callback.headers.get("Location")!);
    expect(redirect.origin + redirect.pathname).toBe("http://127.0.0.1:9999/callback");
    expect(redirect.searchParams.get("error")).toBe("oidc_failed");
    expect(redirect.searchParams.get("error_description")).toContain("id_token_invalid");
    expect(redirect.searchParams.get("state")).toBe("cli-state-failure");
  });

  test("CLI exchange rejects an unknown one-time code", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const exchange = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/cli/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "unknown-code", codeVerifier: "whatever" }),
    }));
    expect(exchange.status).toBe(401);
  });

  test("CLI authorize rejects a non-loopback redirect or unknown client", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const badRedirect = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/cli/authorize?client_id=unicas-cli&redirect_uri=${encodeURIComponent("https://evil.example/callback")}&state=s&code_challenge=c&code_challenge_method=S256`,
    ));
    expect(badRedirect.status).toBe(400);
    const badClient = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/cli/authorize?client_id=other&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&state=s&code_challenge=c&code_challenge_method=S256`,
    ));
    expect(badClient.status).toBe(400);
  });

  test("optional issuer reads return empty configuration without suppressing access errors", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Stack");
    const optional = await authRequest(bff, `/admin/stacks/${stackId}/oauth-issuer?optional=true`, cookie);
    expect(optional.status).toBe(200);
    expect(await optional.json()).toBeNull();
    expect((await authRequest(bff, `/admin/stacks/${stackId}/oauth-issuer`, cookie)).status).toBe(404);
    expect((await authRequest(bff, `/admin/stacks/${stackId}/oauth-issuer?optional=invalid`, cookie)).status).toBe(400);
    expect((await authRequest(bff, "/admin/stacks/cas_other/oauth-issuer?optional=true", cookie)).status).toBe(403);
  });

  test("OAuth issuer inspection rejects administrator-supplied resource policy", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Stack");
    for (const obsolete of [
      { audience: "caller-selected" },
      { capabilityMaxLifetimeSeconds: 604800 },
    ]) {
      const response = await authRequest(
        bff,
        `/admin/stacks/${stackId}/oauth-issuer/inspections`,
        cookie,
        {
          method: "POST",
          headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
          body: JSON.stringify({ issuer: "https://issuer.example/oauth", ...obsolete }),
        },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "INVALID_REQUEST",
        message: "OAuth issuer inspection accepts only issuer",
      });
    }
  });

  test("full OIDC login flow reaches me() with the verified identity", async () => {
    const provider = await createMockProvider();
    provider.expectTokenBody = (body) => {
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("mock-code");
      expect(body.get("redirect_uri")).toBe(`${PUBLIC_ORIGIN}/admin/auth/callback`);
      expect(body.get("client_id")).toBe(CLIENT_ID);
      expect(body.get("client_secret")).toBe(CLIENT_SECRET);
      expect(body.get("code_verifier")).toBeTruthy();
    };
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);

    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(200);
    expect(me.headers.get("X-CSRF-Token")).toBe(csrf);
    const body = await me.json();
    expect(body.identity).toMatchObject({
      identityIssuer: ISSUER,
      subject: "google-user-123",
      displayName: "Alice",
      emailForDisplay: "alice@example.com",
    });
    expect(body.memberships).toEqual([]);
  });

  test("email allowlist accepts verified emails case-insensitively", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider, undefined, {
      emailAllowlist: ["ALICE@EXAMPLE.COM"],
    });
    const { cookie } = await signIn(bff, provider);

    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      identity: { emailForDisplay: "alice@example.com" },
    });
  });

  test("email allowlist rejects absent, unverified, or unlisted OIDC emails", async () => {
    for (const claims of [
      { email: null, email_verified: false },
      { email: "alice@example.com", email_verified: false },
      { email: "mallory@example.com", email_verified: true },
    ]) {
      const provider = await createMockProvider();
      const bff = await createBff(provider, undefined, {
        emailAllowlist: ["alice@example.com"],
      });
      const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc`));
      const cookie = cookieFrom(login)!;
      const location = new URL(login.headers.get("Location")!);
      const state = location.searchParams.get("state")!;
      provider.pendingClaims = {
        iss: ISSUER,
        sub: "google-user-123",
        aud: CLIENT_ID,
        nonce: location.searchParams.get("nonce")!,
        name: "Alice",
        ...claims,
      };

      const callback = await bff(new Request(
        `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: cookie } },
      ));
      expect(callback.status).toBe(302);
      expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=not-allowed");
      expect(callback.headers.get("Set-Cookie")).toBeNull();

      const errorPage = await bff(new Request(`${PUBLIC_ORIGIN}${callback.headers.get("Location")!}`));
      expect(errorPage.status).toBe(200);
      expect(errorPage.headers.get("Location")).toBeNull();
      const errorHtml = await errorPage.text();
      expect(errorHtml).toContain("No management access");
      expect(errorHtml).toContain("does not have management access to UniCAS");
      expect(errorHtml).toContain("Sign in with another Google account");
      expect(errorHtml).not.toContain("Continue with Google");
    }
  }, 10_000);

  test("email allowlist revokes a pre-existing session for an unlisted email", async () => {
    const provider = await createMockProvider();
    const sessionEncryptionKeys = { v1: randomKey() };
    const bff = await createBff(provider, undefined, {
      sessionEncryptionKeys,
      emailAllowlist: ["alice@example.com"],
    });
    const sessionStore = new MemorySessionRepository();
    const sessionId = "sess_preexisting_unlisted";
    const encryptedPayload = await new SessionCrypto(sessionEncryptionKeys).encrypt({
      v: 1,
      authenticated: true,
      identityIssuer: ISSUER,
      subject: "google-user-before-allowlist",
      displayName: "Mallory",
      emailForDisplay: "mallory@example.com",
      csrfToken: "old-csrf-token",
    });
    await sessionStore.create(sessionId, encryptedPayload, 8 * 60 * 60 * 1000);
    const cookie = `cas_admin_session=${sessionId}`;

    const shell = await authRequest(bff, "/admin/", cookie);
    expect(shell.status).toBe(302);
    expect(shell.headers.get("Location")).toContain("/admin/auth/login");
    await expect(sessionStore.read(sessionId)).resolves.toBeNull();

    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(401);
  });

  test("platform access denied: login is rejected and no session is created when principal has no grant or membership", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    // Do NOT grant the test user — repo is empty.
    const bff = await createBff(provider, undefined, {}, repo);

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc?returnTo=/admin/`));
    const preLoginCookie = cookieFrom(login)!;
    const location = new URL(login.headers.get("Location")!);
    const state = location.searchParams.get("state")!;
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "google-user-no-access",
      aud: CLIENT_ID,
      nonce: location.searchParams.get("nonce")!,
      email: "noaccess@example.com",
      email_verified: true,
      name: "No Access",
    };

    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=access-denied");
    // Session cookie must not be set on denied login.
    expect(callback.headers.get("Set-Cookie")).toBeNull();

    const deniedPage = await bff(new Request(`${PUBLIC_ORIGIN}${callback.headers.get("Location")!}`));
    const deniedHtml = await deniedPage.text();
    expect(deniedHtml).toContain("No management access");
    expect(deniedHtml).toContain("Sign in with another Google account");
    expect(deniedHtml).not.toContain("Continue with Google");
  }, 10_000);

  test("platform access granted: login succeeds when principal has an explicit grant", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    repo.grant(ISSUER, "google-user-with-grant");
    const bff = await createBff(provider, undefined, {}, repo);

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc?returnTo=/admin/`));
    const preLoginCookie = cookieFrom(login)!;
    const location = new URL(login.headers.get("Location")!);
    const state = location.searchParams.get("state")!;
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "google-user-with-grant",
      aud: CLIENT_ID,
      nonce: location.searchParams.get("nonce")!,
      email: "granted@example.com",
      email_verified: true,
      name: "Granted User",
    };

    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/");
    const cookie = cookieFrom(callback)!;

    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      identity: { subject: "google-user-with-grant" },
      platformAccess: {
        status: "active",
        authorities: ["apps.create"],
        revision: 1,
      },
    });
  }, 10_000);

  test("platform access blocked: authenticated request is denied and session is cleared for a blocked principal", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    repo.grant(ISSUER, "google-user-to-block");
    const bff = await createBff(provider, undefined, {}, repo);

    // Sign in while still active.
    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc?returnTo=/admin/`));
    const preLoginCookie = cookieFrom(login)!;
    const location = new URL(login.headers.get("Location")!);
    const state = location.searchParams.get("state")!;
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "google-user-to-block",
      aud: CLIENT_ID,
      nonce: location.searchParams.get("nonce")!,
      email: "blocked@example.com",
      email_verified: true,
      name: "To Block",
    };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.status).toBe(302);
    const cookie = cookieFrom(callback)!;

    // Verify the session is initially valid.
    const meBefore = await authRequest(bff, "/admin/me", cookie);
    expect(meBefore.status).toBe(200);

    // Now block the principal.
    repo.block(ISSUER, "google-user-to-block");

    // Subsequent authenticated request must be rejected and session cleared.
    const meAfter = await authRequest(bff, "/admin/me", cookie);
    expect(meAfter.status).toBe(401);
    expect(await meAfter.json()).toMatchObject({ error: "ADMIN_AUTH_REQUIRED" });
  }, 10_000);

  test("platform access revoked: authenticated request is denied after the last authority is removed", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    repo.grant(ISSUER, "google-user-123");
    const bff = await createBff(provider, undefined, {}, repo);
    const { cookie } = await signIn(bff, provider);

    repo.revokeAuthorities(ISSUER, "google-user-123");

    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: "ADMIN_AUTH_REQUIRED" });
  }, 10_000);

  test("App membership revoked: membership-only authenticated session is denied", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    repo.grantViaMembership(ISSUER, "google-user-123");
    const bff = await createBff(provider, undefined, {}, repo);
    const { cookie } = await signIn(bff, provider);

    repo.revokeMembership(ISSUER, "google-user-123");

    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: "ADMIN_AUTH_REQUIRED" });
  }, 10_000);

  test("App membership does not grant App creation authority", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    repo.grantViaMembership(ISSUER, "google-user-123");
    const bff = await createBff(provider, undefined, {}, repo);
    const { cookie, csrf } = await signIn(bff, provider);

    const response = await authRequest(bff, "/admin/stacks", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ displayName: "Denied App" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "APP_CREATION_AUTHORITY_REQUIRED" });
    expect(fakeStacks.size).toBe(0);
  }, 10_000);

  test("current App membership permits later login outside the legacy email allowlist", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    repo.grantViaMembership(ISSUER, "google-user-123");
    const bff = await createBff(provider, undefined, { emailAllowlist: ["allowed@example.com"] }, repo);

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc`));
    const cookie = cookieFrom(login)!;
    const location = new URL(login.headers.get("Location")!);
    const state = location.searchParams.get("state")!;
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "google-user-123",
      aud: CLIENT_ID,
      nonce: location.searchParams.get("nonce")!,
      email: "notallowed@example.com",
      email_verified: true,
      name: "External Member",
    };

    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: cookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/");
    const sessionCookie = cookieFrom(callback)!;
    const me = await authRequest(bff, "/admin/me", sessionCookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ identity: { subject: "google-user-123" } });
  }, 10_000);

  test("configured test account bypasses OIDC and creates a normal admin session", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider, undefined, {
      testAccount: { email: "tester@example.com", password: "test-password" },
      emailAllowlist: ["tester@example.com"],
    });
    const loginUrl = `${PUBLIC_ORIGIN}/admin/auth/login?test-account=1&returnTo=/admin/`;

    const challenge = await bff(new Request(loginUrl));
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("WWW-Authenticate")).toContain("Basic");

    const rejected = await bff(new Request(loginUrl, {
      headers: { Authorization: `Basic ${btoa("tester@example.com:wrong")}` },
    }));
    expect(rejected.status).toBe(401);

    const login = await bff(new Request(loginUrl, {
      headers: { Authorization: `Basic ${btoa("TESTER@example.com:test-password")}` },
    }));
    expect(login.status).toBe(302);
    expect(login.headers.get("Location")).toBe("/admin/");
    const cookie = cookieFrom(login)!;

    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      identity: {
        identityIssuer: "urn:unicas:manage:test-account",
        subject: "tester@example.com",
        emailForDisplay: "tester@example.com",
      },
    });
  });

  test("callback with a mismatched state is rejected", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc`));
    const cookie = cookieFrom(login)!;
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=code&state=wrong-state`,
      { headers: { Cookie: cookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=oidc-failed");
  });

  test("id_token with a wrong nonce is rejected", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc`));
    const cookie = cookieFrom(login)!;
    const location = new URL(login.headers.get("Location")!);
    const state = location.searchParams.get("state")!;
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "google-user-123",
      aud: CLIENT_ID,
      nonce: "wrong-nonce",
      email: null,
      name: null,
    };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: cookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=oidc-failed");
  });

  test("API routes require a session", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const me = await bff(new Request(`${PUBLIC_ORIGIN}/admin/me`));
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: "ADMIN_AUTH_REQUIRED" });
  });

  test("mutations require Origin + CSRF token", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);

    const noCsrf = await authRequest(bff, "/admin/stacks", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Stack" }),
    });
    expect(noCsrf.status).toBe(403);

    const noOrigin = await bff(new Request(`${PUBLIC_ORIGIN}/admin/stacks`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Stack" }),
    }));
    expect(noOrigin.status).toBe(403);

    const ok = await authRequest(bff, "/admin/stacks", cookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Stack" }),
    });
    expect(ok.status).toBe(200);
    const created = await ok.json();
    expect(created.displayName).toBe("Stack");
    expect(created.description).toBe("");
    expect(created.stackId).toMatch(/^cas_/);
    expect(ok.headers.get("ETag")).toBe('"1"');
  });

  test("App issuer mutations preserve minimal receipts and both conditional activation modes", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const appId = await createStack(bff, cookie, csrf, "App");
    const path = `/admin/apps/${appId}/oauth-issuer`;
    const headers = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
    const inspection = await authRequest(bff, `${path}/inspections`, cookie, { method: "POST", headers, body: JSON.stringify({ issuer: "https://candidate.example" }) });
    expect(inspection.status).toBe(201);
    expect(inspection.headers.has("ETag")).toBe(false);
    expect(await inspection.json()).toEqual({ inspectionId: "candidate", metadataUrl: "https://candidate.example/metadata", jwksUri: "https://candidate.example/jwks", challenge: "synthetic", expiresAt: 4102444800000, keys: [{ kid: "key", algorithm: "ES256" }] });
    const body = JSON.stringify({ inspectionId: "candidate", activationProof: "synthetic-proof" });
    const initial = await authRequest(bff, path, cookie, { method: "PUT", headers: { ...headers, "If-None-Match": "*" }, body });
    expect(initial.status).toBe(204);
    expect(initial.headers.get("ETag")).toBe('"1"');
    expect(await initial.text()).toBe("");
    const replacement = await authRequest(bff, path, cookie, { method: "PUT", headers: { ...headers, "If-Match": '"9"' }, body });
    expect(replacement.status).toBe(204);
    expect(replacement.headers.get("ETag")).toBe('"10"');
  });

  test("App invitation list and revoke use strict filters, CSRF, and invitation ETags", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const appId = await createStack(bff, cookie, csrf, "App");
    const path = `/admin/apps/${appId}/member-invitations`;
    const list = await authRequest(bff, `${path}?status=pending&limit=50`, cookie);
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ items: [{ invitationId: "inv-test", revision: 7 }], nextCursor: null });
    expect((await authRequest(bff, `${path}?status=unknown`, cookie)).status).toBe(400);
    expect((await authRequest(bff, `${path}/inv-test`, cookie, { method: "DELETE", headers: { "If-Match": '"7"' } })).status).toBe(403);
    const revoked = await authRequest(bff, `${path}/inv-test`, cookie, { method: "DELETE", headers: { "If-Match": '"7"', "X-CSRF-Token": csrf } });
    expect(revoked.status).toBe(204);
    expect(revoked.headers.get("ETag")).toBe('"8"');
    expect(await revoked.text()).toBe("");
  });

  test("App status mutations enforce CSRF, strict input, and minimal responses", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const appId = await createStack(bff, cookie, csrf, "App");
    const headers = { "X-CSRF-Token": csrf, "Content-Type": "application/json", "If-Match": '"1"' };
    const noCsrf = await authRequest(bff, `/admin/apps/${appId}`, cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": '"1"' },
      body: JSON.stringify({ status: "suspended" }),
    });
    expect(noCsrf.status).toBe(403);
    for (const body of [{}, { status: "inactive" }, { status: null }, { unknown: true }, { status: "active", unknown: true }]) {
      const invalid = await authRequest(bff, `/admin/apps/${appId}`, cookie, {
        method: "PATCH", headers, body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
    const denied = await authRequest(bff, "/admin/apps/not-a-member", cookie, {
      method: "PATCH", headers, body: JSON.stringify({ status: "suspended" }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "APP_MEMBERSHIP_REQUIRED" });
    const response = await authRequest(bff, `/admin/apps/${appId}`, cookie, {
      method: "PATCH", headers, body: JSON.stringify({ status: "suspended" }),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("ETag")).toBe('"2"');
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-transform");
    expect(await response.text()).toBe("");
    expect(fakeStacks.get(appId)?.status).toBe("suspended");
  });

  test("stack lifecycle through the BFF with ETags", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);

    const create = await authRequest(bff, "/admin/stacks", cookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "My Stack" }),
    });
    const stack = await create.json();
    const stackId = stack.stackId;

    const get = await authRequest(bff, `/admin/stacks/${stackId}`, cookie);
    expect(get.status).toBe(200);
    expect(get.headers.get("ETag")).toBe('"1"');

    // Stale If-Match → 412.
    const stale = await authRequest(bff, `/admin/stacks/${stackId}`, cookie, {
      method: "PATCH",
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        "If-Match": '"99"',
      },
      body: JSON.stringify({ displayName: "Renamed" }),
    });
    expect(stale.status).toBe(412);

    const patch = await authRequest(bff, `/admin/stacks/${stackId}`, cookie, {
      method: "PATCH",
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        "If-Match": '"1"',
      },
      body: JSON.stringify({ displayName: "Renamed" }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).displayName).toBe("Renamed");

    const describe = await authRequest(bff, `/admin/stacks/${stackId}`, cookie, {
      method: "PATCH",
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        "If-Match": '"2"',
      },
      body: JSON.stringify({ description: "Production documents" }),
    });
    expect(describe.status).toBe(200);
    expect(await describe.json()).toMatchObject({
      displayName: "Renamed",
      description: "Production documents",
      revision: 3,
    });

    const list = await authRequest(bff, "/admin/stacks", cookie);
    const listed = await list.json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].displayName).toBe("Renamed");
    expect(listed.items[0].description).toBe("Production documents");
  });

  test("managed capability mint requires CSRF and is never cacheable", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Managed");

    const rejected = await authRequest(bff, `/admin/stacks/${stackId}/managed-capabilities`, cookie, {
      method: "POST",
    });
    expect(rejected.status).toBe(403);

    const minted = await authRequest(bff, `/admin/stacks/${stackId}/managed-capabilities`, cookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
    });
    expect(minted.status).toBe(200);
    expect(minted.headers.get("Cache-Control")).toBe("no-store");
    expect(await minted.json()).toMatchObject({
      accessToken: "short-lived-token",
      tenantId: "member_test",
      expiresIn: 120,
    });
  });

  test("managed Space capability mint uses the v2 operation and response", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const appId = await createStack(bff, cookie, csrf, "Managed App");

    const rejected = await authRequest(bff, `/admin/apps/${appId}/managed-capabilities`, cookie, {
      method: "POST",
    });
    expect(rejected.status).toBe(403);

    const minted = await authRequest(bff, `/admin/apps/${appId}/managed-capabilities`, cookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
    });
    expect(minted.status).toBe(201);
    expect(minted.headers.get("Cache-Control")).toBe("no-store");
    expect(await minted.json()).toMatchObject({
      accessToken: "short-lived-space-token",
      spaceId: "member_test",
      permissions: ["spaces:member_test:cas:manage"],
    });
  });

  test("Playground file-root catalog uses CSRF and resource ETags", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Files");
    const path = `/admin/stacks/${stackId}/playground/file-roots`;
    const manifestHash = "a".repeat(64);

    const created = await authRequest(bff, path, cookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
      body: JSON.stringify({ rootId: "root-1", name: "Project", manifestHash }),
    });
    expect(created.status).toBe(200);
    expect(created.headers.get("ETag")).toBe('"1"');

    const list = await authRequest(bff, path, cookie);
    expect(await list.json()).toMatchObject({ items: [{ rootId: "root-1", name: "Project" }] });

    const patched = await authRequest(bff, `${path}/root-1`, cookie, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json", "If-Match": '"1"' },
      body: JSON.stringify({ name: "Renamed", manifestHash }),
    });
    expect(patched.status).toBe(200);
    expect(patched.headers.get("ETag")).toBe('"2"');

    const deleted = await authRequest(bff, `${path}/root-1`, cookie, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrf, "If-Match": '"2"' },
    });
    expect(deleted.status).toBe(200);
  });

  test("email-bound App invitation grants only exact acceptance, then rotates to a full membership session", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const token = "i".repeat(32);
    await repo.addInvitation(token, "outside@example.com");
    const baseControlPlane = fakeControlPlane();
    const controlPlane: ControlPlaneOperations = {
      ...baseControlPlane,
      acceptMemberInvitation: async (ctx, request) => {
        expect(request.path.token).toBe(token);
        repo.grantViaMembership(ctx.identity.identityIssuer, ctx.identity.subject);
        return {
          stackId: "app-invited",
          ...ctx.identity,
          displayName: ctx.profile?.displayName ?? null,
          emailForDisplay: ctx.profile?.emailForDisplay ?? null,
        };
      },
    };
    const bff = await createBff(
      provider,
      undefined,
      { emailAllowlist: ["internal@example.com"] },
      repo,
      controlPlane,
    );

    const page = await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/${token}`));
    expect(page.status).toBe(302);
    const authorization = new URL(page.headers.get("Location")!);
    expect(authorization.origin).toBe(ISSUER);
    expect(authorization.href).not.toContain(token);
    const preLoginCookie = cookieFrom(page)!;
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "outside-user",
      aud: CLIENT_ID,
      nonce: authorization.searchParams.get("nonce")!,
      email: "outside@example.com",
      email_verified: true,
      name: "Outside User",
    };

    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe(`/admin/#/invitations/${token}`);
    const limitedCookie = cookieFrom(callback)!;

    const shell = await authRequest(bff, "/admin/", limitedCookie);
    expect(shell.status).toBe(200);
    const csrf = /<meta name="x-csrf-token" content="([^"]+)"/.exec(await shell.text())![1]!;
    const generalApi = await authRequest(bff, "/admin/me", limitedCookie);
    expect(generalApi.status).toBe(403);
    expect(await generalApi.json()).toMatchObject({ error: "INVITATION_SESSION_REQUIRED" });

    const wrongToken = await authRequest(bff, `/admin/member-invitations/${"w".repeat(32)}/accept`, limitedCookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
    });
    expect(wrongToken.status).toBe(403);
    expect(await wrongToken.json()).toMatchObject({ error: "INVITATION_SESSION_REQUIRED" });

    const accepted = await authRequest(bff, `/admin/member-invitations/${token}/accept`, limitedCookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ stackId: "app-invited" });
    const fullCookie = cookieFrom(accepted)!;
    expect(fullCookie).not.toBe(limitedCookie);

    const staleSession = await authRequest(bff, "/admin/me", limitedCookie);
    expect(staleSession.status).toBe(401);
    const admitted = await authRequest(bff, "/admin/me", fullCookie);
    expect(admitted.status).toBe(200);
  }, 10_000);

  test("invitation login fails closed for invalid, unconstrained, and mismatched-email invitations", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const constrainedToken = "c".repeat(32);
    const unconstrainedToken = "u".repeat(32);
    await repo.addInvitation(constrainedToken, "expected@example.com");
    await repo.addInvitation(unconstrainedToken, null);
    const bff = await createBff(provider, undefined, {}, repo);

    const invalid = await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/short`));
    expect(invalid.status).toBe(404);

    for (const [token, email] of [
      [constrainedToken, "other@example.com"],
      [unconstrainedToken, "expected@example.com"],
    ] as const) {
      const page = await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/${token}`));
      const authorization = new URL(page.headers.get("Location")!);
      const preLoginCookie = cookieFrom(page)!;
      provider.pendingClaims = {
        iss: ISSUER,
        sub: `user-${token[0]}`,
        aud: CLIENT_ID,
        nonce: authorization.searchParams.get("nonce")!,
        email,
        email_verified: true,
        name: "Invitee",
      };
      const callback = await bff(new Request(
        `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
        { headers: { Cookie: preLoginCookie } },
      ));
      expect(callback.status).toBe(302);
      expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=access-denied");
      expect(callback.headers.get("Set-Cookie")).toBeNull();
    }
  }, 10_000);

  test("root-ref audit routes are not available yet without the reader binding", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Stack");
    const audit = await authRequest(
      bff,
      `/admin/stacks/${stackId}/root-ref-domains/doc/refs`,
      cookie,
    );
    expect(audit.status).toBe(503);
    expect(await audit.json()).toMatchObject({ error: "SERVICE_UNAVAILABLE" });
  });

  test("root-ref audit reads forward to the private reader RPC after membership", async () => {
    const provider = await createMockProvider();
    let rpcCalls: { url: URL; key: string }[] = [];
    const auditReader = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        rpcCalls.push({
          url: new URL(String(input)),
          key: new Headers(init?.headers).get("X-CAS-Audit-Reader-Key") ?? "",
        });
        return Response.json({ revision: 1, refs: [{ tenantId: "t", hash: "a".repeat(64), count: 3 }], nextCursor: null });
      },
    };
    const bff = await createBff(provider, auditReader);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Stack");

    const refs = await authRequest(
      bff,
      `/admin/stacks/${stackId}/root-ref-domains/doc/refs?tenantId=tenant-1&limit=50`,
      cookie,
    );
    expect(refs.status).toBe(200);
    expect(await refs.json()).toMatchObject({ revision: 1, refs: [{ tenantId: "t", count: 3 }] });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.url.pathname).toBe("/_internal/audit/refs");
    expect(rpcCalls[0]!.url.searchParams.get("stackId")).toBe(stackId);
    expect(rpcCalls[0]!.url.searchParams.get("refDomain")).toBe("doc");
    expect(rpcCalls[0]!.url.searchParams.get("tenantId")).toBe("tenant-1");
    expect(rpcCalls[0]!.url.searchParams.get("limit")).toBe("50");
    expect(rpcCalls[0]!.key).toBe("audit-reader-secret");

    const events = await authRequest(
      bff,
      `/admin/stacks/${stackId}/root-ref-domains/doc/events?after=7`,
      cookie,
    );
    expect(events.status).toBe(200);
    expect(rpcCalls[1]!.url.pathname).toBe("/_internal/audit/events");
    expect(rpcCalls[1]!.url.searchParams.get("after")).toBe("7");
  });

  test("refDomain listing reads the observed audit catalog", async () => {
    const provider = await createMockProvider();
    const rpcCalls: URL[] = [];
    const auditReader = {
      fetch: async (input: RequestInfo | URL) => {
        rpcCalls.push(new URL(String(input)));
        return Response.json({
          domains: [{ stackId: "cas_stack", refDomain: "doc", revision: 3 }],
        });
      },
    };
    const bff = await createBff(provider, auditReader);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Stack");

    const response = await authRequest(bff, `/admin/stacks/${stackId}/ref-domains`, cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      domains: [{ refDomain: "doc", revision: 3 }],
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.pathname).toBe("/_internal/audit/domains");
    expect(rpcCalls[0]!.searchParams.get("stackId")).toBe(stackId);
    expect(rpcCalls[0]!.searchParams.has("refDomain")).toBe(false);
  });

  test("audit reads require stack membership before touching the reader", async () => {
    const provider = await createMockProvider();
    let readerCalls = 0;
    const auditReader = {
      fetch: async () => {
        readerCalls += 1;
        return Response.json({ revision: 0, refs: [], nextCursor: null });
      },
    };
    const bff = await createBff(provider, auditReader);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Stack");
    // A different operator who is not a member cannot read audit.
    const provider2 = await createMockProvider();
    const bff2 = await createBff(provider2, auditReader);
    const { cookie: otherCookie } = await signInAs(bff2, provider2, "other-sub");
    const denied = await authRequest(
      bff2,
      `/admin/stacks/${stackId}/root-ref-domains/doc/refs`,
      otherCookie,
    );
    expect(denied.status).toBe(403);
    expect(readerCalls).toBe(0);
  });

  test("malformed refDomains are rejected before the reader; reserved domains are readable", async () => {
    const provider = await createMockProvider();
    const rpcPaths: string[] = [];
    const auditReader = {
      fetch: async (input: RequestInfo | URL) => {
        rpcPaths.push(new URL(String(input)).pathname);
        return Response.json({ revision: 0, refs: [], nextCursor: null });
      },
    };
    const bff = await createBff(provider, auditReader);
    const { cookie, csrf } = await signIn(bff, provider);
    const stackId = await createStack(bff, cookie, csrf, "Stack");

    const malformed = await authRequest(
      bff,
      `/admin/stacks/${stackId}/root-ref-domains/Bad%20Domain/refs`,
      cookie,
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "INVALID_REQUEST" });

    const legacy = await authRequest(
      bff,
      `/admin/stacks/${stackId}/root-ref-domains/_legacy/refs`,
      cookie,
    );
    expect(legacy.status).toBe(200);
    expect(rpcPaths).toEqual(["/_internal/audit/refs"]);
  });

  test("logout clears the session", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const { cookie } = await signIn(bff, provider);
    const logout = await authRequest(bff, "/admin/auth/logout", cookie, { method: "POST" });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    const me = await authRequest(bff, "/admin/me", cookie);
    expect(me.status).toBe(401);
  }, 10_000);

  test("tenant JWT bearer tokens are not accepted on admin routes", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const me = await bff(new Request(`${PUBLIC_ORIGIN}/admin/me`, {
      headers: { Authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.eyJ0ZW5hbnRJZCI6InQifQ.signature" },
    }));
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: "ADMIN_AUTH_REQUIRED" });
  });

  // ------------------------------------------------------------------
  // Platform Admin API tests
  // ------------------------------------------------------------------

  async function signInWithAdmin(
    provider: MockProvider,
    repo: MemoryPlatformAccessRepository,
    subject = "platform-admin-user",
    peopleRepository?: PeopleRepository,
    controlPlane?: ControlPlaneOperations,
  ): Promise<{ bff: (req: Request) => Promise<Response>; cookie: string; csrf: string }> {
    repo.grantAdmin(ISSUER, subject);
    const bff = await createBff(
      provider,
      undefined,
      {},
      repo,
      controlPlane,
      repo,
      repo,
      peopleRepository,
      memoryAccountRepository(repo, subject),
    );

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc?returnTo=/admin/`));
    const preLoginCookie = cookieFrom(login)!;
    const location = new URL(login.headers.get("Location")!);
    const state = location.searchParams.get("state")!;
    const nonce = location.searchParams.get("nonce")!;
    provider.pendingClaims = {
      iss: ISSUER,
      sub: subject,
      aud: CLIENT_ID,
      nonce,
      email: `${subject}@example.com`,
      email_verified: true,
      name: subject,
    };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    const cookie = cookieFrom(callback)!;
    const shell = await authRequest(bff, "/admin/", cookie);
    const html = await shell.text();
    const match = /<meta name="x-csrf-token" content="([^"]+)"/.exec(html);
    return { bff, cookie, csrf: match![1]! };
  }

  test("unified people reads recheck separate App membership and Platform Admin authority", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const people: PeopleRepository = { readSnapshot: async () => 1, nextExpiry: async () => null, list: vi.fn(async () => []) };
    const control = fakeControlPlane();
    control.listAppMemberInvitations = vi.fn(async () => ({ error: "STACK_MEMBERSHIP_REQUIRED" as const }));
    const { bff, cookie } = await signInWithAdmin(provider, repo, "people-admin", people, control);
    expect((await bff(new Request(`${PUBLIC_ORIGIN}/admin/platform/people`))).status).toBe(401);
    const platform = await authRequest(bff, "/admin/platform/people", cookie);
    expect(platform.status).toBe(200);
    expect(await platform.json()).toEqual({ items: [], nextCursor: null });
    const appDenied = await authRequest(bff, "/admin/apps/cas_one/people", cookie);
    expect(appDenied.status).toBe(403);
    expect(await appDenied.json()).toEqual({ error: "APP_MEMBERSHIP_REQUIRED" });
    control.listAppMemberInvitations = vi.fn(async () => ({ items: [], nextCursor: null }));
    expect((await authRequest(bff, "/admin/apps/cas_one/people", cookie)).status).toBe(200);
    expect((await authRequest(bff, "/admin/apps/cas_one/people?authority=platform.admin", cookie)).status).toBe(400);
    repo.grant(ISSUER, "people-admin");
    expect((await authRequest(bff, "/admin/platform/people", cookie)).status).toBe(403);
    expect((await authRequest(bff, "/admin/apps/cas_one/people", cookie)).status).toBe(200);
  }, 10000);

  test("platform admin: access summary returns correct counts", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie } = await signInWithAdmin(provider, repo, "admin-user");

    // Add a few extra principals.
    repo.grantAdmin(ISSUER, "admin-two");
    repo.grant(ISSUER, "creator-only");
    repo.grant(ISSUER, "to-block");
    repo.block(ISSUER, "to-block");

    const response = await authRequest(bff, "/admin/platform/access-summary", cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.activePrincipalCount).toBe(3); // admin-user, admin-two, creator-only
    expect(body.platformAdminCount).toBe(2);   // admin-user, admin-two
    expect(body.appCreatorCount).toBe(3);       // active principals with apps.create
    expect(body.blockedPrincipalCount).toBe(1);
    expect(typeof body.generatedAt).toBe("number");
  }, 10_000);

  test("platform admin: list principals returns paginated results", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie } = await signInWithAdmin(provider, repo, "admin-user");

    // Add another principal.
    repo.grant(ISSUER, "another-user");

    const response = await authRequest(bff, "/admin/platform/principals?limit=10", cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { items: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.nextCursor).toBeNull();
  }, 10_000);

  test("platform admin: Principal filters and opaque cursors are server-bound", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie } = await signInWithAdmin(provider, repo, "admin-user");
    repo.grant(ISSUER, "creator-one");
    repo.grant(ISSUER, "creator-two");

    const filtered = await authRequest(bff, "/admin/platform/principals?query=creator-one&authority=apps.create", cookie);
    expect(filtered.status).toBe(200);
    expect(await filtered.json()).toMatchObject({ items: [{ principal: { subject: "creator-one" } }] });

    const first = await authRequest(bff, "/admin/platform/principals?authority=apps.create&limit=1", cookie);
    const firstPage = await first.json() as { nextCursor: string | null };
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toContain(ISSUER);
    const next = await authRequest(bff, `/admin/platform/principals?authority=apps.create&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`, cookie);
    expect(next.status).toBe(200);
    const mismatched = await authRequest(bff, `/admin/platform/principals?authority=none&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`, cookie);
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toMatchObject({ error: "INVALID_CURSOR" });
  }, 10_000);

  test("platform admin: get principal returns detail", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie } = await signInWithAdmin(provider, repo, "admin-user");

    const principalRef = `${ISSUER}\0admin-user`;
    const response = await authRequest(bff, `/admin/platform/principals/${encodeURIComponent(principalRef)}`, cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.principalRef).toBe(principalRef);
    expect(body.status).toBe("active");
    expect(Array.isArray(body.authorities)).toBe(true);

    const access = await authRequest(bff, `/admin/platform/principals/${encodeURIComponent(principalRef)}/access`, cookie);
    expect(access.status).toBe(200);
    expect(access.headers.get("ETag")).toBe('"1"');
    expect(await access.json()).toMatchObject({ principalRef, authorities: ["platform.admin", "apps.create"] });
  }, 10_000);

  test("platform admin: get principal returns 404 for unknown ref", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie } = await signInWithAdmin(provider, repo, "admin-user");

    const response = await authRequest(bff, `/admin/platform/principals/unknown-ref`, cookie);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "NOT_FOUND" });
  }, 10_000);

  test("platform admin: patch principal access delegates to PlatformAccessService", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie, csrf } = await signInWithAdmin(provider, repo, "admin-user");

    // Add target principal.
    repo.grant(ISSUER, "target-user");
    const principalRef = `${ISSUER}\0target-user`;

    const response = await authRequest(bff, `/admin/platform/principals/${encodeURIComponent(principalRef)}/access`, cookie, {
      method: "PATCH",
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        "If-Match": '"1"',
      },
      body: JSON.stringify({ status: "blocked" }),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("ETag")).toBe('"2"');
  }, 10_000);

  test("platform admin: patch without If-Match returns 428", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie, csrf } = await signInWithAdmin(provider, repo, "admin-user");

    repo.grant(ISSUER, "target-user");
    const principalRef = `${ISSUER}\0target-user`;

    const response = await authRequest(bff, `/admin/platform/principals/${encodeURIComponent(principalRef)}/access`, cookie, {
      method: "PATCH",
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ authorities: ["apps.create"] }),
    });
    expect(response.status).toBe(428);
    expect(await response.json()).toMatchObject({ error: "PRECONDITION_REQUIRED" });
  }, 10_000);

  test("platform admin: creates, lists, and conditionally revokes platform invitations", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie, csrf } = await signInWithAdmin(provider, repo, "admin-user");
    const path = "/admin/platform/invitations";

    const missingIdempotency = await authRequest(bff, path, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ emailConstraint: "developer@example.com", authorities: ["apps.create"] }),
    });
    expect(missingIdempotency.status).toBe(400);

    const created = await authRequest(bff, path, cookie, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        "Idempotency-Key": "platform-invitation-1",
        "X-Request-Id": "request-create",
      },
      body: JSON.stringify({ emailConstraint: " Developer@Example.com ", authorities: ["apps.create"] }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("ETag")).toBe('"1"');
    const receipt = await created.json() as { invitationId: string; acceptUrl: string; expiresAt: number };
    expect(receipt.acceptUrl).toMatch(/^https:\/\/cas\.example\/admin\/platform-invitations\/[A-Za-z0-9_-]{32}$/);
    expect(receipt).not.toHaveProperty("emailConstraint");
    expect(receipt).not.toHaveProperty("authorities");

    const list = await authRequest(bff, `${path}?status=pending&limit=10`, cookie);
    expect(list.status).toBe(200);
    const page = await list.json() as { items: Array<Record<string, unknown>> };
    expect(page.items).toEqual([expect.objectContaining({
      invitationId: receipt.invitationId,
      emailConstraint: "developer@example.com",
      authorities: ["apps.create"],
      status: "pending",
    })]);
    expect(JSON.stringify(page)).not.toMatch(/acceptUrl|tokenHash|sealedToken/);

    const missingIfMatch = await authRequest(bff, `${path}/${receipt.invitationId}`, cookie, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrf },
    });
    expect(missingIfMatch.status).toBe(428);

    const revoked = await authRequest(bff, `${path}/${receipt.invitationId}`, cookie, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrf, "If-Match": '"1"' },
    });
    expect(revoked.status).toBe(204);
    expect(revoked.headers.get("ETag")).toBe('"2"');

    const replay = await authRequest(bff, path, cookie, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        "Idempotency-Key": "platform-invitation-1",
      },
      body: JSON.stringify({ emailConstraint: "developer@example.com", authorities: ["apps.create"] }),
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: "INVITATION_NOT_PENDING" });
  }, 10_000);

  test("platform invitation: matching OIDC session accepts and rotates into invited authority", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie: adminCookie, csrf: adminCsrf } = await signInWithAdmin(provider, repo, "admin-user");
    const created = await authRequest(bff, "/admin/platform/invitations", adminCookie, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": adminCsrf,
        "Idempotency-Key": "platform-invitation-login",
      },
      body: JSON.stringify({ emailConstraint: "external@example.com", authorities: ["apps.create"] }),
    });
    const receipt = await created.json() as { invitationId: string; acceptUrl: string };
    const entry = new URL(receipt.acceptUrl);
    const token = entry.pathname.split("/").pop()!;

    const start = await bff(new Request(entry));
    expect(start.status).toBe(302);
    const authorization = new URL(start.headers.get("Location")!);
    expect(authorization.origin).toBe(ISSUER);
    expect(authorization.href).not.toContain(token);
    provider.pendingClaims = {
      iss: ISSUER,
      sub: "external-user",
      aud: CLIENT_ID,
      nonce: authorization.searchParams.get("nonce")!,
      email: "external@example.com",
      email_verified: true,
      name: "External User",
    };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
      { headers: { Cookie: cookieFrom(start)! } },
    ));
    expect(callback.headers.get("Location")).toBe(`/admin/#/platform-invitations/${token}`);
    const limitedCookie = cookieFrom(callback)!;
    const shell = await authRequest(bff, "/admin/", limitedCookie);
    const csrf = /<meta name="x-csrf-token" content="([^"]+)"/.exec(await shell.text())![1]!;
    expect((await authRequest(bff, "/admin/me", limitedCookie)).status).toBe(403);

    const wrongKind = await authRequest(bff, `/admin/member-invitations/${token}/accept`, limitedCookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
    });
    expect(wrongKind.status).toBe(403);
    expect(await wrongKind.json()).toMatchObject({ error: "INVITATION_SESSION_REQUIRED" });

    const accepted = await authRequest(bff, `/admin/platform-invitations/${token}/accept`, limitedCookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "X-Request-Id": "request-accept" },
    });
    expect(accepted.status).toBe(204);
    const fullCookie = cookieFrom(accepted)!;
    expect(fullCookie).not.toBe(limitedCookie);
    expect((await authRequest(bff, "/admin/me", limitedCookie)).status).toBe(401);
    const me = await authRequest(bff, "/admin/me", fullCookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      identity: { subject: "external-user" },
      platformAccess: { status: "active", authorities: ["apps.create"] },
    });
    await expect(repo.getInvitation(receipt.invitationId, Date.now())).resolves.toMatchObject({ status: "accepted" });
  }, 10_000);

  test("platform admin: lists filtered durable platform audit events", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie, csrf } = await signInWithAdmin(provider, repo, "admin-user");
    await authRequest(bff, "/admin/platform/invitations", cookie, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        "Idempotency-Key": "audit-invitation",
        "X-Request-Id": "request-audit",
      },
      body: JSON.stringify({ emailConstraint: "audit@example.com", authorities: ["apps.create"] }),
    });

    const response = await authRequest(
      bff,
      "/admin/platform/audit-events?action=platform_invitation.created&limit=10",
      cookie,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [{
        action: "platform_invitation.created",
        actorAccount: { accountId: testAccountId("admin-user") },
        authenticatedIdentity: { issuer: ISSUER, subject: "admin-user" },
        targetInvitationId: expect.any(String),
        requestId: "request-audit",
        details: {},
      }],
      nextCursor: null,
    });
  }, 10_000);

  test("platform admin: non-platform-admin gets 403 on platform routes", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    // Grant apps.create only, NOT platform.admin.
    repo.grant(ISSUER, "non-admin-user");
    const bff = await createBff(
      provider,
      undefined,
      {},
      repo,
      undefined,
      repo,
      repo,
      undefined,
      memoryAccountRepository(repo, "non-admin-user"),
    );

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/oidc?returnTo=/admin/`));
    const preLoginCookie = cookieFrom(login)!;
    const location = new URL(login.headers.get("Location")!);
    const state = location.searchParams.get("state")!;
    provider.pendingClaims = {
      iss: ISSUER, sub: "non-admin-user", aud: CLIENT_ID,
      nonce: location.searchParams.get("nonce")!, email: "nonadmin@example.com",
      email_verified: true, name: "Non Admin",
    };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    const cookie = cookieFrom(callback)!;

    for (const path of [
      "/admin/platform/access-summary",
      "/admin/platform/principals",
      "/admin/platform/invitations",
      "/admin/platform/audit-events",
      `/admin/platform/principals/${encodeURIComponent(`${ISSUER}\0non-admin-user`)}`,
    ]) {
      const response = await authRequest(bff, path, cookie);
      expect(response.status).toBe(403);
      const body = await response.json() as Record<string, unknown>;
      expect(body.error).toBe("PLATFORM_ADMIN_REQUIRED");
    }
  }, 10_000);
});

async function createStack(
  bff: (request: Request) => Promise<Response>,
  cookie: string,
  csrf: string,
  displayName: string,
): Promise<string> {
  const create = await authRequest(bff, "/admin/stacks", cookie, {
    method: "POST",
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const body = await create.json();
  if (create.status !== 200) throw new Error(`createStack failed: ${JSON.stringify(body)}`);
  return body.stackId;
}
