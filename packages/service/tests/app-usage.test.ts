import { describe, expect, test } from "vitest";
import {
  AppUsageUnavailableError,
  readAppUsage,
  type AppUsageProjection,
  type AppUsageRepository,
} from "../src/index.js";

class MemoryAppUsageRepository implements AppUsageRepository {
  constructor(readonly projection: AppUsageProjection) { }

  async readAppUsage() {
    return this.projection;
  }
}

const projection = (overrides: Partial<AppUsageProjection> = {}): AppUsageProjection => ({
  nodeCount: 3,
  readyContentBytes: 30,
  readyStoredBytes: 24,
  reservedBytes: 5,
  notReadyNodeCount: 1,
  leasedNodeCount: 2,
  unobservedNodeCount: 0,
  ...overrides,
});

describe("App usage service kernel", () => {
  test("returns the complete public aggregate without internal reconciliation state", async () => {
    await expect(readAppUsage({
      repository: new MemoryAppUsageRepository(projection()),
      appId: "app-1",
    })).resolves.toEqual({
      nodeCount: 3,
      readyContentBytes: 30,
      readyStoredBytes: 24,
      reservedBytes: 5,
      notReadyNodeCount: 1,
      leasedNodeCount: 2,
    });
  });

  test("fails closed while any node lacks a completed storage observation", async () => {
    await expect(readAppUsage({
      repository: new MemoryAppUsageRepository(projection({ unobservedNodeCount: 1 })),
      appId: "app-1",
    })).rejects.toBeInstanceOf(AppUsageUnavailableError);
  });
});