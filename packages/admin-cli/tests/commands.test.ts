import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createContext } from "../src/commands/common.js";
import type { CliContext } from "../src/commands/common.js";
import { appAuditCommand } from "../src/commands/app-audit.js";
import { appMembersCommand } from "../src/commands/app-members.js";
import { appOAuthIssuerCommand } from "../src/commands/app-oauth-issuer.js";
import { appRefDomainsCommand } from "../src/commands/app-refdomains.js";
import { appsCommand } from "../src/commands/apps.js";
import { logoutCommand } from "../src/commands/logout.js";
import { membersCommand } from "../src/commands/members.js";
import { oauthIssuerCommand } from "../src/commands/oauth-issuer.js";
import { accountCommand, principalCommand } from "../src/commands/principal.js";
import { platformInvitationsCommand } from "../src/commands/platform-invitations.js";
import { platformAuditCommand } from "../src/commands/platform-audit.js";
import { platformAccessCommand } from "../src/commands/platform-access.js";
import { stacksCommand } from "../src/commands/stacks.js";
import { statusCommand } from "../src/commands/status.js";
import { whoamiCommand } from "../src/commands/whoami.js";
import type { TokenStore } from "../src/store.js";
import { FAKE_ORIGIN, FakeAdminApi } from "./helpers/fake-server.js";

