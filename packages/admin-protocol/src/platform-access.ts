import { z } from "zod";
import type { Principal, Profile } from "./types.js";

export const PlatformAuthoritySchema = z.enum(["platform.admin", "apps.create"]);
export type PlatformAuthority = z.infer<typeof PlatformAuthoritySchema>;
export type PlatformAccessStatus = "active" | "blocked";
export type EffectivePlatformAccess = "active" | "blocked" | "no_access";

export interface PlatformAccessState {
  readonly principalRef: string;
  readonly principal: Principal;
  readonly status: PlatformAccessStatus;
  readonly authorities: readonly PlatformAuthority[];
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlatformPrincipal extends PlatformAccessState {
  readonly profile: Profile;
  readonly effectiveAccess: EffectivePlatformAccess;
  readonly appMembershipCount: number;
}

export const PatchPlatformAccessSchema = z.object({
  status: z.enum(["active", "blocked"]).optional(),
  authorities: z.array(PlatformAuthoritySchema).refine(values => new Set(values).size === values.length).optional(),
}).strict().refine(value => value.status !== undefined || value.authorities !== undefined).readonly();

export function effectivePlatformAccess(
  state: Pick<PlatformAccessState, "status" | "authorities"> | null,
  hasAppMembership: boolean,
): EffectivePlatformAccess {
  if (state?.status === "blocked") return "blocked";
  return state?.status === "active" && state.authorities.length > 0 || hasAppMembership
    ? "active" : "no_access";
}

export function hasPlatformAuthority(
  state: Pick<PlatformAccessState, "status" | "authorities"> | null,
  authority: PlatformAuthority,
): boolean {
  return state?.status === "active" && state.authorities.includes(authority);
}