import { describe, expect, test } from "vitest";
import type { PlatformAccessState, PlatformPrincipal, Principal } from "@unicas/admin-protocol";
import {
  PlatformAccessService,
  PlatformInvitationService,
  type PlatformAccessRepository,
  type PlatformAuditRecord,
  type PlatformInvitationIdempotencyRecord,
  type PlatformInvitationRepository,
  type StoredPlatformInvitation,
} from "../src/index.js";

const actor = { issuer: "https://accounts.example", subject: "admin" };
const invitee = { issuer: "https://accounts.example", subject: "invitee" };

class MemoryRepository implements PlatformAccessRepository, PlatformInvitationRepository {
  snapshot = 0;
  readonly states = new Map<string, PlatformAccessState>();
  readonly invitations = new Map<string, StoredPlatformInvitation>();
  readonly idempotency = new Map<string, PlatformInvitationIdempotencyRecord>();
  readonly audits: PlatformAuditRecord[] = [];

  constructor() {
    this.states.set(key(actor), state(actor, ["platform.admin"]));
  }

  async readSnapshot() { return this.snapshot; }

  async getAccess(principal: Principal) { return this.states.get(key(principal)) ?? null; }
  async hasMembership() { return false; }
  async getAppInvitationByTokenHash() { return null; }
  async getPrincipal(principalRef: string): Promise<PlatformPrincipal | null> {
    const current = [...this.states.values()].find(value => value.principalRef === principalRef);
    return current ? { ...current, profile: { displayName: null, emailForDisplay: null }, effectiveAccess: "active", appMembershipCount: 0 } : null;
  }
  async listPrincipals() { return []; }
  async getAccessSummary() { return { activePrincipalCount: 1, platformAdminCount: 1, appCreatorCount: 0, blockedPrincipalCount: 0 }; }
  async patchAccess() { return "updated" as const; }
  async appendAudit(event: PlatformAuditRecord) { this.audits.push(event); }

  async getInvitation(invitationId: string, now: number) {
    const invitation = this.invitations.get(invitationId) ?? null;
    return invitation ? projectExpiry(invitation, now) : null;
  }
  async getInvitationByTokenHash(tokenHash: string, now: number) {
    const invitation = [...this.invitations.values()].find(value => value.tokenHash === tokenHash) ?? null;
    return invitation ? projectExpiry(invitation, now) : null;
  }
  async listInvitations(input: Parameters<PlatformInvitationRepository["listInvitations"]>[0]) {
    return [...this.invitations.values()]
      .map(invitation => projectExpiry(invitation, input.now))
      .filter(invitation => invitation.invitationId > input.afterInvitationId)
      .filter(invitation => input.query === undefined || invitation.emailConstraint.includes(input.query))
      .filter(invitation => input.status === undefined || invitation.status === input.status)
      .sort((left, right) => left.invitationId.localeCompare(right.invitationId))
      .slice(0, input.limit);
  }
  async getInvitationIdempotency(input: Parameters<PlatformInvitationRepository["getInvitationIdempotency"]>[0]) {
    const record = this.idempotency.get(`${key(input.actor)}\0${input.key}`) ?? null;
    return record && record.expiresAt > input.now ? record : null;
  }
  async commitCreateInvitation(input: Parameters<PlatformInvitationRepository["commitCreateInvitation"]>[0]) {
    if (!this.states.get(key(input.actor))?.authorities.includes("platform.admin")) return "forbidden" as const;
    const idempotencyKey = `${key(input.actor)}\0${input.idempotency.key}`;
    if (this.idempotency.has(idempotencyKey)) return "idempotency-conflict" as const;
    this.invitations.set(input.invitation.invitationId, input.invitation);
    this.idempotency.set(idempotencyKey, input.idempotency);
    this.audits.push(input.audit);
    this.snapshot += 1;
    return "created" as const;
  }
  async commitRevokeInvitation(input: Parameters<PlatformInvitationRepository["commitRevokeInvitation"]>[0]) {
    if (!this.states.get(key(input.actor))?.authorities.includes("platform.admin")) return "forbidden" as const;
    const invitation = this.invitations.get(input.invitationId);
    if (!invitation) return "not-found" as const;
    if (invitation.revision !== input.expectedRevision) return "revision-mismatch" as const;
    if (invitation.status !== "pending" || invitation.expiresAt <= input.now) return "not-pending" as const;
    this.invitations.set(input.invitationId, { ...invitation, status: "revoked", revision: invitation.revision + 1 });
    this.audits.push(input.audit);
    this.snapshot += 1;
    return "updated" as const;
  }
  async commitAcceptInvitation(input: Parameters<PlatformInvitationRepository["commitAcceptInvitation"]>[0]) {
    const invitation = this.invitations.get(input.invitation.invitationId);
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= input.now || invitation.tokenHash !== input.tokenHash) {
      return "not-pending" as const;
    }
    const current = this.states.get(key(input.principal));
    if (current?.status === "blocked") return "blocked" as const;
    const authorities = (["platform.admin", "apps.create"] as const)
      .filter(authority => current?.authorities.includes(authority) || invitation.authorities.includes(authority));
    this.states.set(key(input.principal), current
      ? { ...current, authorities, revision: current.revision + 1, updatedAt: input.now }
      : { principalRef: input.principalRef, principal: input.principal, status: "active", authorities, revision: 1, createdAt: input.now, updatedAt: input.now });
    this.invitations.set(invitation.invitationId, { ...invitation, status: "accepted", revision: invitation.revision + 1 });
    this.audits.push(input.audit);
    this.snapshot += 1;
    return "accepted" as const;
  }
}

