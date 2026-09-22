import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { AppAuthorityRepository } from "../src/control-authority.js";
import { migrateControlSchema } from "../src/control-schema.js";

let miniflare: Miniflare | undefined;
let db: D1Database | undefined;

afterEach(async () => {
  await miniflare?.dispose();
  miniflare = undefined;
  db = undefined;
});

async function createRepository(): Promise<AppAuthorityRepository> {
  miniflare = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "control-authority-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "control-authority-test-db" },
    }],
  }));
  await miniflare.ready;
  db = await miniflare.getD1Database("DB", "control-authority-test");
  await migrateControlSchema(db);
  return new AppAuthorityRepository(db);
}

function oauthIssuerInserts(rows: Array<{
  appId: string;
  issuer: string;
}>, includeApps = true): D1PreparedStatement[] {
  return rows.flatMap(({ appId, issuer }) => [
    ...(includeApps ? [db!.prepare(
      "INSERT INTO cas_apps (app_id, display_name, created_at) VALUES (?, 'Authority fixture', 0)",
    ).bind(appId)] : []),
    db!.prepare(
      "INSERT INTO cas_app_oauth_issuers (app_id, issuer, audience, metadata_url, metadata_type, authorization_endpoint, token_endpoint, jwks_uri, status, jwks_digest, capability_max_lifetime_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'digest', ?)",
    ).bind(
      appId,
      issuer,
      "https://cas.example/v1/apps/" + appId,
      "https://oauth.example/.well-known/oauth-authorization-server",
      "oauth",
      "https://oauth.example/authorize",
      "https://oauth.example/token",
      "https://oauth.example/jwks",
      600,
    )]);
}

describe("AppAuthorityRepository", () => {
  test("fails closed when an issuer has no owning App", async () => {
    await createRepository();
    await db!.batch(oauthIssuerInserts([{ appId: "cas_missing", issuer: "https://orphan.example" }], false));
    const repository = new AppAuthorityRepository(db!);
    await expect(repository.resolveIssuer("https://orphan.example")).resolves.toBeNull();
  });

  test("maps one active physical App issuer to its authority", async () => {
    await createRepository();
    await db!.batch(oauthIssuerInserts([{ appId: "cas_app", issuer: "https://app-issuer.example" }]));
    const repository = new AppAuthorityRepository(db!);
    await expect(repository.resolveIssuer("https://app-issuer.example")).resolves.toMatchObject({
      appId: "cas_app",
      appStatus: "active",
      issuer: "https://app-issuer.example",
      audience: "https://cas.example/v1/apps/cas_app",
      jwksUri: "https://oauth.example/jwks",
      capabilityMaxLifetimeSeconds: 600,
    });
  });

  test("tracks suspension and restoration for external issuers", async () => {
    await createRepository();
    const issuer = "https://external.example";
    await db!.batch(oauthIssuerInserts([{ appId: "cas_status", issuer }]));
    const repository = new AppAuthorityRepository(db!);
    await expect(repository.resolveIssuer(issuer)).resolves.toMatchObject({ appStatus: "active" });
    await db!.prepare("UPDATE cas_apps SET status = 'suspended' WHERE app_id = 'cas_status'").run();
    await expect(repository.resolveIssuer(issuer)).resolves.toMatchObject({ appStatus: "suspended" });
    await db!.prepare("UPDATE cas_apps SET status = 'active' WHERE app_id = 'cas_status'").run();
    await expect(repository.resolveIssuer(issuer)).resolves.toMatchObject({ appStatus: "active" });
  });

  test("fails closed for unknown and inactive App issuers", async () => {
    await createRepository();
    const repository = new AppAuthorityRepository(db!);
    await expect(repository.resolveIssuer("https://unknown.example")).resolves.toBeNull();
    await db!.prepare(
      "INSERT INTO cas_app_oauth_issuers (app_id, issuer, audience, metadata_url, metadata_type, authorization_endpoint, token_endpoint, jwks_uri, status, jwks_digest, capability_max_lifetime_seconds) VALUES ('cas_pending', 'https://pending-app.example', 'cas', 'https://pending-app.example/.well-known/oauth-authorization-server', 'oauth', 'https://pending-app.example/authorize', 'https://pending-app.example/token', 'https://pending-app.example/jwks', 'pending', 'digest', 600)",
    ).run();
    await expect(repository.resolveIssuer("https://pending-app.example")).resolves.toBeNull();
  });
});
