import { describe, expect, test, vi } from "vitest";
import {
  AppGcError,
  runAppGarbageCollection,
  type AppGcSpaceRepository,
  type KeyedActorPort,
} from "../src/index.js";

function gcResponse(examined: number, deleted: number, reclaimedContentBytes: number): Response {
  return Response.json({ examined, deleted, reclaimedContentBytes });
}

describe("App garbage collection", () => {
  test("collects layered garbage within per-Space budgets and paginates Spaces", async () => {
    const repository: AppGcSpaceRepository = {
      listUsageBearingSpaceIds: vi.fn(async ({ afterSpaceId }) =>
        afterSpaceId === "" ? ["space-a", "space-b", "space-c"] : ["space-c"]),
    };
    const results = new Map<string, Response[]>([
      ["space-a", [
        gcResponse(2, 2, 20),
        gcResponse(1, 1, 5),
        gcResponse(0, 0, 0),
      ]],
      ["space-b", [gcResponse(1, 0, 0)]],
      ["space-c", [gcResponse(0, 0, 0)]],
    ]);
    const requests: { key: string; maxNodes: number }[] = [];
    const spaceActors: KeyedActorPort = {
      fetch: vi.fn(async (key, request) => {
        requests.push({
          key,
          maxNodes: (await request.json() as { maxNodes: number }).maxNodes,
        });
        return results.get(request.headers.get("X-CAS-Space-Id")!)!.shift()!;
      }),
    };

    const first = await runAppGarbageCollection({
      repository,
      spaceActors,
      appId: "app-a",
      maxSpaces: 2,
      maxNodesPerSpace: 10,
    });
    expect(first).toMatchObject({
      spacesExamined: 2,
      spacesWithDeletions: 1,
      nodesExamined: 4,
      nodesDeleted: 3,
      reclaimedContentBytes: 25,
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(requests).toEqual([
      { key: "app-a|space-a", maxNodes: 10 },
      { key: "app-a|space-a", maxNodes: 8 },
      { key: "app-a|space-a", maxNodes: 7 },
      { key: "app-a|space-b", maxNodes: 10 },
    ]);
    await expect(runAppGarbageCollection({
      repository,
      spaceActors,
      appId: "app-b",
      cursor: first.nextCursor!,
      maxSpaces: 2,
      maxNodesPerSpace: 10,
    })).rejects.toMatchObject<AppGcError>({ code: "INVALID_CURSOR" });

    await expect(runAppGarbageCollection({
      repository,
      spaceActors,
      appId: "app-a",
      cursor: first.nextCursor!,
      maxSpaces: 2,
      maxNodesPerSpace: 10,
    })).resolves.toEqual({
      spacesExamined: 1,
      spacesWithDeletions: 0,
      nodesExamined: 0,
      nodesDeleted: 0,
      reclaimedContentBytes: 0,
      nextCursor: null,
    });
    expect(repository.listUsageBearingSpaceIds).toHaveBeenLastCalledWith({
      appId: "app-a",
      afterSpaceId: "space-b",
      limit: 3,
    });
  });

  test("rejects invalid cursors before reading storage", async () => {
    const repository: AppGcSpaceRepository = {
      listUsageBearingSpaceIds: vi.fn(async () => []),
    };
    await expect(runAppGarbageCollection({
      repository,
      spaceActors: { fetch: vi.fn() },
      appId: "app-a",
      cursor: "not-base64",
    })).rejects.toMatchObject<AppGcError>({ code: "INVALID_CURSOR" });
    expect(repository.listUsageBearingSpaceIds).not.toHaveBeenCalled();
  });

  test("fails closed when a Space actor rejects or violates the GC contract", async () => {
    const repository: AppGcSpaceRepository = {
      listUsageBearingSpaceIds: vi.fn(async () => ["space-a"]),
    };
    await expect(runAppGarbageCollection({
      repository,
      spaceActors: { fetch: vi.fn(async () => new Response("unavailable", { status: 503 })) },
      appId: "app-a",
    })).rejects.toMatchObject<AppGcError>({ code: "SERVICE_UNAVAILABLE" });

    await expect(runAppGarbageCollection({
      repository,
      spaceActors: { fetch: vi.fn(async () => gcResponse(1, 2, 10)) },
      appId: "app-a",
    })).rejects.toMatchObject<AppGcError>({ code: "SERVICE_UNAVAILABLE" });
  });
});
