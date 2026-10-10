import {
  MaximumCapabilityClockSkewSeconds,
  MaximumSpaceCapabilityGrants,
  SpaceCapabilityPermissionKinds,
  SpaceCapabilityVersion,
  parseSpaceSelector,
  spaceSelectorMatches,
  validateRefDomainClaim,
  type SpaceCapabilityPermissionKind,
} from "@unicas/space-protocol";
import { CasCapabilityError } from "./errors.js";
import type {
  ProvidedSpaceCapability,
  SpaceCapabilityAcquireReason,
  SpaceCapabilityMetadata,
  SpaceCapabilityProvider,
} from "./types.js";

const CredentialClasses = ["content", "root-refs", "management"] as const;
type CredentialClass = (typeof CredentialClasses)[number];

export interface CapabilityRequirement {
  readonly appId: string;
  readonly spaceId: string;
  readonly permission: SpaceCapabilityPermissionKind;
}

export interface CapabilityRecord {
  readonly bearerToken: string;
  readonly metadata: SpaceCapabilityMetadata;
}

export interface CapabilityManager {
  resolve(requirement: CapabilityRequirement): Promise<CapabilityRecord>;
  refreshAfterRejection(
    requirement: CapabilityRequirement,
    rejected: CapabilityRecord,
  ): Promise<CapabilityRecord>;
  invalidate(record: CapabilityRecord): void;
}

export function createCapabilityManager(
  provider: SpaceCapabilityProvider,
  now: () => number = () => Date.now(),
): CapabilityManager {
  const current = new Map<CredentialClass, CapabilityRecord>();
  const acquisitions = new Map<CredentialClass, Promise<CapabilityRecord>>();
  let rootRefDomain: string | undefined;

  const invalidate = (record: CapabilityRecord): void => {
    for (const credentialClass of CredentialClasses) {
      if (current.get(credentialClass) === record) current.delete(credentialClass);
    }
  };

  const acquire = (
    requirement: CapabilityRequirement,
    reason: SpaceCapabilityAcquireReason,
    superseded?: CapabilityRecord,
  ): Promise<CapabilityRecord> => {
    const credentialClass = credentialClassFor(requirement.permission);
    const active = acquisitions.get(credentialClass);
    if (active) return active;

    const acquisition = provider.acquire({ ...requirement, reason })
      .catch((error: unknown) => {
        if (error instanceof CasCapabilityError) throw error;
        throw new CasCapabilityError(
          "PROVIDER_FAILED",
          "CAS capability provider failed",
          error,
        );
      })
      .then((provided) => normalizeCapability(provided, requirement, now()))
      .then((record) => {
        if (credentialClass === "root-refs") {
          const domain = record.metadata.refDomain;
          if (domain === undefined) {
            throw invalidMetadata("Root Ref capability metadata requires refDomain");
          }
          if (rootRefDomain !== undefined && domain !== rootRefDomain) {
            throw invalidMetadata("Root Ref capability metadata changed refDomain");
          }
          rootRefDomain = domain;
        }
        if (superseded) invalidate(superseded);
        current.set(credentialClass, record);
        return record;
      })
      .finally(() => {
        if (acquisitions.get(credentialClass) === acquisition) {
          acquisitions.delete(credentialClass);
        }
      });
    acquisitions.set(credentialClass, acquisition);
    return acquisition;
  };

  const resolve = async (
    requirement: CapabilityRequirement,
    forcedReason?: SpaceCapabilityAcquireReason,
  ): Promise<CapabilityRecord> => {
    const credentialClass = credentialClassFor(requirement.permission);
    const preferred = current.get(credentialClass);
    if (forcedReason === undefined && preferred) {
      const reason = replacementReason(preferred, requirement, now());
      if (reason === null) return preferred;
      return acquire(requirement, reason, preferred);
    }

    if (forcedReason === undefined) {
      for (const candidateClass of CredentialClasses) {
        const candidate = current.get(candidateClass);
        if (!candidate || candidate === preferred) continue;
        if (replacementReason(candidate, requirement, now()) === null) {
          if (credentialClass === "root-refs") {
            const domain = candidate.metadata.refDomain;
            if (domain === undefined) continue;
            if (rootRefDomain !== undefined && domain !== rootRefDomain) continue;
            rootRefDomain = domain;
          }
          current.set(credentialClass, candidate);
          return candidate;
        }
      }
    }

    const active = acquisitions.get(credentialClass);
    if (active) {
      await active;
      return resolve(requirement, forcedReason);
    }
    return acquire(
      requirement,
      forcedReason ?? (preferred ? "requirement-miss" : "missing"),
      preferred,
    );
  };

  const manager: CapabilityManager = {
    resolve: (requirement: CapabilityRequirement) => resolve(requirement),
    refreshAfterRejection(
      requirement: CapabilityRequirement,
      rejected: CapabilityRecord,
    ) {
      invalidate(rejected);
      return resolve(requirement, "server-rejected");
    },
    invalidate,
  };
  return Object.freeze(manager);
}

