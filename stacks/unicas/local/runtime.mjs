import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import {
  convertV4MiniflareOptions,
  Log,
  LogLevel,
  Miniflare,
} from "miniflare";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COMPATIBILITY_DATE = "2025-08-17";
const SESSION_KEY = createHash("sha256").update("unicas local development session key").digest("base64url");

const WORKSPACE_ALIASES = Object.fromEntries(Object.entries({
  "@unicas/codec": "packages/codec/src/index.ts",
  "@unicas/tenant-protocol/openapi.json": "packages/tenant-protocol/openapi/tenant-v1.openapi.json",
  "@unicas/tenant-protocol": "packages/tenant-protocol/src/index.ts",
  "@unicas/admin-protocol/openapi.json": "packages/admin-protocol/openapi/admin-v1.openapi.json",
  "@unicas/admin-protocol": "packages/admin-protocol/src/index.ts",
  "@unicas/service": "packages/service/src/index.ts",
  "@unicas/control-auth": "packages/control-auth/src/index.ts",
}).map(([specifier, path]) => [specifier, join(ROOT, path)]));

function assertPortFree(host, port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      reject(error.code === "EADDRINUSE"
        ? new Error(`Port ${port} is already in use.`)
        : error);
    });
    server.once("listening", () => server.close(resolve));
    server.listen(port, host);
  });
}

async function bundle(entry, outfile, external = []) {
  await mkdir(dirname(outfile), { recursive: true });
  await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2024",
    conditions: ["workerd", "worker", "browser"],
    alias: WORKSPACE_ALIASES,
    external: ["cloudflare:workers", ...external],
    logOverride: { "empty-import-meta": "silent" },
  });
}

export async function startLocalUnicasRuntime({
  host = "127.0.0.1",
  ports: overrides = {},
  persistPath,
  logLevel = LogLevel.WARN,
} = {}) {
  const ports = {
    admin: overrides.admin ?? 8792,
    mockOidc: overrides.mockOidc ?? 8793,
    edge: overrides.edge ?? 8794,
  };
  const publicHost = process.env.UNICAS_LOCAL_PUBLIC_HOST ?? host;
  await Promise.all(Object.values(ports).map((port) => assertPortFree(host, port)));

  const bundleDir = join(ROOT, ".wrangler", "local-bundles", "unicas");
  await Promise.all([
    bundle(
      join(ROOT, "packages", "service-cloudflare", "src", "worker.ts"),
      join(bundleDir, "service.js"),
      ["node:*"],
    ),
    bundle(
      join(ROOT, "stacks", "unicas", "local", "mock-oidc-worker.mjs"),
      join(bundleDir, "mock-oidc.js"),
    ),
  ]);

  const adminOrigin = process.env.UNICAS_ADMIN_ORIGIN ?? "http://localhost:4070";
  const useGoogle = Boolean(process.env.GOOGLE_OIDC_CLIENT_ID)
    || Boolean(process.env.GOOGLE_OIDC_CLIENT_SECRET);
  const adminBindings = {
    GOOGLE_OIDC_CLIENT_ID: process.env.GOOGLE_OIDC_CLIENT_ID ?? "unicas-local-admin",
    GOOGLE_OIDC_CLIENT_SECRET: process.env.GOOGLE_OIDC_CLIENT_SECRET ?? "unicas-local-admin-secret",
    SESSION_ENCRYPTION_KEYS: JSON.stringify({ local: SESSION_KEY }),
    ADMIN_PUBLIC_ORIGIN: adminOrigin,
    PUBLIC_ORIGIN: adminOrigin,
    SESSION_COOKIE_SECURE: "false",
    OIDC_ISSUER: useGoogle
      ? process.env.GOOGLE_OIDC_ISSUER ?? "https://accounts.google.com"
      : `http://${publicHost}:${ports.mockOidc}`,
    ...(!useGoogle ? {
      OIDC_DISCOVERY_URL: `http://${publicHost}:${ports.mockOidc}/.well-known/openid-configuration`,
    } : {}),
  };

  const mf = new Miniflare(convertV4MiniflareOptions({
    host,
    log: new Log(logLevel),
    logRequests: logLevel >= LogLevel.INFO,
    ...(persistPath ? { resourcePersistencePath: persistPath } : {}),
    workers: [
      {
        name: "unicas-service",
        modules: true,
        scriptPath: join(bundleDir, "service.js"),
        compatibilityDate: COMPATIBILITY_DATE,
        compatibilityFlags: ["global_fetch_strictly_public", "nodejs_compat"],
        bindings: {
          ...adminBindings,
          CAS_AUDIT_READER_KEY: "unicas-local-audit-reader-key",
          CAS_PUBLIC_ORIGIN: adminOrigin,
          MCP_PUBLIC_ORIGIN: adminOrigin,
          MCP_ALLOWED_ORIGIN_HOSTNAMES: "",
          MCP_MUTATIONS_ENABLED: "true",
          OAUTH_STATE_ENCRYPTION_KEY: SESSION_KEY,
          ...(process.env.MANAGED_ISSUER_PRIVATE_KEY_PKCS8 && process.env.MANAGED_ISSUER_KEY_ID ? {
            MANAGED_ISSUER_PRIVATE_KEY_PKCS8: process.env.MANAGED_ISSUER_PRIVATE_KEY_PKCS8,
            MANAGED_ISSUER_KEY_ID: process.env.MANAGED_ISSUER_KEY_ID,
          } : {}),
        },
        durableObjects: {
          CAS_DO: { className: "CasDurableObject" },
          CAS_DOMAIN_DO: { className: "RootRefDomainDurableObject" },
        },
        d1Databases: {
          CAS_CONTROL_DB: "unicas-control",
          CAS_DB: "unicas-tenant",
        },
        r2Buckets: { CAS_R2: "unicas-content" },
        kvNamespaces: ["OAUTH_KV"],
        unsafeDirectSockets: [
          { host, port: ports.admin },
          { host, port: ports.edge },
        ],
      },
      {
        name: "unicas-mock-oidc",
        modules: true,
        scriptPath: join(bundleDir, "mock-oidc.js"),
        compatibilityDate: COMPATIBILITY_DATE,
        unsafeDirectSockets: [{ host, port: ports.mockOidc }],
      },
    ],
  }));

  await mf.ready;
  if (!useGoogle) {
    const { migrateControlSchema } = await import(pathToFileURL(
      join(ROOT, "packages", "service-cloudflare", "dist", "control-schema.js"),
    ).href);
    const controlDb = await mf.getD1Database("CAS_CONTROL_DB", "unicas-service");
    await migrateControlSchema(controlDb);
    const now = Date.now();
    await controlDb.prepare(
      "INSERT OR IGNORE INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES ('prn_local_operator', ?, 'local-operator', 'active', 1, 1, 1, ?, ?)",
    ).bind(`http://${publicHost}:${ports.mockOidc}`, now, now).run();
  }
  return {
    mf,
    urls: Object.fromEntries(Object.entries(ports).map(
      ([name, port]) => [name, `http://${publicHost}:${port}`],
    )),
    dispose: () => mf.dispose(),
  };
}