import { z } from "zod";
import type { AppMembership, Principal, Profile } from "./types.js";

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

export interface CurrentPlatformAccess {
  readonly principalRef: string;
  readonly status: "active";
  readonly authorities: readonly PlatformAuthority[];
  readonly revision: number;
}

export interface PlatformPrincipal extends PlatformAccessState {
  readonly profile: Profile;
  readonly effectiveAccess: EffectivePlatformAccess;
  readonly appMembershipCount: number;
}

export interface PlatformPrincipalListItem extends PlatformPrincipal {
  readonly lastActiveAt: number | null;
}

export interface PlatformPrincipalDetail extends PlatformPrincipalListItem {
  readonly memberships: readonly AppMembership[];
}

export interface PlatformPrincipalPage {
  readonly items: readonly PlatformPrincipalListItem[];
  readonly nextCursor: string | null;
}

export interface PlatformAccessSummary {
  readonly activePrincipalCount: number;
  readonly platformAdminCount: number;
  readonly appCreatorCount: number;
  readonly blockedPrincipalCount: number;
  readonly generatedAt: number;
}

export const PlatformPrincipalQuerySchema = z.object({
  query: z.string().max(254).optional(),
  effectiveAccess: z.enum(["active", "blocked", "no_access"]).optional(),
  authority: z.union([PlatformAuthoritySchema, z.literal("none")]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().min(1).optional(),
}).strict().readonly();

export type PlatformInvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface PlatformInvitation {
  readonly invitationId: string;
  readonly emailConstraint: string;
  readonly authorities: readonly PlatformAuthority[];
  readonly status: PlatformInvitationStatus;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly createdBy: Principal;
  readonly revision: number;
}

export interface PlatformInvitationPage {
  readonly items: readonly PlatformInvitation[];
  readonly nextCursor: string | null;
}

export const PlatformAuditActionSchema = z.enum([
  "platform_invitation.created",
  "platform_invitation.revoked",
  "platform_invitation.accepted",
  "platform_access.authority_changed",
  "platform_access.blocked",
  "platform_access.restored",
  "platform_access.change_denied",
  "app.create_denied",
]);
export type PlatformAuditAction = z.infer<typeof PlatformAuditActionSchema>;

export interface PlatformAuditEvent {
  readonly eventId: string;
  readonly action: PlatformAuditAction;
  readonly actorPrincipalRef: string | null;
  readonly actorPrincipal: Principal;
  readonly targetPrincipalRef: string | null;
  readonly targetPrincipal: Principal | null;
  readonly targetInvitationId: string | null;
  readonly result: "succeeded" | "denied";
  readonly requestId: string | null;
  readonly createdAt: number;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PlatformAuditPage {
  readonly items: readonly PlatformAuditEvent[];
  readonly nextCursor: string | null;
}

export const PlatformAuditQuerySchema = z.object({
  action: PlatformAuditActionSchema.optional(),
  actorPrincipalRef: z.string().min(1).optional(),
  targetPrincipalRef: z.string().min(1).optional(),
  createdAfter: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().min(1).optional(),
}).strict().readonly();

const PlatformAuthoritiesSchema = z.array(PlatformAuthoritySchema)
  .refine(values => new Set(values).size === values.length);

export const CreatePlatformInvitationSchema = z.object({
  emailConstraint: z.email().max(254),
  authorities: PlatformAuthoritiesSchema.min(1),
}).strict().readonly();

export const PlatformInvitationQuerySchema = z.object({
  query: z.string().max(254).optional(),
  status: z.enum(["pending", "accepted", "expired", "revoked"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().min(1).optional(),
}).strict().readonly();

export const PatchPlatformAccessSchema = z.object({
  status: z.enum(["active", "blocked"]).optional(),
  authorities: PlatformAuthoritiesSchema.optional(),
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