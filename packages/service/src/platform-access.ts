import {
  effectivePlatformAccess,
  hasPlatformAuthority,
  PatchPlatformAccessSchema,
  PlatformPrincipalQuerySchema,
  parseCasAdminETag,
  type PlatformAccessState,
  type PlatformAccessSummary,
  type PlatformAuthority,
  type PlatformPrincipalDetail,
  type PlatformPrincipalListItem,
  type PlatformPrincipalPage,
  type Principal,
} from "@unicas/admin-protocol";
import { sha256Hex, validateInvitationToken } from "./control-validation.js";
import { requireInvitationEmailEvidence, type VerifiedEmailEvidence } from "./authentication.js";

export class PlatformAccessError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "PlatformAccessError";
  }
}

export interface PlatformAuditRecord {
  readonly eventId: string;
  readonly actorPrincipal: Principal;
  readonly targetPrincipal: Principal | null;
  readonly targetInvitationId?: string | null;
  readonly requestId?: string | null;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly action: string;
  readonly result: "succeeded" | "denied";
  readonly createdAt: number;
}

export interface AppInvitationAdmissionRecord {
  readonly invitationId: string;
  readonly appId: string;
  readonly status: "pending" | "accepted" | "expired" | "revoked";
  readonly emailConstraint: string | null;
  readonly expiresAt: number;
}

export interface AppInvitationAdmission extends Omit<AppInvitationAdmissionRecord, "status"> {
  readonly tokenHash: string;
}

export interface PlatformAccessRepository {
  readSnapshot(): Promise<number>;
  getAccess(principal: Principal): Promise<PlatformAccessState | null>;
  hasMembership(principal: Principal): Promise<boolean>;
  getAppInvitationByTokenHash(tokenHash: string): Promise<AppInvitationAdmissionRecord | null>;
  getPrincipal(principalRef: string): Promise<PlatformPrincipalDetail | null>;
  listPrincipals(input: {
    readonly after: string;
    readonly limit: number;
    readonly query?: string;
    readonly effectiveAccess?: "active" | "blocked" | "no_access";
    readonly authority?: PlatformAuthority | "none";
  }): Promise<readonly PlatformPrincipalListItem[]>;
  getAccessSummary(): Promise<Omit<PlatformAccessSummary, "generatedAt">>;
  patchAccess(input: {
    readonly actor: Principal;
    readonly current: PlatformAccessState;
    readonly status: PlatformAccessState["status"];
    readonly authorities: readonly PlatformAuthority[];
    readonly audit: PlatformAuditRecord;
  }): Promise<"updated" | "revision-mismatch" | "last-admin" | "forbidden">;
  appendAudit(event: PlatformAuditRecord): Promise<void>;
}

export class PlatformAccessService {
  constructor(readonly repository: PlatformAccessRepository, readonly now: () => number = Date.now) { }

  async requireAccess(principal: Principal, authority?: PlatformAuthority): Promise<PlatformAccessState | null> {
    let state: PlatformAccessState | null;
    let member: boolean;
    try {
      [state, member] = await Promise.all([this.repository.getAccess(principal), this.repository.hasMembership(principal)]);
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
    if (effectivePlatformAccess(state, member) !== "active") throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
    if (authority && !hasPlatformAuthority(state, authority)) {
      if (authority === "apps.create") await this.repository.appendAudit({
        eventId: crypto.randomUUID(), actorPrincipal: principal, targetPrincipal: null,
        action: "app.create_denied", result: "denied", createdAt: this.now(),
      });
      throw new PlatformAccessError(authority === "platform.admin" ? "PLATFORM_ADMIN_REQUIRED" : "APP_CREATION_AUTHORITY_REQUIRED", 403);
    }
    return state;
  }

  async assertNotBlocked(principal: Principal): Promise<void> {
    let state: PlatformAccessState | null;
    try { state = await this.repository.getAccess(principal); } catch { throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503); }
    if (state?.status === "blocked") throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
  }

