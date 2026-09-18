import {
  CreatePlatformInvitationSchema,
  parseCasAdminETag,
  PlatformInvitationQuerySchema,
  type AccountId,
  type PlatformAuthority,
  type PlatformInvitation,
  type PlatformInvitationPage,
  type PrimaryVerifiedEmail,
} from "@unicas/admin-protocol";
import { AccountService, AccountServiceError } from "./account.js";
import { requireInvitationEmailEvidence, type VerifiedEmailEvidence } from "./authentication.js";
import { generateEventId, generateInvitationId, generateInvitationToken } from "./control-ids.js";
import { canonicalJson, sha256Hex, validateInvitationToken } from "./control-validation.js";
import { PlatformAccessError } from "./platform-access.js";

const DEFAULT_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIST_LIMIT = 50;

export interface StoredPlatformInvitation extends PlatformInvitation {
  readonly tokenHash: string;
}

export interface PlatformInvitationActor {
  readonly accountId: AccountId;
  readonly externalIdentityId: string;
}

export interface PlatformInvitationIdempotencyRecord {
  readonly actorAccountId: AccountId;
  readonly key: string;
  readonly payloadHash: string;
  readonly invitationId: string;
  readonly sealedToken: string;
  readonly expiresAt: number;
}

export interface PlatformInvitationSecrets {
  seal(token: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

export interface PlatformInvitationRepository {
  readSnapshot(): Promise<number>;
  getInvitation(invitationId: string, now: number): Promise<StoredPlatformInvitation | null>;
  getInvitationByTokenHash(tokenHash: string, now: number): Promise<StoredPlatformInvitation | null>;
  listInvitations(input: {
    readonly afterInvitationId: string;
    readonly limit: number;
    readonly query?: string;
    readonly status?: PlatformInvitation["status"];
    readonly now: number;
  }): Promise<readonly StoredPlatformInvitation[]>;
  getInvitationIdempotency(input: {
    readonly actorAccountId: AccountId;
    readonly key: string;
    readonly now: number;
  }): Promise<PlatformInvitationIdempotencyRecord | null>;
  commitCreateInvitation(input: {
    readonly actor: PlatformInvitationActor;
    readonly invitation: StoredPlatformInvitation;
    readonly idempotency: PlatformInvitationIdempotencyRecord;
    readonly eventId: string;
    readonly requestId: string | null;
  }): Promise<"created" | "idempotency-conflict" | "actor-forbidden">;
  commitRevokeInvitation(input: {
    readonly actor: PlatformInvitationActor;
    readonly invitationId: string;
    readonly expectedRevision: number;
    readonly now: number;
    readonly eventId: string;
    readonly requestId: string | null;
  }): Promise<"updated" | "revision-mismatch" | "not-found" | "not-pending" | "actor-forbidden">;
  commitAcceptInvitation(input: {
    readonly actor: PlatformInvitationActor;
    readonly invitation: StoredPlatformInvitation;
    readonly tokenHash: string;
    readonly primaryVerifiedEmail: PrimaryVerifiedEmail;
    readonly emailChallenge: {
      readonly challengeId: string;
      readonly authenticationEventId: string;
    } | null;
    readonly now: number;
    readonly eventId: string;
    readonly requestId: string | null;
  }): Promise<"accepted" | "not-pending" | "account-unavailable">;
}

export interface PlatformInvitationServiceOptions {
  readonly now?: () => number;
  readonly invitationTtlMs?: number;
  readonly generateInvitationId?: () => string;
  readonly generateInvitationToken?: () => string;
  readonly generateEventId?: () => string;
}

export class PlatformInvitationService {
  readonly #now: () => number;
  readonly #invitationTtlMs: number;
  readonly #generateInvitationId: () => string;
  readonly #generateInvitationToken: () => string;
  readonly #generateEventId: () => string;

  constructor(
    readonly repository: PlatformInvitationRepository,
    readonly accounts: AccountService,
    readonly secrets: PlatformInvitationSecrets,
    options: PlatformInvitationServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#invitationTtlMs = options.invitationTtlMs ?? DEFAULT_INVITATION_TTL_MS;
    this.#generateInvitationId = options.generateInvitationId ?? generateInvitationId;
    this.#generateInvitationToken = options.generateInvitationToken ?? generateInvitationToken;
    this.#generateEventId = options.generateEventId ?? generateEventId;
  }

  async create(
    actor: PlatformInvitationActor,
    input: unknown,
    idempotencyKey: string | undefined,
    requestId: string | null = null,
  ): Promise<{ readonly invitationId: string; readonly acceptUrl: string; readonly expiresAt: number; readonly revision: number }> {
    await this.#requirePlatformAdmin(actor);
    const parsed = CreatePlatformInvitationSchema.safeParse(normalizeCreateInput(input));
    if (!parsed.success || !idempotencyKey || idempotencyKey.length > 200) {
      throw new PlatformAccessError("INVALID_REQUEST", 400);
    }
    const authorities = orderedAuthorities(parsed.data.authorities);
    const payloadHash = await sha256Hex(canonicalJson({
      emailConstraint: parsed.data.emailConstraint,
      authorities,
    }));
    const existing = await this.#readIdempotency(actor.accountId, idempotencyKey);
    if (existing) return this.#replay(existing, payloadHash);

    const now = this.#now();
    const token = this.#generateInvitationToken();
    const invitation: StoredPlatformInvitation = {
      invitationId: this.#generateInvitationId(),
      emailConstraint: parsed.data.emailConstraint,
      authorities,
      status: "pending",
      expiresAt: now + this.#invitationTtlMs,
      createdAt: now,
      createdByAccountId: actor.accountId,
      revision: 1,
      tokenHash: await sha256Hex(token),
    };
    const idempotency: PlatformInvitationIdempotencyRecord = {
      actorAccountId: actor.accountId,
      key: idempotencyKey,
      payloadHash,
      invitationId: invitation.invitationId,
      sealedToken: await this.secrets.seal(token),
      expiresAt: invitation.expiresAt,
    };
    const result = await this.repository.commitCreateInvitation({
      actor,
      invitation,
      idempotency,
      eventId: this.#generateEventId(),
      requestId,
    });
    if (result === "actor-forbidden") throw new PlatformAccessError("PLATFORM_ADMIN_REQUIRED", 403);
    if (result === "idempotency-conflict") {
      const raced = await this.#readIdempotency(actor.accountId, idempotencyKey);
      if (!raced) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
      return this.#replay(raced, payloadHash);
    }
    return receipt(invitation, token);
  }

  async list(actorAccountId: AccountId, input: unknown): Promise<PlatformInvitationPage> {
    await this.#requirePlatformAdminAccount(actorAccountId);
    const parsed = PlatformInvitationQuerySchema.safeParse(normalizeListInput(input));
    if (!parsed.success) throw new PlatformAccessError("INVALID_REQUEST", 400);
    const cursor = decodeCursor(parsed.data.cursor);
    const query = parsed.data.query?.trim().toLowerCase();
    if (cursor && (cursor.query !== query || cursor.status !== parsed.data.status)) {
      throw new PlatformAccessError("INVALID_CURSOR", 400);
    }
    const limit = parsed.data.limit ?? DEFAULT_LIST_LIMIT;
    const snapshot = await this.#readSnapshot();
    if (cursor && cursor.snapshot !== snapshot) throw new PlatformAccessError("INVALID_CURSOR", 400);
    const asOf = cursor?.asOf ?? this.#now();
    try {
      const rows = await this.repository.listInvitations({
        afterInvitationId: cursor?.last ?? "",
        limit: limit + 1,
        query,
        status: parsed.data.status,
        now: asOf,
      });
      if (await this.repository.readSnapshot() !== snapshot) throw new PlatformAccessError("INVALID_CURSOR", 400);
      const items = rows.slice(0, limit).map(withoutTokenHash);
      return {
        items,
        nextCursor: rows.length > limit
          ? encodeCursor({ snapshot, asOf, last: items.at(-1)!.invitationId, query, status: parsed.data.status })
          : null,
      };
    } catch (error) {
      if (error instanceof PlatformAccessError) throw error;
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
  }

  async revoke(
    actor: PlatformInvitationActor,
    invitationId: string,
    ifMatch: string | undefined,
    requestId: string | null = null,
  ): Promise<{ readonly revision: number }> {
    await this.#requirePlatformAdmin(actor);
    if (ifMatch === undefined) throw new PlatformAccessError("PRECONDITION_REQUIRED", 428);
    const expectedRevision = parseCasAdminETag(ifMatch);
    if (expectedRevision === null) throw new PlatformAccessError("INVALID_REQUEST", 400);
    const current = await this.repository.getInvitation(invitationId, this.#now());
    if (!current) throw new PlatformAccessError("NOT_FOUND", 404);
    if (current.revision !== expectedRevision) throw new PlatformAccessError("REVISION_MISMATCH", 412);
    if (current.status === "revoked") return { revision: current.revision };
    if (current.status !== "pending") throw new PlatformAccessError("INVITATION_NOT_PENDING", 409);
    const result = await this.repository.commitRevokeInvitation({
      actor,
      invitationId,
      expectedRevision,
      now: this.#now(),
      eventId: this.#generateEventId(),
      requestId,
    });
    if (result === "actor-forbidden") throw new PlatformAccessError("PLATFORM_ADMIN_REQUIRED", 403);
    if (result === "revision-mismatch") throw new PlatformAccessError("REVISION_MISMATCH", 412);
    if (result === "not-found") throw new PlatformAccessError("NOT_FOUND", 404);
    if (result === "not-pending") throw new PlatformAccessError("INVITATION_NOT_PENDING", 409);
    return { revision: current.revision + 1 };
  }

  async resolve(token: string): Promise<StoredPlatformInvitation> {
    if (validateInvitationToken(token)) throw new PlatformAccessError("NOT_FOUND", 404);
    try {
      const invitation = await this.repository.getInvitationByTokenHash(await sha256Hex(token), this.#now());
      if (!invitation || invitation.status !== "pending") throw new PlatformAccessError("NOT_FOUND", 404);
      return invitation;
    } catch (error) {
      if (error instanceof PlatformAccessError) throw error;
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
  }

  async accept(
    actor: PlatformInvitationActor,
    evidence: readonly VerifiedEmailEvidence[],
    token: string,
    requestId: string | null = null,
  ): Promise<void> {
    const invitation = await this.resolve(token);
    await this.#requireActiveIdentity(actor);
    let primaryVerifiedEmail: PrimaryVerifiedEmail;
    let emailChallenge: Parameters<PlatformInvitationRepository["commitAcceptInvitation"]>[0]["emailChallenge"] = null;
    try {
      const matched = requireInvitationEmailEvidence(evidence, invitation.emailConstraint, this.#now());
      primaryVerifiedEmail = {
        normalizedEmail: matched.normalizedEmail,
        source: matched.source,
        verifiedAt: matched.verifiedAt,
      };
      if (matched.source === "unicas-email-challenge") {
        emailChallenge = {
          challengeId: matched.challengeId!,
          authenticationEventId: matched.authenticationEventId,
        };
      }
    } catch {
      throw new PlatformAccessError("NOT_FOUND", 404);
    }
    const result = await this.repository.commitAcceptInvitation({
      actor,
      invitation,
      tokenHash: await sha256Hex(token),
      primaryVerifiedEmail,
      emailChallenge,
      now: this.#now(),
      eventId: this.#generateEventId(),
      requestId,
    });
    if (result === "account-unavailable") throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
    if (result === "not-pending") throw new PlatformAccessError("INVITATION_NOT_PENDING", 409);
  }

  async #requirePlatformAdmin(actor: PlatformInvitationActor): Promise<void> {
    await this.#requireActiveIdentity(actor);
    await this.#requirePlatformAdminAccount(actor.accountId);
  }

  async #requirePlatformAdminAccount(accountId: AccountId): Promise<void> {
    try {
      await this.accounts.requirePlatformAuthority(accountId, "platform.admin");
    } catch (error) {
      throw mapAccountError(error);
    }
  }

  async #requireActiveIdentity(actor: PlatformInvitationActor): Promise<void> {
    try {
      await this.accounts.requireActiveIdentity(actor.accountId, actor.externalIdentityId);
    } catch (error) {
      throw mapAccountError(error);
    }
  }

  async #readIdempotency(actorAccountId: AccountId, key: string): Promise<PlatformInvitationIdempotencyRecord | null> {
    try {
      return await this.repository.getInvitationIdempotency({ actorAccountId, key, now: this.#now() });
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
  }

  async #replay(
    record: PlatformInvitationIdempotencyRecord,
    payloadHash: string,
  ): Promise<{ readonly invitationId: string; readonly acceptUrl: string; readonly expiresAt: number; readonly revision: number }> {
    if (record.payloadHash !== payloadHash) throw new PlatformAccessError("IDEMPOTENCY_CONFLICT", 409);
    const invitation = await this.repository.getInvitation(record.invitationId, this.#now());
    if (!invitation || invitation.status !== "pending") throw new PlatformAccessError("INVITATION_NOT_PENDING", 409);
    try {
      return receipt(invitation, await this.secrets.open(record.sealedToken));
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
  }

  async #readSnapshot(): Promise<number> {
    try {
      return await this.repository.readSnapshot();
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
  }
}

function mapAccountError(error: unknown): PlatformAccessError {
  if (!(error instanceof AccountServiceError)) return new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
  if (error.code === "PLATFORM_ADMIN_REQUIRED") return new PlatformAccessError(error.code, 403);
  if (error.code === "ACCOUNT_BLOCKED" || error.code === "ACCOUNT_NOT_FOUND"
    || error.code === "IDENTITY_NOT_FOUND" || error.code === "IDENTITY_ACCOUNT_MISMATCH") {
    return new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
  }
  return new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
}

function normalizeCreateInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    ...record,
    ...(typeof record.emailConstraint === "string"
      ? { emailConstraint: record.emailConstraint.trim().toLowerCase() }
      : {}),
  };
}

function normalizeListInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    ...record,
    ...(record.limit === undefined ? {} : { limit: Number(record.limit) }),
  };
}

function orderedAuthorities(authorities: readonly PlatformAuthority[]): readonly PlatformAuthority[] {
  return (["platform.admin", "apps.create"] as const).filter(authority => authorities.includes(authority));
}

function withoutTokenHash(invitation: StoredPlatformInvitation): PlatformInvitation {
  const { tokenHash: _tokenHash, ...view } = invitation;
  return view;
}

function receipt(invitation: StoredPlatformInvitation, token: string) {
  return {
    invitationId: invitation.invitationId,
    acceptUrl: `/admin/platform-invitations/${token}`,
    expiresAt: invitation.expiresAt,
    revision: invitation.revision,
  };
}

interface InvitationCursor {
  readonly v: 1;
  readonly snapshot: number;
  readonly asOf: number;
  readonly last: string;
  readonly query?: string;
  readonly status?: PlatformInvitation["status"];
}

function encodeCursor(input: Omit<InvitationCursor, "v">): string {
  return btoa(JSON.stringify({ v: 1, ...input }));
}

function decodeCursor(value: string | undefined): InvitationCursor | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(atob(value)) as Record<string, unknown>;
    if (parsed.v !== 1 || typeof parsed.snapshot !== "number" || !Number.isSafeInteger(parsed.snapshot) || parsed.snapshot < 0
      || typeof parsed.asOf !== "number" || !Number.isSafeInteger(parsed.asOf) || parsed.asOf < 0
      || typeof parsed.last !== "string" || parsed.last.length === 0) {
      throw new Error("invalid cursor");
    }
    if (parsed.query !== undefined && typeof parsed.query !== "string") throw new Error("invalid cursor");
    if (parsed.status !== undefined && !["pending", "accepted", "expired", "revoked"].includes(String(parsed.status))) {
      throw new Error("invalid cursor");
    }
    return parsed as unknown as InvitationCursor;
  } catch {
    throw new PlatformAccessError("INVALID_CURSOR", 400);
  }
}