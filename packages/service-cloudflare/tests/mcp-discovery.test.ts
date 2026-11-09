import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createControlPlaneMcpWorker, mcpConfigFromEnv, type Env } from "../src/mcp/worker.js";

const origin = "https://console.unicas.work";
const resource = `${origin}/mcp`;
const scopes = ["control:read", "control:write", "control:security"];
let runtime: Miniflare;
let env: Env;
let provider: ReturnType<typeof createControlPlaneMcpWorker>;
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as ExecutionContext;

beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "mcp-discovery",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "mcp-discovery" },
      kvNamespaces: ["OAUTH_KV"],
    }],
  }));
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const configuredOrigin = /^MCP_PUBLIC_ORIGIN = "([^"]+)"$/m.exec(config)?.[1];
  expect(configuredOrigin).toBe(origin);
  env = {
    MCP_PUBLIC_ORIGIN: configuredOrigin,
    PUBLIC_ORIGIN: "https://unicas.work",
    CAS_CONTROL_DB: await runtime.getD1Database("DB", "mcp-discovery"),
    OAUTH_KV: await runtime.getKVNamespace("OAUTH_KV", "mcp-discovery"),
  };
  provider = createControlPlaneMcpWorker(mcpConfigFromEnv(env), env.CAS_CONTROL_DB);
});

afterAll(async () => {
  await runtime?.dispose();
});

describe("production MCP OAuth discovery", () => {
  test("challenges unauthenticated MCP requests with reachable resource metadata", async () => {
    const response = await provider.fetch(new Request(resource), env, ctx);
    expect(response.status).toBe(401);
    const challenge = response.headers.get("WWW-Authenticate");
    expect(challenge).toMatch(/^Bearer /);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge ?? "")?.[1];
    expect(metadataUrl).toBe(`${origin}/.well-known/oauth-protected-resource/mcp`);
    const metadata = await provider.fetch(new Request(metadataUrl!), env, ctx);
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get("Content-Type")).toContain("application/json");
    expect(await metadata.json()).toMatchObject({ resource, authorization_servers: [origin] });
  });

  test.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ])("publishes canonical resource metadata at %s", async path => {
    const response = await provider.fetch(new Request(`${origin}${path}`), env, ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      resource,
      authorization_servers: [origin],
      scopes_supported: scopes,
      bearer_methods_supported: ["header"],
    });
  });

  test("publishes matching authorization server endpoints and S256 support", async () => {
    const response = await provider.fetch(
      new Request(`${origin}/.well-known/oauth-authorization-server`), env, ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      scopes_supported: scopes,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  test.each([
    "https://dash.cloudflare.com/92c3c4fdcc84a1590555bccf4f111de2/one/access-controls/ai-controls/mcp-server/oauth-callback/unicas",
    "https://mcp.shazhou.work/servers-callback",
  ])("accepts DCR and exact authorization callback matching for %s", async redirectUri => {
    const registration = await provider.fetch(new Request(`${origin}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic Portal callback check",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    }), env, ctx);
    expect(registration.status).toBe(201);
    const client = await registration.json() as { client_id: string; redirect_uris: string[] };
    expect(client.redirect_uris).toEqual([redirectUri]);
    const authorize = new URL(`${origin}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      resource,
      scope: "unsupported",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
    }).toString();
    const response = await provider.fetch(new Request(authorize), env, ctx);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(`${location.origin}${location.pathname}`).toBe(redirectUri);
    expect(location.searchParams.get("error")).toBe("invalid_scope");
    authorize.searchParams.set("redirect_uri", `${redirectUri}/wrong`);
    const rejected = await provider.fetch(new Request(authorize), env, ctx);
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get("Location")).toBeNull();
  });
});
