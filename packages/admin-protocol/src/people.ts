import { z } from "zod";
import type { AppMemberInvitation, AppMembership } from "./types.js";
import type { PlatformInvitation, PlatformPrincipalListItem } from "./platform-access.js";

const filters = {
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4000).optional(),
};

export const AppPeopleQuerySchema = z.object({
  ...filters,
  filter: z.enum(["current", "members", "pending", "history"]).optional(),
}).strict();

export const PlatformPeopleQuerySchema = z.object({
  ...filters,
  filter: z.enum(["current", "principals", "pending", "history"]).optional(),
  authority: z.enum(["platform.admin", "apps.create", "none"]).optional(),
  effectiveAccess: z.enum(["active", "blocked", "no_access"]).optional(),
}).strict();

export type AppPeopleQuery = z.infer<typeof AppPeopleQuerySchema>;
export type PlatformPeopleQuery = z.infer<typeof PlatformPeopleQuerySchema>;
export type AppPerson =
  | { readonly kind: "member"; readonly membership: AppMembership; readonly joinedAt: number }
  | { readonly kind: "invitation"; readonly invitation: AppMemberInvitation };
export type PlatformPerson =
  | { readonly kind: "principal"; readonly principal: PlatformPrincipalListItem }
  | { readonly kind: "invitation"; readonly invitation: PlatformInvitation };
export interface PeoplePage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
}