function fixture() {
  const repository = new MemoryRepository();
  let invitationNumber = 0;
  let tokenNumber = 0;
  const service = new PlatformInvitationService(
    repository,
    new PlatformAccessService(repository, () => 1000),
    { seal: async token => `sealed:${token}`, open: async sealed => sealed.slice("sealed:".length) },
    {
      now: () => 1000,
      invitationTtlMs: 1000,
      generateInvitationId: () => `invitation-${++invitationNumber}`,
      generateInvitationToken: () => `${++tokenNumber}`.padStart(32, "t"),
      generatePrincipalRef: () => "principal-invitee",
      generateEventId: () => `event-${repository.audits.length + 1}`,
    },
  );
  return { repository, service };
}

describe("platform invitation service", () => {
  test("creates a normalized sealed invitation and safely replays exact idempotency", async () => {
    const { repository, service } = fixture();
    const input = { emailConstraint: " Developer@Example.com ", authorities: ["apps.create", "platform.admin"] };
    const created = await service.create(actor, input, "create-1", "request-1");
    const replay = await service.create(actor, { ...input, emailConstraint: "developer@example.com" }, "create-1", "request-2");

    expect(replay).toEqual(created);
    expect(created.acceptUrl).toMatch(/^\/admin\/platform-invitations\/[A-Za-z0-9_-]{32}$/);
    expect(repository.invitations.get(created.invitationId)).toMatchObject({
      emailConstraint: "developer@example.com",
      authorities: ["platform.admin", "apps.create"],
    });
    expect(JSON.stringify(repository.invitations)).not.toContain(created.acceptUrl.split("/")[3]);
    expect([...repository.idempotency.values()][0]?.sealedToken).toMatch(/^sealed:/);
    expect(repository.audits).toHaveLength(1);
    await expect(service.create(actor, { ...input, authorities: ["apps.create"] }, "create-1"))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("lists without bearer data and binds continuation cursors to filters", async () => {
    const { service } = fixture();
    await service.create(actor, { emailConstraint: "a@example.com", authorities: ["apps.create"] }, "a");
    await service.create(actor, { emailConstraint: "b@example.com", authorities: ["platform.admin"] }, "b");

    const first = await service.list(actor, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(first)).not.toMatch(/token|acceptUrl|sealed/i);
    await expect(service.list(actor, { limit: 1, status: "pending", cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
    const second = await service.list(actor, { limit: 1, cursor: first.nextCursor });
    expect(second.items[0]?.invitationId).not.toBe(first.items[0]?.invitationId);
    await service.create(actor, { emailConstraint: "c@example.com", authorities: ["apps.create"] }, "c");
    await expect(service.list(actor, { limit: 1, cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  test("revokes conditionally and treats a current revoked ETag as a no-op", async () => {
    const { repository, service } = fixture();
    const created = await service.create(actor, { emailConstraint: "a@example.com", authorities: ["apps.create"] }, "a");
    await expect(service.revoke(actor, created.invitationId, undefined)).rejects.toMatchObject({ code: "PRECONDITION_REQUIRED" });
    await expect(service.revoke(actor, created.invitationId, '"9"')).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    await expect(service.revoke(actor, created.invitationId, '"1"')).resolves.toEqual({ revision: 2 });
    await expect(service.revoke(actor, created.invitationId, '"2"')).resolves.toEqual({ revision: 2 });
    expect(repository.audits.filter(event => event.action === "platform_invitation.revoked")).toHaveLength(1);
  });

  test("accepts matching verified email, unions authority, and rejects blocked Principals", async () => {
    const { repository, service } = fixture();
    const created = await service.create(actor, { emailConstraint: "invitee@example.com", authorities: ["apps.create"] }, "a");
    const token = created.acceptUrl.split("/")[3]!;
    const evidence = (email: string) => [{
      normalizedEmail: email,
      source: "google-oidc" as const,
      verifiedAt: 900,
      expiresAt: 2_000,
      authenticationEventId: "auth-invitee",
    }];
    await expect(service.authorizeLogin(invitee, evidence("other@example.com"), token))
      .rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
    await expect(service.authorizeLogin(invitee, evidence("invitee@example.com"), token)).resolves.toMatchObject({ invitationId: created.invitationId });
    await service.accept(invitee, { displayName: "Invitee", emailForDisplay: "invitee@example.com" }, evidence("invitee@example.com"), token);
    await expect(new PlatformAccessService(repository).requireAccess(invitee, "apps.create")).resolves.toBeTruthy();

    const blocked = { issuer: invitee.issuer, subject: "blocked" };
    repository.states.set(key(blocked), { ...state(blocked, []), status: "blocked" });
    const blockedInvite = await service.create(actor, { emailConstraint: "blocked@example.com", authorities: ["platform.admin"] }, "b");
    await expect(service.authorizeLogin(blocked, evidence("blocked@example.com"), blockedInvite.acceptUrl.split("/")[3]!))
      .rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
  });
});

function key(principal: Principal): string { return `${principal.issuer}\0${principal.subject}`; }
function state(principal: Principal, authorities: PlatformAccessState["authorities"]): PlatformAccessState {
  return { principalRef: `ref-${principal.subject}`, principal, status: "active", authorities, revision: 1, createdAt: 1, updatedAt: 1 };
}
function projectExpiry(invitation: StoredPlatformInvitation, now: number): StoredPlatformInvitation {
  return invitation.status === "pending" && invitation.expiresAt <= now ? { ...invitation, status: "expired" } : invitation;
}