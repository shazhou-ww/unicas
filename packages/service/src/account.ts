import type {
  AccountSelf,
  AccountId,
  AccountSummary,
  App,
  AppControlAuditEvent,
  AppId,
  AppMembership,
  PlatformAccountDetail,
  PlatformAccountListItem,
  PlatformAccountPage,
  PlatformAccountAuditEvent,
  PlatformAccountAuditPage,
  PlatformAuditAction,
  PlatformAuthority,
  PrimaryVerifiedEmail,
  ProviderKind,
} from "@unicas/admin-protocol";
import { AppAccountAuditQuerySchema, CAS_ADMIN_IDEMPOTENCY_RETENTION_MS, PlatformAccountAuditQuerySchema, PlatformPrincipalQuerySchema } from "@unicas/admin-protocol";
import { generateAccountId, generateEventId, generateExternalIdentityId, generateStackId } from "./control-ids.js";
import { decodeControlListCursor, encodeControlListCursor } from "./control-cursor.js";
import type { ControlOAuthIssuerRecord, ManagedOAuthIssuerProvisioner } from "./control-admin.js";
import { canonicalJson, sha256Hex, validateDisplayName } from "./control-validation.js";
import type { AuthenticatedProviderResult } from "./authentication.js";
import { AUTHENTICATION_FLOW_TTL_MS } from "./authentication.js";

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
  readonly accountHint: string | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

export interface AccountWithIdentityCreate {
  readonly account: AccountRecord;
  readonly profile: AccountProfileRecord;
  readonly identity: ExternalIdentityRecord;
}

export interface AccountAppMembershipRecord {
  readonly appId: AppId;
  readonly account: AccountRecord;
  readonly profile: AccountProfileRecord;
  readonly joinedAt: number;
}