  async resolveAppInvitation(token: string): Promise<AppInvitationAdmission> {
    if (validateInvitationToken(token)) throw new PlatformAccessError("NOT_FOUND", 404);
    const tokenHash = await sha256Hex(token);
    let invitation: AppInvitationAdmissionRecord | null;
    try {
      invitation = await this.repository.getAppInvitationByTokenHash(tokenHash);
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= this.now()) {
      throw new PlatformAccessError("NOT_FOUND", 404);
    }
    const { status: _status, ...pending } = invitation;
    return { ...pending, tokenHash };
  }

  async authorizeAppInvitationLogin(
    principal: Principal,
    evidence: readonly VerifiedEmailEvidence[],
    token: string,
  ): Promise<{ readonly mode: "full" | "invitation"; readonly invitation: AppInvitationAdmission }> {
    const invitation = await this.resolveAppInvitation(token);
    let state: PlatformAccessState | null;
    let member: boolean;
    try {
      [state, member] = await Promise.all([
        this.repository.getAccess(principal),
        this.repository.hasMembership(principal),
      ]);
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
    if (effectivePlatformAccess(state, member) === "active") {
      return { mode: "full", invitation };
    }
    if (state?.status === "blocked" || invitation.emailConstraint === null) {
      throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
    }
    try {
      requireInvitationEmailEvidence(evidence, invitation.emailConstraint, this.now());
    } catch {
      throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
    }
    return { mode: "invitation", invitation };
  }

  async patchAccess(actor: Principal, principalRef: string, input: unknown, ifMatch?: string): Promise<{ readonly revision: number }> {
    try {
      return await this.#patchAccess(actor, principalRef, input, ifMatch);
    } catch (error) {
      if (error instanceof PlatformAccessError && error.code !== "SERVICE_UNAVAILABLE") {
        try {
          await this.repository.appendAudit({
            eventId: crypto.randomUUID(),
            actorPrincipal: actor,
            targetPrincipal: null,
            action: "platform_access.change_denied",
            result: "denied",
            createdAt: this.now(),
            details: { errorCode: error.code, principalRef },
          });
        } catch {
          throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
        }
      }
      throw error;
    }
  }

  async #patchAccess(actor: Principal, principalRef: string, input: unknown, ifMatch?: string): Promise<{ readonly revision: number }> {
    await this.requireAccess(actor, "platform.admin");
    const parsed = PatchPlatformAccessSchema.safeParse(input);
    if (!parsed.success) throw new PlatformAccessError("INVALID_REQUEST", 400);
    if (ifMatch === undefined) throw new PlatformAccessError("PRECONDITION_REQUIRED", 428);
    const revision = parseCasAdminETag(ifMatch);
    if (revision === null) throw new PlatformAccessError("INVALID_REQUEST", 400);
    const current = await this.repository.getPrincipal(principalRef);
    if (!current) throw new PlatformAccessError("NOT_FOUND", 404);
    if (revision !== current.revision) throw new PlatformAccessError("REVISION_MISMATCH", 412);
    const status = parsed.data.status ?? current.status;
    const authorities = ["platform.admin", "apps.create"].filter(authority =>
      (parsed.data.authorities ?? current.authorities).includes(authority as PlatformAuthority)) as PlatformAuthority[];
    if (actor.issuer === current.principal.issuer && actor.subject === current.principal.subject && status === "blocked") {
      throw new PlatformAccessError("SELF_BLOCK_FORBIDDEN", 409);
    }
    if (status === current.status && authorities.length === current.authorities.length
      && authorities.every(authority => current.authorities.includes(authority))) return { revision: current.revision };
    const result = await this.repository.patchAccess({
      actor, current, status, authorities, audit: {
        eventId: crypto.randomUUID(), actorPrincipal: actor, targetPrincipal: current.principal,
        action: status !== current.status ? status === "blocked" ? "platform_access.blocked" : "platform_access.restored" : "platform_access.authority_changed",
        result: "succeeded", createdAt: this.now(),
      }
    });
    if (result === "revision-mismatch") throw new PlatformAccessError("REVISION_MISMATCH", 412);
    if (result === "last-admin") throw new PlatformAccessError("LAST_PLATFORM_ADMIN", 409);
    if (result === "forbidden") throw new PlatformAccessError("PLATFORM_ADMIN_REQUIRED", 403);
    return { revision: current.revision + 1 };
  }

