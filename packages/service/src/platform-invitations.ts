import {
  CreatePlatformInvitationSchema,
  parseCasAdminETag,
  PlatformInvitationQuerySchema,
  type PlatformAuthority,
  type PlatformInvitation,
  type PlatformInvitationPage,
  type Principal,
  type PrimaryVerifiedEmail,
  type Profile,
} from "@unicas/admin-protocol";
import { generateEventId, generateInvitationId, generateInvitationToken, generatePrincipalRef } from "./control-ids.js";
import { canonicalJson, sha256Hex, validateInvitationToken } from "./control-validation.js";
import { PlatformAccessError, PlatformAccessService, type PlatformAuditRecord } from "./platform-access.js";
import { requireInvitationEmailEvidence, type VerifiedEmailEvidence } from "./authentication.js";

const DEFAULT_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIST_LIMIT = 50;

export interface StoredPlatformInvitation extends PlatformInvitation {
  readonly tokenHash: string;
}

export interface PlatformInvitationIdempotencyRecord {
  readonly actor: Principal;
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
    readonly actor: Principal;
    readonly key: string;
    readonly now: number;
  }): Promise<PlatformInvitationIdempotencyRecord | null>;
  commitCreateInvitation(input: {
    readonly actor: Principal;
    readonly invitation: StoredPlatformInvitation;
    readonly idempotency: PlatformInvitationIdempotencyRecord;
    readonly audit: PlatformAuditRecord;
  }): Promise<"created" | "idempotency-conflict" | "forbidden">;
  commitRevokeInvitation(input: {
    readonly actor: Principal;
    readonly invitationId: string;
    readonly expectedRevision: number;
    readonly now: number;
    readonly audit: PlatformAuditRecord;
  }): Promise<"updated" | "revision-mismatch" | "not-found" | "not-pending" | "forbidden">;
  commitAcceptInvitation(input: {
    readonly invitation: StoredPlatformInvitation;
    readonly tokenHash: string;
    readonly principalRef: string;
    readonly principal: Principal;
    readonly profile: Profile;
    readonly primaryVerifiedEmail: PrimaryVerifiedEmail;
    readonly emailChallenge: {
      readonly challengeId: string;
      readonly authenticationEventId: string;
    } | null;
    readonly now: number;
    readonly audit: PlatformAuditRecord;
  }): Promise<"accepted" | "not-pending" | "blocked">;
}

export interface PlatformInvitationServiceOptions {
  readonly now?: () => number;
  readonly invitationTtlMs?: number;
  readonly generateInvitationId?: () => string;
  readonly generateInvitationToken?: () => string;
  readonly generatePrincipalRef?: () => string;
  readonly generateEventId?: () => string;
}

export class PlatformInvitationService {
  readonly #now: () => number;
  readonly #invitationTtlMs: number;
  readonly #generateInvitationId: () => string;
  readonly #generateInvitationToken: () => string;
  readonly #generatePrincipalRef: () => string;
  readonly #generateEventId: () => string;

  constructor(
    readonly repository: PlatformInvitationRepository,
    readonly access: PlatformAccessService,
    readonly secrets: PlatformInvitationSecrets,
    options: PlatformInvitationServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#invitationTtlMs = options.invitationTtlMs ?? DEFAULT_INVITATION_TTL_MS;
    this.#generateInvitationId = options.generateInvitationId ?? generateInvitationId;
    this.#generateInvitationToken = options.generateInvitationToken ?? generateInvitationToken;
    this.#generatePrincipalRef = options.generatePrincipalRef ?? generatePrincipalRef;
    this.#generateEventId = options.generateEventId ?? generateEventId;
  }

