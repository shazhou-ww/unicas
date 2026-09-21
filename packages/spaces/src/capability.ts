import { importPKCS8, SignJWT } from "jose";
import { createSpaceCasClient, type SpaceCasClient } from "@unicas/space-client";
import {
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
  spaceGcExecutePermission,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  spaceUsageReadPermission,
  type SpaceCapabilityPermission,
} from "@unicas/space-protocol";
import type { PrincipalContext } from "./repository.js";

export type SpaceAccess = "read" | "write" | "manage";

export interface CapabilityConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly unicasBaseUrl: string;
}

const keyCache = new Map<string, ReturnType<typeof importPKCS8>>();

export async function issueSpaceCapability(
  config: CapabilityConfig,
  principal: PrincipalContext,
  access: readonly SpaceAccess[],
  now: () => number = () => Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(now() / 1000);
  const permissions: SpaceCapabilityPermission[] = [];
  if (access.includes("read")) permissions.push(spaceNodeReadPermission());
  if (access.includes("write")) {
    permissions.push(
      spaceNodeLeasePermission(),
      spaceRootRefsReadPermission(),
      spaceRootRefsUpdatePermission(),
    );
  }
  if (access.includes("manage")) permissions.push(spaceUsageReadPermission(), spaceGcExecutePermission());
  if (permissions.length === 0) throw new TypeError("At least one Space access permission is required");

  let importedKey = keyCache.get(config.privateKeyPem);
  if (!importedKey) {
    importedKey = importPKCS8(config.privateKeyPem, CapabilityAlgorithm);
    keyCache.set(config.privateKeyPem, importedKey);
  }
  const privateKey = await importedKey;
  return new SignJWT({
    ver: SpaceCapabilityVersion,
    spaceId: principal.spaceId,
    permissions,
    refDomain: principal.refDomain,
  })
    .setProtectedHeader({ alg: CapabilityAlgorithm, kid: config.keyId, typ: CapabilityTokenType })
    .setIssuer(config.issuer)
    .setSubject(principal.principalId)
    .setAudience(config.audience)
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + 300)
    .setJti(crypto.randomUUID())
    .sign(privateKey);
}

export async function createPrincipalCasClient(
  config: CapabilityConfig,
  principal: PrincipalContext,
  access: readonly SpaceAccess[],
  fetcher?: { fetch(input: string | Request, init?: RequestInit): Promise<Response> },
): Promise<SpaceCasClient> {
  const capability = await issueSpaceCapability(config, principal, access);
  return createSpaceCasClient({
    baseUrl: config.unicasBaseUrl,
    appId: principal.appId,
    spaceId: principal.spaceId,
    getToken: async () => capability,
    ...(fetcher ? { fetcher } : {}),
  });
}