import { describe, expect, test, vi } from "vitest";
import {
  AccountService,
  type AccountRecord,
  type AccountRepository,
  type ExternalIdentityRecord,
} from "../src/index.js";

const accountId = `acct_${"a".repeat(22)}`;
const identity: ExternalIdentityRecord = {
  externalIdentityId: "ext-alice",
  accountId,
  provider: "google",
  issuer: "https://accounts.google.com",
  subject: "alice",
  linkedAt: 1,
  lastAuthenticatedAt: 2,
  unlinkedAt: null,
  accountHint: null,
  displayName: null,
  avatarUrl: null,
};
const account: AccountRecord = {
  accountId,
  blockedAt: null,
  credentialVersion: 3,
  primaryVerifiedEmail: null,
  createdAt: 1,
  updatedAt: 2,
};

function fixture() {
  const repository: AccountRepository = {
    getAccount: vi.fn(async requested => requested === accountId ? account : null),
    getAliasTarget: vi.fn(async () => null),
    getActiveIdentity: vi.fn(async (issuer, subject) => issuer === identity.issuer && subject === identity.subject ? identity : null),
    getIdentity: vi.fn(async externalIdentityId => externalIdentityId === identity.externalIdentityId ? identity : null),
    getProfile: vi.fn(async () => ({
      accountId,
      displayName: "Alice Example",
      avatarUrl: null,
      displayNameSource: "user",
      avatarSource: "user",
      updatedAt: 2,
    })),
    listActiveIdentities: vi.fn(async () => [identity]),
    listPlatformAuthorities: vi.fn(async () => ["apps.create"]),
    hasAppMembership: vi.fn(async () => false),
    listAccountMembershipAppIds: vi.fn(async () => []),
    readControlSnapshot: vi.fn(async () => 1),
    listAppMemberships: vi.fn(async () => []),
    commitRemoveAppMembership: vi.fn(async () => "removed"),
    getPlatformAccount: vi.fn(async () => null),
    listPlatformAccounts: vi.fn(async () => []),
    commitPlatformAuthority: vi.fn(async () => "updated"),
    commitPlatformBlock: vi.fn(async () => "updated"),
    createAccountWithIdentity: vi.fn(async () => "created"),
    commitLinkIdentity: vi.fn(async () => "linked"),
    commitUnlinkIdentity: vi.fn(async () => "unlinked"),
    updateProfile: vi.fn(async () => "updated"),
  };
  return { repository, service: new AccountService(repository, () => 1000) };
}

