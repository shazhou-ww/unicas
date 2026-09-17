import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { ProviderRegistry, sha256Hex } from "../../../../packages/service/src/index.ts";
import { matchAppAdminRoute } from "../../../../packages/admin-protocol/src/index.ts";
import { createAdminBff } from "../../../../packages/service-cloudflare/src/admin-bff/bff.ts";
import { handleAppAdminCompatibilityRequest } from "../../../../packages/service-cloudflare/src/app-admin-adapter.ts";
import { D1AccountRepository } from "../../../../packages/service-cloudflare/src/account-repository.ts";
import { D1PlatformAccessRepository } from "../../../../packages/service-cloudflare/src/platform-access-repository.ts";
import { D1EmailChallengeRepository } from "../../../../packages/service-cloudflare/src/email-challenge-repository.ts";
import { ControlSessionStore } from "../../../../packages/service-cloudflare/src/control-sessions.ts";
import { createControlPlaneOperations } from "../../../../packages/service-cloudflare/src/control-operations.ts";
import { migrateControlSchema } from "../../../../packages/service-cloudflare/src/control-schema.ts";

const origin = "http://127.0.0.1:9086";
const runtime = new Miniflare(convertV4MiniflareOptions({
  workers: [{
    name: "challenge-browser-fixture",
    modules: true,
    script: "export default { fetch() { return new Response('fixture'); } };",
    compatibilityDate: "2025-08-17",
    d1Databases: { DB: "challenge-browser-fixture" },
  }],
}));
const database = await runtime.getD1Database("DB", "challenge-browser-fixture");
await migrateControlSchema(database);
await database.prepare(
  "INSERT INTO cas_apps (app_id, display_name, status, created_at, revision) VALUES ('fixture-app', 'Fixture', 'active', 1, 1)",
).run();
let latestCode = "";
const platform = new D1PlatformAccessRepository(database);
const bff = createAdminBff({
  config: {
    googleClientId: "fixture",
    googleClientSecret: "fixture",
    publicOrigin: origin,
    sessionEncryptionKeys: { fixture: randomBytes(32).toString("base64url") },
    sessionCookieSecure: false,
  },
  controlPlane: createControlPlaneOperations(database),
  sessionStore: new ControlSessionStore(database),
  accountRepository: new D1AccountRepository(database),
  platformAccessRepository: platform,
  emailChallengeRepository: new D1EmailChallengeRepository(database),
  emailChallengeSender: { send: async input => { latestCode = input.code; } },
  providerRegistry: new ProviderRegistry([{
    kind: "microsoft",
    displayName: "Microsoft",
    begin: async input => `${origin}/admin/auth/callback/microsoft?code=fixture&state=${encodeURIComponent(input.state)}`,
    complete: async input => ({
      provider: "microsoft",
      issuer: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
      subject: "fixture-microsoft-subject",
      displayName: "Fixture Administrator",
      avatarUrl: null,
      accountHint: null,
      verifiedEmailEvidence: [],
      authenticatedAt: Date.now(),
      authenticationEventId: input.authenticationEventId,
    }),
  }]),
  assets: async pathname => ["/assets/index.css", "/assets/index.js"].includes(pathname)
    ? new Response(await readFile(new URL(`../../../../packages/admin-webui/dist/ui${pathname}`, import.meta.url)), {
      headers: { "Content-Type": pathname.endsWith(".css") ? "text/css" : "text/javascript" },
    })
    : null,
});

if (process.argv.includes("--check")) {
  const response = await bff(new Request(`${origin}/admin/auth/login`));
  if (response.status !== 200) throw new Error("Fixture initialization failed");
  await runtime.dispose();
  console.log("Challenge fixture initialization passed");
} else {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url ?? "/", origin);
      let response: Response;
      if (url.pathname === "/fixture/start") {
        const token = randomBytes(24).toString("base64url");
        await database.prepare(
          "INSERT INTO cas_app_member_invitations (invitation_id, app_id, status, email_constraint, token_hash, expires_at, created_at) VALUES (?, 'fixture-app', 'pending', 'fixture@example.com', ?, ?, ?)",
        ).bind(crypto.randomUUID(), await sha256Hex(token), Date.now() + 600_000, Date.now()).run();
        response = Response.redirect(`${origin}/admin/invitations/${token}`);
      } else if (url.pathname === "/fixture/code") {
        response = Response.json({ code: latestCode });
      } else {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const request = new Request(url, {
          method: incoming.method,
          headers: incoming.headers as Record<string, string>,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        const route = matchAppAdminRoute(request.method, url.pathname);
        response = await (route ? handleAppAdminCompatibilityRequest(request, route, bff) : bff(request));
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500);
      outgoing.end("Fixture request failed");
    }
  });
  server.listen(9086, "127.0.0.1", () => console.log(`${origin}/fixture/start`));
  process.on("SIGINT", async () => { server.close(); await runtime.dispose(); process.exit(0); });
}