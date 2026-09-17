import { z } from "zod";

export type AppAdminMcpToolScope = "control:read" | "control:write" | "control:security";

export interface AppAdminMcpToolDefinition {
  readonly name: string;
  readonly requiredScope: AppAdminMcpToolScope;
  readonly registration: {
    readonly title?: string;
    readonly description: string;
    readonly inputSchema: z.ZodObject<z.ZodRawShape>;
    readonly annotations: {
      readonly readOnlyHint?: boolean;
      readonly destructiveHint?: boolean;
      readonly idempotentHint?: boolean;
    };
  };
}

const appId = z.string().min(1);
const accountId = z.string().regex(/^acct_[A-Za-z0-9_-]{22}$/);
const spaceId = z.string().min(1);
const cursor = z.string().min(1);
const boundedLimit = z.number().int().min(1).max(200);
const displayName = z.string().min(1).max(100);
const description = z.string().max(2_000);
const idempotencyKey = z.string().min(1).max(128);
const etag = z.string().min(1);
const email = z.string().email();
const url = z.string().url();
const refDomain = z.string().min(1).max(64);
const rootId = z.string().min(1);
const manifestHash = z.string().regex(/^[0-9a-f]{64}$/);

function tool<const Definition extends AppAdminMcpToolDefinition>(definition: Definition): Definition {
  return definition;
}

