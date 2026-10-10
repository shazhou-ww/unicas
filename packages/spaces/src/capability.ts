import { importPKCS8, SignJWT } from "jose";
import {
  createAppCasClient,
  type AppCasClient,
  type ProvidedSpaceCapability,
} from "@unicas/space-client";
import {
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
  SpaceOperationPolicies,
  parseSpaceSelector,
  type SpaceCapabilityPermissionKind,
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
  return (await issueSpaceCapabilityWithMetadata(
    config,
    principal,
    access,
    now,
  )).bearerToken;
}

async function issueSpaceCapabilityWithMetadata(
  config: CapabilityConfig,
  principal: PrincipalContext,
  access: readonly SpaceAccess[],
  now: () => number = () => Date.now(),
): Promise<ProvidedSpaceCapability> {
  const issuedAt = Math.floor(now() / 1000);
  const permissions = permissionsForAccess(access);
  const selector = parseSpaceSelector(principal.spaceId);
  if (!selector || selector.kind !== "exact") {
    throw new TypeError("Principal spaceId must be a canonical exact Space ID");
  }

  let importedKey = keyCache.get(config.privateKeyPem);
  if (!importedKey) {
    importedKey = importPKCS8(config.privateKeyPem, CapabilityAlgorithm);
    keyCache.set(config.privateKeyPem, importedKey);
  }
  const privateKey = await importedKey;
  const bearerToken = await new SignJWT({
    ver: SpaceCapabilityVersion,
    grants: [{ selector: selector.selector, permissions }],
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
  return {
    bearerToken,
    metadata: {
      version: SpaceCapabilityVersion,
      notBefore: issuedAt,
      expiresAt: issuedAt + 300,
      grants: [{ selector: selector.selector, permissions }],
      refDomain: principal.refDomain,
    },
  };
}

export function createPrincipalAppCasClient(
  config: CapabilityConfig,
  principal: PrincipalContext,
  access: readonly SpaceAccess[],
  fetcher?: { fetch(input: string | Request, init?: RequestInit): Promise<Response> },
): AppCasClient {
  const permissions = permissionsForAccess(access);
  return createAppCasClient({
    baseUrl: config.unicasBaseUrl,
    appId: principal.appId,
    capabilityProvider: {
      async acquire(requirement) {
        if (requirement.appId !== principal.appId || requirement.spaceId !== principal.spaceId) {
          throw new TypeError("Principal capability requirement is outside its App/Space");
        }
        if (!permissions.includes(requirement.permission)) {
          throw new TypeError(
            `Principal access does not allow ${requirement.permission}`,
          );
        }
        return issueSpaceCapabilityWithMetadata(config, principal, access);
      },
    },
    ...(fetcher ? { fetcher } : {}),
  });
}

function permissionsForAccess(
  access: readonly SpaceAccess[],
): readonly SpaceCapabilityPermissionKind[] {
  const permissions: SpaceCapabilityPermissionKind[] = [];
  if (access.includes("read")) {
    permissions.push(SpaceOperationPolicies.readContent.permission);
  }
  if (access.includes("write")) {
    permissions.push(
      SpaceOperationPolicies.lease.permission,
      SpaceOperationPolicies.listRootRefs.permission,
      SpaceOperationPolicies.updateRootRefs.permission,
    );
  }
  if (access.includes("manage")) {
    permissions.push(
      SpaceOperationPolicies.usage.permission,
      SpaceOperationPolicies.gc.permission,
    );
  }
  if (permissions.length === 0) {
    throw new TypeError("At least one Space access permission is required");
  }
  return Object.freeze([...new Set(permissions)]);
}