export interface AccountAppIdempotencyRecord {
  readonly accountId: AccountId;
  readonly method: "POST";
  readonly canonicalRoute: "/admin/apps";
  readonly key: string;
  readonly payloadHash: string;
  readonly response: App;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface AccountPlatformViewRecord {
  readonly account: AccountRecord;
  readonly profile: AccountProfileRecord;
  readonly platformAuthorities: readonly PlatformAuthority[];
  readonly appMembershipCount: number;
  readonly lastActiveAt: number | null;
}

export interface AccountAuditActorRecord {
  readonly account: AccountRecord;
  readonly profile: AccountProfileRecord;
  readonly identity: ExternalIdentityRecord;
}

export interface AppAccountAuditRecord extends AccountAuditActorRecord {
  readonly eventId: string;
  readonly appId: AppId | null;
  readonly targetAccount: AccountRecord | null;
  readonly targetProfile: AccountProfileRecord | null;
  readonly action: string;
  readonly target: string;
  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly callerChannel: "admin-webui" | "mcp" | null;
  readonly oauthClientHandle: string | null;
  readonly toolName: string | null;
  readonly createdAt: number;
}

export interface PlatformAccountAuditRecord extends AccountAuditActorRecord {
  readonly eventId: string;
  readonly action: PlatformAuditAction;
  readonly targetAccount: AccountRecord | null;
  readonly targetProfile: AccountProfileRecord | null;
  readonly targetInvitationId: string | null;
  readonly result: "succeeded" | "denied";
  readonly requestId: string | null;
  readonly createdAt: number;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AccountRepository {
  getAccount(accountId: AccountId): Promise<AccountRecord | null>;
  getAliasTarget(sourceAccountId: AccountId): Promise<AccountId | null>;
  getActiveIdentity(issuer: string, subject: string): Promise<ExternalIdentityRecord | null>;
  getIdentity(externalIdentityId: string): Promise<ExternalIdentityRecord | null>;
  getProfile(accountId: AccountId): Promise<AccountProfileRecord | null>;
  listActiveIdentities(accountId: AccountId): Promise<readonly ExternalIdentityRecord[]>;
  listPlatformAuthorities(accountId: AccountId): Promise<readonly PlatformAuthority[]>;
  hasAppMembership(accountId: AccountId, appId?: AppId): Promise<boolean>;
  listAccountMembershipAppIds(accountId: AccountId): Promise<readonly AppId[]>;
  readControlSnapshot(): Promise<number>;
  listAccountApps(input: {
    readonly accountId: AccountId;
    readonly afterAppId: string;
    readonly limit: number;
  }): Promise<readonly App[]>;
  getAccountAppIdempotency(input: {
    readonly accountId: AccountId;
    readonly key: string;
    readonly now: number;
  }): Promise<AccountAppIdempotencyRecord | null>;
  commitCreateAccountApp(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly app: App;
    readonly managedIssuer: ControlOAuthIssuerRecord | null;
    readonly idempotency: AccountAppIdempotencyRecord | null;
    readonly eventId: string;
    readonly requestId?: string;
    readonly traceId?: string;
    readonly callerChannel?: string;
  }): Promise<"created" | "actor-forbidden" | { readonly idempotencyRace: AccountAppIdempotencyRecord }>;
  listAppMemberships(input: {
    readonly appId: AppId;
    readonly afterAccountId: string;
    readonly limit: number;
  }): Promise<readonly AccountAppMembershipRecord[]>;
  commitRemoveAppMembership(input: {
    readonly appId: AppId;
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly targetAccountId: AccountId;
    readonly eventId: string;
    readonly requestId?: string;
    readonly traceId?: string;
    readonly callerChannel?: string;
    readonly now: number;
  }): Promise<"removed" | "actor-not-member" | "last-member">;
  getPlatformAccount(accountId: AccountId): Promise<AccountPlatformViewRecord | null>;
  listPlatformAccounts(input: {
    readonly afterAccountId: string;
    readonly limit: number;
    readonly query?: string;
    readonly effectiveAccess?: "active" | "blocked" | "no_access";
    readonly authority?: PlatformAuthority | "none";
  }): Promise<readonly AccountPlatformViewRecord[]>;
  commitPlatformAuthority(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly targetAccountId: AccountId;
    readonly authority: PlatformAuthority;
    readonly grant: boolean;
    readonly eventId: string;
    readonly requestId?: string;
    readonly now: number;
  }): Promise<"updated" | "actor-forbidden" | "target-not-found" | "last-admin">;
  commitPlatformBlock(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly targetAccountId: AccountId;
    readonly blocked: boolean;
    readonly eventId: string;
    readonly requestId?: string;
    readonly now: number;
  }): Promise<"updated" | "actor-forbidden" | "target-not-found" | "self-block" | "last-admin">;
  getAppAuditEventPosition(appId: AppId, eventId: string): Promise<{ readonly createdAt: number; readonly eventId: string } | null>;
  listAppAccountAuditEvents(input: {
    readonly appId: AppId;
    readonly actorAccountId?: AccountId;
    readonly targetAccountId?: AccountId;
    readonly afterCreatedAt: number;
    readonly afterEventId: string;
    readonly limit: number;
  }): Promise<readonly AppAccountAuditRecord[]>;
  listPlatformAccountAuditEvents(input: {
    readonly action?: PlatformAuditAction;
    readonly actorAccountId?: AccountId;
    readonly targetAccountId?: AccountId;
    readonly createdAfter?: number;
    readonly beforeCreatedAt?: number;
    readonly beforeEventId?: string;
    readonly limit: number;
  }): Promise<readonly PlatformAccountAuditRecord[]>;
  createAccountWithIdentity(input: AccountWithIdentityCreate): Promise<"created" | "identity-conflict">;
  commitLinkIdentity(input: {
    readonly accountId: AccountId;
    readonly expectedCredentialVersion: number;
    readonly identity: ExternalIdentityRecord;
    readonly displayName: string | null;
    readonly avatarUrl: string | null;
    readonly now: number;
  }): Promise<"linked" | "identity-conflict" | "version-mismatch" | "blocked">;
  commitUnlinkIdentity(input: {
    readonly accountId: AccountId;
    readonly expectedCredentialVersion: number;
    readonly targetExternalIdentityId: string;
    readonly remainingExternalIdentityId: string;
    readonly now: number;
  }): Promise<"unlinked" | "not-found" | "final-identity" | "version-mismatch" | "blocked">;
  updateProfile(input: {
    readonly accountId: AccountId;
    readonly displayName?: string | null;
    readonly avatarExternalIdentityId?: string | null;
    readonly now: number;
  }): Promise<"updated" | "identity-not-found">;
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
  | "IDENTITY_LINK_CONFLICT"
  | "FINAL_IDENTITY_CANNOT_BE_UNLINKED"
  | "FRESH_AUTHENTICATION_REQUIRED"
  | "APP_MEMBERSHIP_REQUIRED"
  | "APP_CREATION_AUTHORITY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_CURSOR"
  | "INVALID_REQUEST"
  | "LAST_MEMBER"
  | "PLATFORM_ADMIN_REQUIRED"
  | "LAST_PLATFORM_ADMIN"
  | "SELF_BLOCK_FORBIDDEN";

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
    readonly managedOAuthIssuer: ManagedOAuthIssuerProvisioner | null = null,
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
        accountHint: null,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
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

  async requireActiveIdentity(accountId: AccountId, externalIdentityId: string): Promise<ExternalIdentityRecord> {
    const identity = await this.repository.getIdentity(externalIdentityId);
    if (!identity || identity.unlinkedAt !== null) throw new AccountServiceError("IDENTITY_NOT_FOUND");
    if (identity.accountId !== accountId) throw new AccountServiceError("IDENTITY_ACCOUNT_MISMATCH");
    return identity;
  }

  async getSelf(
    accountId: AccountId,
    currentExternalIdentityId: string,
    configuredProviders: readonly ProviderKind[],
  ): Promise<AccountSelf> {
    const account = await this.#resolveCanonicalAccount(accountId);
    this.#requireUsableAccount(account);
    const [profile, identities, platformAuthorities] = await Promise.all([
      this.repository.getProfile(account.accountId),
      this.repository.listActiveIdentities(account.accountId),
      this.repository.listPlatformAuthorities(account.accountId),
    ]);
    if (!profile) throw new AccountServiceError("ACCOUNT_NOT_FOUND");
    const summary = projectAccountSummary(account, profile);
    return {
      ...summary,
      blockedAt: account.blockedAt,
      platformAuthorities,
      identities: identities.map(identity => ({
        externalIdentityId: identity.externalIdentityId,
        provider: identity.provider,
        accountHint: identity.accountHint,
        linkedAt: identity.linkedAt,
        lastAuthenticatedAt: identity.lastAuthenticatedAt,
        currentLogin: identity.externalIdentityId === currentExternalIdentityId,
      })),
      linkableProviders: configuredProviders.filter(provider =>
        !identities.some(identity => identity.provider === provider)),
    };
  }

  async updateProfile(input: {
    readonly accountId: AccountId;
    readonly displayName?: string | null;
    readonly avatarExternalIdentityId?: string | null;
  }): Promise<void> {
    await this.#resolveCanonicalAccount(input.accountId).then(account => this.#requireUsableAccount(account));
    const result = await this.repository.updateProfile({ ...input, now: this.now() });
    if (result === "identity-not-found") throw new AccountServiceError("IDENTITY_NOT_FOUND");
  }

  async listApps(input: {
    readonly actorAccountId: AccountId;
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<{ readonly items: readonly App[]; readonly nextCursor: string | null }> {
    const actor = await this.#resolveCanonicalAccount(input.actorAccountId);
    this.#requireUsableAccount(actor);
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AccountServiceError("INVALID_REQUEST");
    }
    const cursor = input.cursor === undefined ? null : decodeControlListCursor(input.cursor);
    if (input.cursor !== undefined && !cursor) throw new AccountServiceError("INVALID_CURSOR");
    const snapshot = await this.repository.readControlSnapshot();
    if (cursor && cursor.snapshot !== snapshot) throw new AccountServiceError("INVALID_CURSOR");
    const rows = await this.repository.listAccountApps({
      accountId: actor.accountId,
      afterAppId: cursor?.last ?? "",
      limit: limit + 1,
    });
    if (await this.repository.readControlSnapshot() !== snapshot) {
      throw new AccountServiceError("INVALID_CURSOR");
    }
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit
        ? encodeControlListCursor({ version: 1, snapshot, last: items.at(-1)!.appId })
        : null,
    };
  }

  async createApp(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly displayName: string;
    readonly idempotencyKey?: string;
    readonly requestId?: string;
    readonly traceId?: string;
    readonly callerChannel?: string;
  }): Promise<App> {
    if (validateDisplayName(input.displayName)) throw new AccountServiceError("INVALID_REQUEST");
    if (input.idempotencyKey !== undefined
      && (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 128)) {
      throw new AccountServiceError("INVALID_REQUEST");
    }
    const actor = await this.#resolveCanonicalAccount(input.actorAccountId);
    this.#requireUsableAccount(actor);
    await this.requireActiveIdentity(actor.accountId, input.actorExternalIdentityId);
    if (!(await this.repository.listPlatformAuthorities(actor.accountId)).includes("apps.create")) {
      throw new AccountServiceError("APP_CREATION_AUTHORITY_REQUIRED");
    }
    const now = this.now();
    const payloadHash = await sha256Hex(canonicalJson({ displayName: input.displayName }));
    if (input.idempotencyKey !== undefined) {
      const existing = await this.repository.getAccountAppIdempotency({
        accountId: actor.accountId, key: input.idempotencyKey, now,
      });
      if (existing) return this.#resolveAppIdempotency(existing, payloadHash);
    }
    const app: App = {
      appId: generateStackId(), displayName: input.displayName.trim(), description: "",
      status: "active", createdAt: now, revision: 1,
    };
    const idempotency: AccountAppIdempotencyRecord | null = input.idempotencyKey === undefined ? null : {
      accountId: actor.accountId, method: "POST", canonicalRoute: "/admin/apps",
      key: input.idempotencyKey, payloadHash, response: app, createdAt: now,
      expiresAt: now + CAS_ADMIN_IDEMPOTENCY_RETENTION_MS,
    };
    const managedIssuer = this.managedOAuthIssuer
      ? await this.managedOAuthIssuer.provision(app.appId, now)
      : null;
    const result = await this.repository.commitCreateAccountApp({
      actorAccountId: actor.accountId,
      actorExternalIdentityId: input.actorExternalIdentityId,
      app, managedIssuer, idempotency, eventId: generateEventId(),
      requestId: input.requestId, traceId: input.traceId, callerChannel: input.callerChannel,
    });
    if (result === "actor-forbidden") throw new AccountServiceError("APP_CREATION_AUTHORITY_REQUIRED");
    if (typeof result === "object") return this.#resolveAppIdempotency(result.idempotencyRace, payloadHash);
    return app;
  }

  async listAppMembers(input: {
    readonly actorAccountId: AccountId;
    readonly appId: AppId;
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<{ readonly items: readonly AppMembership[]; readonly nextCursor: string | null }> {
    const actor = await this.#resolveCanonicalAccount(input.actorAccountId);
    this.#requireUsableAccount(actor);
    if (!await this.repository.hasAppMembership(actor.accountId, input.appId)) {
      throw new AccountServiceError("APP_MEMBERSHIP_REQUIRED");
    }
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AccountServiceError("INVALID_REQUEST");
    }
    const cursor = input.cursor === undefined ? null : decodeControlListCursor(input.cursor);
    if (input.cursor !== undefined && !cursor) throw new AccountServiceError("INVALID_CURSOR");
    const snapshot = await this.repository.readControlSnapshot();
    if (cursor && cursor.snapshot !== snapshot) throw new AccountServiceError("INVALID_CURSOR");
    const rows = await this.repository.listAppMemberships({
      appId: input.appId,
      afterAccountId: cursor?.last ?? "",
      limit: limit + 1,
    });
    if (await this.repository.readControlSnapshot() !== snapshot) {
      throw new AccountServiceError("INVALID_CURSOR");
    }
    const page = rows.slice(0, limit);
    return {
      items: page.map(row => ({
        appId: row.appId,
        account: projectAccountSummary(row.account, row.profile),
      })),
      nextCursor: rows.length > limit
        ? encodeControlListCursor({ version: 1, snapshot, last: page.at(-1)!.account.accountId })
        : null,
    };
  }

  async listAccountMemberships(accountId: AccountId): Promise<readonly AppMembership[]> {
    const account = await this.#resolveCanonicalAccount(accountId);
    this.#requireUsableAccount(account);
    const profile = await this.repository.getProfile(account.accountId);
    if (!profile) throw new AccountServiceError("ACCOUNT_NOT_FOUND");
    const summary = projectAccountSummary(account, profile);
    return (await this.repository.listAccountMembershipAppIds(account.accountId))
      .map(appId => ({ appId, account: summary }));
  }

  async listPlatformAccounts(input: {
    readonly actorAccountId: AccountId;
    readonly query?: unknown;
  }): Promise<PlatformAccountPage> {
    await this.#requirePlatformAdmin(input.actorAccountId);
    const parsed = PlatformPrincipalQuerySchema.safeParse(input.query ?? {});
    if (!parsed.success) throw new AccountServiceError("INVALID_REQUEST");
    const { limit = 50, cursor: encodedCursor, ...filters } = parsed.data;
    const snapshot = await this.repository.readControlSnapshot();
    let afterAccountId = "";
    if (encodedCursor) {
      const cursor = decodeControlListCursor(encodedCursor);
      if (!cursor || cursor.snapshot !== snapshot) throw new AccountServiceError("INVALID_CURSOR");
      try {
        const [cursorFilters, cursorAccountId] = JSON.parse(cursor.last) as [unknown, unknown];
        if (JSON.stringify(cursorFilters) !== JSON.stringify(filters) || typeof cursorAccountId !== "string") {
          throw new Error("invalid cursor");
        }
        afterAccountId = cursorAccountId;
      } catch {
        throw new AccountServiceError("INVALID_CURSOR");
      }
    }
    const rows = await this.repository.listPlatformAccounts({
      afterAccountId,
      limit: limit + 1,
      query: filters.query?.trim().toLowerCase() || undefined,
      effectiveAccess: filters.effectiveAccess,
      authority: filters.authority,
    });
    if (await this.repository.readControlSnapshot() !== snapshot) throw new AccountServiceError("INVALID_CURSOR");
    const page = rows.slice(0, limit);
    return {
      items: page.map(projectPlatformAccount),
      nextCursor: rows.length > limit
        ? encodeControlListCursor({ version: 1, snapshot, last: JSON.stringify([filters, page.at(-1)!.account.accountId]) })
        : null,
    };
  }

  async getPlatformAccount(actorAccountId: AccountId, targetAccountId: AccountId): Promise<PlatformAccountDetail> {
    await this.#requirePlatformAdmin(actorAccountId);
    const target = await this.repository.getPlatformAccount(targetAccountId);
    if (!target) throw new AccountServiceError("ACCOUNT_NOT_FOUND");
    return {
      ...projectPlatformAccount(target),
      memberships: (await this.repository.listAccountMembershipAppIds(target.account.accountId))
        .map(appId => ({ appId, account: projectAccountSummary(target.account, target.profile) })),
    };
  }

  async setPlatformAuthority(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly targetAccountId: AccountId;
    readonly authority: PlatformAuthority;
    readonly grant: boolean;
    readonly requestId?: string;
  }): Promise<void> {
    const actor = await this.#requirePlatformAdmin(input.actorAccountId);
    this.#mapPlatformMutationResult(await this.repository.commitPlatformAuthority({
      ...input,
      actorAccountId: actor.accountId,
      eventId: crypto.randomUUID(),
      now: this.now(),
    }));
  }

  async setPlatformBlocked(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly targetAccountId: AccountId;
    readonly blocked: boolean;
    readonly requestId?: string;
  }): Promise<void> {
    const actor = await this.#requirePlatformAdmin(input.actorAccountId);
    this.#mapPlatformMutationResult(await this.repository.commitPlatformBlock({
      ...input,
      actorAccountId: actor.accountId,
      eventId: crypto.randomUUID(),
      now: this.now(),
    }));
  }

  async listAppAuditEvents(input: {
    readonly actorAccountId: AccountId;
    readonly appId: AppId;
    readonly query?: unknown;
  }): Promise<{ readonly items: readonly AppControlAuditEvent[]; readonly nextCursor: string | null }> {
    const actor = await this.#resolveCanonicalAccount(input.actorAccountId);
    this.#requireUsableAccount(actor);
    if (!await this.repository.hasAppMembership(actor.accountId, input.appId)) {
      throw new AccountServiceError("APP_MEMBERSHIP_REQUIRED");
    }
    const parsed = AppAccountAuditQuerySchema.safeParse(normalizeAuditQuery(input.query ?? {}));
    if (!parsed.success || (parsed.data.after !== undefined && parsed.data.cursor !== undefined)) {
      throw new AccountServiceError("INVALID_REQUEST");
    }
    const { limit = 50, cursor: encodedCursor, after, actorAccountId, targetAccountId } = parsed.data;
    const filters = { actorAccountId, targetAccountId };
    const snapshot = await this.repository.readControlSnapshot();
    let afterCreatedAt = 0;
    let afterEventId = "";
    if (after !== undefined) {
      const position = await this.repository.getAppAuditEventPosition(input.appId, after);
      if (!position) throw new AccountServiceError("INVALID_REQUEST");
      afterCreatedAt = position.createdAt;
      afterEventId = position.eventId;
    } else if (encodedCursor !== undefined) {
      const position = decodeAuditCursor(encodedCursor, snapshot, filters);
      afterCreatedAt = position.createdAt;
      afterEventId = position.eventId;
    }
    const rows = await this.repository.listAppAccountAuditEvents({
      appId: input.appId,
      ...filters,
      afterCreatedAt,
      afterEventId,
      limit: limit + 1,
    });
    if (await this.repository.readControlSnapshot() !== snapshot) throw new AccountServiceError("INVALID_CURSOR");
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(projectAppAuditEvent),
      nextCursor: rows.length > limit && last
        ? encodeAuditCursor(snapshot, filters, last.createdAt, last.eventId)
        : null,
    };
  }

  async listPlatformAuditEvents(input: {
    readonly actorAccountId: AccountId;
    readonly query?: unknown;
  }): Promise<PlatformAccountAuditPage> {
    await this.#requirePlatformAdmin(input.actorAccountId);
    const parsed = PlatformAccountAuditQuerySchema.safeParse(normalizeAuditQuery(input.query ?? {}));
    if (!parsed.success) throw new AccountServiceError("INVALID_REQUEST");
    const { limit = 50, cursor: encodedCursor, ...filters } = parsed.data;
    const snapshot = await this.repository.readControlSnapshot();
    const cursor = encodedCursor === undefined ? null : decodeAuditCursor(encodedCursor, snapshot, filters);
    const rows = await this.repository.listPlatformAccountAuditEvents({
      ...filters,
      beforeCreatedAt: cursor?.createdAt,
      beforeEventId: cursor?.eventId,
      limit: limit + 1,
    });
    if (await this.repository.readControlSnapshot() !== snapshot) throw new AccountServiceError("INVALID_CURSOR");
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(projectPlatformAuditEvent),
      nextCursor: rows.length > limit && last
        ? encodeAuditCursor(snapshot, filters, last.createdAt, last.eventId)
        : null,
    };
  }

  async removeAppMember(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly appId: AppId;
    readonly targetAccountId: AccountId;
    readonly requestId?: string;
    readonly traceId?: string;
    readonly callerChannel?: string;
  }): Promise<void> {
    const actor = await this.#resolveCanonicalAccount(input.actorAccountId);
    this.#requireUsableAccount(actor);
    const result = await this.repository.commitRemoveAppMembership({
      ...input,
      actorAccountId: actor.accountId,
      eventId: crypto.randomUUID(),
      now: this.now(),
    });
    if (result === "actor-not-member") throw new AccountServiceError("APP_MEMBERSHIP_REQUIRED");
    if (result === "last-member") throw new AccountServiceError("LAST_MEMBER");
  }

  async linkExternalIdentity(input: {
    readonly accountId: AccountId;
    readonly currentExternalIdentityId: string;
    readonly credentialVersion: number;
    readonly currentAuthenticatedAt: number;
    readonly target: AuthenticatedProviderResult;
  }): Promise<AccountResolution> {
    this.#requireFresh(input.currentAuthenticatedAt);
    this.#requireFresh(input.target.authenticatedAt);
    const current = await this.authorizeCredential({
      accountId: input.accountId,
      externalIdentityId: input.currentExternalIdentityId,
      credentialVersion: input.credentialVersion,
    });
    const existing = await this.repository.getActiveIdentity(input.target.issuer, input.target.subject);
    if (existing) {
      if (existing.accountId !== input.accountId) {
        throw new AccountServiceError("IDENTITY_LINK_CONFLICT");
      }
      return current;
    }
    const externalIdentityId = generateExternalIdentityId();
    const result = await this.repository.commitLinkIdentity({
      accountId: input.accountId,
      expectedCredentialVersion: input.credentialVersion,
      identity: {
        externalIdentityId,
        accountId: input.accountId,
        provider: input.target.provider,
        issuer: input.target.issuer,
        subject: input.target.subject,
        linkedAt: this.now(),
        lastAuthenticatedAt: input.target.authenticatedAt,
        unlinkedAt: null,
        accountHint: input.target.accountHint,
        displayName: input.target.displayName,
        avatarUrl: input.target.avatarUrl,
      },
      displayName: input.target.displayName,
      avatarUrl: input.target.avatarUrl,
      now: this.now(),
    });
    if (result === "identity-conflict") throw new AccountServiceError("IDENTITY_LINK_CONFLICT");
    if (result === "version-mismatch") throw new AccountServiceError("CREDENTIAL_VERSION_MISMATCH");
    if (result === "blocked") throw new AccountServiceError("ACCOUNT_BLOCKED");
    const resolution = await this.resolveExternalIdentity(current.authenticatedIdentity.issuer, current.authenticatedIdentity.subject);
    if (!resolution) throw new AccountServiceError("IDENTITY_NOT_FOUND");
    return resolution;
  }

  async unlinkExternalIdentity(input: {
    readonly accountId: AccountId;
    readonly credentialVersion: number;
    readonly targetExternalIdentityId: string;
    readonly remainingExternalIdentityId: string;
    readonly remainingAuthenticatedAt: number;
  }): Promise<AccountResolution> {
    this.#requireFresh(input.remainingAuthenticatedAt);
    const remaining = await this.repository.getIdentity(input.remainingExternalIdentityId);
    if (!remaining || remaining.unlinkedAt !== null) throw new AccountServiceError("IDENTITY_NOT_FOUND");
    if (remaining.accountId !== input.accountId) throw new AccountServiceError("IDENTITY_ACCOUNT_MISMATCH");
    const result = await this.repository.commitUnlinkIdentity({
      accountId: input.accountId,
      expectedCredentialVersion: input.credentialVersion,
      targetExternalIdentityId: input.targetExternalIdentityId,
      remainingExternalIdentityId: input.remainingExternalIdentityId,
      now: this.now(),
    });
    if (result === "final-identity") throw new AccountServiceError("FINAL_IDENTITY_CANNOT_BE_UNLINKED");
    if (result === "version-mismatch") throw new AccountServiceError("CREDENTIAL_VERSION_MISMATCH");
    if (result === "blocked") throw new AccountServiceError("ACCOUNT_BLOCKED");
    if (result === "not-found") throw new AccountServiceError("IDENTITY_NOT_FOUND");
    const resolution = await this.resolveExternalIdentity(remaining.issuer, remaining.subject);
    if (!resolution) throw new AccountServiceError("IDENTITY_NOT_FOUND");
    return resolution;
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

  #resolveAppIdempotency(record: AccountAppIdempotencyRecord, payloadHash: string): App {
    if (record.payloadHash !== payloadHash) throw new AccountServiceError("IDEMPOTENCY_CONFLICT");
    return record.response;
  }

  async #requirePlatformAdmin(accountId: AccountId): Promise<AccountRecord> {
    const account = await this.#resolveCanonicalAccount(accountId);
    this.#requireUsableAccount(account);
    if (!(await this.repository.listPlatformAuthorities(account.accountId)).includes("platform.admin")) {
      throw new AccountServiceError("PLATFORM_ADMIN_REQUIRED");
    }
    return account;
  }

  #mapPlatformMutationResult(
    result: "updated" | "actor-forbidden" | "target-not-found" | "last-admin" | "self-block",
  ): void {
    if (result === "actor-forbidden") throw new AccountServiceError("PLATFORM_ADMIN_REQUIRED");
    if (result === "target-not-found") throw new AccountServiceError("ACCOUNT_NOT_FOUND");
    if (result === "last-admin") throw new AccountServiceError("LAST_PLATFORM_ADMIN");
    if (result === "self-block") throw new AccountServiceError("SELF_BLOCK_FORBIDDEN");
  }

  #requireUsableAccount(account: AccountRecord): void {
    if (account.blockedAt !== null) throw new AccountServiceError("ACCOUNT_BLOCKED");
  }

  #requireFresh(authenticatedAt: number): void {
    const now = this.now();
    if (authenticatedAt > now || now - authenticatedAt > AUTHENTICATION_FLOW_TTL_MS) {
      throw new AccountServiceError("FRESH_AUTHENTICATION_REQUIRED");
    }
  }
}

