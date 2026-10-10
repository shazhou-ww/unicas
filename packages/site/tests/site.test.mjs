import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("UniCAS product site", () => {
  test("owns only the product apex static assets", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8"));
    const html = readFileSync(join(ROOT, "public/index.html"), "utf8");

    expect(config.routes).toEqual([{ pattern: "unicas.work", custom_domain: true }]);
    expect(config.assets.directory).toBe("./public");
    expect(config).not.toHaveProperty("main");
    expect(config).not.toHaveProperty("observability");
    expect(JSON.stringify(config)).not.toMatch(
      /d1_databases|durable_objects|kv_namespaces|r2_buckets|services|vars|secrets|oauth/iu,
    );
    expect(html).toContain('href="https://docs.unicas.work"');
    expect(html).toContain('href="https://console.unicas.work"');
  });

  test("publishes a public-key-only issuer for deployment smoke", () => {
    const site = join(ROOT, "public");
    const metadata = JSON.parse(readFileSync(
      join(site, ".well-known/oauth-authorization-server/deploy-smoke"),
      "utf8",
    ));
    const jwks = JSON.parse(readFileSync(join(site, "deploy-smoke/jwks.json"), "utf8"));
    const headers = readFileSync(join(site, "_headers"), "utf8");

    expect(metadata).toEqual({
      issuer: "https://unicas.work/deploy-smoke",
      authorization_endpoint: "https://unicas.work/deploy-smoke/authorize",
      token_endpoint: "https://unicas.work/deploy-smoke/token",
      jwks_uri: "https://unicas.work/deploy-smoke/jwks.json",
      scopes_supported: ["cas:read", "cas:write", "cas:manage"],
      code_challenge_methods_supported: ["S256"],
    });
    const smokeKey = jwks.keys.find((key) => key.kid === "github-actions-2026-09");
    expect(smokeKey).toMatchObject({
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
      key_ops: ["verify"],
      kid: "github-actions-2026-09",
    });
    for (const key of jwks.keys) expect(key).not.toHaveProperty("d");
    expect(headers).toContain("/.well-known/oauth-authorization-server/deploy-smoke");
    expect(headers).toContain("/deploy-smoke/jwks.json");
    expect(headers.match(/Content-Type: application\/json/gu)).toHaveLength(2);
  });
});