export const APP_ADMIN_MCP_TOOLS = {
  get_current_account: tool({
    name: "get_current_account",
    requiredScope: "control:read",
    registration: {
      title: "Current UniCAS Account",
      description: "Return the stable Account summary, current masked login identity, authorities, and App memberships.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  get_current_principal: tool({
    name: "get_current_principal",
    requiredScope: "control:read",
    registration: {
      title: "Current UniCAS Principal",
      description: "Deprecated compatibility alias returning the current administrator response. Use get_current_account.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  list_apps: tool({
    name: "list_apps",
    requiredScope: "control:read",
    registration: {
      title: "List UniCAS Apps",
      description: "List Apps administered by the authenticated Principal.",
      inputSchema: z.object({ limit: boundedLimit.optional(), cursor: cursor.optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  get_app: tool({
    name: "get_app",
    requiredScope: "control:read",
    registration: {
      description: "Get one administered App and its current mutation ETag.",
      inputSchema: z.object({ appId }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  list_app_members: tool({
    name: "list_app_members",
    requiredScope: "control:read",
    registration: {
      description: "List App administrators with Principal and Profile kept separate.",
      inputSchema: z.object({ appId, limit: boundedLimit.optional(), cursor: cursor.optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  get_app_oauth_issuer: tool({
    name: "get_app_oauth_issuer",
    requiredScope: "control:read",
    registration: {
      description: "Get discovered OAuth issuer state and the current mutation ETag for an App.",
      inputSchema: z.object({ appId }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  get_app_managed_issuer: tool({
    name: "get_app_managed_issuer",
    requiredScope: "control:read",
    registration: {
      description: "Get the managed issuer state and current mutation ETag for an App.",
      inputSchema: z.object({ appId }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  list_app_playground_file_roots: tool({
    name: "list_app_playground_file_roots",
    requiredScope: "control:read",
    registration: {
      description: "List Principal-owned Playground file roots for an App.",
      inputSchema: z.object({ appId }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  list_app_ref_domains: tool({
    name: "list_app_ref_domains",
    requiredScope: "control:read",
    registration: {
      description: "List refDomains observed in successful App Root Ref writes.",
      inputSchema: z.object({ appId }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  list_app_control_audit_events: tool({
    name: "list_app_control_audit_events",
    requiredScope: "control:read",
    registration: {
      description: "List append-only App control-plane audit events.",
      inputSchema: z.object({
        appId,
        limit: boundedLimit.optional(),
        cursor: cursor.optional(),
        after: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  list_space_root_domain_refs: tool({
    name: "list_space_root_domain_refs",
    requiredScope: "control:read",
    registration: {
      description: "List current non-zero Space Root Ref balances for one App refDomain.",
      inputSchema: z.object({
        appId,
        refDomain,
        spaceId: spaceId.optional(),
        limit: boundedLimit.optional(),
        cursor: cursor.optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  list_space_root_domain_events: tool({
    name: "list_space_root_domain_events",
    requiredScope: "control:read",
    registration: {
      description: "List ordered Space Root Ref events for one App refDomain.",
      inputSchema: z.object({
        appId,
        refDomain,
        spaceId: spaceId.optional(),
        after: z.number().int().min(0).optional(),
        limit: boundedLimit.optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  create_app: tool({
    name: "create_app",
    requiredScope: "control:write",
    registration: {
      description: "Create an App administered by the current Principal.",
      inputSchema: z.object({ displayName, idempotencyKey }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
  }),
  list_platform_principals: tool({
    name: "list_platform_principals",
    requiredScope: "control:security",
    registration: {
      description: "List platform Principals with effective-access and authority filters.",
      inputSchema: z.object({
        query: z.string().max(254).optional(),
        effectiveAccess: z.enum(["active", "blocked", "no_access"]).optional(),
        authority: z.enum(["platform.admin", "apps.create", "none"]).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        cursor: cursor.optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  get_platform_principal: tool({
    name: "get_platform_principal",
    requiredScope: "control:security",
    registration: {
      description: "Read one platform Principal, current authorities, status, and App memberships.",
      inputSchema: z.object({ principalRef: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  update_platform_access: tool({
    name: "update_platform_access",
    requiredScope: "control:security",
    registration: {
      description: "Conditionally replace Platform Access fields using the current ETag and exact Principal ref confirmation.",
      inputSchema: z.object({
        principalRef: z.string().min(1),
        confirmPrincipalRef: z.string().min(1),
        status: z.enum(["active", "blocked"]).optional(),
        authorities: z.array(z.enum(["platform.admin", "apps.create"])).optional(),
        etag,
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
  }),
  list_platform_invitations: tool({
    name: "list_platform_invitations",
    requiredScope: "control:security",
    registration: {
      description: "List platform invitation lifecycle records without bearer tokens or accept URLs.",
      inputSchema: z.object({
        query: z.string().max(254).optional(),
        status: z.enum(["pending", "accepted", "expired", "revoked"]).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        cursor: cursor.optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  create_platform_invitation: tool({
    name: "create_platform_invitation",
    requiredScope: "control:security",
    registration: {
      description: "Create a verified-email invitation carrying explicit platform authorities.",
      inputSchema: z.object({
        email,
        confirmEmail: email,
        authorities: z.array(z.enum(["platform.admin", "apps.create"])).min(1),
        idempotencyKey,
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
  }),
  revoke_platform_invitation: tool({
    name: "revoke_platform_invitation",
    requiredScope: "control:security",
    registration: {
      description: "Revoke a pending platform invitation using its current ETag and exact ID confirmation.",
      inputSchema: z.object({
        invitationId: z.string().min(1),
        confirmInvitationId: z.string().min(1),
        etag,
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
  }),
  list_platform_audit_events: tool({
    name: "list_platform_audit_events",
    requiredScope: "control:security",
    registration: {
      description: "List durable platform authorization audit events with exact filters and opaque pagination.",
      inputSchema: z.object({
        action: z.enum([
          "platform_invitation.created",
          "platform_invitation.revoked",
          "platform_invitation.accepted",
          "platform_access.authority_changed",
          "platform_access.blocked",
          "platform_access.restored",
          "platform_access.change_denied",
          "app.create_denied",
        ]).optional(),
        actorPrincipalRef: z.string().min(1).optional(),
        targetPrincipalRef: z.string().min(1).optional(),
        createdAfter: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        cursor: cursor.optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  list_app_member_invitations: tool({
    name: "list_app_member_invitations",
    requiredScope: "control:security",
    registration: {
      description: "List App invitation lifecycle records without bearer tokens or accept URLs.",
      inputSchema: z.object({ appId, status: z.enum(["pending", "accepted", "expired", "revoked"]).optional(), limit: z.number().int().min(1).max(1000).optional(), cursor: cursor.optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  }),
  revoke_app_member_invitation: tool({
    name: "revoke_app_member_invitation",
    requiredScope: "control:security",
    registration: {
      description: "Revoke a pending App invitation with its own current ETag and exact invitation ID confirmation; return only the resulting ETag.",
      inputSchema: z.object({ appId, invitationId: z.string().min(1), confirmInvitationId: z.string().min(1), etag }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
  }),
  update_app: tool({
    name: "update_app",
    requiredScope: "control:write",
    registration: {
      description: "Update App metadata or suspend/restore it using its current ETag; returns only the resulting ETag.",
      inputSchema: z.object({
        appId,
        displayName: displayName.optional(),
        description: description.optional(),
        status: z.enum(["active", "suspended"]).optional(),
        etag,
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
  }),
  invite_app_member: tool({
    name: "invite_app_member",
    requiredScope: "control:security",
    registration: {
      description: "Create an email-bound invitation granting equal App administrator authority.",
      inputSchema: z.object({ appId, email, confirmEmail: email, idempotencyKey }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
  }),
  accept_app_member_invitation: tool({
    name: "accept_app_member_invitation",
    requiredScope: "control:security",
    registration: {
      description: "Accept an App administrator invitation for the current Principal.",
      inputSchema: z.object({ token: z.string().min(1) }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
  }),
  remove_app_member: tool({
    name: "remove_app_member",
    requiredScope: "control:security",
    registration: {
      description: "Idempotently remove an App administrator selected by stable Account ID.",
      inputSchema: z.object({
        appId,
        accountId,
        confirmAccountId: accountId,
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
  }),
  create_app_playground_file_root: tool({
    name: "create_app_playground_file_root",
    requiredScope: "control:write",
    registration: {
      description: "Create a Principal-owned Playground file root for an App.",
      inputSchema: z.object({ appId, rootId, name: displayName, manifestHash }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
  }),
  update_app_playground_file_root: tool({
    name: "update_app_playground_file_root",
    requiredScope: "control:write",
    registration: {
      description: "Update a Principal-owned Playground file root using its current ETag.",
      inputSchema: z.object({ appId, rootId, name: displayName, manifestHash, etag }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
  }),
  delete_app_playground_file_root: tool({
    name: "delete_app_playground_file_root",
    requiredScope: "control:write",
    registration: {
      description: "Delete a Principal-owned Playground file root using its current ETag.",
      inputSchema: z.object({ appId, rootId, etag, confirmRootId: rootId }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
  }),
  inspect_app_oauth_issuer: tool({
    name: "inspect_app_oauth_issuer",
    requiredScope: "control:security",
    registration: {
      description: "Create an independent candidate issuer inspection without changing current App authority; returns only proof inputs and discovery review data.",
      inputSchema: z.object({ appId, issuer: url }).strict(),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
  }),
  activate_app_oauth_issuer: tool({
    name: "activate_app_oauth_issuer",
    requiredScope: "control:security",
    registration: {
      description: "Atomically activate or replace a verified App issuer. Use ifNoneMatch '*' for initial activation or the current issuer etag for replacement; returns only the resulting ETag.",
      inputSchema: z.object({
        appId,
        inspectionId: z.string().min(1),
        activationProof: z.string().min(1),
        etag: etag.optional(),
        ifNoneMatch: z.literal("*").optional(),
      }).refine(input => !(input.etag !== undefined && input.ifNoneMatch !== undefined)),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
  }),
  update_app_managed_issuer: tool({
    name: "update_app_managed_issuer",
    requiredScope: "control:security",
    registration: {
      description: "Enable or disable the managed App issuer using its current ETag.",
      inputSchema: z.object({ appId, enabled: z.boolean(), etag }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
  }),
  mint_managed_space_capability: tool({
    name: "mint_managed_space_capability",
    requiredScope: "control:security",
    registration: {
      description: "Mint a short-lived managed capability for the current Principal's personal Space in an App.",
      inputSchema: z.object({ appId }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
  }),
} as const;

export const APP_ADMIN_MCP_TOOL_LIST: readonly AppAdminMcpToolDefinition[] =
  Object.values(APP_ADMIN_MCP_TOOLS);

export type AppAdminMcpToolName = keyof typeof APP_ADMIN_MCP_TOOLS;