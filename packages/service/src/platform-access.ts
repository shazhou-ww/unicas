import {
  effectivePlatformAccess,
  hasPlatformAuthority,
  PatchPlatformAccessSchema,
  parseCasAdminETag,
  type PlatformAccessState,
  type PlatformAuthority,
  type PlatformPrincipal,
  type Principal,
} from "@unicas/admin-protocol";

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
  readonly action: string;
  readonly result: "succeeded" | "denied";
  readonly createdAt: number;
}

export interface PlatformAccessRepository {
  getAccess(principal: Principal): Promise<PlatformAccessState | null>;
  hasMembership(principal: Principal): Promise<boolean>;
  getPrincipal(principalRef: string): Promise<PlatformPrincipal | null>;
  listPrincipals(input: { readonly after: string; readonly limit: number }): Promise<readonly PlatformPrincipal[]>;
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
  constructor(readonly repository: PlatformAccessRepository, readonly now: () => number = Date.now) {}

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

  async patchAccess(actor: Principal, principalRef: string, input: unknown, ifMatch?: string): Promise<{ readonly revision: number }> {
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
    const result = await this.repository.patchAccess({ actor, current, status, authorities, audit: {
      eventId: crypto.randomUUID(), actorPrincipal: actor, targetPrincipal: current.principal,
      action: status !== current.status ? status === "blocked" ? "platform_access.blocked" : "platform_access.restored" : "platform_access.authority_changed",
      result: "succeeded", createdAt: this.now(),
    } });
    if (result === "revision-mismatch") throw new PlatformAccessError("REVISION_MISMATCH", 412);
    if (result === "last-admin") throw new PlatformAccessError("LAST_PLATFORM_ADMIN", 409);
    if (result === "forbidden") throw new PlatformAccessError("PLATFORM_ADMIN_REQUIRED", 403);
    return { revision: current.revision + 1 };
  }
}