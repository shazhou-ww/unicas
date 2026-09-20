import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TOOL_CATALOG } from "../src/mcp/catalog.js";
import { runMcpStdioServer } from "../src/mcp/stdio-server.js";
import { TokenStore } from "../src/store.js";
import { FAKE_ORIGIN, FakeAdminApi } from "./helpers/fake-server.js";

interface LineReader {
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
  all(): string[];
}

let dir: string;
let store: TokenStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "unicas-cli-mcp-"));
  store = new TokenStore({ path: join(dir, "token.json") });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedSession(): Promise<void> {
  await store.save({
    adminOrigin: FAKE_ORIGIN,
    cookie: "cas_admin_session=session-1",
    csrfToken: "cli-csrf-1",
  });
}

async function startStdioServer(fetchImpl: typeof fetch): Promise<{ stdin: PassThrough; reader: LineReader; done: Promise<void> }> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const transport = new StdioServerTransport(stdin as unknown as Readable, stdout as unknown as Writable);
  const serverPromise = runMcpStdioServer({ adminOrigin: FAKE_ORIGIN, store, fetchImpl, transport, log: () => undefined });
  const lines: string[] = [];
  const waiters: Array<(line: Record<string, unknown>) => void> = [];
  stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      lines.push(trimmed);
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const waiter = waiters.shift();
      waiter?.(parsed);
    }
  });
  const reader: LineReader = {
    next: (timeoutMs = 5_000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for an MCP message")), timeoutMs);
      waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    }),
    all: () => [...lines],
  };
  const done = serverPromise.then(() => undefined);
  return { stdin, reader, done };
}