describe("Account service", () => {
  test("resolves an exact active identity without using email", async () => {
    const { repository, service } = fixture();
    await expect(service.resolveExternalIdentity(identity.issuer, identity.subject)).resolves.toMatchObject({
      account,
      authenticatedIdentity: identity,
      platformAuthorities: ["apps.create"],
      hasAppMembership: false,
    });
    await expect(service.resolveExternalIdentity(identity.issuer, "unknown")).resolves.toBeNull();
    expect(repository.getActiveIdentity).toHaveBeenCalledWith(identity.issuer, identity.subject);
  });

  test("rejects blocked Accounts and stale credential versions", async () => {
    const { repository, service } = fixture();
    await expect(service.authorizeCredential({
      accountId,
      externalIdentityId: identity.externalIdentityId,
      credentialVersion: 2,
    })).rejects.toMatchObject({ code: "CREDENTIAL_VERSION_MISMATCH" });
    vi.mocked(repository.getAccount).mockResolvedValue({ ...account, blockedAt: 10 });
    await expect(service.authorizeCredential({
      accountId,
      externalIdentityId: identity.externalIdentityId,
      credentialVersion: 3,
    })).rejects.toMatchObject({ code: "ACCOUNT_BLOCKED" });
  });

  test("rejects missing, unlinked, and cross-Account credential identities", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.getIdentity).mockResolvedValue(null);
    await expect(service.authorizeCredential({ accountId, externalIdentityId: "missing", credentialVersion: 3 }))
      .rejects.toMatchObject({ code: "IDENTITY_NOT_FOUND" });
    vi.mocked(repository.getIdentity).mockResolvedValue({ ...identity, unlinkedAt: 5 });
    await expect(service.authorizeCredential({ accountId, externalIdentityId: identity.externalIdentityId, credentialVersion: 3 }))
      .rejects.toMatchObject({ code: "IDENTITY_NOT_FOUND" });
    vi.mocked(repository.getIdentity).mockResolvedValue({ ...identity, accountId: `acct_${"b".repeat(22)}` });
    await expect(service.authorizeCredential({ accountId, externalIdentityId: identity.externalIdentityId, credentialVersion: 3 }))
      .rejects.toMatchObject({ code: "IDENTITY_ACCOUNT_MISMATCH" });
  });

  test("selects only an active identity owned by the requested Account", async () => {
    const { repository, service } = fixture();
    await expect(service.requireActiveIdentity(accountId, identity.externalIdentityId)).resolves.toBe(identity);
    vi.mocked(repository.getIdentity).mockResolvedValue({ ...identity, unlinkedAt: 5 });
    await expect(service.requireActiveIdentity(accountId, identity.externalIdentityId))
      .rejects.toMatchObject({ code: "IDENTITY_NOT_FOUND" });
  });

  test("projects self Account data and field-level profile updates", async () => {
    const { repository, service } = fixture();
    await expect(service.getSelf(accountId, identity.externalIdentityId, ["google", "github"]))
      .resolves.toMatchObject({
        accountId,
        displayName: "Alice Example",
        avatar: { kind: "fallback", initials: "AE" },
        identities: [{ externalIdentityId: identity.externalIdentityId, currentLogin: true }],
        platformAuthorities: ["apps.create"],
        linkableProviders: ["github"],
      });
    await service.updateProfile({ accountId, displayName: "Updated" });
    expect(repository.updateProfile).toHaveBeenCalledWith({ accountId, displayName: "Updated", now: 1000 });
  });

  test("lists and removes App members only by stable Account ID", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.hasAppMembership).mockResolvedValue(true);
    vi.mocked(repository.listAppMemberships).mockResolvedValue([{
      appId: "cas_app_a",
      account,
      profile: {
        accountId,
        displayName: "Alice Example",
        avatarUrl: null,
        displayNameSource: "user",
        avatarSource: "user",
        updatedAt: 2,
      },
      joinedAt: 3,
    }]);

    await expect(service.listAppMembers({ actorAccountId: accountId, appId: "cas_app_a" }))
      .resolves.toMatchObject({
        items: [{ appId: "cas_app_a", account: { accountId, displayName: "Alice Example" } }],
        nextCursor: null,
      });
    await service.removeAppMember({
      actorAccountId: accountId,
      actorExternalIdentityId: identity.externalIdentityId,
      appId: "cas_app_a",
      targetAccountId: accountId,
    });
    expect(repository.commitRemoveAppMembership).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: accountId,
      targetAccountId: accountId,
      appId: "cas_app_a",
    }));

    vi.mocked(repository.commitRemoveAppMembership).mockResolvedValue("last-member");
    await expect(service.removeAppMember({
      actorAccountId: accountId,
      actorExternalIdentityId: identity.externalIdentityId,
      appId: "cas_app_a",
      targetAccountId: accountId,
    })).rejects.toMatchObject({ code: "LAST_MEMBER" });
  });

  test("projects current memberships with one Account summary", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.listAccountMembershipAppIds).mockResolvedValue(["cas_app_a", "cas_app_b"]);
    await expect(service.listAccountMemberships(accountId)).resolves.toEqual([
      expect.objectContaining({ appId: "cas_app_a", account: expect.objectContaining({ accountId }) }),
      expect.objectContaining({ appId: "cas_app_b", account: expect.objectContaining({ accountId }) }),
    ]);
  });

  test("projects platform Accounts and guards authority and block commands", async () => {
    const { repository, service } = fixture();
    const platformRecord = {
      account,
      profile: {
        accountId,
        displayName: "Alice Example",
        avatarUrl: null,
        displayNameSource: "user",
        avatarSource: "user",
        updatedAt: 2,
      },
      platformAuthorities: ["platform.admin" as const],
      appMembershipCount: 1,
      lastActiveAt: 10,
    };
    vi.mocked(repository.listPlatformAuthorities).mockResolvedValue(["platform.admin"]);
    vi.mocked(repository.listPlatformAccounts).mockResolvedValue([platformRecord]);
    vi.mocked(repository.getPlatformAccount).mockResolvedValue(platformRecord);

    await expect(service.listPlatformAccounts({ actorAccountId: accountId }))
      .resolves.toMatchObject({ items: [{ accountId, effectiveAccess: "active" }] });
    await expect(service.getPlatformAccount(accountId, accountId))
      .resolves.toMatchObject({ accountId, memberships: [] });
    await service.setPlatformAuthority({
      actorAccountId: accountId,
      actorExternalIdentityId: identity.externalIdentityId,
      targetAccountId: accountId,
      authority: "apps.create",
      grant: true,
    });
    await service.setPlatformBlocked({
      actorAccountId: accountId,
      actorExternalIdentityId: identity.externalIdentityId,
      targetAccountId: `acct_${"b".repeat(22)}`,
      blocked: true,
    });
    vi.mocked(repository.commitPlatformAuthority).mockResolvedValue("last-admin");
    await expect(service.setPlatformAuthority({
      actorAccountId: accountId,
      actorExternalIdentityId: identity.externalIdentityId,
      targetAccountId: accountId,
      authority: "platform.admin",
      grant: false,
    })).rejects.toMatchObject({ code: "LAST_PLATFORM_ADMIN" });
    vi.mocked(repository.commitPlatformBlock).mockResolvedValue("self-block");
    await expect(service.setPlatformBlocked({
      actorAccountId: accountId,
      actorExternalIdentityId: identity.externalIdentityId,
      targetAccountId: accountId,
      blocked: true,
    })).rejects.toMatchObject({ code: "SELF_BLOCK_FORBIDDEN" });
  });

  test("fails closed on alias cycles and excessive depth", async () => {
    const { repository, service } = fixture();
    const aliasAccountId = `acct_${"b".repeat(22)}`;
    vi.mocked(repository.getAccount).mockImplementation(async requested => ({ ...account, accountId: requested }));
    vi.mocked(repository.getAliasTarget).mockImplementation(async requested => requested === accountId ? aliasAccountId : accountId);
    await expect(service.resolveExternalIdentity(identity.issuer, identity.subject))
      .rejects.toMatchObject({ code: "ACCOUNT_ALIAS_INVALID" });
  });

  test("atomically creates a new Account without inferring primary email", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.getActiveIdentity).mockImplementation(async (issuer, subject) => {
      const create = vi.mocked(repository.createAccountWithIdentity).mock.calls[0]?.[0];
      return create && issuer === create.identity.issuer && subject === create.identity.subject
        ? create.identity : null;
    });
    vi.mocked(repository.getAccount).mockImplementation(async requested => {
      const create = vi.mocked(repository.createAccountWithIdentity).mock.calls[0]?.[0];
      return create?.account.accountId === requested ? create.account : null;
    });
    const resolution = await service.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "9482173",
      displayName: "Alex",
    });
    expect(resolution.account.primaryVerifiedEmail).toBeNull();
    expect(resolution.account.accountId).toMatch(/^acct_[A-Za-z0-9_-]{22}$/);
    expect(repository.createAccountWithIdentity).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({ provider: "github", subject: "9482173" }),
    }));
  });

  test("does not convert an existing identity into a second Account", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.createAccountWithIdentity).mockResolvedValue("identity-conflict");
    await expect(service.createForExternalIdentity({
      provider: "google",
      issuer: identity.issuer,
      subject: identity.subject,
    })).rejects.toMatchObject({ code: "IDENTITY_LINK_CONFLICT" });
  });

  test("links an unowned fresh identity and increments credential generation", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.getAccount).mockImplementation(async requested => requested === accountId
      ? { ...account, credentialVersion: vi.mocked(repository.commitLinkIdentity).mock.calls.length > 0 ? 4 : 3 }
      : null);
    const result = await service.linkExternalIdentity({
      accountId,
      currentExternalIdentityId: identity.externalIdentityId,
      credentialVersion: 3,
      currentAuthenticatedAt: 950,
      target: {
        provider: "github",
        issuer: "https://github.com",
        subject: "42",
        displayName: "Alice",
        avatarUrl: null,
        accountHint: "alice",
        verifiedEmailEvidence: [],
        authenticatedAt: 975,
        authenticationEventId: "target-auth",
      },
    });
    expect(repository.commitLinkIdentity).toHaveBeenCalledWith(expect.objectContaining({
      accountId,
      expectedCredentialVersion: 3,
      identity: expect.objectContaining({ provider: "github", subject: "42" }),
    }));
    expect(result.account.credentialVersion).toBe(4);
  });

  test("rejects stale proof and identities owned by another Account", async () => {
    const { repository, service } = fixture();
    const target = {
      provider: "github" as const,
      issuer: "https://github.com",
      subject: "42",
      displayName: null,
      avatarUrl: null,
      accountHint: null,
      verifiedEmailEvidence: [],
      authenticatedAt: 975,
      authenticationEventId: "target-auth",
    };
    await expect(service.linkExternalIdentity({
      accountId,
      currentExternalIdentityId: identity.externalIdentityId,
      credentialVersion: 3,
      currentAuthenticatedAt: -600_000,
      target,
    })).rejects.toMatchObject({ code: "FRESH_AUTHENTICATION_REQUIRED" });
    vi.mocked(repository.getActiveIdentity).mockResolvedValue({
      ...identity,
      accountId: `acct_${"b".repeat(22)}`,
      issuer: target.issuer,
      subject: target.subject,
    });
    await expect(service.linkExternalIdentity({
      accountId,
      currentExternalIdentityId: identity.externalIdentityId,
      credentialVersion: 3,
      currentAuthenticatedAt: 950,
      target,
    })).rejects.toMatchObject({ code: "IDENTITY_LINK_CONFLICT" });
  });

  test("unlinks only with a fresh different remaining identity", async () => {
    const { repository, service } = fixture();
    const remaining = { ...identity, externalIdentityId: "ext-remaining", provider: "github" as const };
    vi.mocked(repository.getIdentity).mockImplementation(async id => id === remaining.externalIdentityId ? remaining : identity);
    vi.mocked(repository.getActiveIdentity).mockImplementation(async (issuer, subject) =>
      issuer === remaining.issuer && subject === remaining.subject ? remaining : identity);
    vi.mocked(repository.getAccount).mockImplementation(async requested => requested === accountId
      ? { ...account, credentialVersion: vi.mocked(repository.commitUnlinkIdentity).mock.calls.length > 0 ? 4 : 3 }
      : null);
    await expect(service.unlinkExternalIdentity({
      accountId,
      credentialVersion: 3,
      targetExternalIdentityId: identity.externalIdentityId,
      remainingExternalIdentityId: remaining.externalIdentityId,
      remainingAuthenticatedAt: 975,
    })).resolves.toMatchObject({ account: { credentialVersion: 4 }, authenticatedIdentity: remaining });
    vi.mocked(repository.commitUnlinkIdentity).mockResolvedValue("final-identity");
    await expect(service.unlinkExternalIdentity({
      accountId,
      credentialVersion: 4,
      targetExternalIdentityId: remaining.externalIdentityId,
      remainingExternalIdentityId: identity.externalIdentityId,
      remainingAuthenticatedAt: 975,
    })).rejects.toMatchObject({ code: "FINAL_IDENTITY_CANNOT_BE_UNLINKED" });
  });
});