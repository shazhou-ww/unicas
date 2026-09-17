import { McpServer } from "@modelcontextprotocol/server";
import {
  AccountServiceError,
  PlatformAccessError,
  type AccountService,
  type PlatformAccessService,
  type PlatformAuditService,
  type PlatformInvitationService,
  type ControlPlaneCallContext,
  type ControlPlaneOperations,
  type VerifiedEmailEvidence,
} from "@unicas/service";
import {
  APP_ADMIN_MCP_TOOLS,
  CasAdminErrorCodes,
  formatCasAdminETag,
  type AppAdminRoute,
  type CasAdminErrorResponse,
  type PlatformAuthority,
  type AccountId,
  type ProviderKind,
} from "@unicas/admin-protocol";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { transformAppAdminError, transformAppAdminResponse } from "../app-admin-adapter.js";

export interface ControlPlaneMcpGrantProps extends Record<string, unknown> {
  readonly accountId?: AccountId;
  readonly externalIdentityId?: string;
  readonly credentialVersion?: number;
  readonly authProvider?: ProviderKind;
  readonly authenticatedAt?: number;
  readonly identityIssuer: string;
  readonly subject: string;
  readonly displayName: string | null;
  readonly emailForDisplay: string | null;
  readonly verifiedEmailEvidence?: readonly VerifiedEmailEvidence[];
  readonly scopes: readonly string[];
  readonly oauthClientId: string;
  readonly oauthClientHandle: string;
}

export interface ControlPlaneMcpServerOptions {
  readonly auditReader?: Fetcher;
  readonly auditReaderKey?: string;
  readonly publicOrigin?: string;
  readonly mutationsEnabled?: boolean;
  readonly authorizePlatformOperation?: (
    grant: ControlPlaneMcpGrantProps,
    authority: PlatformAuthority,
  ) => Promise<CasAdminErrorResponse | null>;
  readonly platformInvitations?: PlatformInvitationService;
  readonly platformAudit?: PlatformAuditService;
  readonly platformAccess?: PlatformAccessService;
  readonly accountService?: AccountService;
}

