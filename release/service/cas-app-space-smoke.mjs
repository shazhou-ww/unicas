/**
 * Smoke-test the deployed App/Space v1 contract through a machine API origin.
 *
 * Usage: node release/service/cas-app-space-smoke.mjs [baseUrl]
 * Required: UNICAS_SMOKE_APP_ID/ISSUER/AUDIENCE/KID/KEY_FILE.
 * Optional: UNICAS_SMOKE_SPACE_ID (defaults to /deploy-smoke).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { importPKCS8, SignJWT } from "jose";
import { normalizeSmokeBaseUrl } from "./smoke-target.mjs";
import {
  concatenateNodeBytes,
  computeNodeDigest,
  encodeHeader,
  hashToHex,
  hexToHash,
} from "../../packages/codec/dist/index.js";
import { createAppCasClient } from "../../packages/space-client/dist/index.js";
import {
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
  appSpaceRoutes,
  spaceGcExecutePermission,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  spaceUsageReadPermission,
} from "../../packages/space-protocol/dist/index.js";

const BASE = normalizeSmokeBaseUrl(
  process.argv[2] ?? "https://api.unicas.work",
  process.env.UNICAS_SMOKE_ALLOW_OTHER_ORIGIN === "true",
);
const APP_ID = requiredEnv("UNICAS_SMOKE_APP_ID");
const ISSUER = requiredEnv("UNICAS_SMOKE_ISSUER");
const AUDIENCE = requiredEnv("UNICAS_SMOKE_AUDIENCE");
const KID = requiredEnv("UNICAS_SMOKE_KID");
const KEY_FILE = requiredEnv("UNICAS_SMOKE_KEY_FILE");
const SPACE_ID = process.env.UNICAS_SMOKE_SPACE_ID ?? "/deploy-smoke";
const ISOLATION_SPACE_ID = `${SPACE_ID}-isolation`;
const KEY_DIR = join(import.meta.dirname, "..", ".wrangler", "cas-deploy");
const NODE_CONTENT_TYPE = "application/vnd.unidocs.cas-node.v1";
const RUN = `${process.pid}-${Date.now()}`;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the App/Space production smoke test`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

async function assertInvalidToken(response, message) {
  const responseBody = await response.json().catch(() => null);
  assert(
    response.status === 401 && responseBody?.error === "invalid_token",
    `${message} -> ${response.status} (401 invalid_token)`,
  );
}

async function nodeOf(content, refs = []) {
  const contentBytes = new TextEncoder().encode(content);
  const contentTypeBytes = new TextEncoder().encode(NODE_CONTENT_TYPE);
  const refHashes = refs.map(hexToHash);
  const header = encodeHeader(contentBytes.length, NODE_CONTENT_TYPE, refHashes.length);
  const hash = hashToHex(await computeNodeDigest(header, NODE_CONTENT_TYPE, refHashes, contentBytes));
  return {
    hash,
    contentBytes,
    body: concatenateNodeBytes(header, contentTypeBytes, refHashes, contentBytes),
  };
}

async function main() {
  const privateKey = await importPKCS8(
    await readFile(join(KEY_DIR, KEY_FILE), "utf8"),
    CapabilityAlgorithm,
  );
  const sign = (claims, subject = "deploy-smoke") => {
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: CapabilityAlgorithm, kid: KID, typ: CapabilityTokenType })
      .setIssuer(ISSUER)
      .setSubject(subject)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .setJti(crypto.randomUUID())
      .sign(privateKey);
  };
  const issueSpace = (spaceId, refDomain) => sign({
    ver: SpaceCapabilityVersion,
    grants: [{
      selector: spaceId,
      permissions: [
        spaceNodeReadPermission(),
        spaceNodeLeasePermission(),
        spaceRootRefsReadPermission(),
        spaceRootRefsUpdatePermission(),
        spaceUsageReadPermission(),
        spaceGcExecutePermission(),
      ],
    }],
    ...(refDomain === undefined ? {} : { refDomain }),
  });
  const client = createAppCasClient({
    baseUrl: BASE,
    appId: APP_ID,
    capabilityProvider: {
      async acquire(requirement) {
        const issuedAt = Math.floor(Date.now() / 1000);
        return {
          bearerToken: await sign({
            ver: SpaceCapabilityVersion,
            grants: [{
              selector: requirement.spaceId,
              permissions: [requirement.permission],
            }],
            refDomain: "doc",
          }),
          metadata: {
            version: SpaceCapabilityVersion,
            expiresAt: issuedAt + 300,
            grants: [{
              selector: requirement.spaceId,
              permissions: [requirement.permission],
            }],
            refDomain: "doc",
          },
        };
      },
    },
  });

  console.log(`smoke base: ${BASE}`);
  console.log(`App: ${APP_ID}; Space: ${SPACE_ID}`);
  if (BASE.startsWith("https://")) {
    const health = await fetch(`${BASE}/health`);
    assert(health.status === 200, `edge /health -> ${health.status}`);
    const internal = await fetch(`${BASE}/_internal/health`);
    assert(internal.status === 404, "edge never forwards /_internal/health");
  }

  const child = await nodeOf(`space-smoke-child:${RUN}`);
  const childLease = await uploadNode(client, SPACE_ID, child);
  assert(childLease.state === "ready", "lease child");

  const parent = await nodeOf(`space-smoke-parent:${RUN}`, [child.hash]);
  const parentLease = await uploadNode(client, SPACE_ID, parent);
  assert(parentLease.state === "ready", "lease parent");

  const content = new Uint8Array(
    await new Response(await client.readContent(SPACE_ID, parent.hash)).arrayBuffer(),
  );
  assert(content.join(",") === parent.contentBytes.join(","), "read content matches");
  const metadata = await client.readMetadata(SPACE_ID, parent.hash);
  assert(metadata.hash === parent.hash && metadata.refs[0] === child.hash, "metadata preserves child reference");

  let smokeFailure;
  try {
    const firstRootUpdate = await client.updateRootRefs(SPACE_ID, {
      requestId: `${RUN}:roots:1`,
      changes: { [parent.hash]: 1 },
    });
    assert(firstRootUpdate.success === true && typeof firstRootUpdate.revision === "number", "Root Ref update succeeds");
    const retry = await client.updateRootRefs(SPACE_ID, {
      requestId: `${RUN}:roots:1`,
      changes: { [parent.hash]: 1 },
    });
    assert(retry.idempotent === true && retry.revision === firstRootUpdate.revision, "Root Ref retry is idempotent");
    const roots = await client.listRootRefs(SPACE_ID, { limit: 100 });
    assert(roots.items.some((item) => item.hash === parent.hash && item.refCount > 0), "Root Ref list contains parent");

    const replacement = await client.updateRootRefs(SPACE_ID, {
      requestId: `${RUN}:roots:replace`,
      changes: { [parent.hash]: -1, [child.hash]: 1 },
    });
    assert(
      replacement.success === true && replacement.revision > firstRootUpdate.revision,
      "mixed-sign Root Ref replacement succeeds atomically",
    );
    const replacedRoots = await client.listRootRefs(SPACE_ID, { limit: 100 });
    assert(
      replacedRoots.items.some((item) => item.hash === child.hash && item.refCount > 0)
        && !replacedRoots.items.some((item) => item.hash === parent.hash && item.refCount > 0),
      "mixed-sign Root Ref replacement updates the projection",
    );

    const usage = await client.usage(SPACE_ID);
    assert(usage.nodeCount >= 2, `Space usage nodeCount -> ${usage.nodeCount}`);
    const gc = await client.gc(SPACE_ID, { maxNodes: 100 });
    const retainedParent = await client.readMetadata(SPACE_ID, parent.hash);
    const retainedChild = await client.readMetadata(SPACE_ID, child.hash);
    assert(
      retainedParent.hash === parent.hash && retainedChild.hash === child.hash,
      `GC keeps current leased nodes (deleted ${gc.deleted} stale nodes)`,
    );

    const usageUrl = `${BASE}${appSpaceRoutes.usage({ appId: APP_ID, spaceId: SPACE_ID })}`;
    const prototypeUrl = new URL([
      "v2",
      "cas",
      "usage",
    ].join("/"), `${BASE}/`);
    prototypeUrl.searchParams.set("appId", APP_ID);
    prototypeUrl.searchParams.set("spaceId", SPACE_ID);
    let response = await fetch(
      prototypeUrl,
      { redirect: "manual" },
    );
    assert(response.status === 404, `prototype App/Space v2 route -> ${response.status} (404)`);
    for (const version of [1, 3]) {
      const prototypeToken = await sign({
        ver: version,
        grants: [{
          selector: SPACE_ID,
          permissions: [spaceUsageReadPermission()],
        }],
      });
      response = await fetch(usageUrl, {
        headers: { Authorization: `Bearer ${prototypeToken}` },
      });
      await assertInvalidToken(response, `prototype Space claim v${version}`);
    }
    const broadPermissionToken = await sign({
      ver: SpaceCapabilityVersion,
      grants: [{
        selector: SPACE_ID,
        permissions: [`spaces:${SPACE_ID}:cas:read`],
      }],
    });
    response = await fetch(usageUrl, {
      headers: { Authorization: `Bearer ${broadPermissionToken}` },
    });
    await assertInvalidToken(response, "broad prototype Space permission");

    const isolationToken = await issueSpace(ISOLATION_SPACE_ID);
    response = await fetch(`${BASE}${appSpaceRoutes.readContent({
      appId: APP_ID,
      spaceId: SPACE_ID,
      hash: parent.hash,
    })}`, {
      headers: { Authorization: `Bearer ${isolationToken}` },
    });
    assert(response.status === 403, `cross-Space read -> ${response.status} (403)`);
    assert(
      (await client.usage(ISOLATION_SPACE_ID)).nodeCount === 0,
      "isolation Space remains empty",
    );

    const retiredToken = await sign({
      ver: SpaceCapabilityVersion,
      tenantId: SPACE_ID,
      permissions: [`tenants:${SPACE_ID}:cas:manage`],
    });
    response = await fetch(usageUrl, {
      headers: { Authorization: `Bearer ${retiredToken}` },
    });
    assert(response.status === 401, `retired Tenant claim on App/Space v1 route -> ${response.status} (401)`);
    response = await fetch(`${BASE}/stacks/${encodeURIComponent(APP_ID)}/tenants/${encodeURIComponent(SPACE_ID)}/cas/usage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(response.status === 404, `App/Space token on retired route -> ${response.status} (404)`);
  } catch (error) {
    smokeFailure = error;
    throw error;
  } finally {
    try {
      const roots = await client.listRootRefs(SPACE_ID, { limit: 100 });
      const changes = Object.fromEntries(roots.items
        .filter((item) => (item.hash === parent.hash || item.hash === child.hash) && item.refCount > 0)
        .map((item) => [item.hash, -item.refCount]));
      if (Object.keys(changes).length > 0) {
        const cleanup = await client.updateRootRefs(SPACE_ID, {
          requestId: `${RUN}:roots:cleanup`,
          changes,
        });
        assert(cleanup.success === true, "Root Ref cleanup releases smoke roots");
      }
    } catch (cleanupError) {
      if (smokeFailure) console.error("Root Ref cleanup also failed", cleanupError);
      else throw cleanupError;
    }
  }
  console.log("\nAPP/SPACE SMOKE PASS");
}

async function uploadNode(client, spaceId, node) {
  let result = await client.leaseNode(spaceId, node.hash);
  if (result.state === "ready") return result;
  if (result.state === "validated_awaiting_children") {
    throw new Error(`Node upload is waiting for children: ${result.childHashes.join(", ")}`);
  }
  const uploaded = await fetch(result.upload.url, {
    method: result.upload.method,
    headers: result.upload.headers,
    body: node.body,
  });
  if (!uploaded.ok && uploaded.status !== 412) {
    throw new Error(`Direct node upload failed: ${uploaded.status} ${uploaded.statusText}`);
  }
  result = await client.leaseNode(spaceId, node.hash);
  if (result.state === "awaiting_replacement_upload") {
    throw new Error(`${result.rejection.code}: ${result.rejection.message}`);
  }
  return result;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});