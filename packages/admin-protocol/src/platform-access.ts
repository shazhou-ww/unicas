import { z } from "zod";
import type { AccountId } from "./types.js";

export const PlatformAuthoritySchema = z.enum(["platform.admin", "apps.create"]);
export type PlatformAuthority = z.infer<typeof PlatformAuthoritySchema>;
export const PlatformAccountQuerySchema = z.object({
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
  readonly createdByAccountId: AccountId;
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