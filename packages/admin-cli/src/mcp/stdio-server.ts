/**
 * `unicas mcp`: a stdio MCP server exposing the same tool contract as the
 * remote control-plane MCP server, backed by the local `/admin` HTTP client
 * (the authenticated session from `unicas login`). No MCP-to-MCP forwarding.
 *
 * This is what DSH (DeepSeek Harness) or any stdio-capable MCP client
 * launches with `command: "unicas", args: ["mcp"]`. Only MCP protocol frames
 * are written to stdout; all diagnostics go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AdminClient, PlatformAuditAction, PlatformAuthority } from "@unicas/admin-client";
import { createAdminClient } from "@unicas/admin-client";
import type { AppAdminMcpToolName } from "@unicas/admin-protocol";
import type { ToolDefinition } from "./catalog.js";
import { TOOL_CATALOG } from "./catalog.js";
import type { TokenStore } from "../store.js";

export interface McpStdioServerOptions {
  readonly adminOrigin: string;
  readonly store: TokenStore;
  /** Injectable fetch for tests. */
  readonly fetchImpl?: typeof fetch;
  /** Diagnostic log sink; defaults to stderr. */
  readonly log?: (message: string) => void;
  /** Test-only: inject a custom transport instead of stdio. */
  readonly transport?: Transport;
}

export async function runMcpStdioServer(options: McpStdioServerOptions): Promise<void> {
  const server = new McpServer({
    name: "unicas-control-plane-cli",
    version: "0.1.0",
  });

  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const holder: { admin?: AdminClient } = {};
  const getOrCreateAdmin = async (): Promise<AdminClient> => {
    if (holder.admin !== undefined) return holder.admin;
    let session = await options.store.load();
    if (session.cookie.length === 0 || session.csrfToken.length === 0) {
      throw new Error("Not logged in. Run `unicas login` first.");
    }
    holder.admin = createAdminClient({
      baseUrl: options.adminOrigin,
      getSession: async () => ({ cookie: session.cookie, csrfToken: session.csrfToken }),
      onSessionChanged: async next => {
        session = { ...session, ...next };
        await options.store.save(session);
      },
      fetcher: options.fetchImpl,
    });
    return holder.admin;
  };

  for (const tool of TOOL_CATALOG) {
    registerCatalogTool(server, tool, getOrCreateAdmin, log);
  }

  const transport = options.transport ?? new StdioServerTransport();
  await server.connect(transport);
}

type ToolHandler = (admin: AdminClient, args: Record<string, unknown>) => Promise<unknown>;

function registerCatalogTool(
  server: McpServer,
  tool: ToolDefinition,
  getOrCreateAdmin: () => Promise<AdminClient>,
  log: (message: string) => void,
): void {
  const handler = TOOL_HANDLERS[tool.name as keyof typeof TOOL_HANDLERS];
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.annotations.readOnlyHint,
        destructiveHint: tool.annotations.destructiveHint,
        idempotentHint: tool.annotations.idempotentHint,
      },
    },
    async (args: Record<string, unknown>) => {
      if (handler === undefined) {
        return toolError(`no local handler for tool '${tool.name}'`);
      }
      try {
        const admin = await getOrCreateAdmin();
        const result = await handler(admin, args);
        const structuredContent = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
          structuredContent,
          isError: false,
        };
      } catch (error) {
        log(`unicas mcp: tool '${tool.name}' failed: ${error instanceof Error ? error.message : String(error)}`);
        const structuredContent = { error: "CLIENT_ERROR", message: error instanceof Error ? error.message : String(error) };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
          structuredContent,
          isError: true,
        };
      }
    },
  );
}

function toolError(message: string): { content: { type: "text"; text: string }[]; structuredContent: { error: string; message: string }; isError: true } {
  const structuredContent = { error: "CLIENT_ERROR", message };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  };
}

async function resolveEtag(
  admin: AdminClient,
  loader: () => Promise<{ etag: string }>,
  resource: string,
  provided: unknown,
): Promise<string> {
  if (typeof provided === "string" && provided.length > 0) return provided;
  const { etag } = await loader();
  if (etag.length === 0) throw new Error(`could not resolve the current ETag for ${resource}`);
  return etag;
}

