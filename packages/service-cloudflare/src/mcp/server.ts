import { McpServer } from "@modelcontextprotocol/server";
import type {
  ControlPlaneCallContext,
  ControlPlaneOperations,
} from "@unicas/service";
import {
  APP_ADMIN_MCP_TOOLS,
  CasAdminErrorCodes,
  formatCasAdminETag,
  type AppAdminRoute,
} from "@unicas/admin-protocol";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { transformAppAdminError, transformAppAdminResponse } from "../app-admin-adapter.js";

export interface ControlPlaneMcpGrantProps extends Record<string, unknown> {
  readonly identityIssuer: string;
  readonly subject: string;
  readonly displayName: string | null;
  readonly emailForDisplay: string | null;
  readonly scopes: readonly string[];
  readonly oauthClientId: string;
  readonly oauthClientHandle: string;
}

export interface ControlPlaneMcpServerOptions {
  readonly auditReader?: Fetcher;
  readonly auditReaderKey?: string;
  readonly publicOrigin?: string;
  readonly mutationsEnabled?: boolean;
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
      const result = await controlPlane.listMembers(
        serviceContext(grant, "list_app_members"),
        { path: { stackId: appId }, query: { limit, cursor } },
      );
      return appToolResult({ operation: "listMembers", appId }, result);
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
    async ({ appId, limit, cursor, after }) => {
      const grant = requireGrantScope("control:read");
      const result = await controlPlane.listControlAuditEvents(
        serviceContext(grant, "list_app_control_audit_events"),
        { path: { stackId: appId }, query: { limit, cursor, after } },
      );
      return appToolResult({ operation: "listControlAuditEvents", appId }, result);
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
      const result = await controlPlane.createStack(
        serviceContext(grant, "create_app"),
        { body: { displayName } },
        { idempotencyKey },
      );
      return appToolResult({ operation: "createApp" }, withEtag(result));
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
      return appToolResult({ operation: "createMemberInvitation", appId }, response);
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
    async ({ appId, issuer, subject, etag, confirmSubject }) => {
      const grant = requireMutation("control:security", options);
      if (confirmSubject !== subject) return confirmationError("confirmSubject must exactly match subject");
      const result = await controlPlane.deleteMember(
        serviceContext(grant, "remove_app_member"),
        { path: { stackId: appId }, query: { identityIssuer: issuer, subject } },
        { ifMatch: etag },
      );
      return appToolResult({ operation: "deleteMember", appId }, result);
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
      const result = await controlPlane.inspectOAuthIssuer(
        serviceContext(grant, "inspect_app_oauth_issuer"),
        { path: { stackId: appId }, body: { issuer } },
      );
      return appToolResult({ operation: "inspectOAuthIssuer", appId }, withEtag(result));
    },
  );

  server.registerTool(
    APP_ADMIN_MCP_TOOLS.activate_app_oauth_issuer.name,
    APP_ADMIN_MCP_TOOLS.activate_app_oauth_issuer.registration,
    async ({ appId, inspectionId, activationProof, etag }) => {
      const grant = requireMutation("control:security", options);
      let currentEtag = etag;
      if (!currentEtag) {
        const current = await controlPlane.getOAuthIssuer(
          serviceContext(grant, "activate_app_oauth_issuer"),
          { path: { stackId: appId } },
        );
        if (!current) return toolResult({ error: "NOT_FOUND", message: "OAuth issuer is not configured" });
        if ("error" in current) return toolResult(current);
        currentEtag = formatCasAdminETag(current.revision);
      }
      const result = await controlPlane.activateOAuthIssuer(
        serviceContext(grant, "activate_app_oauth_issuer"),
        { path: { stackId: appId }, body: { inspectionId, activationProof } },
        { ifMatch: currentEtag },
      );
      return appToolResult({ operation: "activateOAuthIssuer", appId }, withEtag(result));
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
    && Array.isArray(value.scopes)
    && value.scopes.every((scope) => typeof scope === "string")
    && typeof value.oauthClientId === "string"
    && typeof value.oauthClientHandle === "string"
    && value.oauthClientHandle.length > 0;
}

function serviceContext(grant: ControlPlaneMcpGrantProps, toolName: string): ControlPlaneCallContext {
  return {
    identity: {
      identityIssuer: grant.identityIssuer,
      subject: grant.subject,
    },
    profile: {
      displayName: grant.displayName,
      emailForDisplay: grant.emailForDisplay,
    },
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