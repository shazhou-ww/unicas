import {
  validateSpaceId,
  type SpaceCapabilityPermissionKind,
} from "@unicas/space-protocol";
import {
  createCapabilityManager,
  type CapabilityRecord,
  type CapabilityRequirement,
} from "./capability.js";
import { CasClientError } from "./errors.js";
import type { AppCasClientConfig } from "./types.js";

export interface AuthorizedTransport {
  request(
    requirement: CapabilityRequirement,
    route: string,
    init: RequestInit,
    operation: string,
    retryInvalidToken: boolean,
  ): Promise<Response>;
  requireSpaceId(spaceId: string): void;
}

interface ErrorResponse {
  readonly code?: string;
  readonly detail?: string;
}

export function createAuthorizedTransport(
  config: AppCasClientConfig,
): AuthorizedTransport {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const fetcher = config.fetcher ?? { fetch: globalThis.fetch.bind(globalThis) };
  const capabilities = createCapabilityManager(config.capabilityProvider);

  const fetchWith = (
    record: CapabilityRecord,
    route: string,
    init: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", ["Bearer", record.bearerToken].join(" "));
    return fetcher.fetch(`${baseUrl}${route}`, { ...init, headers });
  };

  const request = async (
    requirement: CapabilityRequirement,
    route: string,
    init: RequestInit,
    operation: string,
    retryInvalidToken: boolean,
  ): Promise<Response> => {
    let record = await capabilities.resolve(requirement);
    let response = await fetchWith(record, route, init);
    if (response.ok) return response;

    let error = await readError(response);
    if (response.status === 401 && error.code === "invalid_token") {
      if (retryInvalidToken) {
        record = await capabilities.refreshAfterRejection(requirement, record);
        response = await fetchWith(record, route, init);
        if (response.ok) return response;
        error = await readError(response);
      } else {
        capabilities.invalidate(record);
      }
    } else if (
      response.status === 403
      && (error.code === "insufficient_permission" || error.code === "resource_scope_mismatch")
    ) {
      capabilities.invalidate(record);
    }

    throw new CasClientError(
      response.status,
      response.statusText,
      operation,
      error.detail,
      error.code,
    );
  };

  const transport: AuthorizedTransport = {
    request,
    requireSpaceId(spaceId: string) {
      const error = validateSpaceId(spaceId);
      if (error) throw new TypeError(error);
    },
  };
  return Object.freeze(transport);
}

export function requirement(
  appId: string,
  spaceId: string,
  permission: SpaceCapabilityPermissionKind,
): CapabilityRequirement {
  return { appId, spaceId, permission };
}

export function withSignal(
  init: RequestInit,
  signal: AbortSignal | null | undefined,
): RequestInit {
  return signal === undefined || signal === null ? init : { ...init, signal };
}

async function readError(response: Response): Promise<ErrorResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {};
  }
  if (typeof body !== "object" || body === null) return {};
  const envelope = body as { readonly error?: unknown; readonly message?: unknown };
  const code = typeof envelope.error === "string" ? envelope.error : undefined;
  const detail = typeof envelope.message === "string" ? envelope.message : code;
  return {
    ...(code === undefined ? {} : { code }),
    ...(detail === undefined ? {} : { detail }),
  };
}