function normalizeCapability(
  provided: ProvidedSpaceCapability,
  requirement: CapabilityRequirement,
  nowMs: number,
): CapabilityRecord {
  if (typeof provided !== "object" || provided === null) {
    throw invalidMetadata("Capability provider result must be an object");
  }
  if (typeof provided.bearerToken !== "string" || provided.bearerToken.length === 0) {
    throw invalidMetadata("Capability bearerToken must not be empty");
  }
  const metadata = provided.metadata;
  if (typeof metadata !== "object" || metadata === null) {
    throw invalidMetadata("Capability metadata must be an object");
  }
  if (metadata.version !== SpaceCapabilityVersion) {
    throw invalidMetadata(`Capability metadata version must be ${SpaceCapabilityVersion}`);
  }
  if (!validUnixSeconds(metadata.expiresAt)) {
    throw invalidMetadata("Capability metadata expiresAt must be non-negative Unix seconds");
  }
  if (metadata.notBefore !== undefined && !validUnixSeconds(metadata.notBefore)) {
    throw invalidMetadata("Capability metadata notBefore must be non-negative Unix seconds");
  }
  if (metadata.notBefore !== undefined && metadata.notBefore > metadata.expiresAt) {
    throw invalidMetadata("Capability metadata time window is invalid");
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    metadata.notBefore !== undefined
    && metadata.notBefore > nowSeconds + MaximumCapabilityClockSkewSeconds
  ) {
    throw invalidMetadata("Capability metadata is not active yet");
  }
  if (metadata.expiresAt <= nowSeconds + MaximumCapabilityClockSkewSeconds) {
    throw invalidMetadata("Capability metadata is expired or too close to expiry");
  }
  if (
    !Array.isArray(metadata.grants)
    || metadata.grants.length === 0
    || metadata.grants.length > MaximumSpaceCapabilityGrants
  ) {
    throw invalidMetadata(
      `Capability metadata grants must contain 1-${MaximumSpaceCapabilityGrants} entries`,
    );
  }

  const grants = metadata.grants.map((grant) => {
    if (typeof grant !== "object" || grant === null) {
      throw invalidMetadata("Capability grant metadata must be an object");
    }
    if (typeof grant.selector !== "string") {
      throw invalidMetadata("Capability grant metadata has an invalid selector");
    }
    const selector = parseSpaceSelector(grant.selector);
    if (!selector) throw invalidMetadata("Capability grant metadata has an invalid selector");
    if (!Array.isArray(grant.permissions) || grant.permissions.length === 0) {
      throw invalidMetadata("Capability grant metadata permissions must not be empty");
    }
    const rawPermissions: readonly unknown[] = grant.permissions;
    if (!rawPermissions.every(isSpaceCapabilityPermissionKind)) {
      throw invalidMetadata("Capability grant metadata has an invalid permission");
    }
    const permissions = [...new Set(rawPermissions.filter(isSpaceCapabilityPermissionKind))];
    return Object.freeze({
      selector: selector.selector,
      permissions: Object.freeze(permissions),
    });
  });

  let refDomain: string | undefined;
  if (metadata.refDomain !== undefined) {
    const domainError = validateRefDomainClaim(metadata.refDomain);
    if (domainError) throw invalidMetadata(`Capability metadata ${domainError}`);
    refDomain = metadata.refDomain;
  }

  const normalizedMetadata: SpaceCapabilityMetadata = Object.freeze({
    version: SpaceCapabilityVersion,
    ...(metadata.notBefore === undefined ? {} : { notBefore: metadata.notBefore }),
    expiresAt: metadata.expiresAt,
    grants: Object.freeze(grants),
    ...(refDomain === undefined ? {} : { refDomain }),
  });
  const record = Object.freeze({
    bearerToken: provided.bearerToken,
    metadata: normalizedMetadata,
  });
  if (!capabilityMatches(record, requirement)) {
    throw new CasCapabilityError(
      "UNSATISFIED_CAPABILITY_REQUIREMENT",
      `CAS capability does not satisfy ${requirement.permission} for the requested Space`,
    );
  }
  if (
    credentialClassFor(requirement.permission) === "root-refs"
    && normalizedMetadata.refDomain === undefined
  ) {
    throw invalidMetadata("Root Ref capability metadata requires refDomain");
  }
  return record;
}

function replacementReason(
  record: CapabilityRecord,
  requirement: CapabilityRequirement,
  nowMs: number,
): SpaceCapabilityAcquireReason | null {
  const nowSeconds = Math.floor(nowMs / 1000);
  if (record.metadata.expiresAt <= nowSeconds + MaximumCapabilityClockSkewSeconds) {
    return "expiring";
  }
  return capabilityMatches(record, requirement) ? null : "requirement-miss";
}

function capabilityMatches(
  record: CapabilityRecord,
  requirement: CapabilityRequirement,
): boolean {
  return record.metadata.grants.some((grant) =>
    spaceSelectorMatches(grant.selector, requirement.spaceId)
    && grant.permissions.includes(requirement.permission)
  );
}

function credentialClassFor(
  permission: SpaceCapabilityPermissionKind,
): CredentialClass {
  switch (permission) {
    case "cas:nodes:read":
    case "cas:nodes:lease":
      return "content";
    case "cas:root-refs:read":
    case "cas:root-refs:update":
      return "root-refs";
    case "cas:usage:read":
    case "cas:gc:execute":
      return "management";
  }
}

function validUnixSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSpaceCapabilityPermissionKind(
  value: unknown,
): value is SpaceCapabilityPermissionKind {
  return typeof value === "string"
    && (SpaceCapabilityPermissionKinds as readonly string[]).includes(value);
}

function invalidMetadata(message: string): CasCapabilityError {
  return new CasCapabilityError("INVALID_CAPABILITY_METADATA", message);
}
