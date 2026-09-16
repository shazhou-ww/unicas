import {
  PlatformAuditQuerySchema,
  type PlatformAuditAction,
  type PlatformAuditEvent,
  type PlatformAuditPage,
  type Principal,
} from "@unicas/admin-protocol";
import { PlatformAccessError, PlatformAccessService } from "./platform-access.js";

const DEFAULT_LIMIT = 50;

export interface PlatformAuditRepository {
  listAuditEvents(input: {
    readonly action?: PlatformAuditAction;
    readonly actorPrincipalRef?: string;
    readonly targetPrincipalRef?: string;
    readonly createdAfter?: number;
    readonly beforeCreatedAt?: number;
    readonly beforeEventId?: string;
    readonly limit: number;
  }): Promise<readonly PlatformAuditEvent[]>;
}

export class PlatformAuditService {
  constructor(
    readonly repository: PlatformAuditRepository,
    readonly access: PlatformAccessService,
  ) { }

  async list(actor: Principal, input: unknown): Promise<PlatformAuditPage> {
    await this.access.requireAccess(actor, "platform.admin");
    const parsed = PlatformAuditQuerySchema.safeParse(normalizeInput(input));
    if (!parsed.success) throw new PlatformAccessError("INVALID_REQUEST", 400);
    const cursor = decodeCursor(parsed.data.cursor);
    const filters = {
      action: parsed.data.action,
      actorPrincipalRef: parsed.data.actorPrincipalRef,
      targetPrincipalRef: parsed.data.targetPrincipalRef,
      createdAfter: parsed.data.createdAfter,
    };
    if (cursor && canonicalFilters(cursor) !== canonicalFilters(filters)) {
      throw new PlatformAccessError("INVALID_CURSOR", 400);
    }
    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    const snapshot = await readSnapshot(this.access);
    if (cursor && cursor.snapshot !== snapshot) throw new PlatformAccessError("INVALID_CURSOR", 400);
    let rows: readonly PlatformAuditEvent[];
    try {
      rows = await this.repository.listAuditEvents({
        ...filters,
        beforeCreatedAt: cursor?.beforeCreatedAt,
        beforeEventId: cursor?.beforeEventId,
        limit: limit + 1,
      });
      if (await this.access.repository.readSnapshot() !== snapshot) throw new PlatformAccessError("INVALID_CURSOR", 400);
    } catch (error) {
      if (error instanceof PlatformAccessError) throw error;
      throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    }
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last
        ? btoa(JSON.stringify({ v: 1, snapshot, ...filters, beforeCreatedAt: last.createdAt, beforeEventId: last.eventId }))
        : null,
    };
  }
}

interface AuditCursor {
  readonly v: 1;
  readonly snapshot: number;
  readonly action?: PlatformAuditAction;
  readonly actorPrincipalRef?: string;
  readonly targetPrincipalRef?: string;
  readonly createdAfter?: number;
  readonly beforeCreatedAt: number;
  readonly beforeEventId: string;
}

function decodeCursor(value: string | undefined): AuditCursor | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(atob(value)) as Record<string, unknown>;
    if (parsed.v !== 1
      || typeof parsed.snapshot !== "number"
      || !Number.isSafeInteger(parsed.snapshot)
      || parsed.snapshot < 0
      || typeof parsed.beforeCreatedAt !== "number"
      || !Number.isSafeInteger(parsed.beforeCreatedAt)
      || typeof parsed.beforeEventId !== "string"
      || parsed.beforeEventId.length === 0) {
      throw new Error("invalid cursor");
    }
    return parsed as unknown as AuditCursor;
  } catch {
    throw new PlatformAccessError("INVALID_CURSOR", 400);
  }
}

function normalizeInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    ...record,
    ...(record.limit === undefined ? {} : { limit: Number(record.limit) }),
    ...(record.createdAfter === undefined ? {} : { createdAfter: Number(record.createdAfter) }),
  };
}

function canonicalFilters(input: {
  readonly action?: PlatformAuditAction;
  readonly actorPrincipalRef?: string;
  readonly targetPrincipalRef?: string;
  readonly createdAfter?: number;
}): string {
  return JSON.stringify([
    input.action ?? null,
    input.actorPrincipalRef ?? null,
    input.targetPrincipalRef ?? null,
    input.createdAfter ?? null,
  ]);
}

async function readSnapshot(access: PlatformAccessService): Promise<number> {
  try {
    return await access.repository.readSnapshot();
  } catch {
    throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
  }
}