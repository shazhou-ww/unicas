import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import {
  AccountService,
  ProviderRegistry,
  type ControlPlaneCallContext,
  type ControlPlaneOperations,
  type ControlSessionRepository,
  type ProviderAdapter,
  type StoredSession,
} from "@unicas/service";
import { createAdminBff } from "../src/admin-bff/bff.js";
import type { AdminBffConfig } from "../src/admin-bff/config.js";
import { D1AccountRepository } from "../src/account-repository.js";
import { D1PlatformAccessRepository } from "../src/platform-access-repository.js";
import { migrateControlSchema } from "../src/control-schema.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

class MemorySessions implements ControlSessionRepository {
  readonly sessions = new Map<string, StoredSession>();

  async create(sessionId: string, encryptedPayload: string, ttlMs: number): Promise<void> {
    this.sessions.set(sessionId, {
      sessionId,
      encryptedPayload,
      createdAt: 1,
      lastSeenAt: 1,
      expiresAt: 1 + ttlMs,
    });
  }

  async read(sessionId: string): Promise<StoredSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async touch(): Promise<void> { }
  async delete(sessionId: string): Promise<void> { this.sessions.delete(sessionId); }
  async pruneExpired(): Promise<number> { return 0; }
}

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cookieFrom(response: Response): string {
  return response.headers.get("Set-Cookie")!.split(";")[0]!.trim();
}

function adapter(kind: "google" | "github", now: () => number): ProviderAdapter {
  return {
    kind,
    displayName: kind,
    begin: async context => `https://${kind}.example/authorize?state=${encodeURIComponent(context.state)}`,
    complete: async input => ({
      provider: kind,
      issuer: `https://${kind}.example`,
      subject: `${kind}-subject`,
      displayName: `${kind} user`,
      avatarUrl: null,
      accountHint: null,
      verifiedEmailEvidence: [],
      authenticatedAt: now(),
      authenticationEventId: input.authenticationEventId,
    }),
  };
}

