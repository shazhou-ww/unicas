import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { AppAuthorityRepository, AuthorityRepository } from "../src/control-authority.js";
import { migrateControlSchema } from "../src/control-schema.js";

let miniflare: Miniflare | undefined;
let db: D1Database | undefined;

afterEach(async () => {
  await miniflare?.dispose();
  miniflare = undefined;
  db = undefined;
});

async function createRepository(): Promise<AuthorityRepository> {
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
  return new AuthorityRepository(db);
}

function oauthIssuerInserts(rows: Array<{
  stackId: string;
  issuer: string;
}>, includeApps = true): D1PreparedStatement[] {
  return rows.flatMap(({ stackId, issuer }) => [
    ...(includeApps ? [db!.prepare(
      "INSERT INTO cas_apps (app_id, display_name, created_at) VALUES (?, 'Authority fixture', 0)",
    ).bind(stackId)] : []),
    db!.prepare(
      "INSERT INTO cas_app_oauth_issuers (app_id, issuer, audience, metadata_url, metadata_type, authorization_endpoint, token_endpoint, jwks_uri, status, jwks_digest, capability_max_lifetime_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'digest', ?)",
    ).bind(
      stackId,
      issuer,
      "https://cas.example/stacks/" + stackId,
      "https://oauth.example/.well-known/oauth-authorization-server",
      "oauth",
      "https://oauth.example/authorize",
      "https://oauth.example/token",
      "https://oauth.example/jwks",
      600,
    )]);
}

describe("AuthorityRepository (read-only)", () => {
  test("resolves an active OAuth issuer to its stack authority and discovered JWKS URI", async () => {
    const repository = await createRepository();
    await db!.batch(oauthIssuerInserts([{ stackId: "cas_s", issuer: "https://issuer.example" }]));
    const authority = await repository.resolveIssuer("https://issuer.example");
    expect(authority).toMatchObject({
      stackId: "cas_s",
      issuer: "https://issuer.example",
      audience: "https://cas.example/stacks/cas_s",
      jwksUri: "https://oauth.example/jwks",
      capabilityMaxLifetimeSeconds: 600,
    });
  });

  test("unknown issuers resolve to null (fail closed)", async () => {
    const repository = await createRepository();
    expect(await repository.resolveIssuer("https://unknown.example")).toBeNull();
    expect(await repository.resolveIssuer("")).toBeNull();
  });

  test("the legacy active issuer key snapshot table is removed", async () => {
    const repository = await createRepository();
    expect(repository).toBeDefined();
    expect(await db!.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cas_stack_oauth_issuer_keys'",
    ).first()).toBeNull();
  });

  test("a pending issuer is never an authority", async () => {
    const repository = await createRepository();
    await db!.prepare(
      "INSERT INTO cas_app_oauth_issuers (app_id, issuer, audience, metadata_url, metadata_type, authorization_endpoint, token_endpoint, jwks_uri, status, jwks_digest, capability_max_lifetime_seconds) VALUES ('cas_pending', 'https://pending.example', 'cas', 'https://pending.example/.well-known/oauth-authorization-server', 'oauth', 'https://pending.example/authorize', 'https://pending.example/token', 'https://pending.example/jwks', 'pending', 'digest', 600)",
    ).run();
    expect(await repository.resolveIssuer("https://pending.example")).toBeNull();
  });
});

describe("AppAuthorityRepository", () => {
  test("fails closed when an issuer has no owning App", async () => {
    await createRepository();
    await db!.batch(oauthIssuerInserts([{ stackId: "cas_missing", issuer: "https://orphan.example" }], false));
    const repository = new AppAuthorityRepository(db!);
    await expect(repository.resolveIssuer("https://orphan.example")).resolves.toBeNull();
  });

  test("maps one active physical App issuer to its authority", async () => {
    await createRepository();
    await db!.batch(oauthIssuerInserts([{ stackId: "cas_app", issuer: "https://app-issuer.example" }]));
    const repository = new AppAuthorityRepository(db!);
    await expect(repository.resolveIssuer("https://app-issuer.example")).resolves.toMatchObject({
      appId: "cas_app",
      appStatus: "active",
      issuer: "https://app-issuer.example",
      audience: "https://cas.example/stacks/cas_app",
      jwksUri: "https://oauth.example/jwks",
      capabilityMaxLifetimeSeconds: 600,
    });
  });

  test.each(["external", "managed"])("tracks suspension and restoration for %s issuers", async (mode) => {
    const legacy = await createRepository();
    const issuer = `https://${mode}.example`;
    await db!.batch(oauthIssuerInserts([{ stackId: "cas_status", issuer }]));
    if (mode === "managed") {
      await db!.batch([
        db!.prepare(
          "INSERT INTO cas_app_managed_issuers (app_id, issuer, audience, metadata_url, authorization_endpoint, token_endpoint, jwks_uri, status, verified_at, jwks_digest, capability_max_lifetime_seconds) SELECT app_id, issuer, audience, metadata_url, authorization_endpoint, token_endpoint, jwks_uri, status, 0, jwks_digest, capability_max_lifetime_seconds FROM cas_app_oauth_issuers WHERE app_id = 'cas_status'",
        ),
        db!.prepare("UPDATE cas_app_oauth_issuers SET status = 'disabled' WHERE app_id = 'cas_status'"),
      ]);
    }
    const repository = new AppAuthorityRepository(db!);
    await expect(repository.resolveIssuer(issuer)).resolves.toMatchObject({ appStatus: "active" });
    await db!.prepare("UPDATE cas_apps SET status = 'suspended' WHERE app_id = 'cas_status'").run();
    await expect(repository.resolveIssuer(issuer)).resolves.toMatchObject({ appStatus: "suspended" });
    await expect(legacy.resolveIssuer(issuer)).resolves.toBeNull();
    await db!.prepare("UPDATE cas_apps SET status = 'active' WHERE app_id = 'cas_status'").run();
    await expect(repository.resolveIssuer(issuer)).resolves.toMatchObject({ appStatus: "active" });
    await expect(legacy.resolveIssuer(issuer)).resolves.toMatchObject({ stackId: "cas_status" });
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
