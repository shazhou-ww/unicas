import { APP_ADMIN_MCP_TOOL_LIST } from "@unicas/admin-protocol";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { getToolDefinition, TOOL_CATALOG } from "../src/mcp/catalog.js";

/** The exact tool contract of the remote control-plane MCP server. */
const REMOTE_TOOL_NAMES = APP_ADMIN_MCP_TOOL_LIST.map((tool) => tool.name);

describe("tool catalog", () => {
  test("exposes exactly the remote tool contract", () => {
    expect(TOOL_CATALOG.map((tool) => tool.name)).toEqual(REMOTE_TOOL_NAMES);
    expect(new Set(TOOL_CATALOG.map((tool) => tool.name)).size).toBe(TOOL_CATALOG.length);
    for (const retired of ["whoami", "get_current_principal", "list_stacks", "get_stack", "list_members", "get_oauth_issuer", "list_ref_domains", "list_control_audit_events", "list_root_domain_refs", "list_root_domain_events", "create_stack", "update_stack", "invite_member", "remove_member", "inspect_oauth_issuer", "activate_oauth_issuer", "get_app_managed_issuer", "update_app_managed_issuer", "mint_managed_space_capability", "list_app_playground_file_roots", "create_app_playground_file_root", "update_app_playground_file_root", "delete_app_playground_file_root"]) {
      expect(getToolDefinition(retired)).toBeUndefined();
    }
  });

  test("every tool has a description, a zod input schema, and a known scope", () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
      expect(typeof tool.inputSchema.parse, tool.name).toBe("function");
      expect(["control:read", "control:write", "control:security"]).toContain(tool.requiredScope);
    }
  });

  test("App tool inputs contain no legacy Stack or Tenant fields", () => {
    for (const tool of APP_ADMIN_MCP_TOOL_LIST) {
      const schema = JSON.stringify(z.toJSONSchema(tool.registration.inputSchema));
      expect(schema, tool.name).not.toMatch(/stackId|tenantId/);
    }
  });

  test("creation tools are idempotent; destructive mutations are annotated", () => {
    expect(getToolDefinition("create_app")?.annotations.idempotentHint).toBe(true);
    expect(getToolDefinition("invite_app_member")?.annotations.idempotentHint).toBe(true);
    expect(getToolDefinition("remove_app_member")?.annotations.destructiveHint).toBe(true);
    expect(getToolDefinition("revoke_platform_authority")?.annotations.idempotentHint).toBe(true);
    expect(getToolDefinition("block_platform_account")?.annotations.destructiveHint).toBe(true);
    expect(getToolDefinition("update_platform_access")).toBeUndefined();
  });

  test("input schemas validate and reject bad arguments", () => {
    const getApp = getToolDefinition("get_app");
    expect(getApp?.inputSchema.safeParse({ appId: "cas_app" }).success).toBe(true);
    expect(getApp?.inputSchema.safeParse({}).success).toBe(false);

    const createApp = getToolDefinition("create_app");
    expect(createApp?.inputSchema.safeParse({ displayName: "Ops", idempotencyKey: "k1" }).success).toBe(true);
    expect(createApp?.inputSchema.safeParse({ displayName: "", idempotencyKey: "k1" }).success).toBe(false);

    const updateApp = getToolDefinition("update_app");
    expect(updateApp?.inputSchema.safeParse({ appId: "a", description: "Production", etag: '"1"' }).success).toBe(true);
    expect(updateApp?.inputSchema.safeParse({ appId: "a", description: "x".repeat(2_001), etag: '"1"' }).success).toBe(false);

    const activate = getToolDefinition("activate_app_oauth_issuer");
    expect(activate?.inputSchema.safeParse({
      appId: "a",
      inspectionId: "oinsp_1",
      activationProof: "eyJhbGciOiJFUzI1NiJ9.payload.sig",
      etag: '"3"',
    }).success).toBe(true);
    expect(activate?.inputSchema.safeParse({ appId: "a", inspectionId: "oinsp_1" }).success).toBe(false);

    const inspect = getToolDefinition("inspect_app_oauth_issuer");
    expect(inspect?.inputSchema.safeParse({ appId: "a", issuer: "https://issuer.example" }).success).toBe(true);
    expect(inspect?.inputSchema.safeParse({ appId: "a", issuer: "https://issuer.example", extra: true }).success).toBe(false);

    const spaceRefs = getToolDefinition("list_space_root_domain_refs");
    expect(spaceRefs?.inputSchema.safeParse({ appId: "a", refDomain: "doc", spaceId: "s" }).success).toBe(true);
    expect(spaceRefs?.inputSchema.safeParse({ stackId: "a", refDomain: "doc", tenantId: "s" }).success).toBe(false);

    const removeAppMember = getToolDefinition("remove_app_member");
    expect(removeAppMember?.inputSchema.safeParse({
      appId: "a",
      accountId: `acct_${"a".repeat(22)}`,
      confirmAccountId: `acct_${"a".repeat(22)}`,
    }).success).toBe(true);

    const grantAuthority = getToolDefinition("grant_platform_authority");
    expect(grantAuthority?.inputSchema.safeParse({
      accountId: `acct_${"a".repeat(22)}`,
      confirmAccountId: `acct_${"a".repeat(22)}`,
      authority: "apps.create",
    }).success).toBe(true);
    expect(grantAuthority?.inputSchema.safeParse({
      principalRef: "principal-1",
      authorities: ["apps.create"],
      etag: '"1"',
    }).success).toBe(false);

    const platformAudit = getToolDefinition("list_platform_audit_events");
    expect(platformAudit?.inputSchema.safeParse({
      actorAccountId: `acct_${"a".repeat(22)}`,
      targetAccountId: `acct_${"b".repeat(22)}`,
    }).success).toBe(true);
    expect(platformAudit?.inputSchema.safeParse({ actorPrincipalRef: "principal-1" }).success).toBe(false);
  });
});