function initials(displayName: string | null): string {
  if (!displayName) return "UC";
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0]![0]}${parts.at(-1)![0]}`
    : parts[0]!.slice(0, 2)).toUpperCase();
}

function stableColorIndex(accountId: string): number {
  let hash = 0;
  for (const character of accountId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 12;
}

export function projectAccountSummary(
  account: Pick<AccountRecord, "accountId" | "primaryVerifiedEmail">,
  profile: Pick<AccountProfileRecord, "displayName" | "avatarUrl">,
): AccountSummary {
  const fallbackAvatar = {
    initials: initials(profile.displayName),
    colorIndex: stableColorIndex(account.accountId),
  };
  return {
    accountId: account.accountId,
    displayName: profile.displayName,
    primaryVerifiedEmail: account.primaryVerifiedEmail,
    avatar: profile.avatarUrl
      ? { kind: "image" as const, url: profile.avatarUrl, ...fallbackAvatar }
      : { kind: "fallback" as const, ...fallbackAvatar },
  };
}

function projectPlatformAccount(record: AccountPlatformViewRecord): PlatformAccountListItem {
  return {
    ...projectAccountSummary(record.account, record.profile),
    blockedAt: record.account.blockedAt,
    platformAuthorities: record.platformAuthorities,
    createdAt: record.account.createdAt,
    updatedAt: record.account.updatedAt,
    effectiveAccess: record.account.blockedAt !== null
      ? "blocked"
      : record.platformAuthorities.length > 0 || record.appMembershipCount > 0 ? "active" : "no_access",
    appMembershipCount: record.appMembershipCount,
    lastActiveAt: record.lastActiveAt,
  };
}

function projectAuditIdentity(identity: ExternalIdentityRecord) {
  return {
    externalIdentityId: identity.externalIdentityId,
    provider: identity.provider,
    accountHint: identity.accountHint,
    linkedAt: identity.linkedAt,
    lastAuthenticatedAt: identity.lastAuthenticatedAt,
    currentLogin: false,
    issuer: identity.issuer,
    subject: identity.subject,
  };
}

function projectAppAuditEvent(record: AppAccountAuditRecord): AppControlAuditEvent {
  return {
    eventId: record.eventId,
    appId: record.appId,
    actorAccount: projectAccountSummary(record.account, record.profile),
    authenticatedIdentity: projectAuditIdentity(record.identity),
    targetAccount: record.targetAccount && record.targetProfile
      ? projectAccountSummary(record.targetAccount, record.targetProfile)
      : null,
    action: record.action,
    target: record.target,
    requestId: record.requestId,
    traceId: record.traceId,
    caller: record.callerChannel
      ? {
        channel: record.callerChannel,
        oauthClientHandle: record.oauthClientHandle,
        toolName: record.toolName,
      }
      : null,
    createdAt: record.createdAt,
  };
}

function projectPlatformAuditEvent(record: PlatformAccountAuditRecord): PlatformAccountAuditEvent {
  return {
    eventId: record.eventId,
    action: record.action,
    actorAccount: projectAccountSummary(record.account, record.profile),
    authenticatedIdentity: projectAuditIdentity(record.identity),
    targetAccount: record.targetAccount && record.targetProfile
      ? projectAccountSummary(record.targetAccount, record.targetProfile)
      : null,
    targetInvitationId: record.targetInvitationId,
    result: record.result,
    requestId: record.requestId,
    createdAt: record.createdAt,
    details: record.details,
  };
}

function normalizeAuditQuery(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    ...record,
    ...(record.limit === undefined ? {} : { limit: Number(record.limit) }),
    ...(record.createdAfter === undefined ? {} : { createdAfter: Number(record.createdAfter) }),
  };
}

function encodeAuditCursor(
  snapshot: number,
  filters: object,
  createdAt: number,
  eventId: string,
): string {
  return encodeControlListCursor({
    version: 1,
    snapshot,
    last: JSON.stringify({ filters, createdAt, eventId }),
  });
}

function decodeAuditCursor(
  encoded: string,
  snapshot: number,
  filters: object,
): { readonly createdAt: number; readonly eventId: string } {
  const cursor = decodeControlListCursor(encoded);
  if (!cursor || cursor.snapshot !== snapshot) throw new AccountServiceError("INVALID_CURSOR");
  try {
    const parsed = JSON.parse(cursor.last) as Record<string, unknown>;
    if (JSON.stringify(parsed.filters) !== JSON.stringify(filters)
      || typeof parsed.createdAt !== "number"
      || !Number.isSafeInteger(parsed.createdAt)
      || parsed.createdAt < 0
      || typeof parsed.eventId !== "string"
      || parsed.eventId.length === 0) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, eventId: parsed.eventId };
  } catch {
    throw new AccountServiceError("INVALID_CURSOR");
  }
}