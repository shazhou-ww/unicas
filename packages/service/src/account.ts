import type {
  AccountId,
  PlatformAuthority,
  PrimaryVerifiedEmail,
  ProviderKind,
} from "@unicas/admin-protocol";
import { generateAccountId, generateExternalIdentityId } from "./control-ids.js";

const MAX_ALIAS_DEPTH = 8;

export interface AccountRecord {
  readonly accountId: AccountId;
  readonly blockedAt: number | null;
  readonly credentialVersion: number;
  readonly primaryVerifiedEmail: PrimaryVerifiedEmail | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AccountProfileRecord {
  readonly accountId: AccountId;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly displayNameSource: "user" | string | null;
  readonly avatarSource: "user" | string | null;
  readonly updatedAt: number;
}

export interface ExternalIdentityRecord {
  readonly externalIdentityId: string;
  readonly accountId: AccountId;
  readonly provider: ProviderKind;
  readonly issuer: string;
  readonly subject: string;
  readonly linkedAt: number;
  readonly lastAuthenticatedAt: number | null;
  readonly unlinkedAt: number | null;
}

export interface AccountWithIdentityCreate {
  readonly account: AccountRecord;
  readonly profile: AccountProfileRecord;
  readonly identity: ExternalIdentityRecord;
}

export interface AccountRepository {
  getAccount(accountId: AccountId): Promise<AccountRecord | null>;
  getAliasTarget(sourceAccountId: AccountId): Promise<AccountId | null>;
  getActiveIdentity(issuer: string, subject: string): Promise<ExternalIdentityRecord | null>;
  getIdentity(externalIdentityId: string): Promise<ExternalIdentityRecord | null>;
  listPlatformAuthorities(accountId: AccountId): Promise<readonly PlatformAuthority[]>;
  hasAppMembership(accountId: AccountId): Promise<boolean>;
  createAccountWithIdentity(input: AccountWithIdentityCreate): Promise<"created" | "identity-conflict">;
}

export interface AccountCreateInput {
  readonly provider: ProviderKind;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName?: string | null;
  readonly avatarUrl?: string | null;
}

export interface AccountResolution {
  readonly account: AccountRecord;
  readonly authenticatedIdentity: ExternalIdentityRecord;
  readonly platformAuthorities: readonly PlatformAuthority[];
  readonly hasAppMembership: boolean;
}

export type AccountServiceErrorCode =
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_BLOCKED"
  | "ACCOUNT_ALIAS_INVALID"
  | "CREDENTIAL_VERSION_MISMATCH"
  | "IDENTITY_NOT_FOUND"
  | "IDENTITY_ACCOUNT_MISMATCH"
  | "IDENTITY_LINK_CONFLICT";

export class AccountServiceError extends Error {
  constructor(readonly code: AccountServiceErrorCode) {
    super(code);
    this.name = "AccountServiceError";
  }
}

export class AccountService {
  constructor(
    readonly repository: AccountRepository,
    readonly now: () => number = Date.now,
  ) { }

  async createForExternalIdentity(input: AccountCreateInput): Promise<AccountResolution> {
    const timestamp = this.now();
    const accountId = generateAccountId();
    const externalIdentityId = generateExternalIdentityId();
    const result = await this.repository.createAccountWithIdentity({
      account: {
        accountId,
        blockedAt: null,
        credentialVersion: 1,
        primaryVerifiedEmail: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      profile: {
        accountId,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        displayNameSource: input.displayName ? externalIdentityId : null,
        avatarSource: input.avatarUrl ? externalIdentityId : null,
        updatedAt: timestamp,
      },
      identity: {
        externalIdentityId,
        accountId,
        provider: input.provider,
        issuer: input.issuer,
        subject: input.subject,
        linkedAt: timestamp,
        lastAuthenticatedAt: timestamp,
        unlinkedAt: null,
      },
    });
    if (result === "identity-conflict") throw new AccountServiceError("IDENTITY_LINK_CONFLICT");
    return this.resolveExternalIdentity(input.issuer, input.subject).then(resolution => {
      if (resolution === null) throw new AccountServiceError("IDENTITY_NOT_FOUND");
      return resolution;
    });
  }

  async resolveExternalIdentity(issuer: string, subject: string): Promise<AccountResolution | null> {
    const identity = await this.repository.getActiveIdentity(issuer, subject);
    if (identity === null) return null;
    const account = await this.#resolveCanonicalAccount(identity.accountId);
    this.#requireUsableAccount(account);
    return {
      account,
      authenticatedIdentity: identity,
      platformAuthorities: await this.repository.listPlatformAuthorities(account.accountId),
      hasAppMembership: await this.repository.hasAppMembership(account.accountId),
    };
  }

  async authorizeCredential(input: {
    readonly accountId: AccountId;
    readonly externalIdentityId: string;
    readonly credentialVersion: number;
  }): Promise<AccountResolution> {
    const account = await this.#resolveCanonicalAccount(input.accountId);
    this.#requireUsableAccount(account);
    if (account.credentialVersion !== input.credentialVersion) {
      throw new AccountServiceError("CREDENTIAL_VERSION_MISMATCH");
    }
    const identity = await this.repository.getIdentity(input.externalIdentityId);
    if (identity === null || identity.unlinkedAt !== null) {
      throw new AccountServiceError("IDENTITY_NOT_FOUND");
    }
    if (identity.accountId !== input.accountId) {
      throw new AccountServiceError("IDENTITY_ACCOUNT_MISMATCH");
    }
    return {
      account,
      authenticatedIdentity: identity,
      platformAuthorities: await this.repository.listPlatformAuthorities(account.accountId),
      hasAppMembership: await this.repository.hasAppMembership(account.accountId),
    };
  }

  async #resolveCanonicalAccount(initialAccountId: AccountId): Promise<AccountRecord> {
    let accountId = initialAccountId;
    const visited = new Set<AccountId>();
    for (let depth = 0; depth <= MAX_ALIAS_DEPTH; depth += 1) {
      if (visited.has(accountId)) throw new AccountServiceError("ACCOUNT_ALIAS_INVALID");
      visited.add(accountId);
      const account = await this.repository.getAccount(accountId);
      if (account === null) throw new AccountServiceError("ACCOUNT_NOT_FOUND");
      const target = await this.repository.getAliasTarget(accountId);
      if (target === null) return account;
      accountId = target;
    }
    throw new AccountServiceError("ACCOUNT_ALIAS_INVALID");
  }

  #requireUsableAccount(account: AccountRecord): void {
    if (account.blockedAt !== null) throw new AccountServiceError("ACCOUNT_BLOCKED");
  }
}