/**
 * Smoke-test the deployed App/Space v1 contract through a machine API origin.
 *
 * Usage: node scripts/cas-app-space-smoke.mjs [baseUrl]
 * Required: UNICAS_SMOKE_APP_ID/ISSUER/AUDIENCE/KID/KEY_FILE.
 * Optional: UNICAS_SMOKE_SPACE_ID (defaults to deploy-smoke).
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
} from "../packages/codec/dist/index.js";
import { createSpaceCasClient } from "../packages/space-client/dist/index.js";
import {
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
  spaceGcExecutePermission,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  spaceUsageReadPermission,
} from "../packages/space-protocol/dist/index.js";
import {
  CapabilityVersion,
  casManagePermission,
} from "../packages/space-protocol/dist/v1.js";

const BASE = normalizeSmokeBaseUrl(
  process.argv[2] ?? "https://api.unicas.work",
  process.env.UNICAS_SMOKE_ALLOW_OTHER_ORIGIN === "true",
);
const APP_ID = requiredEnv("UNICAS_SMOKE_APP_ID");
const ISSUER = requiredEnv("UNICAS_SMOKE_ISSUER");
const AUDIENCE = requiredEnv("UNICAS_SMOKE_AUDIENCE");
const KID = requiredEnv("UNICAS_SMOKE_KID");
const KEY_FILE = requiredEnv("UNICAS_SMOKE_KEY_FILE");
const SPACE_ID = process.env.UNICAS_SMOKE_SPACE_ID ?? "deploy-smoke";
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
    spaceId,
    permissions: [
      spaceNodeReadPermission(),
      spaceNodeLeasePermission(),
      spaceRootRefsReadPermission(),
      spaceRootRefsUpdatePermission(),
      spaceUsageReadPermission(),
      spaceGcExecutePermission(),
    ],
    ...(refDomain === undefined ? {} : { refDomain }),
  });
  const token = await issueSpace(SPACE_ID, "doc");
  const client = createSpaceCasClient({
    baseUrl: BASE,
    appId: APP_ID,
    spaceId: SPACE_ID,
    getToken: async () => token,
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
  const childLease = await uploadNode(client, child);
  assert(childLease.state === "ready", "lease child");

  const parent = await nodeOf(`space-smoke-parent:${RUN}`, [child.hash]);
  const parentLease = await uploadNode(client, parent);
  assert(parentLease.state === "ready", "lease parent");

  const content = new Uint8Array(await new Response(await client.readContent(parent.hash)).arrayBuffer());
  assert(content.join(",") === parent.contentBytes.join(","), "read content matches");
  const metadata = await client.readMetadata(parent.hash);
  assert(metadata.hash === parent.hash && metadata.refs[0] === child.hash, "metadata preserves child reference");

  let rootRetained = false;
  let smokeFailure;
  try {
    const firstRootUpdate = await client.updateRootRefs({
      requestId: `${RUN}:roots:1`,
      changes: { [parent.hash]: 1 },
    });
    rootRetained = firstRootUpdate.success === true;
    assert(rootRetained && typeof firstRootUpdate.revision === "number", "Root Ref update succeeds");
    const retry = await client.updateRootRefs({
      requestId: `${RUN}:roots:1`,
      changes: { [parent.hash]: 1 },
    });
    assert(retry.idempotent === true && retry.revision === firstRootUpdate.revision, "Root Ref retry is idempotent");
    const roots = await client.listRootRefs({ limit: 100 });
    assert(roots.items.some((item) => item.hash === parent.hash && item.refCount > 0), "Root Ref list contains parent");

    const usage = await client.usage();
    assert(usage.nodeCount >= 2, `Space usage nodeCount -> ${usage.nodeCount}`);
    const gc = await client.gc({ maxNodes: 100 });
    const retainedParent = await client.readMetadata(parent.hash);
    const retainedChild = await client.readMetadata(child.hash);
    assert(
      retainedParent.hash === parent.hash && retainedChild.hash === child.hash,
      `GC keeps current leased nodes (deleted ${gc.deleted} stale nodes)`,
    );

    const prefix = `/v1/apps/${encodeURIComponent(APP_ID)}/spaces/${encodeURIComponent(SPACE_ID)}`;
    const isolationToken = await issueSpace(ISOLATION_SPACE_ID);
    let response = await fetch(`${BASE}${prefix}/cas/nodes/${parent.hash}/content`, {
      headers: { Authorization: `Bearer ${isolationToken}` },
    });
    assert(response.status === 403, `cross-Space read -> ${response.status} (403)`);
    const isolationClient = createSpaceCasClient({
      baseUrl: BASE,
      appId: APP_ID,
      spaceId: ISOLATION_SPACE_ID,
      getToken: async () => isolationToken,
    });
    assert((await isolationClient.usage()).nodeCount === 0, "isolation Space remains empty");

    const v1Token = await sign({
      ver: CapabilityVersion,
      tenantId: SPACE_ID,
      permissions: [casManagePermission(SPACE_ID)],
    });
    response = await fetch(`${BASE}${prefix}/cas/usage`, {
      headers: { Authorization: `Bearer ${v1Token}` },
    });
    assert(response.status === 401, `frozen token on App/Space v1 route -> ${response.status} (401)`);
    response = await fetch(`${BASE}/stacks/${encodeURIComponent(APP_ID)}/tenants/${encodeURIComponent(SPACE_ID)}/cas/usage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(response.status === 401, `Space v1 token on frozen route -> ${response.status} (401)`);
  } catch (error) {
    smokeFailure = error;
    throw error;
  } finally {
    if (rootRetained) {
      try {
        const cleanup = await client.updateRootRefs({
          requestId: `${RUN}:roots:cleanup`,
          changes: { [parent.hash]: -1 },
        });
        assert(cleanup.success === true, "Root Ref cleanup releases parent");
      } catch (cleanupError) {
        if (smokeFailure) console.error("Root Ref cleanup also failed", cleanupError);
        else throw cleanupError;
      }
    }
  }
  console.log("\nAPP/SPACE SMOKE PASS");
}

async function uploadNode(client, node) {
  let result = await client.leaseNode(node.hash);
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
  result = await client.leaseNode(node.hash);
  if (result.state === "awaiting_replacement_upload") {
    throw new Error(`${result.rejection.code}: ${result.rejection.message}`);
  }
  return result;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});