  async create(
    actor: Principal,
    input: unknown,
    idempotencyKey: string | undefined,
    requestId: string | null = null,
  ): Promise<{ readonly invitationId: string; readonly acceptUrl: string; readonly expiresAt: number; readonly revision: number }> {
    await this.access.requireAccess(actor, "platform.admin");
    const normalized = normalizeCreateInput(input);
    const parsed = CreatePlatformInvitationSchema.safeParse(normalized);
    if (!parsed.success) throw new PlatformAccessError("INVALID_REQUEST", 400);
    if (!idempotencyKey || idempotencyKey.length > 200) throw new PlatformAccessError("INVALID_REQUEST", 400);
    const authorities = orderedAuthorities(parsed.data.authorities);
    const payloadHash = await sha256Hex(canonicalJson({
      emailConstraint: parsed.data.emailConstraint,
      authorities,
    }));
    const existing = await this.#readIdempotency(actor, idempotencyKey);
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
      createdBy: actor,
      revision: 1,
      tokenHash: await sha256Hex(token),
    };
    const idempotency: PlatformInvitationIdempotencyRecord = {
      actor,
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
      audit: this.#audit(actor, "platform_invitation.created", invitation.invitationId, requestId),
    });
    if (result === "forbidden") throw new PlatformAccessError("PLATFORM_ADMIN_REQUIRED", 403);
    if (result === "idempotency-conflict") {
      const raced = await this.#readIdempotency(actor, idempotencyKey);
      if (!raced) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
      return this.#replay(raced, payloadHash);
    }
    return receipt(invitation, token);
  }

  async list(actor: Principal, input: unknown): Promise<PlatformInvitationPage> {
    await this.access.requireAccess(actor, "platform.admin");
    const candidate = normalizeListInput(input);
    const parsed = PlatformInvitationQuerySchema.safeParse(candidate);
    if (!parsed.success) throw new PlatformAccessError("INVALID_REQUEST", 400);
    const cursor = decodeCursor(parsed.data.cursor);
    const query = parsed.data.query?.trim().toLowerCase();
    if (cursor && (cursor.query !== query || cursor.status !== parsed.data.status)) {
      throw new PlatformAccessError("INVALID_CURSOR", 400);
    }
    const limit = parsed.data.limit ?? DEFAULT_LIST_LIMIT;
    const snapshot = await readSnapshot(this.access);
    if (cursor && cursor.snapshot !== snapshot) throw new PlatformAccessError("INVALID_CURSOR", 400);
    const asOf = cursor?.asOf ?? this.#now();
    let rows: readonly StoredPlatformInvitation[];
    try {
      rows = await this.repository.listInvitations({
        afterInvitationId: cursor?.last ?? "",
        limit: limit + 1,
        query,
        status: parsed.data.status,
        now: asOf,
      });
      if (await this.access.repository.readSnapshot() !== snapshot) throw new PlatformAccessError("INVALID_CURSOR", 400);
    } catch (error) {
      if (error instanceof PlatformAccessError) throw error;
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
    const items = rows.slice(0, limit).map(withoutTokenHash);
    const nextCursor = rows.length > limit
      ? encodeCursor({ snapshot, asOf, last: items.at(-1)!.invitationId, query, status: parsed.data.status })
      : null;
    return { items, nextCursor };
  }

  async revoke(
    actor: Principal,
    invitationId: string,
    ifMatch: string | undefined,
    requestId: string | null = null,
  ): Promise<{ readonly revision: number }> {
    await this.access.requireAccess(actor, "platform.admin");
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
      audit: this.#audit(actor, "platform_invitation.revoked", invitationId, requestId),
    });
    if (result === "forbidden") throw new PlatformAccessError("PLATFORM_ADMIN_REQUIRED", 403);
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

  async authorizeLogin(
    principal: Principal,
    evidence: readonly VerifiedEmailEvidence[],
    token: string,
  ): Promise<StoredPlatformInvitation> {
    const invitation = await this.resolve(token);
    await this.access.assertNotBlocked(principal);
    try {
      requireInvitationEmailEvidence(evidence, invitation.emailConstraint, this.#now());
    } catch {
      throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
    }
    return invitation;
  }

  async accept(
    principal: Principal,
    profile: Profile,
    evidence: readonly VerifiedEmailEvidence[],
    token: string,
    requestId: string | null = null,
  ): Promise<void> {
    const invitation = await this.resolve(token);
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
      invitation,
      tokenHash: await sha256Hex(token),
      principalRef: this.#generatePrincipalRef(),
      principal,
      profile,
      primaryVerifiedEmail,
      emailChallenge,
      now: this.#now(),
      audit: this.#audit(principal, "platform_invitation.accepted", invitation.invitationId, requestId, principal),
    });
    if (result === "blocked") throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
    if (result === "not-pending") throw new PlatformAccessError("INVITATION_NOT_PENDING", 409);
  }

  async #readIdempotency(actor: Principal, key: string): Promise<PlatformInvitationIdempotencyRecord | null> {
    try {
      return await this.repository.getInvitationIdempotency({ actor, key, now: this.#now() });
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
    let token: string;
    try {
      token = await this.secrets.open(record.sealedToken);
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
    return receipt(invitation, token);
  }

  #audit(
    actor: Principal,
    action: string,
    targetInvitationId: string,
    requestId: string | null,
    targetPrincipal: Principal | null = null,
  ): PlatformAuditRecord {
    return {
      eventId: this.#generateEventId(),
      actorPrincipal: actor,
      targetPrincipal,
      targetInvitationId,
      requestId,
      action,
      result: "succeeded",
      createdAt: this.#now(),
    };
  }
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

async function readSnapshot(access: PlatformAccessService): Promise<number> {
  try {
    return await access.repository.readSnapshot();
  } catch {
    throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
  }
}