let dir: string;
let ctx: CliContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "unicas-cli-cmd-"));
  ctx = createContext(
    { UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN },
    new FakeAdminApi().fetch,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function captureStdout(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  return { writes, restore: () => spy.mockRestore() };
}

async function seedLoggedIn(store: TokenStore): Promise<void> {
  await store.save({
    adminOrigin: FAKE_ORIGIN,
    cookie: "cas_admin_session=session-1",
    csrfToken: "cli-csrf-1",
    identity: { identityIssuer: "https://accounts.google.com", subject: "sub-1", displayName: "Alice", emailForDisplay: "alice@example.com" },
    savedAt: Date.now(),
  });
}

describe("command layer", () => {
  test("persists server-rotated session credentials", async () => {
    await seedLoggedIn(ctx.store);
    const previous = await ctx.store.load();
    const server = new FakeAdminApi();
    const rotating = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, async (input, init) => {
      const response = await server.fetch(input, init);
      response.headers.set("Set-Cookie", "cas_admin_session=rotated; HttpOnly; Path=/admin");
      response.headers.set("X-CSRF-Token", "rotated-csrf");
      return response;
    });
    captureStdout();
    await whoamiCommand(rotating);
    expect(await ctx.store.load()).toMatchObject({ ...previous, cookie: "cas_admin_session=rotated", csrfToken: "rotated-csrf", savedAt: expect.any(Number) });
  });

  test("whoami prints the operator identity as JSON", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi();
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await whoamiCommand(ctx);
    const parsed = JSON.parse(writes.join("")) as { identity: { subject: string } };
    expect(parsed.identity.subject).toBe("sub-1");
    expect(server.requests[0]!.cookie).toContain("cas_admin_session=");
  });

  test("whoami fails with exit code 2 when not logged in", async () => {
    await expect(whoamiCommand(ctx)).rejects.toMatchObject({
      name: "CliError",
      exitCode: 2,
      message: /unicas login/,
    });
  });

  test("principal prints the App administrator identity as JSON", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await principalCommand(ctx);
    const parsed = JSON.parse(writes.join("")) as { principal: { subject: string }; memberships: Array<{ appId: string }> };
    expect(parsed.principal.subject).toBe("sub-1");
    expect(parsed.memberships).toEqual([expect.objectContaining({ appId: "cas_stack_a" })]);
  });

  test("account prints stable Account data without Principal identity", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await accountCommand(ctx);
    const parsed = JSON.parse(writes.join(""));
    expect(parsed).toMatchObject({
      account: { accountId: `acct_${"a".repeat(22)}`, displayName: "Alice" },
      authenticatedIdentity: { provider: "google" },
      memberships: [{ appId: "cas_stack_a" }],
    });
    expect(parsed).not.toHaveProperty("principal");
  });

  test("status reports the local session without network traffic", async () => {
    await seedLoggedIn(ctx.store);
    const { writes } = captureStdout();
    await statusCommand(ctx);
    const status = JSON.parse(writes.join("")) as { loggedIn: boolean; identity: { subject: string } | null };
    expect(status.loggedIn).toBe(true);
    expect(status.identity?.subject).toBe("sub-1");
    expect(ctx.store.path).toContain(dir);
  });

  test("apps list and get print App-shaped JSON", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appsCommand(ctx, "list", ["--limit", "10"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ items: [{ appId: "cas_app_a", displayName: "App Ops" }] });
    writes.length = 0;
    await appsCommand(ctx, "get", ["cas_app_a"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ appId: "cas_app_a", revision: 3 });
    expect(server.requests.map((request) => request.pathname)).toEqual([
      "/admin/apps",
      "/admin/apps/cas_app_a",
    ]);
  });

  test("apps create sends an idempotency key", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appsCommand(ctx, "create", ["Documents"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ appId: "cas_app_new", displayName: "Documents" });
    expect(server.requests[0]).toMatchObject({
      pathname: "/admin/apps",
      method: "POST",
      csrf: "cli-csrf-1",
      idempotencyKey: expect.stringMatching(/^unicas-cli:/),
    });
  });

  test("apps update resolves the current App ETag", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appsCommand(ctx, "update", ["cas_app_a", "Renamed", "--description", "Production", "--status", "suspended"]);
    expect(JSON.parse(writes.join(""))).toEqual({ etag: '"rev-4"' });
    expect(server.requests).toEqual([
      expect.objectContaining({ pathname: "/admin/apps/cas_app_a", method: "GET" }),
      expect.objectContaining({
        pathname: "/admin/apps/cas_app_a",
        method: "PATCH",
        ifMatch: '"rev-3"',
        body: { displayName: "Renamed", description: "Production", status: "suspended" },
      }),
    ]);
  });

  test("App invitation commands filter history and confirm a revision-specific revocation", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appMembersCommand(ctx, "invitations", ["cas_app_a", "--status", "pending"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ items: [{ invitationId: "inv-app-1" }] });
    writes.length = 0;
    await appMembersCommand(ctx, "revoke-invitation", ["cas_app_a", "inv-app-1", "--etag", '"1"', "--confirm-invitation-id", "inv-app-1"]);
    expect(JSON.parse(writes.join(""))).toEqual({ etag: '"2"' });
    expect(server.requests.at(-1)).toMatchObject({ method: "DELETE", pathname: "/admin/apps/cas_app_a/member-invitations/inv-app-1", ifMatch: '"1"' });
  });

  test("platform invitation commands list, create with authorities, and conditionally revoke", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();

    await platformInvitationsCommand(ctx, "list", ["--status", "pending", "--limit", "10"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ items: [{ invitationId: "platform-invite-1" }] });
    writes.length = 0;
    await platformInvitationsCommand(ctx, "create", [
      "developer@example.com",
      "--authority", "apps.create",
      "--authority", "platform.admin",
    ]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ invitationId: "platform-invite-new", etag: '"1"' });
    expect(server.requests.at(-1)).toMatchObject({
      pathname: "/admin/platform/invitations",
      method: "POST",
      idempotencyKey: expect.stringMatching(/^unicas-cli:/),
      body: { emailConstraint: "developer@example.com", authorities: ["apps.create", "platform.admin"] },
    });
    writes.length = 0;
    await platformInvitationsCommand(ctx, "revoke", [
      "platform-invite-1",
      "--etag", '"1"',
      "--confirm-invitation-id", "platform-invite-1",
    ]);
    expect(JSON.parse(writes.join(""))).toEqual({ etag: '"2"' });
    expect(server.requests.at(-1)).toMatchObject({
      pathname: "/admin/platform/invitations/platform-invite-1",
      method: "DELETE",
      ifMatch: '"1"',
    });
  });

  test("platform audit forwards exact filters and pagination", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();

    await platformAuditCommand(ctx, [
      "--action", "platform_invitation.created",
      "--actor-account-id", `acct_${"a".repeat(22)}`,
      "--created-after", "10",
      "--limit", "10",
      "--cursor", "next",
    ]);

    expect(JSON.parse(writes.join(""))).toMatchObject({ items: [{ eventId: "platform-event-1" }] });
    expect(server.requests[0]).toMatchObject({
      pathname: "/admin/platform/audit-events",
      search: `?action=platform_invitation.created&actorAccountId=acct_${"a".repeat(22)}&createdAfter=10&limit=10&cursor=next`,
    });
  });

  test("platform access lists Accounts and sends explicit revision-free commands", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    const accountId = `acct_${"a".repeat(22)}`;

    await platformAccessCommand(ctx, "list", ["--authority", "apps.create", "--effective-access", "active", "--limit", "10"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ items: [{ accountId }] });
    expect(server.requests.at(-1)?.search).toBe("?effectiveAccess=active&authority=apps.create&limit=10");
    writes.length = 0;
    await platformAccessCommand(ctx, "get", [accountId]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ accountId, memberships: [] });
    writes.length = 0;
    await platformAccessCommand(ctx, "revoke", [accountId, "apps.create", "--confirm-account-id", accountId]);
    writes.length = 0;
    await platformAccessCommand(ctx, "block", [accountId, "--confirm-account-id", accountId]);
    expect(JSON.parse(writes.join(""))).toEqual({ ok: true });
    expect(server.requests.slice(-2)).toEqual([
      expect.objectContaining({ pathname: `/admin/platform/accounts/${accountId}/authorities/apps.create`, method: "DELETE", ifMatch: null }),
      expect.objectContaining({ pathname: `/admin/platform/accounts/${accountId}/block`, method: "PUT", ifMatch: null }),
    ]);
  });

  test("app-members list returns Account summaries without login identity", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appMembersCommand(ctx, "list", ["cas_app_a", "--limit", "10"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({
      items: [{
        appId: "cas_app_a",
        account: { accountId: `acct_${"a".repeat(22)}`, displayName: "Alice" },
      }],
    });
    expect(server.requests[0]).toMatchObject({
      pathname: "/admin/apps/cas_app_a/members",
      search: "?limit=10",
    });
  });

  test("app-members invite uses the App endpoint and idempotency", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appMembersCommand(ctx, "invite", [
      "cas_app_a",
      "alice@example.com",
      "--idempotency-key",
      "invite-app-1",
    ]);
    expect(JSON.parse(writes.join(""))).toEqual({ invitationId: "inv-app-1", expiresAt: 1_800_000_000, acceptUrl: `${FAKE_ORIGIN}/admin/invitations/inv-app-1`, etag: '"1"' });
    expect(server.requests[0]).toMatchObject({
      pathname: "/admin/apps/cas_app_a/member-invitations",
      method: "POST",
      csrf: "cli-csrf-1",
      idempotencyKey: "invite-app-1",
      body: { emailConstraint: "alice@example.com" },
    });
  });

  test("app-members remove confirms the Account ID without resolving an App ETag", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appMembersCommand(ctx, "remove", [
      "cas_app_a",
      `acct_${"a".repeat(22)}`,
      "--confirm-account-id",
      `acct_${"a".repeat(22)}`,
    ]);
    expect(JSON.parse(writes.join(""))).toEqual({ ok: true });
    expect(server.requests).toEqual([
      expect.objectContaining({
        pathname: "/admin/apps/cas_app_a/members",
        search: `?accountId=acct_${"a".repeat(22)}`,
        method: "DELETE",
        ifMatch: null,
      }),
    ]);
  });

  test("app-members remove requires an explicit non-TTY confirmation", async () => {
    await seedLoggedIn(ctx.store);
    await expect(appMembersCommand(ctx, "remove", [
      "cas_app_a",
      `acct_${"a".repeat(22)}`,
    ])).rejects.toThrow(/confirm-account-id/);
  });

  test("stacks create auto-generates an idempotency key", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi();
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await stacksCommand(ctx, "create", ["Ops"]);
    const parsed = JSON.parse(writes.join("")) as { stackId: string; displayName: string };
    expect(parsed.stackId).toBe("cas_stack_new");
    expect(parsed.displayName).toBe("Ops");
    const create = server.requests.find((request) => request.method === "POST" && request.pathname === "/admin/stacks")!;
    expect((create.body as { displayName: string }).displayName).toBe("Ops");
    expect(server.requests.some((request) => request.pathname === "/admin/stacks" && request.method === "POST")).toBe(true);
  });

  test("stacks update resolves the current ETag when none is passed", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi();
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await stacksCommand(ctx, "update", ["cas_stack_a", "Renamed"]);
    const parsed = JSON.parse(writes.join("")) as { displayName: string };
    expect(parsed.displayName).toBe("Renamed");
    const get = server.requests.find((request) => request.method === "GET" && request.pathname === "/admin/stacks/cas_stack_a")!;
    expect(get).toBeDefined();
    const patch = server.requests.find((request) => request.method === "PATCH")!;
    expect(patch.pathname).toBe("/admin/stacks/cas_stack_a");
    expect(patch.body).toMatchObject({ displayName: "Renamed" });
  });

  test("stacks update can change only the description", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi();
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    await stacksCommand(ctx, "update", ["cas_stack_a", "--description", "Production"]);
    const patch = server.requests.find((request) => request.method === "PATCH")!;
    expect(patch.body).toEqual({ description: "Production" });
  });

  test("logout ends the BFF session and clears the store", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi();
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await logoutCommand(ctx);
    expect(writes.join("")).toMatch(/Ended the UniCAS admin session/);
    expect(await ctx.store.load()).toEqual({ adminOrigin: "", cookie: "", csrfToken: "" });
    expect(server.requests.some((request) => request.pathname === "/admin/auth/logout" && request.method === "POST")).toBe(true);
  });

  test("a non-TTY destructive command demands an explicit confirmation flag", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi();
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    await expect(
      membersCommand(ctx, "remove", [
        "cas_stack_a",
        "--identity-issuer",
        "https://accounts.google.com",
        "--subject",
        "bob",
        "--etag",
        '"rev-3"',
      ]),
    ).rejects.toThrow(/confirm-subject/);
  });

  test("OAuth issuer inspect and activate use the standard discovery flow", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi();
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await oauthIssuerCommand(ctx, "inspect", ["cas_stack_a", "https://issuer.example"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ inspectionId: "oinsp_test", status: "pending" });
    writes.length = 0;
    await oauthIssuerCommand(ctx, "activate", ["cas_stack_a", "oinsp_test", "--activation-proof", "proof"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ status: "active", revision: 2 });
    expect(server.requests.some((request) => request.pathname.endsWith("/oauth-issuer") && request.method === "GET")).toBe(true);
    expect(server.requests.some((request) => request.pathname.endsWith("/oauth-issuer") && request.method === "PUT")).toBe(true);
  });

  test("App OAuth issuer inspect and activate use App routes and ETags", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appOAuthIssuerCommand(ctx, "inspect", ["cas_app_a", "https://issuer.example"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ inspectionId: "oinsp_app", challenge: expect.any(String) });
    expect(JSON.parse(writes.join(""))).not.toHaveProperty("revision");
    writes.length = 0;
    await appOAuthIssuerCommand(ctx, "activate", ["cas_app_a", "oinsp_app", "--activation-proof", "proof", "--if-none-match", "*"]);
    expect(JSON.parse(writes.join(""))).toEqual({ etag: '"1"' });
    expect(server.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ pathname: "/admin/apps/cas_app_a/oauth-issuer/inspections", method: "POST" }),
      expect.objectContaining({ pathname: "/admin/apps/cas_app_a/oauth-issuer", method: "PUT", ifNoneMatch: "*", ifMatch: null }),
    ]));
  });

  test("App ref-domain and audit commands use App/Space vocabulary", async () => {
    await seedLoggedIn(ctx.store);
    const server = new FakeAdminApi({ adminVocabulary: "app" });
    ctx = createContext({ UNICAS_CONFIG_DIR: dir, UNICAS_ADMIN_URL: FAKE_ORIGIN }, server.fetch);
    const { writes } = captureStdout();
    await appRefDomainsCommand(ctx, "list", ["cas_app_a"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ domains: [{ appId: "cas_app_a", refDomain: "doc" }] });
    writes.length = 0;
    await appAuditCommand(ctx, "control", ["cas_app_a", "--after", "event-0"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({
      items: [{
        appId: "cas_app_a",
        actorAccount: { accountId: `acct_${"a".repeat(22)}` },
        authenticatedIdentity: { subject: "sub-1" },
      }]
    });
    writes.length = 0;
    await appAuditCommand(ctx, "root-domain-refs", ["cas_app_a", "doc", "--space-id", "space-1"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ refs: [{ spaceId: "space-1" }] });
    writes.length = 0;
    await appAuditCommand(ctx, "root-domain-events", ["cas_app_a", "doc", "--space-id", "space-1", "--after", "0"]);
    expect(JSON.parse(writes.join(""))).toMatchObject({ events: [{ spaceId: "space-1" }] });
    expect(server.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ pathname: "/admin/apps/cas_app_a/audit-events", search: "?after=event-0" }),
      expect.objectContaining({ pathname: "/admin/apps/cas_app_a/root-ref-domains/doc/refs", search: "?spaceId=space-1" }),
      expect.objectContaining({ pathname: "/admin/apps/cas_app_a/root-ref-domains/doc/events", search: "?spaceId=space-1&after=0" }),
    ]));
  });
});
