import { describe, expect, test } from "vitest";
import {
  AccountServiceError,
  PlatformInvitationService,
  type AccountService,
  type PlatformInvitationActor,
  type PlatformInvitationIdempotencyRecord,
  type PlatformInvitationRepository,
  type StoredPlatformInvitation,
} from "../src/index.js";

const admin: PlatformInvitationActor = {
  accountId: "acct_aaaaaaaaaaaaaaaaaaaaaa",
  externalIdentityId: "ext_admin",
};
const invitee: PlatformInvitationActor = {
  accountId: "acct_bbbbbbbbbbbbbbbbbbbbbb",
  externalIdentityId: "ext_invitee",
};

class MemoryRepository implements PlatformInvitationRepository {
  snapshot = 0;
  readonly invitations = new Map<string, StoredPlatformInvitation>();
  readonly idempotency = new Map<string, PlatformInvitationIdempotencyRecord>();
  readonly authorities = new Map([[admin.accountId, new Set(["platform.admin" as const])]]);
  readonly activeIdentities = new Map([
    [admin.externalIdentityId, admin.accountId],
    [invitee.externalIdentityId, invitee.accountId],
  ]);
  readonly auditActions: string[] = [];

  async readSnapshot() { return this.snapshot; }

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
    const record = this.idempotency.get(`${input.actorAccountId}\0${input.key}`) ?? null;
    return record && record.expiresAt > input.now ? record : null;
  }

  async commitCreateInvitation(input: Parameters<PlatformInvitationRepository["commitCreateInvitation"]>[0]) {
    if (!this.#isAdmin(input.actor)) return "actor-forbidden" as const;
    const idempotencyKey = `${input.actor.accountId}\0${input.idempotency.key}`;
    if (this.idempotency.has(idempotencyKey)) return "idempotency-conflict" as const;
    this.invitations.set(input.invitation.invitationId, input.invitation);
    this.idempotency.set(idempotencyKey, input.idempotency);
    this.auditActions.push("platform_invitation.created");
    this.snapshot += 1;
    return "created" as const;
  }

  async commitRevokeInvitation(input: Parameters<PlatformInvitationRepository["commitRevokeInvitation"]>[0]) {
    if (!this.#isAdmin(input.actor)) return "actor-forbidden" as const;
    const invitation = this.invitations.get(input.invitationId);
    if (!invitation) return "not-found" as const;
    if (invitation.revision !== input.expectedRevision) return "revision-mismatch" as const;
    if (invitation.status !== "pending" || invitation.expiresAt <= input.now) return "not-pending" as const;
    this.invitations.set(input.invitationId, { ...invitation, status: "revoked", revision: invitation.revision + 1 });
    this.auditActions.push("platform_invitation.revoked");
    this.snapshot += 1;
    return "updated" as const;
  }

  async commitAcceptInvitation(input: Parameters<PlatformInvitationRepository["commitAcceptInvitation"]>[0]) {
    const invitation = this.invitations.get(input.invitation.invitationId);
    if (this.activeIdentities.get(input.actor.externalIdentityId) !== input.actor.accountId) {
      return "account-unavailable" as const;
    }
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= input.now
      || invitation.tokenHash !== input.tokenHash) {
      return "not-pending" as const;
    }
    const authorities = this.authorities.get(input.actor.accountId) ?? new Set();
    for (const authority of invitation.authorities) authorities.add(authority);
    this.authorities.set(input.actor.accountId, authorities);
    this.invitations.set(invitation.invitationId, { ...invitation, status: "accepted", revision: invitation.revision + 1 });
    this.auditActions.push("platform_invitation.accepted");
    this.snapshot += 1;
    return "accepted" as const;
  }

  #isAdmin(actor: PlatformInvitationActor): boolean {
    return this.activeIdentities.get(actor.externalIdentityId) === actor.accountId
      && this.authorities.get(actor.accountId)?.has("platform.admin") === true;
  }
}

function fixture() {
  const repository = new MemoryRepository();
  const accounts = {
    async requireActiveIdentity(accountId: string, externalIdentityId: string) {
      if (repository.activeIdentities.get(externalIdentityId) !== accountId) {
        throw new AccountServiceError("IDENTITY_ACCOUNT_MISMATCH");
      }
      return {};
    },
    async requirePlatformAuthority(accountId: string, authority: "platform.admin" | "apps.create") {
      if (!repository.authorities.get(accountId)?.has(authority)) {
        throw new AccountServiceError("PLATFORM_ADMIN_REQUIRED");
      }
    },
  } as unknown as AccountService;
  let invitationNumber = 0;
  let tokenNumber = 0;
  const service = new PlatformInvitationService(
    repository,
    accounts,
    { seal: async token => `sealed:${token}`, open: async sealed => sealed.slice("sealed:".length) },
    {
      now: () => 1000,
      invitationTtlMs: 1000,
      generateInvitationId: () => `invitation-${++invitationNumber}`,
      generateInvitationToken: () => `${++tokenNumber}`.padStart(32, "t"),
      generateEventId: () => `event-${repository.auditActions.length + 1}`,
    },
  );
  return { repository, service };
}