/** Maps the remote tool contract to admin-client operations. */
const TOOL_HANDLERS = {
  async list_platform_accounts(admin, args) {
    const effectiveAccess = args.effectiveAccess;
    const authority = args.authority;
    return admin.listPlatformAccounts({
      ...pick(args, ["query", "limit", "cursor"]),
      ...(effectiveAccess === undefined ? {} : { effectiveAccess: str(effectiveAccess) as "active" | "blocked" | "no_access" }),
      ...(authority === undefined ? {} : { authority: str(authority) as PlatformAuthority | "none" }),
    });
  },

  async get_platform_account(admin, args) {
    return admin.getPlatformAccount({ accountId: str(args.accountId) });
  },

  async grant_platform_authority(admin, args) {
    const accountId = confirmedAccountId(args);
    await admin.grantPlatformAccountAuthority({ accountId, authority: str(args.authority) as PlatformAuthority });
    return { ok: true };
  },

  async revoke_platform_authority(admin, args) {
    const accountId = confirmedAccountId(args);
    await admin.revokePlatformAccountAuthority({ accountId, authority: str(args.authority) as PlatformAuthority });
    return { ok: true };
  },

  async block_platform_account(admin, args) {
    const accountId = confirmedAccountId(args);
    await admin.blockPlatformAccount({ accountId });
    return { ok: true };
  },

  async restore_platform_account(admin, args) {
    const accountId = confirmedAccountId(args);
    await admin.restorePlatformAccount({ accountId });
    return { ok: true };
  },

  async list_platform_audit_events(admin, args) {
    return admin.listPlatformAuditEvents({
      ...pick(args, ["actorAccountId", "targetAccountId", "createdAfter", "limit", "cursor"]),
      ...(args.action === undefined ? {} : { action: str(args.action) as PlatformAuditAction }),
    });
  },

  async list_platform_invitations(admin, args) {
    const status = args.status;
    if (status !== undefined && status !== "pending" && status !== "accepted" && status !== "expired" && status !== "revoked") {
      throw new Error("invalid invitation status");
    }
    return admin.listPlatformInvitations({
      ...pick(args, ["query", "limit", "cursor"]),
      ...(status === undefined ? {} : { status }),
    });
  },

  async create_platform_invitation(admin, args) {
    requireMatch(args.confirmEmail, args.email, "confirmEmail must exactly match the invited email");
    const requested = args.authorities;
    if (!Array.isArray(requested) || requested.some(authority => authority !== "platform.admin" && authority !== "apps.create")) {
      throw new Error("invalid platform authorities");
    }
    return admin.createPlatformInvitation(
      { emailConstraint: str(args.email), authorities: requested as PlatformAuthority[] },
      str(args.idempotencyKey),
    );
  },

  async revoke_platform_invitation(admin, args) {
    requireMatch(args.confirmInvitationId, args.invitationId, "confirmInvitationId must exactly match invitationId");
    return admin.revokePlatformInvitation({ invitationId: str(args.invitationId) }, str(args.etag));
  },

  async list_app_member_invitations(admin, args) {
    const status = args.status;
    if (status !== undefined && status !== "pending" && status !== "accepted" && status !== "expired" && status !== "revoked") {
      throw new Error("invalid invitation status");
    }
    return admin.listAppMemberInvitations({ appId: str(args.appId) }, { ...pick(args, ["limit", "cursor"]), ...(status === undefined ? {} : { status }) });
  },

  async revoke_app_member_invitation(admin, args) {
    requireMatch(args.confirmInvitationId, args.invitationId, "confirmInvitationId must exactly match invitationId");
    return admin.revokeAppMemberInvitation({ appId: str(args.appId), invitationId: str(args.invitationId) }, str(args.etag));
  },

  async get_current_account(admin) {
    return currentAccountOutput(await admin.getCurrentAdministrator());
  },

  async list_apps(admin, args) {
    return admin.listApps(pick(args, ["limit", "cursor"]));
  },

  async get_app(admin, args) {
    const result = await admin.getApp({ appId: str(args.appId) });
    return { ...result.value, etag: result.etag };
  },

  async create_app(admin, args) {
    const result = await admin.createApp(
      { displayName: str(args.displayName) },
      { idempotencyKey: str(args.idempotencyKey) },
    );
    return { ...result.value, etag: result.etag };
  },

  async update_app(admin, args) {
    const appId = str(args.appId);
    const status = args.status;
    if (status !== undefined && status !== "active" && status !== "suspended") {
      throw new Error("status must be active or suspended");
    }
    const result = await admin.patchApp(
      { appId },
      {
        ...(args.displayName !== undefined ? { displayName: str(args.displayName) } : {}),
        ...(args.description !== undefined ? { description: str(args.description) } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      str(args.etag),
    );
    return result;
  },

  async list_app_members(admin, args) {
    return admin.listAppMembers(
      { appId: str(args.appId) },
      pick(args, ["limit", "cursor"]),
    );
  },

  async invite_app_member(admin, args) {
    requireMatch(args.confirmEmail, args.email, "confirmEmail must exactly match the invited email");
    return admin.createAppMemberInvitation(
      { appId: str(args.appId) },
      { emailConstraint: str(args.email) },
      { idempotencyKey: str(args.idempotencyKey) },
    );
  },

  async accept_app_member_invitation(admin, args) {
    return admin.acceptAppMemberInvitation({ token: str(args.token) });
  },

  async remove_app_member(admin, args) {
    const accountId = str(args.accountId);
    requireMatch(args.confirmAccountId, accountId, "confirmAccountId must exactly match accountId");
    return admin.deleteAppMember({ appId: str(args.appId), accountId });
  },

  async list_app_playground_file_roots(admin, args) {
    return admin.listAppPlaygroundFileRoots({ appId: str(args.appId) });
  },

  async create_app_playground_file_root(admin, args) {
    const result = await admin.createAppPlaygroundFileRoot(
      { appId: str(args.appId) },
      {
        rootId: str(args.rootId),
        name: str(args.name),
        manifestHash: str(args.manifestHash),
      },
    );
    return { ...result.value, etag: result.etag };
  },

  async update_app_playground_file_root(admin, args) {
    const result = await admin.patchAppPlaygroundFileRoot(
      { appId: str(args.appId), rootId: str(args.rootId) },
      { name: str(args.name), manifestHash: str(args.manifestHash) },
      str(args.etag),
    );
    return { ...result.value, etag: result.etag };
  },

  async delete_app_playground_file_root(admin, args) {
    const rootId = str(args.rootId);
    requireMatch(args.confirmRootId, rootId, "confirmRootId must exactly match rootId");
    return admin.deleteAppPlaygroundFileRoot(
      { appId: str(args.appId), rootId },
      str(args.etag),
    );
  },

  async get_app_oauth_issuer(admin, args) {
    const result = await admin.getAppOAuthIssuer({ appId: str(args.appId) });
    if (result.value === null) throw new Error("OAuth issuer is not configured");
    return { ...result.value, etag: result.etag };
  },

  async inspect_app_oauth_issuer(admin, args) {
    const result = await admin.inspectAppOAuthIssuer(
      { appId: str(args.appId) },
      { issuer: str(args.issuer) },
    );
    return result;
  },

  async activate_app_oauth_issuer(admin, args) {
    const appId = str(args.appId);
    if (args.ifNoneMatch !== undefined && (args.ifNoneMatch !== "*" || args.etag !== undefined)) {
      throw new Error("provide exactly one issuer precondition");
    }
    const precondition = args.ifNoneMatch === "*" ? { ifNoneMatch: "*" as const } : await resolveEtag(
      admin,
      () => admin.getAppOAuthIssuer({ appId }),
      "App OAuth issuer",
      args.etag,
    );
    const result = await admin.activateAppOAuthIssuer(
      { appId },
      { inspectionId: str(args.inspectionId), activationProof: str(args.activationProof) },
      precondition,
    );
    return result;
  },

  async get_app_managed_issuer(admin, args) {
    const result = await admin.getAppManagedIssuer({ appId: str(args.appId) });
    return { ...result.value, etag: result.etag };
  },

  async update_app_managed_issuer(admin, args) {
    const result = await admin.patchAppManagedIssuer(
      { appId: str(args.appId) },
      { enabled: args.enabled === true },
      str(args.etag),
    );
    return { ...result.value, etag: result.etag };
  },

  async mint_managed_space_capability(admin, args) {
    return admin.mintManagedSpaceCapability({ appId: str(args.appId) });
  },

  async list_app_ref_domains(admin, args) {
    return admin.listAppRefDomains({ appId: str(args.appId) });
  },

  async list_app_control_audit_events(admin, args) {
    return admin.listAppControlAuditEvents(
      { appId: str(args.appId) },
      pick(args, ["limit", "cursor", "after", "actorAccountId", "targetAccountId"]),
    );
  },

  async list_space_root_domain_refs(admin, args) {
    return admin.listSpaceRootDomainRefs(
      { appId: str(args.appId), refDomain: str(args.refDomain) },
      pick(args, ["spaceId", "limit", "cursor"]),
    );
  },

  async list_space_root_domain_events(admin, args) {
    return admin.listSpaceRootDomainEvents(
      { appId: str(args.appId), refDomain: str(args.refDomain) },
      pick(args, ["spaceId", "after", "limit"]),
    );
  },
} satisfies Readonly<Record<AppAdminMcpToolName, ToolHandler>>;

function currentAccountOutput(current: Awaited<ReturnType<AdminClient["getCurrentAdministrator"]>>) {
  return {
    account: {
      accountId: current.account.accountId,
      displayName: current.account.displayName,
      primaryVerifiedEmail: current.account.primaryVerifiedEmail,
      avatar: current.account.avatar,
    },
    authenticatedIdentity: current.authenticatedIdentity,
    platformAuthorities: current.account.platformAuthorities,
    memberships: current.memberships,
  };
}

function str(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`expected a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireMatch(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message);
}

function confirmedAccountId(args: Record<string, unknown>): string {
  const accountId = str(args.accountId);
  requireMatch(args.confirmAccountId, accountId, "confirmAccountId must exactly match accountId");
  return accountId;
}

function pick(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return out;
}