describe("unicas mcp (stdio server)", () => {
  test("answers initialize, lists the tool contract, and serves tools/call from the admin client", async () => {
    await seedSession();
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    const { stdin, reader, done } = await startStdioServer(server.fetch);

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    })}\n`);

    const initialize = await reader.next();
    expect(initialize.id).toBe(1);
    const result = initialize.result as { protocolVersion?: string; serverInfo?: { name?: string } };
    expect(typeof result.protocolVersion).toBe("string");
    expect(result.serverInfo?.name).toBe("unicas-control-plane-cli");

    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);

    const toolsList = await reader.next();
    expect(toolsList.id).toBe(2);
    const tools = (toolsList.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_CATALOG.map((tool) => tool.name));
    expect(tools.map((tool) => tool.name)).not.toContain("mint_managed_space_capability");
    expect(tools.map((tool) => tool.name)).toContain("get_app_oauth_issuer");
    expect(tools.map((tool) => tool.name)).not.toContain("add_issuer_key");

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_current_account", arguments: {} },
    })}\n`);

    const call = await reader.next();
    expect(call.id).toBe(3);
    const callResult = call.result as {
      isError?: boolean;
      structuredContent: Record<string, unknown>;
    };
    expect(callResult.isError).toBe(false);
    expect(callResult.structuredContent).toMatchObject({
      account: { accountId: `acct_${"a".repeat(22)}` },
    });
    expect(callResult.structuredContent.memberships).toHaveLength(1);

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "invite_app_member",
        arguments: {
          appId: "cas_stack_a",
          email: "alice@example.com",
          confirmEmail: "mallory@example.com",
          idempotencyKey: "invite-1",
        },
      },
    })}\n`);
    const rejected = await reader.next();
    expect(rejected.id).toBe(4);
    expect(rejected.result).toMatchObject({
      isError: true,
      structuredContent: { message: "confirmEmail must exactly match the invited email" },
    });
    expect(server.requests.some((request) => request.pathname.endsWith("/member-invitations"))).toBe(false);

    stdin.end();
    await done;

    const me = server.requests.find((request) => request.pathname === "/admin/me");
    expect(me).toBeDefined();
    expect(me?.cookie).toContain("cas_admin_session=");
  });

  test("rejects the retired Principal alias and serves the current Account tool", async () => {
    await seedSession();
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    const { stdin, reader, done } = await startStdioServer(server.fetch);

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    })}\n`);
    await reader.next();
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_current_principal", arguments: {} },
    })}\n`);

    const call = await reader.next();
    expect(call.error ?? (call.result as { isError?: boolean })?.isError).toBeTruthy();

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "get_current_account", arguments: {} },
    })}\n`);
    const account = await reader.next();
    expect(account.result).toMatchObject({
      isError: false,
      structuredContent: {
        account: { accountId: `acct_${"a".repeat(22)}` },
        authenticatedIdentity: { provider: "google" },
        memberships: [{ appId: "cas_stack_a" }],
      },
    });
    expect((account.result as { structuredContent: object }).structuredContent).not.toHaveProperty("principal");

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_apps", arguments: { limit: 10 } },
    })}\n`);
    expect((await reader.next()).result).toMatchObject({
      isError: false,
      structuredContent: { items: [{ appId: "cas_app_a", displayName: "App Ops" }] },
    });

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "list_space_root_domain_refs",
        arguments: { appId: "cas_app_a", refDomain: "doc", spaceId: "space-1" },
      },
    })}\n`);
    expect((await reader.next()).result).toMatchObject({
      isError: false,
      structuredContent: { refs: [{ spaceId: "space-1", count: 1 }] },
    });

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "update_app", arguments: { appId: "cas_app_a", status: "suspended", etag: '"rev-3"' } },
    })}\n`);
    const updated = await reader.next();
    expect(updated.result).toMatchObject({ isError: false, structuredContent: { etag: '"rev-4"' } });
    expect((updated.result as { structuredContent: object }).structuredContent).toEqual({ etag: '"rev-4"' });
    expect(server.requests.at(-1)).toMatchObject({ method: "PATCH", body: { status: "suspended" }, ifMatch: '"rev-3"' });

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "create_platform_invitation",
        arguments: {
          email: "developer@example.com",
          confirmEmail: "developer@example.com",
          authorities: ["apps.create"],
          idempotencyKey: "platform-invite-1",
        },
      },
    })}\n`);
    expect((await reader.next()).result).toMatchObject({
      isError: false,
      structuredContent: { invitationId: "platform-invite-new", etag: '"1"' },
    });

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "list_platform_invitations", arguments: { status: "pending" } },
    })}\n`);
    expect((await reader.next()).result).toMatchObject({
      isError: false,
      structuredContent: { items: [{ invitationId: "platform-invite-1" }] },
    });

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "revoke_platform_invitation",
        arguments: { invitationId: "platform-invite-1", confirmInvitationId: "platform-invite-1", etag: '"1"' },
      },
    })}\n`);
    expect((await reader.next()).result).toMatchObject({
      isError: false,
      structuredContent: { etag: '"2"' },
    });

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "list_platform_audit_events", arguments: { action: "platform_invitation.created", limit: 10 } },
    })}\n`);
    expect((await reader.next()).result).toMatchObject({
      isError: false,
      structuredContent: { items: [{ eventId: "platform-event-1" }] },
    });

    const platformAccountId = `acct_${"a".repeat(22)}`;
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "list_platform_accounts", arguments: { authority: "platform.admin" } } })}\n`);
    expect((await reader.next()).result).toMatchObject({ isError: false, structuredContent: { items: [{ accountId: platformAccountId }] } });

    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "get_platform_account", arguments: { accountId: platformAccountId } } })}\n`);
    expect((await reader.next()).result).toMatchObject({ isError: false, structuredContent: { accountId: platformAccountId } });

    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "revoke_platform_authority", arguments: { accountId: platformAccountId, confirmAccountId: platformAccountId, authority: "apps.create" } } })}\n`);
    expect((await reader.next()).result).toMatchObject({ isError: false, structuredContent: { ok: true } });

    stdin.end();
    await done;
  });

  test("returns a tool error result when not logged in", async () => {
    const server = new FakeAdminApi();
    const { stdin, reader, done } = await startStdioServer(server.fetch);

    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    })}\n`);
    await reader.next();
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_current_account", arguments: {} } })}\n`);

    const call = await reader.next();
    const callResult = call.result as { isError?: boolean; structuredContent?: { message?: string } };
    expect(callResult.isError).toBe(true);
    expect(callResult.structuredContent?.message).toMatch(/unicas login/);

    stdin.end();
    await done;
  });
});