export function createControlPlaneMcpServer(
  controlPlane: ControlPlaneOperations,
  options: ControlPlaneMcpServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: "unicas-control-plane",
    version: "0.1.0",
  });

  server.registerTool(
    "whoami",
    {
      title: "Legacy UniCAS operator",
      description: "Return the authenticated operator identity and current Stack memberships from the v1 contract.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.me(serviceContext(grant, "whoami"));
      return toolResult(result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.get_current_account.name,
    APP_ADMIN_MCP_TOOLS.get_current_account.registration,
    async () => {
      const grant = requireGrantScope("control:read");
      return accountToolResult(async () => {
        if (!options.accountService) throw new Error("Account service unavailable");
        const actor = await options.accountService.resolveExternalIdentity(grant.identityIssuer, grant.subject);
        if (!actor) throw new AccountServiceError("IDENTITY_NOT_FOUND");
        const account = await options.accountService.getSelf(
          actor.account.accountId,
          actor.authenticatedIdentity.externalIdentityId,
          [],
        );
        const authenticatedIdentity = account.identities.find(identity => identity.currentLogin);
        if (!authenticatedIdentity) throw new AccountServiceError("IDENTITY_NOT_FOUND");
        return {
          account: {
            accountId: account.accountId,
            displayName: account.displayName,
            primaryVerifiedEmail: account.primaryVerifiedEmail,
            avatar: account.avatar,
          },
          authenticatedIdentity,
          platformAuthorities: account.platformAuthorities,
          memberships: await options.accountService.listAccountMemberships(account.accountId),
        };
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.get_current_principal.name,
    APP_ADMIN_MCP_TOOLS.get_current_principal.registration,
    async () => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.me(serviceContext(grant, "get_current_principal"));
      return appToolResult({ operation: "me" }, result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_apps.name,
    APP_ADMIN_MCP_TOOLS.list_apps.registration,
    async ({ limit, cursor }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.listStacks(serviceContext(grant, "list_apps"), {
        query: { limit, cursor },
      });
      return appToolResult({ operation: "listApps" }, result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.get_app.name,
    APP_ADMIN_MCP_TOOLS.get_app.registration,
    async ({ appId }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.getStack(
        serviceContext(grant, "get_app"),
        { path: { stackId: appId } },
      );
      return appToolResult({ operation: "getApp", appId }, withEtag(result));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_app_members.name,
    APP_ADMIN_MCP_TOOLS.list_app_members.registration,
    async ({ appId, limit, cursor }) => {
      const grant = requireGrantScope("control:read");
      return accountToolResult(async () => {
        if (!options.accountService) throw new Error("Account service unavailable");
        const actor = await options.accountService.resolveExternalIdentity(grant.identityIssuer, grant.subject);
        if (!actor) throw new AccountServiceError("IDENTITY_NOT_FOUND");
        return options.accountService.listAppMembers({
          actorAccountId: actor.account.accountId,
          appId,
          limit,
          cursor,
        });
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.get_app_oauth_issuer.name,
    APP_ADMIN_MCP_TOOLS.get_app_oauth_issuer.registration,
    async ({ appId }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.getOAuthIssuer(
        serviceContext(grant, "get_app_oauth_issuer"),
        { path: { stackId: appId } },
      );
      if (result === null) return toolResult({ error: "NOT_FOUND", message: "OAuth issuer is not configured" });
      return appToolResult({ operation: "getOAuthIssuer", appId }, withEtag(result));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.get_app_managed_issuer.name,
    APP_ADMIN_MCP_TOOLS.get_app_managed_issuer.registration,
    async ({ appId }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.getManagedOAuthIssuer(
        serviceContext(grant, "get_app_managed_issuer"),
        { path: { stackId: appId } },
      );
      return appToolResult({ operation: "getManagedIssuer", appId }, withEtag(result));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_app_playground_file_roots.name,
    APP_ADMIN_MCP_TOOLS.list_app_playground_file_roots.registration,
    async ({ appId }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.listPlaygroundFileRoots(
        serviceContext(grant, "list_app_playground_file_roots"),
        { path: { stackId: appId } },
      );
      return appToolResult({ operation: "listPlaygroundFileRoots", appId }, result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_app_ref_domains.name,
    APP_ADMIN_MCP_TOOLS.list_app_ref_domains.registration,
    async ({ appId }) => {
      const grant = requireGrantScope("control:read");
      const context = serviceContext(grant, "list_app_ref_domains");
      const membership = await controlPlane.getStack(context, { path: { stackId: appId } });
      if ("error" in membership) return toolResult(membership);
      const result = await auditReaderValue(options, "/_internal/audit/domains", { stackId: appId });
      return appToolResult({ operation: "listRefDomains", appId }, result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_app_control_audit_events.name,
    APP_ADMIN_MCP_TOOLS.list_app_control_audit_events.registration,
    async ({ appId, limit, cursor, after, actorAccountId, targetAccountId }) => {
      const grant = requireGrantScope("control:read");
      return accountToolResult(async () => {
        const actor = await requireGrantAccount(grant, options);
        return options.accountService!.listAppAuditEvents({
          actorAccountId: actor.account.accountId,
          appId,
          query: { limit, cursor, after, actorAccountId, targetAccountId },
        });
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_space_root_domain_refs.name,
    APP_ADMIN_MCP_TOOLS.list_space_root_domain_refs.registration,
    async ({ appId, refDomain, spaceId, limit, cursor }) => {
      const grant = requireGrantScope("control:read");
      const context = serviceContext(grant, "list_space_root_domain_refs");
      const membership = await controlPlane.getStack(context, { path: { stackId: appId } });
      if ("error" in membership) return toolResult(membership);
      const result = await auditReaderValue(options, "/_internal/audit/refs", {
        stackId: appId,
        refDomain,
        tenantId: spaceId,
        limit: limit === undefined ? undefined : String(limit),
        cursor,
      });
      return appToolResult({ operation: "listRootDomainRefs", appId, refDomain }, result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_space_root_domain_events.name,
    APP_ADMIN_MCP_TOOLS.list_space_root_domain_events.registration,
    async ({ appId, refDomain, spaceId, after, limit }) => {
      const grant = requireGrantScope("control:read");
      const context = serviceContext(grant, "list_space_root_domain_events");
      const membership = await controlPlane.getStack(context, { path: { stackId: appId } });
      if ("error" in membership) return toolResult(membership);
      const result = await auditReaderValue(options, "/_internal/audit/events", {
        stackId: appId,
        refDomain,
        tenantId: spaceId,
        after: after === undefined ? undefined : String(after),
        limit: limit === undefined ? undefined : String(limit),
      });
      return appToolResult({ operation: "listRootDomainEvents", appId, refDomain }, result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.create_app.name,
    APP_ADMIN_MCP_TOOLS.create_app.registration,
    async ({ displayName, idempotencyKey }) => {
      const grant = requireMutation("control:write", options);
      const authorizationError = await options.authorizePlatformOperation?.(grant, "apps.create");
      if (authorizationError) return toolResult(authorizationError);
      const result = await controlPlane.createStack(
        serviceContext(grant, "create_app"),
        { body: { displayName } },
        { idempotencyKey },
      );
      return appToolResult({ operation: "createApp" }, withEtag(result));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_platform_accounts.name,
    APP_ADMIN_MCP_TOOLS.list_platform_accounts.registration,
    async ({ query, effectiveAccess, authority, limit, cursor }) => {
      const grant = requireGrantScope("control:security");
      const authorizationError = await options.authorizePlatformOperation?.(grant, "platform.admin");
      if (authorizationError) return toolResult(authorizationError);
      return accountToolResult(async () => {
        const actor = await requireGrantAccount(grant, options);
        return options.accountService!.listPlatformAccounts({
          actorAccountId: actor.account.accountId,
          query: { query, effectiveAccess, authority, limit, cursor },
        });
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.get_platform_account.name,
    APP_ADMIN_MCP_TOOLS.get_platform_account.registration,
    async ({ accountId }) => {
      const grant = requireGrantScope("control:security");
      const authorizationError = await options.authorizePlatformOperation?.(grant, "platform.admin");
      if (authorizationError) return toolResult(authorizationError);
      return accountToolResult(async () => {
        const actor = await requireGrantAccount(grant, options);
        return options.accountService!.getPlatformAccount(actor.account.accountId, accountId);
      });
    },
  );

  for (const command of [
    { definition: APP_ADMIN_MCP_TOOLS.grant_platform_authority, kind: "authority" as const, grant: true },
    { definition: APP_ADMIN_MCP_TOOLS.revoke_platform_authority, kind: "authority" as const, grant: false },
    { definition: APP_ADMIN_MCP_TOOLS.block_platform_account, kind: "block" as const, blocked: true },
    { definition: APP_ADMIN_MCP_TOOLS.restore_platform_account, kind: "block" as const, blocked: false },
  ]) {
    server.registerTool(command.definition.name, command.definition.registration, async (args) => {
      const grant = requireMutation("control:security", options);
      if (args.accountId !== args.confirmAccountId) return confirmationError("confirmAccountId must exactly match accountId");
      const authorizationError = await options.authorizePlatformOperation?.(grant, "platform.admin");
      if (authorizationError) return toolResult(authorizationError);
      return accountToolResult(async () => {
        const actor = await requireGrantAccount(grant, options);
        if (command.kind === "authority") {
          if (!("authority" in args)) throw new Error("Authority argument unavailable");
          await options.accountService!.setPlatformAuthority({
            actorAccountId: actor.account.accountId,
            actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
            targetAccountId: args.accountId,
            authority: args.authority as PlatformAuthority,
            grant: command.grant,
          });
        } else {
          await options.accountService!.setPlatformBlocked({
            actorAccountId: actor.account.accountId,
            actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
            targetAccountId: args.accountId,
            blocked: command.blocked,
          });
        }
        return { ok: true };
      });
    });
  }

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_platform_invitations.name,
    APP_ADMIN_MCP_TOOLS.list_platform_invitations.registration,
    async ({ query, status, limit, cursor }) => {
      const grant = requireGrantScope("control:security");
      const authorizationError = await options.authorizePlatformOperation?.(grant, "platform.admin");
      if (authorizationError) return toolResult(authorizationError);
      if (!options.platformInvitations) return toolResult({ error: "SERVICE_UNAVAILABLE" });
      return platformToolResult(() => options.platformInvitations!.list(
        grantPrincipal(grant),
        { query, status, limit, cursor },
      ));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.create_platform_invitation.name,
    APP_ADMIN_MCP_TOOLS.create_platform_invitation.registration,
    async ({ email, confirmEmail, authorities, idempotencyKey }) => {
      const grant = requireMutation("control:security", options);
      if (email !== confirmEmail) return confirmationError("confirmEmail must exactly match email");
      const authorizationError = await options.authorizePlatformOperation?.(grant, "platform.admin");
      if (authorizationError) return toolResult(authorizationError);
      if (!options.platformInvitations || !options.publicOrigin) return toolResult({ error: "SERVICE_UNAVAILABLE" });
      return platformToolResult(async () => {
        const created = await options.platformInvitations!.create(
          grantPrincipal(grant),
          { emailConstraint: email, authorities },
          idempotencyKey,
        );
        return {
          invitationId: created.invitationId,
          acceptUrl: new URL(created.acceptUrl, options.publicOrigin).toString(),
          expiresAt: created.expiresAt,
          etag: formatCasAdminETag(created.revision),
        };
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.revoke_platform_invitation.name,
    APP_ADMIN_MCP_TOOLS.revoke_platform_invitation.registration,
    async ({ invitationId, confirmInvitationId, etag }) => {
      const grant = requireMutation("control:security", options);
      if (invitationId !== confirmInvitationId) return confirmationError("confirmInvitationId must exactly match invitationId");
      const authorizationError = await options.authorizePlatformOperation?.(grant, "platform.admin");
      if (authorizationError) return toolResult(authorizationError);
      if (!options.platformInvitations) return toolResult({ error: "SERVICE_UNAVAILABLE" });
      return platformToolResult(async () => {
        const revoked = await options.platformInvitations!.revoke(grantPrincipal(grant), invitationId, etag);
        return { etag: formatCasAdminETag(revoked.revision) };
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_platform_audit_events.name,
    APP_ADMIN_MCP_TOOLS.list_platform_audit_events.registration,
    async ({ action, actorAccountId, targetAccountId, createdAfter, limit, cursor }) => {
      const grant = requireGrantScope("control:security");
      const authorizationError = await options.authorizePlatformOperation?.(grant, "platform.admin");
      if (authorizationError) return toolResult(authorizationError);
      return accountToolResult(async () => {
        const actor = await requireGrantAccount(grant, options);
        return options.accountService!.listPlatformAuditEvents({
          actorAccountId: actor.account.accountId,
          query: { action, actorAccountId, targetAccountId, createdAfter, limit, cursor },
        });
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.list_app_member_invitations.name,
    APP_ADMIN_MCP_TOOLS.list_app_member_invitations.registration,
    async ({ appId, status, limit, cursor }) => {
      const grant = requireGrantScope("control:security");
      return appToolResult({ operation: "listMemberInvitations", appId }, await controlPlane.listAppMemberInvitations(
        serviceContext(grant, "list_app_member_invitations"), appId, { status, limit, cursor },
      ));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.revoke_app_member_invitation.name,
    APP_ADMIN_MCP_TOOLS.revoke_app_member_invitation.registration,
    async ({ appId, invitationId, confirmInvitationId, etag }) => {
      const grant = requireMutation("control:security", options);
      if (invitationId !== confirmInvitationId) return confirmationError("confirmInvitationId must exactly match invitationId");
      const result = await controlPlane.revokeAppMemberInvitation(serviceContext(grant, "revoke_app_member_invitation"), appId, invitationId, { ifMatch: etag });
      return appToolResult({ operation: "revokeMemberInvitation", appId, invitationId }, "error" in result ? result : { etag: formatCasAdminETag(result.revision) });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.update_app.name,
    APP_ADMIN_MCP_TOOLS.update_app.registration,
    async ({ appId, displayName, description, status, etag }) => {
      const grant = requireMutation("control:write", options);
      const result = await controlPlane.patchApp(
        serviceContext(grant, "update_app"),
        appId,
        { displayName, description, status },
        { ifMatch: etag },
      );
      return appToolResult({ operation: "patchApp", appId }, "error" in result
        ? result
        : { etag: formatCasAdminETag(result.revision) });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.invite_app_member.name,
    APP_ADMIN_MCP_TOOLS.invite_app_member.registration,
    async ({ appId, email, confirmEmail, idempotencyKey }) => {
      const grant = requireMutation("control:security", options);
      if (email !== confirmEmail) return confirmationError("confirmEmail must exactly match the invited email");
      const result = await controlPlane.createMemberInvitation(
        serviceContext(grant, "invite_app_member"),
        { path: { stackId: appId }, body: { emailConstraint: email } },
        { idempotencyKey },
      );
      const response = "error" in result || !options.publicOrigin
        ? result
        : { ...result, acceptUrl: new URL(result.acceptUrl, options.publicOrigin).toString() };
      if ("error" in response) return appToolResult({ operation: "createMemberInvitation", appId }, response);
      return toolResult({
        invitationId: response.invitation.invitationId,
        acceptUrl: response.acceptUrl,
        expiresAt: response.invitation.expiresAt,
        etag: formatCasAdminETag(response.invitation.revision),
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.accept_app_member_invitation.name,
    APP_ADMIN_MCP_TOOLS.accept_app_member_invitation.registration,
    async ({ token }) => {
      const grant = requireMutation("control:security", options);
      const result = await controlPlane.acceptMemberInvitation(
        serviceContext(grant, "accept_app_member_invitation"),
        { path: { token } },
      );
      return appToolResult({ operation: "acceptMemberInvitation", token }, result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.remove_app_member.name,
    APP_ADMIN_MCP_TOOLS.remove_app_member.registration,
    async ({ appId, accountId, confirmAccountId }) => {
      const grant = requireMutation("control:security", options);
      if (confirmAccountId !== accountId) return confirmationError("confirmAccountId must exactly match accountId");
      return accountToolResult(async () => {
        if (!options.accountService) throw new Error("Account service unavailable");
        const actor = await options.accountService.resolveExternalIdentity(grant.identityIssuer, grant.subject);
        if (!actor) throw new AccountServiceError("IDENTITY_NOT_FOUND");
        await options.accountService.removeAppMember({
          actorAccountId: actor.account.accountId,
          actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
          appId,
          targetAccountId: accountId,
          callerChannel: "mcp",
        });
        return { ok: true };
      });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.create_app_playground_file_root.name,
    APP_ADMIN_MCP_TOOLS.create_app_playground_file_root.registration,
    async ({ appId, rootId, name, manifestHash }) => {
      const grant = requireMutation("control:write", options);
      const result = await controlPlane.createPlaygroundFileRoot(
        serviceContext(grant, "create_app_playground_file_root"),
        { path: { stackId: appId }, body: { rootId, name, manifestHash } },
      );
      return appToolResult({ operation: "createPlaygroundFileRoot", appId }, withEtag(result));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.update_app_playground_file_root.name,
    APP_ADMIN_MCP_TOOLS.update_app_playground_file_root.registration,
    async ({ appId, rootId, name, manifestHash, etag }) => {
      const grant = requireMutation("control:write", options);
      const result = await controlPlane.patchPlaygroundFileRoot(
        serviceContext(grant, "update_app_playground_file_root"),
        { path: { stackId: appId, rootId }, body: { name, manifestHash } },
        { ifMatch: etag },
      );
      return appToolResult({ operation: "patchPlaygroundFileRoot", appId, rootId }, withEtag(result));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.delete_app_playground_file_root.name,
    APP_ADMIN_MCP_TOOLS.delete_app_playground_file_root.registration,
    async ({ appId, rootId, etag, confirmRootId }) => {
      const grant = requireMutation("control:write", options);
      if (confirmRootId !== rootId) return confirmationError("confirmRootId must exactly match rootId");
      const result = await controlPlane.deletePlaygroundFileRoot(
        serviceContext(grant, "delete_app_playground_file_root"),
        { path: { stackId: appId, rootId } },
        { ifMatch: etag },
      );
      return appToolResult({ operation: "deletePlaygroundFileRoot", appId, rootId }, result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.inspect_app_oauth_issuer.name,
    APP_ADMIN_MCP_TOOLS.inspect_app_oauth_issuer.registration,
    async ({ appId, issuer }) => {
      const grant = requireMutation("control:security", options);
      const result = await controlPlane.inspectAppOAuthIssuer(
        serviceContext(grant, "inspect_app_oauth_issuer"),
        appId, issuer,
      );
      return "error" in result ? toolResult(transformAppAdminError({ ...result })) : toolResult(result);
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.activate_app_oauth_issuer.name,
    APP_ADMIN_MCP_TOOLS.activate_app_oauth_issuer.registration,
    async ({ appId, inspectionId, activationProof, etag, ifNoneMatch }) => {
      const grant = requireMutation("control:security", options);
      let currentEtag = etag;
      if (!currentEtag && ifNoneMatch !== "*") {
        const current = await controlPlane.getOAuthIssuer(
          serviceContext(grant, "activate_app_oauth_issuer"),
          { path: { stackId: appId } },
        );
        if (!current) return toolResult({ error: "NOT_FOUND", message: "OAuth issuer is not configured" });
        if ("error" in current) return toolResult(current);
        currentEtag = formatCasAdminETag(current.revision);
      }
      const result = await controlPlane.activateAppOAuthIssuer(
        serviceContext(grant, "activate_app_oauth_issuer"),
        appId, { inspectionId, activationProof },
        { ifMatch: currentEtag, ifNoneMatch },
      );
      return "error" in result ? toolResult(transformAppAdminError({ ...result })) : toolResult({ etag: formatCasAdminETag(result.revision) });
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.update_app_managed_issuer.name,
    APP_ADMIN_MCP_TOOLS.update_app_managed_issuer.registration,
    async ({ appId, enabled, etag }) => {
      const grant = requireMutation("control:security", options);
      const result = await controlPlane.patchManagedOAuthIssuer(
        serviceContext(grant, "update_app_managed_issuer"),
        { path: { stackId: appId }, body: { enabled } },
        { ifMatch: etag },
      );
      return appToolResult({ operation: "patchManagedIssuer", appId }, withEtag(result));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.mint_managed_space_capability.name,
    APP_ADMIN_MCP_TOOLS.mint_managed_space_capability.registration,
    async ({ appId }) => {
      const grant = requireMutation("control:security", options);
      const result = await controlPlane.mintManagedSpaceCapability(
        serviceContext(grant, "mint_managed_space_capability"),
        appId,
      );
      return toolResult(result);
    },
  );

  server.registerTool(
    "list_stacks",
    {
      title: "List UniCAS stacks",
      description: "List stacks administered by the authenticated operator.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ limit, cursor }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.listStacks(serviceContext(grant, "list_stacks"), {
        query: {
          limit,
          cursor,
        },
      });
      return toolResult(result);
    },
  );

  server.registerTool(
    "get_stack",
    {
      description: "Get one administered stack and its current mutation ETag.",
      inputSchema: z.object({ stackId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ stackId }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.getStack(serviceContext(grant, "get_stack"), { path: { stackId } });
      return toolResult(withEtag(result));
    },
  );

  server.registerTool(
    "list_members",
    {
      description: "List administrators for a stack.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ stackId, limit, cursor }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.listMembers(serviceContext(grant, "list_members"), {
        path: { stackId },
        query: { limit, cursor },
      });
      return toolResult(result);
    },
  );

  server.registerTool(
    "get_oauth_issuer",
    {
      description: "Get discovered OAuth issuer metadata, status, and current mutation ETag for a stack.",
      inputSchema: z.object({ stackId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ stackId }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.getOAuthIssuer(
        serviceContext(grant, "get_oauth_issuer"),
        { path: { stackId } },
      );
      return toolResult(withEtag(result ?? { error: "NOT_FOUND", message: "OAuth issuer is not configured" }));
    },
  );

  server.registerTool(
    "list_ref_domains",
    {
      description: "List refDomains observed in successful Root Ref audit writes.",
      inputSchema: z.object({ stackId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ stackId }) => {
      const grant = requireGrantScope("control:read");
      const context = serviceContext(grant, "list_ref_domains");
      const membership = await controlPlane.getStack(context, { path: { stackId } });
      if ("error" in membership) return toolResult(membership);
      return auditReaderResult(options, "/_internal/audit/domains", { stackId });
    },
  );

  server.registerTool(
    "list_control_audit_events",
    {
      description: "List append-only control-plane audit events for a stack.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().min(1).optional(),
        after: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ stackId, limit, cursor, after }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.listControlAuditEvents(serviceContext(grant, "list_control_audit_events"), {
        path: { stackId },
        query: { limit, cursor, after },
      });
      return toolResult(result);
    },
  );

  server.registerTool(
    "list_root_domain_refs",
    {
      description: "List current non-zero Root Ref balances for one refDomain.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        refDomain: z.string().min(1).max(64),
        tenantId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ stackId, refDomain, tenantId, limit, cursor }) => {
      const grant = requireGrantScope("control:read");
      const context = serviceContext(grant, "list_root_domain_refs");
      const membership = await controlPlane.getStack(context, { path: { stackId } });
      if ("error" in membership) return toolResult(membership);
      return auditReaderResult(options, "/_internal/audit/refs", {
        stackId,
        refDomain,
        tenantId,
        limit: limit === undefined ? undefined : String(limit),
        cursor,
      });
    },
  );

  server.registerTool(
    "list_root_domain_events",
    {
      description: "List ordered Root Ref audit events for one refDomain.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        refDomain: z.string().min(1).max(64),
        tenantId: z.string().min(1).optional(),
        after: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ stackId, refDomain, tenantId, after, limit }) => {
      const grant = requireGrantScope("control:read");
      const context = serviceContext(grant, "list_root_domain_events");
      const membership = await controlPlane.getStack(context, { path: { stackId } });
      if ("error" in membership) return toolResult(membership);
      return auditReaderResult(options, "/_internal/audit/events", {
        stackId,
        refDomain,
        tenantId,
        after: after === undefined ? undefined : String(after),
        limit: limit === undefined ? undefined : String(limit),
      });
    },
  );

  server.registerTool(
    "create_stack",
    {
      description: "Create a new stack administered by the current operator.",
      inputSchema: z.object({
        displayName: z.string().min(1).max(100),
        idempotencyKey: z.string().min(1).max(128),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ displayName, idempotencyKey }) => {
      const grant = requireMutation("control:write", options);
      const result = await controlPlane.createStack(
        serviceContext(grant, "create_stack"),
        { body: { displayName } },
        { idempotencyKey },
      );
      return toolResult(withEtag(result));
    },
  );

  server.registerTool(
    "update_stack",
    {
      description: "Update stack metadata using its current ETag.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        displayName: z.string().min(1).max(100).optional(),
        description: z.string().max(2_000).optional(),
        etag: z.string().min(1),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ stackId, displayName, description, etag }) => {
      const grant = requireMutation("control:write", options);
      const result = await controlPlane.patchStack(
        serviceContext(grant, "update_stack"),
        { path: { stackId }, body: { displayName, description } },
        { ifMatch: etag },
      );
      return toolResult(withEtag(result));
    },
  );

  server.registerTool(
    "invite_member",
    {
      description: "Create an email-bound invitation granting equal stack administrator authority.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        email: z.string().email(),
        confirmEmail: z.string().email(),
        idempotencyKey: z.string().min(1).max(128),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ stackId, email, confirmEmail, idempotencyKey }) => {
      const grant = requireMutation("control:security", options);
      if (email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
        return confirmationError("confirmEmail must exactly match the invited email");
      }
      const result = await controlPlane.createMemberInvitation(
        serviceContext(grant, "invite_member"),
        { path: { stackId }, body: { emailConstraint: email } },
        { idempotencyKey },
      );
      if ("error" in result || !options.publicOrigin) return toolResult(result);
      return toolResult({
        ...result,
        acceptUrl: new URL(result.acceptUrl, options.publicOrigin).toString(),
      });
    },
  );

  server.registerTool(
    "remove_member",
    {
      description: "Remove a stack administrator using the stack's current ETag.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        identityIssuer: z.string().url(),
        subject: z.string().min(1),
        etag: z.string().min(1),
        confirmSubject: z.string().min(1),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ stackId, identityIssuer, subject, etag, confirmSubject }) => {
      const grant = requireMutation("control:security", options);
      if (confirmSubject !== subject) return confirmationError("confirmSubject must exactly match subject");
      const result = await controlPlane.deleteMember(
        serviceContext(grant, "remove_member"),
        { path: { stackId }, query: { identityIssuer, subject } },
        { ifMatch: etag },
      );
      return toolResult(result);
    },
  );

  server.registerTool(
    "inspect_oauth_issuer",
    {
      description: "Discover and persist a validated OAuth issuer metadata and JWKS snapshot, returning a control challenge.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        issuer: z.string().url(),
      }).strict(),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ stackId, issuer }) => {
      const grant = requireMutation("control:security", options);
      const result = await controlPlane.inspectOAuthIssuer(
        serviceContext(grant, "inspect_oauth_issuer"),
        { path: { stackId }, body: { issuer } },
      );
      return toolResult(withEtag(result));
    },
  );

  server.registerTool(
    "activate_oauth_issuer",
    {
      description: "Activate an inspected OAuth issuer using a compact-JWS control proof and current ETag.",
      inputSchema: z.object({
        stackId: z.string().min(1),
        inspectionId: z.string().min(1),
        activationProof: z.string().min(1),
        etag: z.string().min(1).optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ stackId, inspectionId, activationProof, etag }) => {
      const grant = requireMutation("control:security", options);
      let currentEtag = etag;
      if (!currentEtag) {
        const current = await controlPlane.getOAuthIssuer(
          serviceContext(grant, "activate_oauth_issuer"),
          { path: { stackId } },
        );
        if (!current) return toolResult({ error: "NOT_FOUND", message: "OAuth issuer is not configured" });
        if ("error" in current) return toolResult(current);
        currentEtag = formatCasAdminETag(current.revision);
      }
      const result = await controlPlane.activateOAuthIssuer(
        serviceContext(grant, "activate_oauth_issuer"),
        { path: { stackId }, body: { inspectionId, activationProof } },
        { ifMatch: currentEtag },
      );
      return toolResult(withEtag(result));
    },
  );

  return server;
}

function requireGrantScope(scope: string): ControlPlaneMcpGrantProps {
  const props = getMcpAuthContext()?.props;
  if (!isGrantProps(props)) throw new Error("MCP authentication context is unavailable");
  if (!props.scopes.includes(scope)) throw new Error(`OAuth scope '${scope}' is required`);
  return props;
}

function requireMutation(
  scope: "control:write" | "control:security",
  options: ControlPlaneMcpServerOptions,
): ControlPlaneMcpGrantProps {
  const grant = requireGrantScope(scope);
  if (options.mutationsEnabled !== true) {
    throw new Error("MCP control-plane mutations are disabled by deployment policy");
  }
  return grant;
}

function isGrantProps(value: Record<string, unknown> | undefined): value is ControlPlaneMcpGrantProps {
  return value !== undefined
    && typeof value.identityIssuer === "string"
    && value.identityIssuer.length > 0
    && typeof value.subject === "string"
    && value.subject.length > 0
    && (value.displayName === null || typeof value.displayName === "string")
    && (value.emailForDisplay === null || typeof value.emailForDisplay === "string")
    && (value.verifiedEmailEvidence === undefined
      || Array.isArray(value.verifiedEmailEvidence)
      && value.verifiedEmailEvidence.every(isVerifiedEmailEvidence))
    && Array.isArray(value.scopes)
    && value.scopes.every((scope) => typeof scope === "string")
    && typeof value.oauthClientId === "string"
    && typeof value.oauthClientHandle === "string"
    && value.oauthClientHandle.length > 0;
}

function serviceContext(grant: ControlPlaneMcpGrantProps, toolName: string): ControlPlaneCallContext {
  return {
    account: grant.accountId && grant.externalIdentityId && grant.credentialVersion !== undefined
      ? { accountId: grant.accountId, externalIdentityId: grant.externalIdentityId, credentialVersion: grant.credentialVersion }
      : undefined,
    identity: {
      identityIssuer: grant.identityIssuer,
      subject: grant.subject,
    },
    profile: {
      displayName: grant.displayName,
      emailForDisplay: grant.emailForDisplay,
    },
    verifiedEmailEvidence: grant.verifiedEmailEvidence,
    requestId: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
    caller: {
      channel: "mcp",
      oauthClientHandle: grant.oauthClientHandle,
      toolName,
    },
  };
}

function toolResult(value: object) {
  const structuredContent = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: "error" in value,
  };
}

function appToolResult(route: AppAdminRoute, value: object) {
  if ("error" in value && isObject(value)) return toolResult(transformAppAdminError(value));
  const transformed = transformAppAdminResponse(route, value);
  return toolResult(isObject(transformed)
    ? transformed
    : { error: CasAdminErrorCodes.SERVICE_UNAVAILABLE, message: "App response mapping failed" });
}

function confirmationError(message: string) {
  return toolResult({ error: "CONFIRMATION_REQUIRED", message });
}

function withEtag<T extends object>(value: T): T & { etag?: string } {
  if ("error" in value || !("revision" in value) || typeof value.revision !== "number") return value;
  return { ...value, etag: formatCasAdminETag(value.revision) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function auditReaderResult(
  options: ControlPlaneMcpServerOptions,
  pathname: string,
  query: Record<string, string | undefined>,
) {
  return toolResult(await auditReaderValue(options, pathname, query));
}

async function auditReaderValue(
  options: ControlPlaneMcpServerOptions,
  pathname: string,
  query: Record<string, string | undefined>,
): Promise<object> {
  if (!options.auditReader) {
    return {
      error: CasAdminErrorCodes.SERVICE_UNAVAILABLE,
      message: "Root Ref audit reader is unavailable",
    };
  }
  const url = new URL(pathname, "https://cas-audit.internal");
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  const headers = new Headers();
  if (options.auditReaderKey) headers.set("X-CAS-Audit-Reader-Key", options.auditReaderKey);
  try {
    const response = await options.auditReader.fetch(url, { headers });
    return await response.json() as object;
  } catch {
    return {
      error: CasAdminErrorCodes.SERVICE_UNAVAILABLE,
      message: "Root Ref audit reader is unavailable",
    };
  }
}

function grantPrincipal(grant: ControlPlaneMcpGrantProps) {
  return { issuer: grant.identityIssuer, subject: grant.subject };
}

async function platformToolResult(operation: () => Promise<object>) {
  try {
    return toolResult(await operation());
  } catch (error) {
    if (error instanceof PlatformAccessError) return toolResult({ error: error.code });
    return toolResult({ error: "SERVICE_UNAVAILABLE" });
  }
}

function isVerifiedEmailEvidence(value: unknown): value is VerifiedEmailEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  return typeof evidence.normalizedEmail === "string"
    && ["google-oidc", "github-emails-api", "unicas-email-challenge"].includes(String(evidence.source))
    && typeof evidence.verifiedAt === "number"
    && Number.isSafeInteger(evidence.verifiedAt)
    && typeof evidence.expiresAt === "number"
    && Number.isSafeInteger(evidence.expiresAt)
    && typeof evidence.authenticationEventId === "string"
    && evidence.authenticationEventId.length > 0;
}

async function accountToolResult(operation: () => Promise<object>) {
  try {
    return toolResult(await operation());
  } catch (error) {
    if (error instanceof AccountServiceError) return toolResult({ error: error.code });
    return toolResult({ error: "SERVICE_UNAVAILABLE" });
  }
}

async function requireGrantAccount(
  grant: ControlPlaneMcpGrantProps,
  options: ControlPlaneMcpServerOptions,
) {
  if (!options.accountService) throw new Error("Account service unavailable");
  const actor = await options.accountService.resolveExternalIdentity(grant.identityIssuer, grant.subject);
  if (!actor) throw new AccountServiceError("IDENTITY_NOT_FOUND");
  return actor;
}