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
    listPlatformAuthorities: vi.fn(async () => ["apps.create"]),
    hasAppMembership: vi.fn(async () => false),
    createAccountWithIdentity: vi.fn(async () => "created"),
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
});