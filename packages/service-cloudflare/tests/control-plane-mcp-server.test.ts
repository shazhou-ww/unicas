import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { APP_ADMIN_MCP_TOOL_LIST } from "@unicas/admin-protocol";
import { PlatformAccessService, PlatformAuditService, PlatformInvitationService } from "@unicas/service";
import { createControlPlaneMcpServer } from "../src/mcp/server.js";
import type { ControlPlaneMcpGrantProps } from "../src/mcp/server.js";
import { migrateControlSchema } from "../src/control-schema.js";
import { createControlPlaneOperations } from "../src/control-operations.js";
import { D1PlatformAccessRepository } from "../src/platform-access-repository.js";

let miniflare: Miniflare;
let db: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "control-plane-mcp-server-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "control-plane-mcp-server-test-db" },
    }]
  }));
  await miniflare.ready;
  db = await miniflare.getD1Database("DB", "control-plane-mcp-server-test");
  await migrateControlSchema(db);
});
afterEach(async () => miniflare.dispose());

describe("adapter-hosted control-plane MCP server", () => {
  test("lists tools and maps whoami to the OAuth identity", async () => {
    const handler = handlerFor(grant(["control:read"]));
    const listed = await mcpRequest(handler, "tools/list", {});
    const body = await listed.json() as { result: { tools: Array<{ name: string; description?: string }> } };
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "whoami", ...APP_ADMIN_MCP_TOOL_LIST.map((tool) => tool.name),
      "list_stacks", "get_stack", "list_members", "get_oauth_issuer",
      "list_ref_domains", "list_control_audit_events",
      "list_root_domain_refs", "list_root_domain_events", "create_stack",
      "update_stack", "invite_member", "remove_member", "inspect_oauth_issuer", "activate_oauth_issuer",
    ]);
    for (const definition of APP_ADMIN_MCP_TOOL_LIST) {
      expect(body.result.tools.find((tool) => tool.name === definition.name)?.description)
        .toBe(definition.registration.description);
    }
    const whoami = await callTool(handler, "whoami", {});
    expect(whoami.structuredContent).toMatchObject({
      identity: { subject: "alice-sub", displayName: "Alice", emailForDisplay: "alice@example.com" },
      memberships: [],
    });
    const principal = await callTool(handler, "get_current_principal", {});
    expect(principal.structuredContent).toMatchObject({
      principal: { issuer: "https://accounts.google.com", subject: "alice-sub" },
      profile: { displayName: "Alice", emailForDisplay: "alice@example.com" },
      memberships: [],
    });
  });

  test("enforces read, write, security, and deployment-policy gates", async () => {
    expect((await callTool(handlerFor(grant([])), "whoami", {})).content[0]?.text).toContain("control:read");
    expect((await callTool(handlerFor(grant(["control:write"])), "create_stack", {
      displayName: "Operations", idempotencyKey: "create-ops-1",
    })).content[0]?.text).toContain("disabled by deployment policy");
    expect((await callTool(handlerFor(grant(["control:write"]), { mutationsEnabled: true }), "invite_member", {
      stackId: "cas_stack", email: "bob@example.com", confirmEmail: "bob@example.com", idempotencyKey: "invite-1",
    })).content[0]?.text).toContain("control:security");
    expect((await callTool(handlerFor(grant(["control:security"])), "mint_managed_space_capability", {
      appId: "cas_app",
    })).content[0]?.text).toContain("disabled by deployment policy");
  });

  test("requires apps.create authority in addition to the delegated write scope", async () => {
    const authorizePlatformOperation = vi.fn(async () => ({
      error: "APP_CREATION_AUTHORITY_REQUIRED" as const,
    }));
    const handler = handlerFor(grant(["control:write"]), {
      mutationsEnabled: true,
      authorizePlatformOperation,
    });

    const denied = await callTool(handler, "create_app", {
      displayName: "Denied App",
      idempotencyKey: "denied-app-1",
    });

    expect(denied).toMatchObject({
      isError: true,
      structuredContent: { error: "APP_CREATION_AUTHORITY_REQUIRED" },
    });
    expect(authorizePlatformOperation).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "alice-sub" }),
      "apps.create",
    );
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_apps").first()).toEqual({ count: 0 });
  });

  test("creates idempotent stacks, records MCP audit attribution, and guards writes with ETags", async () => {
    const handler = handlerFor(grant(["control:read", "control:write"]), { mutationsEnabled: true });
    const first = await callTool(handler, "create_stack", { displayName: "Operations", idempotencyKey: "create-ops-1" });
    expect(first.structuredContent).toMatchObject({ displayName: "Operations", revision: 1, etag: '"1"' });
    const replay = await callTool(handler, "create_stack", { displayName: "Operations", idempotencyKey: "create-ops-1" });
    expect(replay.structuredContent.stackId).toBe(first.structuredContent.stackId);
    const stale = await callTool(handler, "update_stack", { stackId: first.structuredContent.stackId, description: "Production", etag: '"0"' });
    expect(stale).toMatchObject({ isError: true, structuredContent: { error: "REVISION_MISMATCH" } });
    const updated = await callTool(handler, "update_stack", { stackId: first.structuredContent.stackId, description: "Production", etag: '"1"' });
    expect(updated.structuredContent).toMatchObject({ description: "Production", revision: 2, etag: '"2"' });
    const audit = await callTool(handler, "list_control_audit_events", { stackId: first.structuredContent.stackId, limit: 10 });
    const items = audit.structuredContent.items as Array<Record<string, unknown>>;
    expect(items.find((item) => item.action === "stack.created")).toMatchObject({
      caller: {
        channel: "mcp", oauthClientHandle: "a".repeat(64), toolName: "create_stack",
      }
    });
  });

  test("serves App CRUD and audit without exposing Stack-shaped fields", async () => {
    const handler = handlerFor(
      grant(["control:read", "control:write", "control:security"]),
      { mutationsEnabled: true },
    );
    const created = await callTool(handler, "create_app", {
      displayName: "Documents",
      idempotencyKey: "create-app-1",
    });
    expect(created.structuredContent).toEqual({
      appId: expect.any(String),
      etag: '"1"',
    });
    expect(created.structuredContent).not.toHaveProperty("stackId");
    const appId = String(created.structuredContent.appId);

    const listed = await callTool(handler, "list_apps", { limit: 10 });
    expect(listed.structuredContent).toMatchObject({ items: [{ appId, displayName: "Documents" }] });
    expect((listed.structuredContent.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty("stackId");

    const updated = await callTool(handler, "update_app", {
      appId,
      description: "Production documents",
      etag: '"1"',
    });
    expect(updated.structuredContent).toEqual({ etag: '"2"' });
    expect((await callTool(handler, "get_app", { appId })).structuredContent)
      .toMatchObject({ appId, description: "Production documents", revision: 2 });
    expect((await callTool(handler, "update_app", { appId, status: "suspended", etag: '"2"' })).structuredContent)
      .toEqual({ etag: '"3"' });
    expect((await callTool(handler, "get_app", { appId })).structuredContent).toMatchObject({ status: "suspended" });
    expect((await callTool(handler, "update_app", { appId, status: "suspended", etag: '"3"' })).structuredContent)
      .toEqual({ etag: '"3"' });
    expect((await callTool(handler, "update_app", { appId, status: "active", etag: '"2"' })).structuredContent)
      .toMatchObject({ error: "REVISION_MISMATCH" });
    expect((await callTool(handler, "update_app", { appId, status: "active", etag: '"3"' })).structuredContent)
      .toEqual({ etag: '"4"' });
    expect((await callTool(handler, "get_app", { appId })).structuredContent).toMatchObject({ status: "active" });

    const audit = await callTool(handler, "list_app_control_audit_events", { appId, limit: 10 });
    const events = audit.structuredContent.items as Array<Record<string, unknown>>;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "app.suspended" }),
      expect.objectContaining({ action: "app.restored" }),
      expect.objectContaining({
        appId,
        actor: { issuer: "https://accounts.google.com", subject: "alice-sub" },
      }),
    ]));
    expect(events.every((event) => !("stackId" in event))).toBe(true);
  });

  test("lists and revokes App invitations with security scope and exact confirmation", async () => {
    const handler = handlerFor(grant(["control:read", "control:write", "control:security"]), { mutationsEnabled: true });
    const created = await callTool(handler, "create_app", { displayName: "Invitations", idempotencyKey: "inv-app-create" });
    const appId = String(created.structuredContent.appId);
    const invitation = await callTool(handler, "invite_app_member", { appId, email: "synthetic@example.test", confirmEmail: "synthetic@example.test", idempotencyKey: "inv-create" });
    const invitationId = String(invitation.structuredContent.invitationId);
    const list = await callTool(handler, "list_app_member_invitations", { appId, status: "pending" });
    expect(list.structuredContent).toMatchObject({ items: [{ invitationId, status: "pending" }] });
    expect(JSON.stringify(list.structuredContent)).not.toMatch(/tokenHash|acceptUrl/);
    expect((await callTool(handlerFor(grant(["control:read"])), "list_app_member_invitations", { appId })).content[0]?.text).toContain("control:security");
    expect((await callTool(handler, "revoke_app_member_invitation", { appId, invitationId, confirmInvitationId: "wrong", etag: '"1"' })).isError).toBe(true);
    expect((await callTool(handler, "revoke_app_member_invitation", { appId, invitationId, confirmInvitationId: invitationId, etag: '"1"' })).structuredContent).toEqual({ etag: '"2"' });
    expect((await callTool(handler, "list_app_member_invitations", { appId, status: "revoked" })).structuredContent).toMatchObject({ items: [{ invitationId, status: "revoked" }] });
  });

  test("creates, lists, and revokes platform invitations with current platform authority", async () => {
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES ('alice-ref', ?, ?, 'active', 1, 0, 1, 1, 1)")
      .bind("https://accounts.google.com", "alice-sub").run();
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES ('target-ref', ?, 'target-sub', 'active', 0, 0, 1, 1, 1)")
      .bind("https://accounts.google.com").run();
    const repository = new D1PlatformAccessRepository(db);
    const platformAccess = new PlatformAccessService(repository);
    const platformInvitations = new PlatformInvitationService(
      repository,
      platformAccess,
      { seal: async token => `sealed:${token}`, open: async sealed => sealed.slice(7) },
    );
    const handler = handlerFor(grant(["control:security"]), {
      mutationsEnabled: true,
      publicOrigin: "https://console.unicas.work",
      platformInvitations,
      platformAudit: new PlatformAuditService(repository, platformAccess),
      platformAccess,
    });

    expect((await callTool(handler, "create_platform_invitation", {
      email: "developer@example.com",
      confirmEmail: "wrong@example.com",
      authorities: ["apps.create"],
      idempotencyKey: "platform-invite-1",
    })).isError).toBe(true);
    const created = await callTool(handler, "create_platform_invitation", {
      email: "developer@example.com",
      confirmEmail: "developer@example.com",
      authorities: ["apps.create"],
      idempotencyKey: "platform-invite-1",
    });
    expect(created.structuredContent).toMatchObject({
      invitationId: expect.any(String),
      acceptUrl: expect.stringMatching(/^https:\/\/console\.unicas\.work\/admin\/platform-invitations\//),
      etag: '"1"',
    });
    const invitationId = String(created.structuredContent.invitationId);
    expect((await callTool(handler, "list_platform_principals", { authority: "platform.admin" })).structuredContent)
      .toMatchObject({ items: [{ principalRef: "alice-ref" }] });
    expect((await callTool(handler, "get_platform_principal", { principalRef: "target-ref" })).structuredContent)
      .toMatchObject({ principalRef: "target-ref", authorities: [] });
    expect((await callTool(handler, "update_platform_access", {
      principalRef: "target-ref",
      confirmPrincipalRef: "wrong",
      authorities: ["apps.create"],
      etag: '"1"',
    })).isError).toBe(true);
    expect((await callTool(handler, "update_platform_access", {
      principalRef: "target-ref",
      confirmPrincipalRef: "target-ref",
      authorities: ["apps.create"],
      etag: '"1"',
    })).structuredContent).toEqual({ etag: '"2"' });
    const listed = await callTool(handler, "list_platform_invitations", { status: "pending" });
    expect(listed.structuredContent).toMatchObject({
      items: [{ invitationId, emailConstraint: "developer@example.com", authorities: ["apps.create"] }],
    });
    expect(JSON.stringify(listed.structuredContent)).not.toMatch(/acceptUrl|tokenHash|sealedToken/);
    expect((await callTool(handler, "list_platform_audit_events", {
      action: "platform_invitation.created",
      limit: 10,
    })).structuredContent).toMatchObject({
      items: [{ action: "platform_invitation.created", targetInvitationId: invitationId }],
    });
    expect((await callTool(handler, "revoke_platform_invitation", {
      invitationId,
      confirmInvitationId: "wrong",
      etag: '"1"',
    })).isError).toBe(true);
    expect((await callTool(handler, "revoke_platform_invitation", {
      invitationId,
      confirmInvitationId: invitationId,
      etag: '"1"',
    })).structuredContent).toEqual({ etag: '"2"' });
  });

  test("serves App memberships and Principal-owned Playground records", async () => {
    const aliceHandler = handlerFor(
      grant(["control:read", "control:write", "control:security"]),
      { mutationsEnabled: true, publicOrigin: "https://console.unicas.work" },
    );
    const created = await callTool(aliceHandler, "create_app", {
      displayName: "Collaboration",
      idempotencyKey: "create-collaboration-1",
    });
    const appId = String(created.structuredContent.appId);
    const invitation = await callTool(aliceHandler, "invite_app_member", {
      appId,
      email: "bob@example.com",
      confirmEmail: "bob@example.com",
      idempotencyKey: "invite-bob-app-1",
    });
    expect(invitation.structuredContent).toMatchObject({ invitationId: expect.any(String), expiresAt: expect.any(Number), etag: '"1"' });
    expect(invitation.structuredContent).not.toHaveProperty("invitation");
    const token = String(invitation.structuredContent.acceptUrl).split("/").pop()!;

    const bobHandler = handlerFor({
      ...grant(["control:read", "control:security"]),
      subject: "bob-sub",
      displayName: "Bob",
      emailForDisplay: "bob@example.com",
    }, { mutationsEnabled: true });
    expect((await callTool(bobHandler, "accept_app_member_invitation", { token })).structuredContent)
      .toEqual({ appId });

    const members = await callTool(aliceHandler, "list_app_members", { appId, limit: 10 });
    expect(members.structuredContent.items).toEqual([
      expect.objectContaining({
        appId,
        principal: expect.objectContaining({ subject: "alice-sub" }),
      }),
      expect.objectContaining({
        appId,
        principal: expect.objectContaining({ subject: "bob-sub" }),
        profile: expect.objectContaining({ displayName: "Bob" }),
      }),
    ]);

    const manifestHash = "a".repeat(64);
    const root = await callTool(aliceHandler, "create_app_playground_file_root", {
      appId,
      rootId: "root-1",
      name: "Files",
      manifestHash,
    });
    expect(root.structuredContent).toMatchObject({ rootId: "root-1", etag: '"1"' });
    expect(await callTool(aliceHandler, "delete_app_playground_file_root", {
      appId,
      rootId: "root-1",
      etag: '"1"',
      confirmRootId: "wrong",
    })).toMatchObject({ isError: true, structuredContent: { error: "CONFIRMATION_REQUIRED" } });
    expect((await callTool(aliceHandler, "delete_app_playground_file_root", {
      appId,
      rootId: "root-1",
      etag: '"1"',
      confirmRootId: "root-1",
    })).structuredContent).toEqual({ ok: true });
  });

  test("invites, lists, and removes members through the extracted admin service", async () => {
    const handler = handlerFor(grant(["control:read", "control:write", "control:security"]), { mutationsEnabled: true });
    const stack = await callTool(handler, "create_stack", { displayName: "Members", idempotencyKey: "members-stack-1" });
    const stackId = String(stack.structuredContent.stackId);
    const invitation = await callTool(handler, "invite_member", {
      stackId,
      email: "bob@example.com",
      confirmEmail: "bob@example.com",
      idempotencyKey: "invite-bob-1",
    });
    const replay = await callTool(handler, "invite_member", {
      stackId,
      email: "bob@example.com",
      confirmEmail: "bob@example.com",
      idempotencyKey: "invite-bob-1",
    });
    expect(replay.structuredContent).toEqual(invitation.structuredContent);
    const acceptUrl = String(invitation.structuredContent.acceptUrl);
    const token = acceptUrl.split("/").pop()!;
    expect(await createControlPlaneOperations(db).acceptMemberInvitation({
      identity: { identityIssuer: "https://accounts.google.com", subject: "bob-sub" },
      profile: { displayName: "Bob", emailForDisplay: "bob@example.com" },
    }, { path: { token } })).toMatchObject({ subject: "bob-sub", displayName: "Bob" });
    const members = await callTool(handler, "list_members", { stackId, limit: 10 });
    expect(members.structuredContent.items).toEqual([
      expect.objectContaining({ subject: "alice-sub" }),
      expect.objectContaining({ subject: "bob-sub", displayName: "Bob", emailForDisplay: "bob@example.com" }),
    ]);
    const stale = await callTool(handler, "remove_member", {
      stackId,
      identityIssuer: "https://accounts.google.com",
      subject: "bob-sub",
      confirmSubject: "bob-sub",
      etag: '"0"',
    });
    expect(stale).toMatchObject({ isError: true, structuredContent: { error: "REVISION_MISMATCH" } });
    expect((await callTool(handler, "remove_member", {
      stackId,
      identityIssuer: "https://accounts.google.com",
      subject: "bob-sub",
      confirmSubject: "bob-sub",
      etag: '"1"',
    })).structuredContent).toEqual({ ok: true });
  });

  test("reads adapter-provided root-domain audit data", async () => {
    const auditReader = {
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/_internal/audit/domains");
        return Response.json({ domains: [{ stackId: url.searchParams.get("stackId"), refDomain: "doc", revision: 2 }] });
      }
    };
    const handler = handlerFor(grant(["control:read", "control:write"]), { mutationsEnabled: true, auditReader });
    const stack = await callTool(handler, "create_stack", { displayName: "Audit", idempotencyKey: "create-audit-1" });
    expect((await callTool(handler, "list_ref_domains", { stackId: stack.structuredContent.stackId })).structuredContent)
      .toEqual({ domains: [{ stackId: stack.structuredContent.stackId, refDomain: "doc", revision: 2 }] });
  });

  test("maps physical audit dimensions to App and Space MCP output", async () => {
    const requests: URL[] = [];
    const auditReader = {
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url);
        if (url.pathname === "/_internal/audit/domains") {
          return Response.json({ domains: [{ stackId: url.searchParams.get("stackId"), refDomain: "doc", revision: 2 }] });
        }
        if (url.pathname === "/_internal/audit/refs") {
          return Response.json({
            revision: 2,
            refs: [{ tenantId: url.searchParams.get("tenantId"), hash: "a".repeat(64), count: 1 }],
            nextCursor: null,
          });
        }
        return Response.json({
          events: [{ revision: 2, tenantId: url.searchParams.get("tenantId"), requestId: "request-1", changes: {}, appliedAt: 1 }],
          latestRevision: 2,
          nextAfter: 2,
        });
      },
    };
    const handler = handlerFor(
      grant(["control:read", "control:write"]),
      { mutationsEnabled: true, auditReader },
    );
    const app = await callTool(handler, "create_app", {
      displayName: "Audit App",
      idempotencyKey: "create-audit-app-1",
    });
    const appId = String(app.structuredContent.appId);

    expect((await callTool(handler, "list_app_ref_domains", { appId })).structuredContent)
      .toEqual({ domains: [{ appId, refDomain: "doc", revision: 2 }] });
    expect((await callTool(handler, "list_space_root_domain_refs", {
      appId,
      refDomain: "doc",
      spaceId: "space-1",
    })).structuredContent).toMatchObject({ refs: [{ spaceId: "space-1", count: 1 }] });
    expect((await callTool(handler, "list_space_root_domain_events", {
      appId,
      refDomain: "doc",
      spaceId: "space-1",
    })).structuredContent).toMatchObject({ events: [{ spaceId: "space-1", revision: 2 }] });

    expect(requests.map((url) => ({
      pathname: url.pathname,
      stackId: url.searchParams.get("stackId"),
      tenantId: url.searchParams.get("tenantId"),
      spaceId: url.searchParams.get("spaceId"),
    }))).toEqual([
      { pathname: "/_internal/audit/domains", stackId: appId, tenantId: null, spaceId: null },
      { pathname: "/_internal/audit/refs", stackId: appId, tenantId: "space-1", spaceId: null },
      { pathname: "/_internal/audit/events", stackId: appId, tenantId: "space-1", spaceId: null },
    ]);
  });
});

