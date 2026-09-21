import { CanonicalNodeContentType } from "@unicas/codec";
import { casRoutes } from "@unicas/space-protocol/v1";
import type { CasLeaseOptions, CasNodeSource } from "../shared-types.js";
import { createScopedCasClient, withSignal } from "../transport.js";
import type { TenantCasClient, TenantCasClientConfig } from "./types.js";

export function createTenantCasClient(config: TenantCasClientConfig): TenantCasClient {
  const path = { stackId: config.stackId, tenantId: config.tenantId };
  const scoped = createScopedCasClient(config, path, {
    readMetadata: hash => casRoutes.readMetadata({ ...path, hash }),
    readContent: hash => casRoutes.readContent({ ...path, hash }),
    lease: hash => casRoutes.lease({ ...path, hash }),
    updateRootRefs: () => casRoutes.updateRootRefs(path),
    listRootRefs: options => casRoutes.listRootRefs(path, options),
    usage: () => casRoutes.usage(path),
    gc: () => casRoutes.gc(path),
  });
  return Object.freeze({
    ...scoped.client,
    async leaseNode(hash: string, source?: CasNodeSource, options: CasLeaseOptions = {}) {
      const headers = new Headers();
      if (options.durationMs !== undefined) {
        headers.set("X-CAS-Lease-Duration", String(options.durationMs));
      }
      if (source !== undefined) {
        headers.set("Content-Type", CanonicalNodeContentType);
        headers.set("Content-Length", String(source.contentLength));
      }
      const init = withSignal({
        method: "POST",
        headers,
        ...(source === undefined ? {} : { body: source.body }),
      }, options.signal);
      if (source?.body instanceof ReadableStream) {
        (init as RequestInit & { duplex?: "half" }).duplex = "half";
      }
      const response = await scoped.requireOk(
        await scoped.request(scoped.routes.lease(hash), init),
        "lease",
      );
      return response.json();
    },
  });
}