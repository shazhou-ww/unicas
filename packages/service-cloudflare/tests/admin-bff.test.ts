import { afterEach, describe, expect, test, vi } from "vitest";
import { CompactSign, exportJWK, generateKeyPair, SignJWT } from "jose";
import { s256Challenge } from "@unicas/control-auth";
import type {
  PlatformAuthority,
  Principal,
} from "@unicas/admin-protocol";
import type {
  ControlSessionRepository,
  EmailChallengeBinding,
  EmailChallengeRecord,
  EmailChallengeRepository,
  AccountRecord,
  AccountRepository,
  OAuthDiscoveryPort,
  ExternalIdentityRecord,
  PeopleRepository,
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
  members: Map<string, { readonly identity: { readonly identityIssuer: string; readonly subject: string } }>;
}

const fakeStacks = new Map<string, FakeStack>();
const fakeSessions = new Map<string, StoredSession>();

afterEach(() => {
  fakeStacks.clear();
  fakeSessions.clear();
});

test("stable admin asset URLs revalidate across deployments", async () => {
  for (const pathname of ["/assets/index.js", "/assets/index.css", "/assets/skills/unicas-cli/SKILL.md"]) {
    const response = await uiAssets(pathname);
    expect(response?.headers.get("Cache-Control")).toBe("no-cache");
  }
  await expect(uiAssets("/assets/missing.js")).resolves.toBeNull();
});

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

