import {
  DefaultSpaceNodeLeaseDurationMs,
  appSpaceRoutes,
} from "@unicas/space-protocol";
import type { SpaceNodeLeaseResult } from "@unicas/space-protocol";
import type {
  SpaceCasClient,
  SpaceCasClientConfig,
  SpaceNodeLeaseOptions,
} from "./types.js";
import { createScopedCasClient, withSignal } from "./transport.js";

export const DEFAULT_SPACE_NODE_LEASE_OPTIONS: SpaceNodeLeaseOptions = Object.freeze({
  durationMs: DefaultSpaceNodeLeaseDurationMs,
  signal: null,
});

export function createSpaceCasClient(config: SpaceCasClientConfig): SpaceCasClient {
  const path = { appId: config.appId, spaceId: config.spaceId };
  const scoped = createScopedCasClient(config, { version: 2, ...path }, {
    readMetadata: hash => appSpaceRoutes.readMetadata({ ...path, hash }),
    readContent: hash => appSpaceRoutes.readContent({ ...path, hash }),
    lease: hash => appSpaceRoutes.lease({ ...path, hash }),
    updateRootRefs: () => appSpaceRoutes.updateRootRefs(path),
    listRootRefs: options => appSpaceRoutes.listRootRefs(path, options),
    usage: () => appSpaceRoutes.usage(path),
    gc: () => appSpaceRoutes.gc(path),
  });
  const leaseNode = async (
    hash: string,
    options: SpaceNodeLeaseOptions = DEFAULT_SPACE_NODE_LEASE_OPTIONS,
  ): Promise<SpaceNodeLeaseResult> => {
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(options.durationMs) || options.durationMs <= 0) {
      throw new TypeError("CAS lease duration must be a positive safe integer");
    }
    const response = await scoped.requireOk(
      await scoped.request(scoped.routes.lease(hash), withSignal({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseDurationMs: options.durationMs }),
      }, options.signal)),
      "lease",
    );
    return response.json() as Promise<SpaceNodeLeaseResult>;
  };
  return Object.freeze({ ...scoped.client, leaseNode });
}