function grant(scopes: readonly string[]): ControlPlaneMcpGrantProps {
  return {
    identityIssuer: "https://accounts.google.com", subject: "alice-sub", displayName: "Alice",
    emailForDisplay: "alice@example.com", scopes, oauthClientId: "github-copilot", oauthClientHandle: "a".repeat(64),
  };
}
function handlerFor(props: ControlPlaneMcpGrantProps, options: Parameters<typeof createControlPlaneMcpServer>[1] = {}) {
  return createMcpHandler(
    () => createControlPlaneMcpServer(createControlPlaneOperations(db), options),
    { route: "/mcp", authContext: { props } },
  );
}
function mcpRequest(handler: ReturnType<typeof createMcpHandler>, method: string, params: Record<string, unknown>): Promise<Response> {
  const headers = new Headers({
    Accept: "application/json, text/event-stream", "Content-Type": "application/json", Host: "localhost",
    "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method,
  });
  if (method === "tools/call" && typeof params.name === "string") headers.set("Mcp-Name", params.name);
  return handler.fetch(new Request("https://localhost/mcp", {
    method: "POST", headers, body: JSON.stringify({
      jsonrpc: "2.0", id: crypto.randomUUID(), method, params: {
        ...params, _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "control-plane-mcp-test", version: "1.0.0" },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        }
      }
    }),
  }));
}
async function callTool(handler: ReturnType<typeof createMcpHandler>, name: string, argumentsValue: Record<string, unknown>): Promise<{
  isError?: boolean; content: Array<{ text: string }>; structuredContent: Record<string, unknown>;
}> {
  const response = await mcpRequest(handler, "tools/call", { name, arguments: argumentsValue });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json() as { result: { isError?: boolean; content: Array<{ text: string }>; structuredContent: Record<string, unknown> } };
  return body.result;
}