describe("platform invitation service", () => {
  test("creates a normalized sealed invitation and safely replays exact idempotency", async () => {
    const { repository, service } = fixture();
    const input = { emailConstraint: " Developer@Example.com ", authorities: ["apps.create", "platform.admin"] };
    const created = await service.create(admin, input, "create-1", "request-1");
    const replay = await service.create(admin, { ...input, emailConstraint: "developer@example.com" }, "create-1", "request-2");

    expect(replay).toEqual(created);
    expect(created.acceptUrl).toMatch(/^\/admin\/platform-invitations\/[A-Za-z0-9_-]{32}$/);
    expect(repository.invitations.get(created.invitationId)).toMatchObject({
      emailConstraint: "developer@example.com",
      authorities: ["platform.admin", "apps.create"],
      createdByAccountId: admin.accountId,
    });
    expect([...repository.idempotency.values()][0]?.sealedToken).toMatch(/^sealed:/);
    expect(repository.auditActions).toEqual(["platform_invitation.created"]);
    await expect(service.create(admin, { ...input, authorities: ["apps.create"] }, "create-1"))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("lists without bearer data and binds continuation cursors to filters", async () => {
    const { service } = fixture();
    await service.create(admin, { emailConstraint: "a@example.com", authorities: ["apps.create"] }, "a");
    await service.create(admin, { emailConstraint: "b@example.com", authorities: ["platform.admin"] }, "b");

    const first = await service.list(admin.accountId, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(first)).not.toMatch(/token|acceptUrl|sealed/i);
    await expect(service.list(admin.accountId, { limit: 1, status: "pending", cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
    const second = await service.list(admin.accountId, { limit: 1, cursor: first.nextCursor });
    expect(second.items[0]?.invitationId).not.toBe(first.items[0]?.invitationId);
    await service.create(admin, { emailConstraint: "c@example.com", authorities: ["apps.create"] }, "c");
    await expect(service.list(admin.accountId, { limit: 1, cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  test("revokes conditionally and treats a current revoked ETag as a no-op", async () => {
    const { repository, service } = fixture();
    const created = await service.create(admin, { emailConstraint: "a@example.com", authorities: ["apps.create"] }, "a");
    await expect(service.revoke(admin, created.invitationId, undefined)).rejects.toMatchObject({ code: "PRECONDITION_REQUIRED" });
    await expect(service.revoke(admin, created.invitationId, '"9"')).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    await expect(service.revoke(admin, created.invitationId, '"1"')).resolves.toEqual({ revision: 2 });
    await expect(service.revoke(admin, created.invitationId, '"2"')).resolves.toEqual({ revision: 2 });
    expect(repository.auditActions.filter(action => action === "platform_invitation.revoked")).toHaveLength(1);
  });

  test("accepts matching verified email into the stable Account and rejects inactive identities", async () => {
    const { repository, service } = fixture();
    const created = await service.create(admin, { emailConstraint: "invitee@example.com", authorities: ["apps.create"] }, "a");
    const token = created.acceptUrl.split("/")[3]!;
    const evidence = (email: string) => [{
      normalizedEmail: email,
      source: "google-oidc" as const,
      verifiedAt: 900,
      expiresAt: 2_000,
      authenticationEventId: "auth-invitee",
    }];
    await expect(service.accept(invitee, evidence("other@example.com"), token))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await service.accept(invitee, evidence("invitee@example.com"), token);
    expect(repository.authorities.get(invitee.accountId)).toEqual(new Set(["apps.create"]));

    repository.activeIdentities.delete(invitee.externalIdentityId);
    const next = await service.create(admin, { emailConstraint: "invitee@example.com", authorities: ["platform.admin"] }, "b");
    await expect(service.accept(invitee, evidence("invitee@example.com"), next.acceptUrl.split("/")[3]!))
      .rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
  });
});

function projectExpiry(invitation: StoredPlatformInvitation, now: number): StoredPlatformInvitation {
  return invitation.status === "pending" && invitation.expiresAt <= now ? { ...invitation, status: "expired" } : invitation;
}