import {
  SpaceOperationPolicies,
  parseSpaceSelector,
} from "@unicas/space-protocol";
import { createAppCasClient } from "@unicas/space-client";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const spaceId = required("UNICAS_SPACE_ID");
const selector = parseSpaceSelector(spaceId);
if (!selector) throw new Error("UNICAS_SPACE_ID must be a canonical Space ID");
const expiresAt = Number(required("UNICAS_CAPABILITY_EXPIRES_AT"));
if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
  throw new Error("UNICAS_CAPABILITY_EXPIRES_AT must be non-negative Unix seconds");
}
const permission = SpaceOperationPolicies.readMetadata.permission;

const cas = createAppCasClient({
  baseUrl: required("UNICAS_BASE_URL"),
  appId: required("UNICAS_APP_ID"),
  capabilityProvider: {
    async acquire(requirement) {
      if (requirement.spaceId !== spaceId || requirement.permission !== permission) {
        throw new Error("The supplied capability does not cover this requirement");
      }
      return {
        bearerToken: required("UNICAS_CAPABILITY"),
        metadata: {
          version: 2,
          expiresAt,
          grants: [{ selector: selector.selector, permissions: [permission] }],
        },
      };
    },
  },
});

const metadata = await cas.readMetadata(spaceId, required("UNICAS_NODE_HASH"));
console.log(JSON.stringify(metadata, null, 2));
