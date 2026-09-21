import { appSpaceRoutes, type CasErrorResponse } from "@unicas/tenant-protocol";
import { issueSpaceCapability, type CapabilityConfig } from "./capability.js";
import type { PrincipalContext } from "./repository.js";

export interface DenialEvidence {
  readonly status: 403;
  readonly code: "insufficient_permission" | "resource_scope_mismatch";
}

export interface IsolationEvidence {
  readonly authority: DenialEvidence;
  readonly space: DenialEvidence;
}

export async function verifySmokeIsolation(input: {
  readonly capability: CapabilityConfig;
  readonly principal: PrincipalContext;
  readonly fetchImpl?: typeof fetch;
}): Promise<IsolationEvidence> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const hash = "0".repeat(64);
  const readOnlyToken = await issueSpaceCapability(input.capability, input.principal, ["read"]);
  const authority = await expectDenial(
    fetchImpl,
    `${input.capability.unicasBaseUrl}${appSpaceRoutes.lease({
      appId: input.principal.appId,
      spaceId: input.principal.spaceId,
      hash,
    })}`,
    readOnlyToken,
    "insufficient_permission",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseDurationMs: 60_000 }),
    },
  );
  const otherSpacePrincipal = {
    ...input.principal,
    spaceId: `${input.principal.spaceId}-isolation`,
  };
  const otherSpaceToken = await issueSpaceCapability(input.capability, otherSpacePrincipal, ["read"]);
  const space = await expectDenial(
    fetchImpl,
    `${input.capability.unicasBaseUrl}${appSpaceRoutes.readMetadata({
      appId: input.principal.appId,
      spaceId: input.principal.spaceId,
      hash,
    })}`,
    otherSpaceToken,
    "resource_scope_mismatch",
  );
  return { authority, space };
}

async function expectDenial(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  expectedCode: DenialEvidence["code"],
  init: RequestInit = {},
): Promise<DenialEvidence> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetchImpl(url, { ...init, headers });
  const body = await response.json().catch(() => null) as CasErrorResponse | null;
  if (response.status !== 403 || body?.error !== expectedCode) {
    throw new Error(`Isolation probe expected 403 ${expectedCode}, received ${response.status}`);
  }
  return { status: 403, code: expectedCode };
}