async function callback(
  bff: (request: Request) => Promise<Response>,
  started: Response,
  provider: "google" | "github",
): Promise<Response> {
  const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
  return bff(new Request(
    `https://console.example/admin/auth/callback/${provider}?code=code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: cookieFrom(started) } },
  ));
}

describe("BFF Account identity mutations", () => {
  test("freshly links and unlinks a provider while rotating credential version", async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
      workers: [{
        name: "account-link-bff-test",
        modules: true,
        script: "export default { fetch() { return new Response('ok'); } };",
        compatibilityDate: "2025-08-17",
        d1Databases: { DB: "account-link-bff-test" },
      }],
    }));
    await runtime.ready;
    const db: D1Database = await runtime.getD1Database("DB", "account-link-bff-test");
    await migrateControlSchema(db);
    let clock = 1000;
    const now = () => clock;
    const repository = new D1AccountRepository(db);
    const accounts = new AccountService(repository, now);
    const created = await accounts.createForExternalIdentity({
      provider: "google",
      issuer: "https://google.example",
      subject: "google-subject",
      displayName: "Google User",
    });
    await db.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'platform.admin', 1)",
    ).bind(created.account.accountId).run();
    await db.prepare(
      `INSERT INTO cas_platform_principals
        (principal_ref, identity_issuer, subject, status, platform_admin, apps_create,
         revision, created_at, updated_at, account_id)
       VALUES ('actor-ref', ?, ?, 'active', 1, 0, 1, 1, 1, ?)`,
    ).bind(
      created.authenticatedIdentity.issuer,
      created.authenticatedIdentity.subject,
      created.account.accountId,
    ).run();
    const sessions = new MemorySessions();
    const controlPlane = {
      recordSessionAudit: async () => undefined,
      me: async (context: ControlPlaneCallContext) => ({
        identity: {
          ...context.identity,
          displayName: context.profile?.displayName ?? null,
          emailForDisplay: context.profile?.emailForDisplay ?? null,
        },
        memberships: [],
      }),
    } as unknown as ControlPlaneOperations;
    const config: AdminBffConfig = {
      googleClientId: "google",
      googleClientSecret: "secret",
      sessionEncryptionKeys: { v1: randomKey() },
      publicOrigin: "https://console.example",
      sessionCookieSecure: false,
      csrfEnforced: false,
      now,
    };
    const bff = createAdminBff({
      config,
      controlPlane,
      sessionStore: sessions,
      accountRepository: repository,
      platformAccessRepository: new D1PlatformAccessRepository(db),
      providerRegistry: new ProviderRegistry([adapter("google", now), adapter("github", now)]),
    });

    const initialStart = await bff(new Request("https://console.example/admin/auth/start/google"));
    const initialLogin = await callback(bff, initialStart, "google");
    const initialCookie = cookieFrom(initialLogin);

    const initialAccount = await bff(new Request("https://console.example/admin/account", {
      headers: { Cookie: initialCookie },
    }));
    expect(await initialAccount.json()).toMatchObject({
      accountId: created.account.accountId,
      displayName: "Google User",
      identities: [{ provider: "google", currentLogin: true }],
      linkableProviders: ["github"],
    });
    expect((await bff(new Request("https://console.example/admin/account/profile", {
      method: "PATCH",
      headers: { Cookie: initialCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "User Choice", avatarExternalIdentityId: null }),
    }))).status).toBe(204);
    expect(await repository.getProfile(created.account.accountId)).toMatchObject({
      displayName: "User Choice",
      displayNameSource: "user",
      avatarUrl: null,
      avatarSource: "user",
    });

    const targetMember = await accounts.createForExternalIdentity({
      provider: "microsoft",
      issuer: "https://login.microsoftonline.com/consumers/v2.0",
      subject: "target-member",
      displayName: "Target Member",
    });
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_a', 'App', '', 'active', 1, 1)",
    ).run();
    for (const member of [created, targetMember]) {
      await db.prepare(
        "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('cas_app_a', ?, ?, 1, ?)",
      ).bind(
        member.authenticatedIdentity.issuer,
        member.authenticatedIdentity.subject,
        member.account.accountId,
      ).run();
    }
    expect(await (await bff(new Request("https://console.example/admin/platform/accounts", {
      headers: { Cookie: initialCookie },
    }))).json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ accountId: created.account.accountId }),
        expect.objectContaining({ accountId: targetMember.account.accountId }),
      ])
    });
    expect((await bff(new Request(
      `https://console.example/admin/platform/accounts/${targetMember.account.accountId}/authorities/apps.create`,
      { method: "PUT", headers: { Cookie: initialCookie } },
    ))).status).toBe(204);
    expect((await bff(new Request(
      `https://console.example/admin/platform/accounts/${targetMember.account.accountId}/authorities/apps.create`,
      { method: "DELETE", headers: { Cookie: initialCookie } },
    ))).status).toBe(204);
    expect((await bff(new Request(
      `https://console.example/admin/platform/accounts/${created.account.accountId}/authorities/platform.admin`,
      { method: "DELETE", headers: { Cookie: initialCookie } },
    ))).status).toBe(409);
    expect((await bff(new Request(
      `https://console.example/admin/platform/accounts/${created.account.accountId}/block`,
      { method: "PUT", headers: { Cookie: initialCookie } },
    ))).status).toBe(409);
    expect((await bff(new Request(
      `https://console.example/admin/platform/accounts/${targetMember.account.accountId}/block`,
      { method: "PUT", headers: { Cookie: initialCookie } },
    ))).status).toBe(204);
    expect(await repository.getAccount(targetMember.account.accountId)).toMatchObject({ credentialVersion: 2, blockedAt: clock });
    expect((await bff(new Request(
      `https://console.example/admin/platform/accounts/${targetMember.account.accountId}/block`,
      { method: "DELETE", headers: { Cookie: initialCookie } },
    ))).status).toBe(204);
    expect(await (await bff(new Request("https://console.example/admin/me", {
      headers: { Cookie: initialCookie },
    }))).json()).toMatchObject({
      account: { accountId: created.account.accountId },
      authenticatedIdentity: { externalIdentityId: created.authenticatedIdentity.externalIdentityId },
      accountMemberships: [{ appId: "cas_app_a", account: { accountId: created.account.accountId } }],
    });
    expect(await (await bff(new Request("https://console.example/admin/apps/cas_app_a/members", {
      headers: { Cookie: initialCookie },
    }))).json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ account: expect.objectContaining({ accountId: created.account.accountId }) }),
        expect.objectContaining({ account: expect.objectContaining({ accountId: targetMember.account.accountId }) }),
      ]),
    });
    expect(await (await bff(new Request(
      `https://console.example/admin/apps/cas_app_a/members?accountId=${encodeURIComponent(targetMember.account.accountId)}`,
      { method: "DELETE", headers: { Cookie: initialCookie } },
    ))).json()).toEqual({ ok: true });
    expect((await bff(new Request(
      `https://console.example/admin/apps/cas_app_a/members?accountId=${encodeURIComponent(created.account.accountId)}`,
      { method: "DELETE", headers: { Cookie: initialCookie } },
    ))).status).toBe(409);

    const linkStart = await bff(new Request("https://console.example/admin/auth/link/github", {
      method: "POST",
      headers: { Cookie: initialCookie, Accept: "application/json" },
    }));
    const { redirectTo } = await linkStart.json() as { redirectTo: string };
    expect(new URL(redirectTo).origin).toBe("https://google.example");
    const linkRedirect = new Response(null, {
      status: 302,
      headers: { Location: redirectTo, "Set-Cookie": linkStart.headers.get("Set-Cookie")! },
    });
    clock += 1;
    const currentProof = await callback(bff, linkRedirect, "google");
    expect(new URL(currentProof.headers.get("Location")!).origin).toBe("https://github.example");
    clock += 1;
    const linked = await callback(bff, currentProof, "github");
    expect(linked.headers.get("Location")).toBe("/admin/#/account");
    const linkedCookie = cookieFrom(linked);
    const github = await repository.getActiveIdentity("https://github.example", "github-subject");
    expect(github).toMatchObject({ accountId: created.account.accountId });
    expect(await repository.getAccount(created.account.accountId)).toMatchObject({ credentialVersion: 2 });
    expect(await (await bff(new Request("https://console.example/admin/account/identities", {
      headers: { Cookie: linkedCookie },
    }))).json()).toMatchObject({
      identities: [
        { provider: "google", currentLogin: true },
        { provider: "github", currentLogin: false },
      ],
    });

    const unlinkStart = await bff(new Request(
      `https://console.example/admin/auth/unlink/${encodeURIComponent(github!.externalIdentityId)}`,
      {
        method: "POST",
        headers: { Cookie: linkedCookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          remainingExternalIdentityId: created.authenticatedIdentity.externalIdentityId,
        }),
      },
    ));
    expect(new URL(unlinkStart.headers.get("Location")!).origin).toBe("https://google.example");
    clock += 1;
    const unlinked = await callback(bff, unlinkStart, "google");
    expect(unlinked.headers.get("Location")).toBe("/admin/#/account");
    expect(await repository.getActiveIdentity("https://github.example", "github-subject")).toBeNull();
    expect(await repository.getIdentity(github!.externalIdentityId)).toMatchObject({ unlinkedAt: clock });
    expect(await repository.getAccount(created.account.accountId)).toMatchObject({ credentialVersion: 3 });
    expect(sessions.sessions.has(initialCookie.split("=")[1]!)).toBe(false);
  }, 30_000);
});
