import type { AppGcResult } from "@unicas/admin-protocol";
import { CasGcResultSchema } from "@unicas/space-protocol";
import { canonicalActorKey } from "./actor.js";
import type { KeyedActorPort } from "./ports.js";

export const DEFAULT_APP_GC_MAX_SPACES = 20;
export const DEFAULT_APP_GC_MAX_NODES_PER_SPACE = 100;

interface AppGcCursor {
  readonly version: 1;
  readonly appId: string;
  readonly lastSpaceId: string;
}

export interface AppGcSpaceRepository {
  listUsageBearingSpaceIds(input: {
    readonly appId: string;
    readonly afterSpaceId: string;
    readonly limit: number;
  }): Promise<readonly string[]>;
}

export interface AppGarbageCollector {
  collect(input: {
    readonly appId: string;
    readonly cursor?: string;
  }): Promise<AppGcResult>;
}

export type AppGcErrorCode = "INVALID_CURSOR" | "SERVICE_UNAVAILABLE";

export class AppGcError extends Error {
  constructor(readonly code: AppGcErrorCode, message: string) {
    super(message);
    this.name = "AppGcError";
  }
}

export async function runAppGarbageCollection(input: {
  readonly repository: AppGcSpaceRepository;
  readonly spaceActors: KeyedActorPort;
  readonly appId: string;
  readonly cursor?: string;
  readonly maxSpaces?: number;
  readonly maxNodesPerSpace?: number;
}): Promise<AppGcResult> {
  const maxSpaces = input.maxSpaces ?? DEFAULT_APP_GC_MAX_SPACES;
  const maxNodesPerSpace = input.maxNodesPerSpace ?? DEFAULT_APP_GC_MAX_NODES_PER_SPACE;
  if (!Number.isSafeInteger(maxSpaces) || maxSpaces <= 0) {
    throw new TypeError("maxSpaces must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxNodesPerSpace) || maxNodesPerSpace <= 0) {
    throw new TypeError("maxNodesPerSpace must be a positive safe integer");
  }
  if (input.appId.length === 0) throw new TypeError("appId must not be empty");

  const cursor = input.cursor === undefined ? null : decodeAppGcCursor(input.cursor);
  if (input.cursor !== undefined && (cursor === null || cursor.appId !== input.appId)) {
    throw new AppGcError("INVALID_CURSOR", "The garbage-collection cursor is invalid");
  }
  const afterSpaceId = cursor?.lastSpaceId ?? "";
  const rows = await input.repository.listUsageBearingSpaceIds({
    appId: input.appId,
    afterSpaceId,
    limit: maxSpaces + 1,
  });
  validateSpacePage(rows, afterSpaceId, maxSpaces + 1);

  const spaces = rows.slice(0, maxSpaces);
  let spacesWithDeletions = 0;
  let nodesExamined = 0;
  let nodesDeleted = 0;
  let reclaimedContentBytes = 0;
  for (const spaceId of spaces) {
    const result = await collectSpaceGarbage({
      spaceActors: input.spaceActors,
      appId: input.appId,
      spaceId,
      maxNodes: maxNodesPerSpace,
    });
    nodesExamined += result.nodesExamined;
    nodesDeleted += result.nodesDeleted;
    reclaimedContentBytes += result.reclaimedContentBytes;
    if (result.nodesDeleted > 0) spacesWithDeletions += 1;
    if (![nodesExamined, nodesDeleted, reclaimedContentBytes].every(Number.isSafeInteger)) {
      throw new AppGcError("SERVICE_UNAVAILABLE", "App garbage-collection totals exceeded safe integer limits");
    }
  }

  return {
    spacesExamined: spaces.length,
    spacesWithDeletions,
    nodesExamined,
    nodesDeleted,
    reclaimedContentBytes,
    nextCursor: rows.length > maxSpaces
      ? encodeAppGcCursor({ version: 1, appId: input.appId, lastSpaceId: spaces.at(-1)! })
      : null,
  };
}

async function collectSpaceGarbage(input: {
  readonly spaceActors: KeyedActorPort;
  readonly appId: string;
  readonly spaceId: string;
  readonly maxNodes: number;
}): Promise<{
  readonly nodesExamined: number;
  readonly nodesDeleted: number;
  readonly reclaimedContentBytes: number;
}> {
  let remaining = input.maxNodes;
  let nodesExamined = 0;
  let nodesDeleted = 0;
  let reclaimedContentBytes = 0;
  while (remaining > 0) {
    const requested = remaining;
    const response = await input.spaceActors.fetch(
      canonicalActorKey(input.appId, input.spaceId),
      new Request("https://space.internal/gc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CAS-App-Id": input.appId,
          "X-CAS-Space-Id": input.spaceId,
          "X-CAS-Route-Family": "app-admin-gc",
        },
        body: JSON.stringify({ maxNodes: requested }),
      }),
    );
    if (!response.ok) {
      throw new AppGcError(
        "SERVICE_UNAVAILABLE",
        `Space garbage collection failed with HTTP ${response.status}`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AppGcError("SERVICE_UNAVAILABLE", "Space garbage collection returned invalid JSON");
    }
    const parsed = CasGcResultSchema.safeParse(body);
    if (!parsed.success || parsed.data.examined > requested || parsed.data.deleted > parsed.data.examined) {
      throw new AppGcError("SERVICE_UNAVAILABLE", "Space garbage collection returned an invalid result");
    }
    nodesExamined += parsed.data.examined;
    nodesDeleted += parsed.data.deleted;
    reclaimedContentBytes += parsed.data.reclaimedContentBytes;
    remaining -= parsed.data.examined;
    if (parsed.data.examined === 0 || parsed.data.deleted === 0) break;
  }
  return { nodesExamined, nodesDeleted, reclaimedContentBytes };
}

function validateSpacePage(rows: readonly string[], afterSpaceId: string, maximumRows: number): void {
  if (rows.length > maximumRows) {
    throw new AppGcError("SERVICE_UNAVAILABLE", "App garbage-collection Space page exceeded its limit");
  }
  let previous = afterSpaceId;
  for (const spaceId of rows) {
    if (spaceId.length === 0 || spaceId <= previous) {
      throw new AppGcError("SERVICE_UNAVAILABLE", "App garbage-collection Space page was not ordered");
    }
    previous = spaceId;
  }
}

function encodeAppGcCursor(cursor: AppGcCursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeAppGcCursor(value: string): AppGcCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(value));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.version !== 1
    || typeof candidate.appId !== "string"
    || candidate.appId.length === 0
    || typeof candidate.lastSpaceId !== "string"
    || candidate.lastSpaceId.length === 0
  ) {
    return null;
  }
  return { version: 1, appId: candidate.appId, lastSpaceId: candidate.lastSpaceId };
}