function fakeControlPlane(): Record<string, unknown> {
  return {};
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

interface TestPlatformState {
  readonly principalRef: string;
  readonly principal: Principal;
  readonly status: "active" | "blocked";
  readonly authorities: readonly PlatformAuthority[];
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface TestPlatformAudit {
  readonly eventId: string;
  readonly action: string;
  readonly actorPrincipal: Principal;
  readonly targetPrincipal: Principal | null;
  readonly targetInvitationId: string | null;
  readonly result: "succeeded" | "denied";
  readonly requestId: string | null;
  readonly createdAt: number;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

/** Current invitation port plus local Account authorization fixture state. */
class MemoryPlatformAccessRepository implements PlatformInvitationRepository {
  private readonly states = new Map<string, TestPlatformState>();
  private readonly accountActors = new Map<string, { externalIdentityId: string; principal: Principal }>();
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
  private readonly platformAudits: TestPlatformAudit[] = [];

  async readSnapshot(): Promise<number> { return 0; }

  private key(p: Principal): string {
    return `${p.issuer}\0${p.subject}`;
  }

  bindAccount(accountId: string, externalIdentityId: string, principal: Principal): void {
    this.accountActors.set(accountId, { externalIdentityId, principal });
  }

  isAccountBlocked(accountId: string): boolean {
    const actor = this.accountActors.get(accountId);
    return actor ? this.states.get(this.key(actor.principal))?.status === "blocked" : false;
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
    const record = this.platformInvitationIdempotency.get(`${input.actorAccountId}\0${input.key}`) ?? null;
    return record && record.expiresAt > input.now ? record : null;
  }

  async commitCreateInvitation(input: Parameters<PlatformInvitationRepository["commitCreateInvitation"]>[0]) {
    const actor = this.#stateForActor(input.actor.accountId, input.actor.externalIdentityId);
    if (!actor?.authorities.includes("platform.admin") || actor.status !== "active") return "actor-forbidden" as const;
    const idempotencyKey = `${input.actor.accountId}\0${input.idempotency.key}`;
    if (this.platformInvitationIdempotency.has(idempotencyKey)) return "idempotency-conflict" as const;
    this.platformInvitations.set(input.invitation.invitationId, input.invitation);
    this.platformInvitationIdempotency.set(idempotencyKey, input.idempotency);
    this.platformAudits.push({
      eventId: input.eventId,
      action: "platform_invitation.created",
      actorPrincipal: actor.principal,
      targetPrincipal: null,
      targetInvitationId: input.invitation.invitationId,
      result: "succeeded",
      requestId: input.requestId,
      createdAt: input.invitation.createdAt,
      details: {},
    });
    return "created" as const;
  }

  async commitRevokeInvitation(input: Parameters<PlatformInvitationRepository["commitRevokeInvitation"]>[0]) {
    const actor = this.#stateForActor(input.actor.accountId, input.actor.externalIdentityId);
    if (!actor?.authorities.includes("platform.admin") || actor.status !== "active") return "actor-forbidden" as const;
    const invitation = this.platformInvitations.get(input.invitationId);
    if (!invitation) return "not-found" as const;
    if (invitation.revision !== input.expectedRevision) return "revision-mismatch" as const;
    if (invitation.status !== "pending" || invitation.expiresAt <= input.now) return "not-pending" as const;
    this.platformInvitations.set(input.invitationId, { ...invitation, status: "revoked", revision: invitation.revision + 1 });
    this.platformAudits.push({
      eventId: input.eventId,
      action: "platform_invitation.revoked",
      actorPrincipal: actor.principal,
      targetPrincipal: null,
      targetInvitationId: input.invitationId,
      result: "succeeded",
      requestId: input.requestId,
      createdAt: input.now,
      details: {},
    });
    return "updated" as const;
  }

  async commitAcceptInvitation(input: Parameters<PlatformInvitationRepository["commitAcceptInvitation"]>[0]) {
    const invitation = this.platformInvitations.get(input.invitation.invitationId);
    if (!invitation || invitation.status !== "pending" || invitation.tokenHash !== input.tokenHash || invitation.expiresAt <= input.now) {
      return "not-pending" as const;
    }
    const principal = this.#principalForAccount(input.actor.accountId);
    const principalKey = principal ? this.key(principal) : null;
    const current = principalKey ? this.states.get(principalKey) : null;
    if (!principal || current?.status === "blocked") return "account-unavailable" as const;
    const authorities = (["platform.admin", "apps.create"] as const)
      .filter(authority => current?.authorities.includes(authority) || invitation.authorities.includes(authority));
    this.states.set(principalKey, current
      ? { ...current, authorities, revision: current.revision + 1 }
      : {
        principalRef: principalKey,
        principal,
        status: "active",
        authorities,
        revision: 1,
        createdAt: input.now,
        updatedAt: input.now,
      });
    this.platformInvitations.set(invitation.invitationId, { ...invitation, status: "accepted", revision: invitation.revision + 1 });
    this.platformAudits.push({
      eventId: input.eventId,
      action: "platform_invitation.accepted",
      actorPrincipal: principal,
      targetPrincipal: principal,
      targetInvitationId: invitation.invitationId,
      result: "succeeded",
      requestId: input.requestId,
      createdAt: input.now,
      details: {},
    });
    return "accepted" as const;
  }

  #principalForAccount(accountId: string): Principal | null {
    return this.accountActors.get(accountId)?.principal ?? null;
  }

  #stateForActor(accountId: string, externalIdentityId: string): TestPlatformState | null {
    const actor = this.accountActors.get(accountId);
    const principal = actor?.principal ?? null;
    if (!principal || actor?.externalIdentityId !== externalIdentityId) return null;
    return this.states.get(this.key(principal)) ?? null;
  }

  async listAuditEvents(input: {
    readonly action?: string;
    readonly actorPrincipalRef?: string;
    readonly targetPrincipalRef?: string;
    readonly createdAfter?: number;
    readonly beforeCreatedAt?: number;
    readonly beforeEventId?: string;
    readonly limit: number;
  }) {
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
  issuer = ISSUER,
): AccountRepository {
  const accounts = new Map<string, AccountRecord>();
  const profiles = new Map<string, { accountId: string; displayName: string | null; avatarUrl: string | null; displayNameSource: string | null; avatarSource: string | null; updatedAt: number }>();
  const identities = new Map<string, ExternalIdentityRecord>();
  const identityKeys = new Map<string, ExternalIdentityRecord>();
  const externalIssuers = new Map<string, Awaited<ReturnType<AccountRepository["getAppOAuthIssuer"]>>>();
  const issuerInspections = new Map<string, Parameters<AccountRepository["commitInspectAccountOAuthIssuer"]>[0]["inspection"]>();
  const issuerInspectionKeys = new Map<string, Parameters<AccountRepository["commitInspectAccountOAuthIssuer"]>[0]["keys"]>();
  const appInvitations = new Map<string, {
    invitationId?: string;
    status: "pending" | "accepted" | "expired" | "revoked";
    revision: number;
    emailConstraint?: string | null;
    expiresAt?: number;
  }>();
  const invitationIdempotency = new Map<string, Parameters<AccountRepository["commitCreateAccountAppInvitation"]>[0]["idempotency"]>();
  const invitationTokens = new Map<string, { appId: string; invitationId: string }>();
  const appIdempotency = new Map<string, Parameters<AccountRepository["commitCreateAccountApp"]>[0]["idempotency"]>();
  function add(
    account: AccountRecord,
    profile: { accountId: string; displayName: string | null; avatarUrl: string | null; displayNameSource: string | null; avatarSource: string | null; updatedAt: number },
    identity: ExternalIdentityRecord,
  ) {
    accounts.set(account.accountId, account);
    profiles.set(profile.accountId, profile);
    identities.set(identity.externalIdentityId, identity);
    identityKeys.set(`${identity.issuer}\0${identity.subject}`, identity);
    platform.bindAccount(account.accountId, identity.externalIdentityId, {
      issuer: identity.issuer,
      subject: identity.subject,
    });
  }
  const accountId = testAccountId(subject);
  const seedIdentity: ExternalIdentityRecord = {
    externalIdentityId: `ext-${subject}`, accountId, provider: "google", issuer, subject,
    linkedAt: 1, lastAuthenticatedAt: 1, unlinkedAt: null, accountHint: null, displayName: subject, avatarUrl: null,
  };
  add(
    { accountId, blockedAt: null, credentialVersion: 1, primaryVerifiedEmail: null, createdAt: 1, updatedAt: 1 },
    { accountId, displayName: subject, avatarUrl: null, displayNameSource: seedIdentity.externalIdentityId, avatarSource: null, updatedAt: 1 },
    seedIdentity,
  );
  const identityForAccount = (requested: string) => [...identities.values()].find(value => value.accountId === requested && value.unlinkedAt === null) ?? null;
  const repository: Partial<AccountRepository> = {
    getAccount: async requested => {
      const account = accounts.get(requested);
      return account
        ? { ...account, blockedAt: platform.isAccountBlocked(requested) ? 1 : account.blockedAt }
        : null;
    },
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
    hasAppMembership: async (requested, appId) => {
      const identity = identityForAccount(requested);
      if (!identity) return false;
      if (appId !== undefined) return fakeStacks.get(appId)?.members.has(`${identity.issuer}\n${identity.subject}`) ?? false;
      return [...fakeStacks.values()].some(app => app.members.has(`${identity.issuer}\n${identity.subject}`))
        || platform.hasMembership({ issuer: identity.issuer, subject: identity.subject });
    },
    listAccountMembershipAppIds: async () => [],
    readControlSnapshot: () => platform.readSnapshot(),
    listAccountApps: async ({ accountId: requested, afterAppId, limit }) => {
      const identity = identityForAccount(requested);
      if (!identity) return [];
      return [...fakeStacks.values()]
        .filter(app => app.stackId > afterAppId
          && app.members.has(`${identity.issuer}\n${identity.subject}`))
        .sort((left, right) => left.stackId.localeCompare(right.stackId))
        .slice(0, limit)
        .map(({ members: _members, stackId, ...app }) => ({ appId: stackId, ...app }));
    },
    getAccountApp: async (requested, appId) => {
      const identity = identityForAccount(requested);
      const app = fakeStacks.get(appId);
      if (!identity || !app?.members.has(`${identity.issuer}\n${identity.subject}`)) return null;
      const { members: _members, stackId, ...record } = app;
      return { appId: stackId, ...record };
    },
    getAccountAppIdempotency: async input => appIdempotency.get(
      `${input.accountId}\0${input.key}`,
    ) ?? null,
    commitCreateAccountApp: async input => {
      const identity = identities.get(input.actorExternalIdentityId);
      if (!identity || identity.accountId !== input.actorAccountId || identity.unlinkedAt !== null) {
        return "actor-forbidden";
      }
      fakeStacks.set(input.app.appId, {
        stackId: input.app.appId,
        displayName: input.app.displayName,
        description: input.app.description,
        status: input.app.status,
        createdAt: input.app.createdAt,
        revision: input.app.revision,
        members: new Map([[`${identity.issuer}\n${identity.subject}`, {
          identity: { identityIssuer: identity.issuer, subject: identity.subject },
        }]]),
      });
      if (input.idempotency) appIdempotency.set(
        `${input.idempotency.accountId}\0${input.idempotency.key}`,
        input.idempotency,
      );
      return "created";
    },
    getAppOAuthIssuer: async appId => externalIssuers.get(appId) ?? null,
    hasAppOAuthIssuerElsewhere: async (issuer, appId) => [...externalIssuers.entries()]
      .some(([candidateAppId, candidate]) => candidateAppId !== appId && candidate?.issuer === issuer),
    commitInspectAccountOAuthIssuer: async input => {
      issuerInspections.set(input.inspection.inspectionId, input.inspection);
      issuerInspectionKeys.set(input.inspection.inspectionId, input.keys);
      return "created";
    },
    getAppOAuthIssuerInspection: async inspectionId => issuerInspections.get(inspectionId) ?? null,
    listAppOAuthIssuerInspectionKeys: async inspectionId => issuerInspectionKeys.get(inspectionId) ?? [],
    commitActivateAccountOAuthIssuer: async input => {
      const identity = identities.get(input.actorExternalIdentityId);
      const app = fakeStacks.get(input.appId);
      if (!identity || identity.accountId !== input.actorAccountId
        || !app?.members.has(`${identity.issuer}\n${identity.subject}`)) return "actor-not-member";
      const current = externalIssuers.get(input.appId) ?? null;
      if (input.expectedIssuerRevision === null
        ? current !== null
        : current?.revision !== input.expectedIssuerRevision) return "revision-mismatch";
      const inspection = issuerInspections.get(input.inspectionId);
      if (!inspection || inspection.usedAt !== null || inspection.expiresAt <= input.now) return "unavailable";
      issuerInspections.set(input.inspectionId, { ...inspection, usedAt: input.now, revision: inspection.revision + 1 });
      externalIssuers.set(input.appId, input.issuer);
      return "activated";
    },
    getAppMemberInvitation: async (appId, invitationId) => {
      if (!fakeStacks.has(appId)) return null;
      const state = appInvitations.get(appId) ?? { status: "pending" as const, revision: 7 };
      const currentInvitationId = state.invitationId ?? "inv-test";
      if (invitationId !== currentInvitationId) return null;
      return {
        appId,
        invitationId: currentInvitationId,
        status: state.status,
        emailConstraint: state.emailConstraint ?? null,
        expiresAt: state.expiresAt ?? 4102444800000,
        createdAt: 1,
        revision: state.revision,
      };
    },
    listAppMemberInvitations: async input => {
      if (!fakeStacks.has(input.appId)) return [];
      const state = appInvitations.get(input.appId) ?? { status: "pending" as const, revision: 7 };
      const invitationId = state.invitationId ?? "inv-test";
      const expiresAt = state.expiresAt ?? 4102444800000;
      if (input.afterInvitationId >= invitationId) return [];
      if (input.status !== undefined && input.status !== state.status) return [];
      if (input.expiresAtOrBefore !== undefined && expiresAt > input.expiresAtOrBefore) return [];
      return [{
        appId: input.appId,
        invitationId,
        status: state.status,
        emailConstraint: state.emailConstraint ?? null,
        expiresAt,
        createdAt: 1,
        revision: state.revision,
      }];
    },
    commitAccountAppInvitationTransition: async input => {
      const identity = identities.get(input.actorExternalIdentityId);
      const app = fakeStacks.get(input.appId);
      if (!identity || identity.accountId !== input.actorAccountId
        || !app?.members.has(`${identity.issuer}\n${identity.subject}`)) return "actor-not-member";
      const state = appInvitations.get(input.appId) ?? { status: "pending" as const, revision: 7 };
      if (input.invitationId !== (state.invitationId ?? "inv-test") || state.status !== "pending"
        || state.revision !== input.expectedRevision) return "unavailable";
      appInvitations.set(input.appId, { ...state, status: input.status, revision: state.revision + 1 });
      return "updated";
    },
    getAccountAppInvitationIdempotency: async input => invitationIdempotency.get(
      `${input.accountId}\0${input.appId}\0${input.key}`,
    ) ?? null,
    commitCreateAccountAppInvitation: async input => {
      const identity = identities.get(input.actorExternalIdentityId);
      const app = fakeStacks.get(input.invitation.appId);
      if (!identity || identity.accountId !== input.actorAccountId
        || !app?.members.has(`${identity.issuer}\n${identity.subject}`)) return "actor-not-member";
      appInvitations.set(input.invitation.appId, {
        invitationId: input.invitation.invitationId,
        status: "pending",
        revision: 1,
        emailConstraint: input.invitation.emailConstraint,
        expiresAt: input.invitation.expiresAt,
      });
      invitationTokens.set(input.invitation.tokenHash, {
        appId: input.invitation.appId,
        invitationId: input.invitation.invitationId,
      });
      if (input.idempotency) invitationIdempotency.set(
        `${input.idempotency.accountId}\0${input.idempotency.appId}\0${input.idempotency.key}`,
        input.idempotency,
      );
      return "created";
    },
    getAccountAppInvitationByTokenHash: async tokenHash => {
      const target = invitationTokens.get(tokenHash);
      if (!target) {
        const seeded = await platform.getAppInvitationByTokenHash(tokenHash);
        return seeded ? { ...seeded, tokenHash, createdAt: 1, revision: 1 } : null;
      }
      const state = appInvitations.get(target.appId);
      if (!state) return null;
      return {
        appId: target.appId,
        invitationId: target.invitationId,
        status: state.status,
        emailConstraint: state.emailConstraint ?? null,
        tokenHash,
        expiresAt: state.expiresAt ?? 4102444800000,
        createdAt: 1,
        revision: state.revision,
      };
    },
    commitAcceptAccountAppInvitation: async input => {
      const identity = identities.get(input.externalIdentityId);
      if (!identity || identity.accountId !== input.accountId || identity.unlinkedAt !== null) {
        return "account-unavailable";
      }
      const state = appInvitations.get(input.invitation.appId);
      if (!state || state.status !== "pending" || state.expiresAt !== undefined && state.expiresAt <= input.now) {
        return "invitation-unavailable";
      }
      state.status = "accepted";
      state.revision += 1;
      fakeStacks.get(input.invitation.appId)?.members.set(
        `${identity.issuer}\n${identity.subject}`,
        { identity: { identityIssuer: identity.issuer, subject: identity.subject } },
      );
      platform.grantViaMembership(identity.issuer, identity.subject);
      return "accepted";
    },
    appendAccountSessionAudit: async input => {
      const identity = identities.get(input.externalIdentityId);
      return identity?.accountId === input.accountId && identity.unlinkedAt === null
        ? "recorded"
        : "account-unavailable";
    },
    commitPatchAccountApp: async input => {
      const identity = identities.get(input.actorExternalIdentityId);
      const app = fakeStacks.get(input.app.appId);
      if (!identity || identity.accountId !== input.actorAccountId
        || !app?.members.has(`${identity.issuer}\n${identity.subject}`)) return "actor-not-member";
      if (app.revision !== input.expectedRevision) return "revision-mismatch";
      Object.assign(app, {
        displayName: input.app.displayName,
        description: input.app.description,
        status: input.app.status,
        revision: input.app.revision,
      });
      return "updated";
    },
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
  };
  return repository as AccountRepository;
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
  platformAccessRepository?: MemoryPlatformAccessRepository,
  _unusedLegacySlot: unknown = fakeControlPlane(),
  platformInvitationRepository?: PlatformInvitationRepository,
  _platformAuditRepository?: unknown,
  peopleRepository?: PeopleRepository,
  accountRepository?: AccountRepository,
  oauthDiscovery?: OAuthDiscoveryPort,
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
      redirectUri: `${PUBLIC_ORIGIN}/admin/auth/callback/google`,
    },
    { fetchImpl: providerFetch },
  );
  const defaultAccountPlatform = new MemoryPlatformAccessRepository();
  defaultAccountPlatform.grant(ISSUER, "google-user-123");
  const accountPlatform = platformAccessRepository instanceof MemoryPlatformAccessRepository
    ? platformAccessRepository
    : defaultAccountPlatform;
  return createAdminBff({
    config,
    sessionStore: new MemorySessionRepository(config.now),
    oidc,
    auditReader,
    platformInvitationRepository,
    peopleRepository,
    accountRepository: accountRepository ?? memoryAccountRepository(accountPlatform, "google-user-123"),
    oauthDiscovery,
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
  const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google?returnTo=/admin/`));
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
  expect(location.searchParams.get("redirect_uri")).toBe(`${PUBLIC_ORIGIN}/admin/auth/callback/google`);
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
    `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
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
  const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google?returnTo=/admin/`));
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
    `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
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
      sessionStore: sessions, accountRepository: repository,
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
    expect(html).toContain("<title>Sign in - UniCAS</title>");
    expect(html).toContain('class="login-panel-header"');
    expect(html).toContain("Restricted console");
    expect(html).toContain("Choose a sign-in method.");
    expect(html).toContain("/admin/auth/start/google?returnTo=%2Fadmin%2F");
    expect(html).toContain("Continue with Google");
    expect(html).toContain("login-provider-icon-google");
    expect(html).toContain("login-provider-label");
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
          source: "google-oidc" as const,
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
    const accountPlatform = new MemoryPlatformAccessRepository();
    accountPlatform.grant("https://microsoft.example", "microsoft-subject");
    const bff = createAdminBff({
      config,
      sessionStore: new MemorySessionRepository(),
      providerRegistry: registry,
      accountRepository: memoryAccountRepository(
        accountPlatform,
        "microsoft-subject",
        "https://microsoft.example",
      ),
    });

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/login`));
    const html = await login.text();
    expect(html).toContain("Continue with Google");
    expect(html).toContain("Continue with Microsoft");
    expect(html).not.toContain("Continue with GitHub");
    expect(html).toContain("login-provider-icon-google");
    expect(html).toContain("login-provider-icon-microsoft");

    const started = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/microsoft`));
    const preLoginCookie = cookieFrom(started)!;
    const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    const mismatch = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/github?code=code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(mismatch.headers.get("Location")).toBe("/admin/auth/login?error=oidc-failed");
    expect((await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/github`))).status).toBe(404);
    for (const path of [
      "/admin/auth/oidc",
      "/admin/auth/callback",
      "/oauth/google/callback",
    ]) expect((await bff(new Request(`${PUBLIC_ORIGIN}${path}`))).status).toBe(404);

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
          source: "google-oidc" as const,
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
      sessionStore: new MemorySessionRepository(),
      accountRepository: memoryAccountRepository(repository, "alice", "https://google.example"),
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
      sessionStore: new MemorySessionRepository(),
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
      sessionStore: new MemorySessionRepository(),
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
    const accountRepository: Partial<AccountRepository> = {
      getAccount: async requested => requested === accountId ? account : null,
      getAliasTarget: async () => null,
      getActiveIdentity: async (issuer, subject) => identities.get(`${issuer}\0${subject}`) ?? null,
      getIdentity: async externalIdentityId => [...identities.values()].find(identity => identity.externalIdentityId === externalIdentityId) ?? null,
      getProfile: async () => ({ accountId, displayName: "Account User", avatarUrl: null, displayNameSource: "user", avatarSource: "user", updatedAt: 1 }),
      listActiveIdentities: async () => [...identities.values()],
      listPlatformAuthorities: async () => ["platform.admin", "apps.create"],
      hasAppMembership: async () => false,
      listAccountMembershipAppIds: async () => [],
      readControlSnapshot: async () => 1,
      listAccountApps: vi.fn(async input => input.accountId === accountId ? [{
        appId: "cas_app_a",
        displayName: "App A",
        description: "",
        status: "active",
        createdAt: 1,
        revision: 1,
      }] : []),
      getAccountAppIdempotency: vi.fn(async () => null),
      commitCreateAccountApp: vi.fn(async () => "created"),
      appendAccountSessionAudit: vi.fn(async () => "recorded"),
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
        csrfEnforced: false,
      },
      sessionStore: new MemorySessionRepository(),
      providerRegistry: new ProviderRegistry([adapter("google"), adapter("github")]),
      accountRepository: accountRepository as AccountRepository,
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
    const current = await authRequest(bff, "/admin/me", githubCookie);
    expect(current.status).toBe(200);
    const currentBody = await current.json();
    expect(Object.keys(currentBody).sort()).toEqual(["account", "authenticatedIdentity", "memberships"]);
    expect(currentBody.account.accountId).toBe(accountId);
    expect(currentBody.authenticatedIdentity.provider).toBe("github");
    expect(currentBody.authenticatedIdentity).not.toHaveProperty("subject");
    const apps = await authRequest(bff, "/admin/apps", githubCookie);
    expect(apps.status).toBe(200);
    await expect(apps.json()).resolves.toEqual({
      items: [expect.objectContaining({ appId: "cas_app_a", displayName: "App A" })],
      nextCursor: null,
    });
    expect(accountRepository.listAccountApps).toHaveBeenCalledWith({
      accountId,
      afterAppId: "",
      limit: 51,
    });
    const createdApp = await authRequest(bff, "/admin/apps", githubCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "create-app" },
      body: JSON.stringify({ displayName: "Created App" }),
    });
    expect(createdApp.status).toBe(201);
    expect(createdApp.headers.get("ETag")).toBe('"1"');
    expect(accountRepository.commitCreateAccountApp).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: accountId,
      actorExternalIdentityId: "ext-github",
      idempotency: expect.objectContaining({ accountId, key: "create-app" }),
    }));

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
      sub: "google-user-123",
      aud: CLIENT_ID,
      nonce,
      email: "alice@example.com",
      email_verified: true,
      name: "Alice",
    };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(oidcState)}`,
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
    expect(body.identity?.subject).toBe("google-user-123");

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
    provider.pendingClaims = { iss: ISSUER, sub: "google-user-123", aud: CLIENT_ID, nonce, email: "alice@example.com", email_verified: true };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(googleUrl.searchParams.get("state")!)}`,
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(googleUrl.searchParams.get("state")!)}`,
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
    const optional = await authRequest(bff, `/admin/apps/${stackId}/oauth-issuer?optional=true`, cookie);
    expect(optional.status).toBe(200);
    expect(await optional.json()).toBeNull();
    expect((await authRequest(bff, `/admin/apps/${stackId}/oauth-issuer`, cookie)).status).toBe(404);
    expect((await authRequest(bff, `/admin/apps/${stackId}/oauth-issuer?optional=invalid`, cookie)).status).toBe(400);
    expect((await authRequest(bff, "/admin/apps/cas_other/oauth-issuer?optional=true", cookie)).status).toBe(403);
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
        `/admin/apps/${stackId}/oauth-issuer/inspections`,
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
        message: "A valid issuer URL is required",
      });
    }
  });

  test("full OIDC login flow reaches me() with the verified identity", async () => {
    const provider = await createMockProvider();
    provider.expectTokenBody = (body) => {
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("mock-code");
      expect(body.get("redirect_uri")).toBe(`${PUBLIC_ORIGIN}/admin/auth/callback/google`);
      expect(body.get("client_id")).toBe(CLIENT_ID);
      expect(body.get("client_secret")).toBe(CLIENT_SECRET);
      expect(body.get("code_verifier")).toBeTruthy();
    };
    const bff = await createBff(provider);
    const { cookie } = await signIn(bff, provider);
    expect((await authRequest(bff, "/admin/me", cookie)).status).toBe(200);
  });

  test("platform access denied: login is rejected and no session is created when principal has no grant or membership", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    // Do NOT grant the test user — repo is empty.
    const bff = await createBff(provider, undefined, {}, repo);

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google?returnTo=/admin/`));
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=access-denied");
    // Session cookie must not be set on denied login.
    expect(callback.headers.get("Set-Cookie")).toBeNull();

    const deniedPage = await bff(new Request(`${PUBLIC_ORIGIN}${callback.headers.get("Location")!}`));
    const deniedHtml = await deniedPage.text();
    expect(deniedHtml).toContain('class="login-panel login-panel-restricted"');
    expect(deniedHtml).toContain("Access restricted");
    expect(deniedHtml).toContain("No management access");
    expect(deniedHtml).toContain("Sign in with another Google account");
    expect(deniedHtml).not.toContain("Continue with Google");
  }, 10_000);

  test("platform access granted: login succeeds when principal has an explicit grant", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    repo.grant(ISSUER, "google-user-with-grant");
    const bff = await createBff(
      provider, undefined, {}, repo, fakeControlPlane(), undefined, undefined, undefined,
      memoryAccountRepository(repo, "google-user-with-grant"),
    );

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google?returnTo=/admin/`));
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/");
    const cookie = cookieFrom(callback)!;

    expect((await authRequest(bff, "/admin/me", cookie)).status).toBe(200);
  }, 10_000);

  test("platform access blocked: authenticated request is denied and session is cleared for a blocked principal", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    repo.grant(ISSUER, "google-user-to-block");
    const bff = await createBff(
      provider, undefined, {}, repo, fakeControlPlane(), undefined, undefined, undefined,
      memoryAccountRepository(repo, "google-user-to-block"),
    );

    // Sign in while still active.
    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google?returnTo=/admin/`));
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
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

    const response = await authRequest(bff, "/admin/apps", cookie, {
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
    const bff = await createBff(provider, undefined, {}, repo);

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google`));
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: cookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/");
    const sessionCookie = cookieFrom(callback)!;
    const me = await authRequest(bff, "/admin/me", sessionCookie);
    expect(me.status).toBe(200);
  }, 10_000);

  test("callback with a mismatched state is rejected", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google`));
    const cookie = cookieFrom(login)!;
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=code&state=wrong-state`,
      { headers: { Cookie: cookie } },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=oidc-failed");
  });

  test("id_token with a wrong nonce is rejected", async () => {
    const provider = await createMockProvider();
    const bff = await createBff(provider);
    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google`));
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=code&state=${encodeURIComponent(state)}`,
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

    const noCsrf = await authRequest(bff, "/admin/apps", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Stack" }),
    });
    expect(noCsrf.status).toBe(403);

    const noOrigin = await bff(new Request(`${PUBLIC_ORIGIN}/admin/apps`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Stack" }),
    }));
    expect(noOrigin.status).toBe(403);

    const ok = await authRequest(bff, "/admin/apps", cookie, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Stack" }),
    });
    expect(ok.status).toBe(201);
    const created = await ok.json();
    expect(created.appId).toMatch(/^cas_/);
    expect(ok.headers.get("ETag")).toBe('"1"');
  });

  test("external App issuer reads use Account membership", async () => {
    const provider = await createMockProvider();
    const platform = new MemoryPlatformAccessRepository();
    platform.grant(ISSUER, "google-user-123");
    const accounts = memoryAccountRepository(platform, "google-user-123");
    const accountIssuer = vi.spyOn(accounts, "getAppOAuthIssuer").mockResolvedValue(null);
    const legacyGet = vi.fn(async () => {
      throw new Error("legacy external issuer read must not be called");
    });
    const bff = await createBff(
      provider,
      undefined,
      {},
      platform,
      { ...fakeControlPlane(), getOAuthIssuer: legacyGet },
      undefined,
      undefined,
      undefined,
      accounts,
    );
    const { cookie, csrf } = await signIn(bff, provider);
    const appId = await createStack(bff, cookie, csrf, "External Issuer App");
    const path = `/admin/apps/${appId}/oauth-issuer`;

    expect(await (await authRequest(bff, `${path}?optional=true`, cookie)).json()).toBeNull();
    expect((await authRequest(bff, path, cookie)).status).toBe(404);
    accountIssuer.mockResolvedValue({
      appId,
      issuer: "https://issuer.example",
      audience: "https://api.example/app",
      metadataUrl: "https://issuer.example/.well-known/openid-configuration",
      metadataType: "oidc",
      authorizationEndpoint: "https://issuer.example/authorize",
      tokenEndpoint: "https://issuer.example/token",
      jwksUri: "https://issuer.example/jwks",
      registrationEndpoint: null,
      scopesSupported: ["openid"],
      codeChallengeMethodsSupported: ["S256"],
      status: "active",
      verifiedAt: 1,
      lastRefreshAt: 1,
      lastRefreshError: null,
      jwksDigest: "digest",
      capabilityMaxLifetimeSeconds: 3600,
      revision: 3,
    });
    const current = await authRequest(bff, path, cookie);
    expect(current.status).toBe(200);
    expect(current.headers.get("ETag")).toBe('"3"');
    expect(await current.json()).toMatchObject({ appId, issuer: "https://issuer.example", revision: 3 });
    expect(legacyGet).not.toHaveBeenCalled();
  });

  test("App issuer mutations preserve minimal receipts and both conditional activation modes", async () => {
    const provider = await createMockProvider();
    const platform = new MemoryPlatformAccessRepository();
    platform.grant(ISSUER, "google-user-123");
    const accounts = memoryAccountRepository(platform, "google-user-123");
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const publicJwk = { ...(await exportJWK(publicKey)), kid: "issuer-key", alg: "ES256" };
    const oauthDiscovery: OAuthDiscoveryPort = {
      inspectIssuer: async ({ issuer }) => ({
        metadata: {
          issuer,
          metadataUrl: `${issuer}/metadata`,
          metadataType: "oauth",
          authorizationEndpoint: `${issuer}/authorize`,
          tokenEndpoint: `${issuer}/token`,
          jwksUri: `${issuer}/jwks`,
          registrationEndpoint: null,
          scopesSupported: ["openid"],
          codeChallengeMethodsSupported: ["S256"],
        },
        metadataDigest: `metadata-${issuer}`,
        jwksDigest: `jwks-${issuer}`,
        keys: [{ kid: "issuer-key", algorithm: "ES256", publicJwk }],
      }),
    };
    const legacyInspect = vi.fn(async () => { throw new Error("legacy inspection must not be called"); });
    const legacyActivate = vi.fn(async () => { throw new Error("legacy activation must not be called"); });
    const bff = await createBff(
      provider,
      undefined,
      {},
      platform,
      { ...fakeControlPlane(), inspectAppOAuthIssuer: legacyInspect, activateAppOAuthIssuer: legacyActivate },
      undefined,
      undefined,
      undefined,
      accounts,
      oauthDiscovery,
    );
    const { cookie, csrf } = await signIn(bff, provider);
    const appId = await createStack(bff, cookie, csrf, "App");
    const path = `/admin/apps/${appId}/oauth-issuer`;
    const headers = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
    const inspection = await authRequest(bff, `${path}/inspections`, cookie, { method: "POST", headers, body: JSON.stringify({ issuer: "https://candidate.example" }) });
    expect(inspection.status).toBe(201);
    expect(inspection.headers.has("ETag")).toBe(false);
    const inspected = await inspection.json() as { inspectionId: string; challenge: string };
    const initialProof = await new CompactSign(new TextEncoder().encode(inspected.challenge))
      .setProtectedHeader({ alg: "ES256", kid: "issuer-key" }).sign(privateKey);
    const body = JSON.stringify({ inspectionId: inspected.inspectionId, activationProof: initialProof });
    const initial = await authRequest(bff, path, cookie, { method: "PUT", headers: { ...headers, "If-None-Match": "*" }, body });
    expect(initial.status).toBe(204);
    expect(initial.headers.get("ETag")).toBe('"1"');
    expect(await initial.text()).toBe("");
    const secondInspection = await authRequest(bff, `${path}/inspections`, cookie, { method: "POST", headers, body: JSON.stringify({ issuer: "https://replacement.example" }) });
    const second = await secondInspection.json() as { inspectionId: string; challenge: string };
    const replacementProof = await new CompactSign(new TextEncoder().encode(second.challenge))
      .setProtectedHeader({ alg: "ES256", kid: "issuer-key" }).sign(privateKey);
    const replacementBody = JSON.stringify({ inspectionId: second.inspectionId, activationProof: replacementProof });
    expect((await authRequest(bff, path, cookie, { method: "PUT", headers: { ...headers, "If-Match": '"9"' }, body: replacementBody })).status).toBe(412);
    const replacement = await authRequest(bff, path, cookie, { method: "PUT", headers: { ...headers, "If-Match": '"1"' }, body: replacementBody });
    expect(replacement.status).toBe(204);
    expect(replacement.headers.get("ETag")).toBe('"2"');
    expect(legacyInspect).not.toHaveBeenCalled();
    expect(legacyActivate).not.toHaveBeenCalled();
  });

  test("App invitation list and revoke use strict filters, CSRF, and invitation ETags", async () => {
    const provider = await createMockProvider();
    const platform = new MemoryPlatformAccessRepository();
    platform.grant(ISSUER, "google-user-123");
    const accounts = memoryAccountRepository(platform, "google-user-123");
    const legacyList = vi.fn(async () => { throw new Error("legacy invitation list must not be called"); });
    const legacyRevoke = vi.fn(async () => { throw new Error("legacy invitation revoke must not be called"); });
    const bff = await createBff(
      provider,
      undefined,
      {},
      platform,
      {
        ...fakeControlPlane(),
        listAppMemberInvitations: legacyList,
        revokeAppMemberInvitation: legacyRevoke,
      },
      undefined,
      undefined,
      undefined,
      accounts,
    );
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
    expect(legacyList).not.toHaveBeenCalled();
    expect(legacyRevoke).not.toHaveBeenCalled();
  });

  test("App invitation creation uses Account-scoped idempotency", async () => {
    const provider = await createMockProvider();
    const platform = new MemoryPlatformAccessRepository();
    platform.grant(ISSUER, "google-user-123");
    const accounts = memoryAccountRepository(platform, "google-user-123");
    const legacyCreate = vi.fn(async () => { throw new Error("legacy invitation create must not be called"); });
    const bff = await createBff(
      provider,
      undefined,
      {},
      platform,
      { ...fakeControlPlane(), createMemberInvitation: legacyCreate },
      undefined,
      undefined,
      undefined,
      accounts,
    );
    const { cookie, csrf } = await signIn(bff, provider);
    const appId = await createStack(bff, cookie, csrf, "Invitation Create App");
    const path = `/admin/apps/${appId}/member-invitations`;
    const init = {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        "Idempotency-Key": "invite-once",
      },
      body: JSON.stringify({ emailConstraint: " Invitee@Example.com " }),
    };
    const created = await authRequest(bff, path, cookie, init);
    expect(created.status).toBe(201);
    expect(created.headers.get("ETag")).toBe('"1"');
    const receipt = await created.json() as Record<string, unknown>;
    expect(receipt).toMatchObject({
      invitationId: expect.any(String),
      acceptUrl: expect.stringMatching(/^https:\/\/cas\.example\/admin\/invitations\//),
      expiresAt: expect.any(Number),
    });
    const replayed = await authRequest(bff, path, cookie, init);
    expect(await replayed.json()).toEqual(receipt);
    expect(legacyCreate).not.toHaveBeenCalled();
  });

  test("App status mutations enforce CSRF, strict input, and minimal responses", async () => {
    const provider = await createMockProvider();
    const platform = new MemoryPlatformAccessRepository();
    platform.grant(ISSUER, "google-user-123");
    const accounts = memoryAccountRepository(platform, "google-user-123");
    const bff = await createBff(
      provider,
      undefined,
      {},
      platform,
      fakeControlPlane(),
      undefined,
      undefined,
      undefined,
      accounts,
    );
    const { cookie, csrf } = await signIn(bff, provider);
    const appId = await createStack(bff, cookie, csrf, "App");
    const detail = await authRequest(bff, `/admin/apps/${appId}`, cookie);
    expect(detail.status).toBe(200);
    expect(detail.headers.get("ETag")).toBe('\"1\"');
    expect(await detail.json()).toMatchObject({ appId, displayName: "App", status: "active" });
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

  test("email-bound App invitation grants only exact acceptance, then rotates to a full membership session", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const token = "i".repeat(32);
    await repo.addInvitation(token, "outside@example.com");
    const accounts = memoryAccountRepository(repo, "seed-admin");
    fakeStacks.set("app-invited", {
      stackId: "app-invited",
      displayName: "Invited App",
      description: "",
      status: "active",
      createdAt: 1,
      revision: 1,
      members: new Map([[`${ISSUER}\nseed-admin`, {
        identity: { identityIssuer: ISSUER, subject: "seed-admin" },
      }]]),
    });
    await accounts.commitCreateAccountAppInvitation({
      actorAccountId: testAccountId("seed-admin"),
      actorExternalIdentityId: "ext-seed-admin",
      invitation: {
        appId: "app-invited",
        invitationId: "inv-account",
        status: "pending",
        emailConstraint: "outside@example.com",
        tokenHash: await sha256Hex(token),
        expiresAt: 4102444800000,
        createdAt: 1,
        revision: 1,
      },
      response: {
        invitationId: "inv-account",
        acceptUrl: `/admin/invitations/${token}`,
        expiresAt: 4102444800000,
        revision: 1,
      },
      idempotency: null,
      eventId: "event-invite",
      now: 1,
    });
    const legacyAccept = vi.fn(async () => { throw new Error("legacy invitation acceptance must not be called"); });
    const bff = await createBff(
      provider,
      undefined,
      {},
      repo,
      { ...fakeControlPlane(), acceptMemberInvitation: legacyAccept },
      undefined,
      undefined,
      undefined,
      accounts,
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
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
    expect(await accepted.json()).toEqual({ appId: "app-invited" });
    expect(legacyAccept).not.toHaveBeenCalled();
    const fullCookie = cookieFrom(accepted)!;
    expect(fullCookie).not.toBe(limitedCookie);

    const staleSession = await authRequest(bff, "/admin/me", limitedCookie);
    expect(staleSession.status).toBe(401);
    const admitted = await authRequest(bff, "/admin/apps", fullCookie);
    expect(admitted.status).toBe(200);
  }, 10_000);

  test("invitation login fails closed for invalid and mismatched-email invitations", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const constrainedToken = "c".repeat(32);
    await repo.addInvitation(constrainedToken, "expected@example.com");
    const bff = await createBff(provider, undefined, {}, repo);

    const invalid = await bff(new Request(`${PUBLIC_ORIGIN}/admin/invitations/short`));
    expect(invalid.status).toBe(404);

    for (const [token, email] of [[constrainedToken, "other@example.com"]] as const) {
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
        `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
        { headers: { Cookie: preLoginCookie } },
      ));
      expect(callback.status).toBe(302);
      expect(callback.headers.get("Location")).toBe("/admin/auth/login?error=access-denied");
      expect(callback.headers.get("Set-Cookie")).toBeNull();
    }
  }, 10_000);

  test("App root-ref audit reads authorize by Account without legacy Stack routing", async () => {
    const provider = await createMockProvider();
    const platform = new MemoryPlatformAccessRepository();
    platform.grantViaMembership(ISSUER, "google-user-123");
    const accounts = memoryAccountRepository(platform, "google-user-123");
    fakeStacks.set("cas_app", {
      stackId: "cas_app", displayName: "App", description: "", status: "active", createdAt: 1, revision: 1,
      members: new Map([[`${ISSUER}\ngoogle-user-123`, {
        identity: { identityIssuer: ISSUER, subject: "google-user-123" },
      }]]),
    });
    const rpcCalls: URL[] = [];
    const auditReader = {
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        rpcCalls.push(url);
        if (url.pathname === "/_internal/audit/domains") {
          return Response.json({ domains: [{ stackId: "cas_app", refDomain: "doc", revision: 2 }] });
        }
        return Response.json({
          revision: 2,
          refs: [{ tenantId: url.searchParams.get("tenantId"), hash: "a".repeat(64), count: 1 }],
          nextCursor: null,
        });
      },
    };
    const bff = await createBff(
      provider, auditReader, {}, platform, fakeControlPlane(), undefined, undefined, undefined, accounts,
    );
    const { cookie } = await signIn(bff, provider);

    const domains = await authRequest(bff, "/admin/apps/cas_app/ref-domains", cookie);
    expect(domains.status).toBe(200);
    expect(await domains.json()).toEqual({ domains: [{ appId: "cas_app", refDomain: "doc", revision: 2 }] });
    const refs = await authRequest(
      bff,
      "/admin/apps/cas_app/root-ref-domains/doc/refs?spaceId=space-1&limit=50",
      cookie,
    );
    expect(refs.status).toBe(200);
    expect(await refs.json()).toMatchObject({ refs: [{ spaceId: "space-1", count: 1 }] });
    expect(rpcCalls[1]!.searchParams.get("stackId")).toBe("cas_app");
    expect(rpcCalls[1]!.searchParams.get("tenantId")).toBe("space-1");
    expect(rpcCalls[1]!.searchParams.has("spaceId")).toBe(false);
  });

  test("audit reads require App membership before touching the reader", async () => {
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
    const otherAccess = new MemoryPlatformAccessRepository();
    otherAccess.grant(ISSUER, "other-sub");
    const bff2 = await createBff(
      provider2, auditReader, {}, otherAccess, fakeControlPlane(), undefined, undefined, undefined,
      memoryAccountRepository(otherAccess, "other-sub"),
    );
    const { cookie: otherCookie } = await signInAs(bff2, provider2, "other-sub");
    const denied = await authRequest(
      bff2,
      `/admin/apps/${stackId}/root-ref-domains/doc/refs`,
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
      `/admin/apps/${stackId}/root-ref-domains/Bad%20Domain/refs`,
      cookie,
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "INVALID_REQUEST" });

    const reserved = await authRequest(
      bff,
      `/admin/apps/${stackId}/root-ref-domains/_legacy/refs`,
      cookie,
    );
    expect(reserved.status).toBe(200);
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
  ): Promise<{ bff: (req: Request) => Promise<Response>; cookie: string; csrf: string }> {
    repo.grantAdmin(ISSUER, subject);
    const bff = await createBff(
      provider,
      undefined,
      {},
      repo,
      undefined,
      repo,
      repo,
      peopleRepository,
      memoryAccountRepository(repo, subject),
    );

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google?returnTo=/admin/`));
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
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
    const { bff, cookie } = await signInWithAdmin(provider, repo, "people-admin", people);
    expect((await bff(new Request(`${PUBLIC_ORIGIN}/admin/platform/people`))).status).toBe(401);
    const platform = await authRequest(bff, "/admin/platform/people", cookie);
    expect(platform.status).toBe(200);
    expect(await platform.json()).toEqual({ items: [], nextCursor: null });
    const appDenied = await authRequest(bff, "/admin/apps/cas_one/people", cookie);
    expect(appDenied.status).toBe(403);
    expect(await appDenied.json()).toEqual({ error: "APP_MEMBERSHIP_REQUIRED" });
    repo.grantViaMembership(ISSUER, "people-admin");
    fakeStacks.set("cas_one", {
      stackId: "cas_one", displayName: "One", description: "", status: "active", createdAt: 1, revision: 1,
      members: new Map([[`${ISSUER}\npeople-admin`, {
        identity: { identityIssuer: ISSUER, subject: "people-admin" },
      }]]),
    });
    expect((await authRequest(bff, "/admin/apps/cas_one/people", cookie)).status).toBe(200);
    expect((await authRequest(bff, "/admin/apps/cas_one/people?authority=platform.admin", cookie)).status).toBe(400);
    repo.grant(ISSUER, "people-admin");
    expect((await authRequest(bff, "/admin/platform/people", cookie)).status).toBe(403);
    expect((await authRequest(bff, "/admin/apps/cas_one/people", cookie)).status).toBe(200);
  }, 10000);

  test("retired Principal-keyed platform routes return 404", async () => {
    const provider = await createMockProvider();
    const repo = new MemoryPlatformAccessRepository();
    const { bff, cookie, csrf } = await signInWithAdmin(provider, repo, "admin-user");

    for (const [method, path] of [
      ["GET", "/admin/platform/access-summary"],
      ["GET", "/admin/platform/principals"],
      ["GET", "/admin/platform/principals/prn_1"],
      ["GET", "/admin/platform/principals/prn_1/access"],
      ["PATCH", "/admin/platform/principals/prn_1/access"],
    ] as const) {
      const response = await authRequest(bff, path, cookie, {
        method,
        headers: method === "PATCH" ? { "X-CSRF-Token": csrf } : undefined,
      });
      expect(response.status).toBe(404);
    }
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
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
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
      account: { displayName: "External User", blockedAt: null, platformAuthorities: ["apps.create"] },
      authenticatedIdentity: { provider: "google", currentLogin: true },
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

    const login = await bff(new Request(`${PUBLIC_ORIGIN}/admin/auth/start/google?returnTo=/admin/`));
    const preLoginCookie = cookieFrom(login)!;
    const location = new URL(login.headers.get("Location")!);
    const state = location.searchParams.get("state")!;
    provider.pendingClaims = {
      iss: ISSUER, sub: "non-admin-user", aud: CLIENT_ID,
      nonce: location.searchParams.get("nonce")!, email: "nonadmin@example.com",
      email_verified: true, name: "Non Admin",
    };
    const callback = await bff(new Request(
      `${PUBLIC_ORIGIN}/admin/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: preLoginCookie } },
    ));
    const cookie = cookieFrom(callback)!;

    for (const path of [
      "/admin/platform/accounts",
      "/admin/platform/invitations",
      "/admin/platform/audit-events",
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
  const create = await authRequest(bff, "/admin/apps", cookie, {
    method: "POST",
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const body = await create.json();
  if (create.status !== 201) throw new Error(`createApp failed: ${JSON.stringify(body)}`);
  return body.appId;
}