  async listPrincipals(actor: Principal, input: unknown): Promise<PlatformPrincipalPage> {
    await this.requireAccess(actor, "platform.admin");
    const parsed = PlatformPrincipalQuerySchema.safeParse(normalizeListInput(input));
    if (!parsed.success) throw new PlatformAccessError("INVALID_REQUEST", 400);
    const cursor = decodePrincipalCursor(parsed.data.cursor);
    const query = parsed.data.query?.trim().toLowerCase();
    const filters = {
      query,
      effectiveAccess: parsed.data.effectiveAccess,
      authority: parsed.data.authority,
    };
    if (cursor && JSON.stringify(cursor.filters) !== JSON.stringify(filters)) {
      throw new PlatformAccessError("INVALID_CURSOR", 400);
    }
    const limit = parsed.data.limit ?? 50;
    const snapshot = await readSnapshot(this.repository);
    if (cursor && cursor.snapshot !== snapshot) throw new PlatformAccessError("INVALID_CURSOR", 400);
    try {
      const rows = await this.repository.listPrincipals({
        after: cursor?.last ?? "",
        limit: limit + 1,
        ...filters,
      });
      const items = rows.slice(0, limit);
      if (await this.repository.readSnapshot() !== snapshot) throw new PlatformAccessError("INVALID_CURSOR", 400);
      return {
        items,
        nextCursor: rows.length > limit
          ? btoa(JSON.stringify({ v: 1, snapshot, last: items.at(-1)!.principalRef, filters }))
          : null,
      };
    } catch (error) {
      if (error instanceof PlatformAccessError) throw error;
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
  }

  async getPrincipal(actor: Principal, principalRef: string): Promise<PlatformPrincipalDetail> {
    await this.requireAccess(actor, "platform.admin");
    let principal: PlatformPrincipalDetail | null;
    try {
      principal = await this.repository.getPrincipal(principalRef);
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
    if (!principal) throw new PlatformAccessError("NOT_FOUND", 404);
    return principal;
  }

  async getAccessState(actor: Principal, principalRef: string): Promise<PlatformAccessState> {
    const principal = await this.getPrincipal(actor, principalRef);
    return {
      principalRef: principal.principalRef,
      principal: principal.principal,
      status: principal.status,
      authorities: principal.authorities,
      revision: principal.revision,
      createdAt: principal.createdAt,
      updatedAt: principal.updatedAt,
    };
  }

  async getAccessSummary(actor: Principal): Promise<PlatformAccessSummary> {
    await this.requireAccess(actor, "platform.admin");
    try {
      const counts = await this.repository.getAccessSummary();
      return { ...counts, generatedAt: this.now() };
    } catch {
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
  }
}

function normalizeListInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    ...record,
    ...(record.limit === undefined ? {} : { limit: Number(record.limit) }),
  };
}

interface PrincipalCursor {
  readonly v: 1;
  readonly snapshot: number;
  readonly last: string;
  readonly filters: {
    readonly query?: string;
    readonly effectiveAccess?: "active" | "blocked" | "no_access";
    readonly authority?: PlatformAuthority | "none";
  };
}

function decodePrincipalCursor(value: string | undefined): PrincipalCursor | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(atob(value)) as PrincipalCursor;
    if (parsed.v !== 1 || !Number.isSafeInteger(parsed.snapshot) || parsed.snapshot < 0
      || typeof parsed.last !== "string" || parsed.last.length === 0
      || typeof parsed.filters !== "object" || parsed.filters === null) {
      throw new Error("invalid cursor");
    }
    return parsed;
  } catch {
    throw new PlatformAccessError("INVALID_CURSOR", 400);
  }
}

async function readSnapshot(repository: PlatformAccessRepository): Promise<number> {
  try {
    return await repository.readSnapshot();
  } catch {
    throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
  }
}