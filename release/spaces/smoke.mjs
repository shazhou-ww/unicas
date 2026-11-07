import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DefaultSpacesSmokeBaseUrl = "https://spaces.unicas.work";
export const SpacesSmokePayloadBytes = 2 * 1024 * 1024 + 257;

export class SpacesSmokeError extends Error {
  constructor(stage, code, status = null) {
    super(`${stage}: ${code}${status === null ? "" : ` (${status})`}`);
    this.stage = stage;
    this.code = code;
    this.status = status;
  }
}

export function normalizeSpacesSmokeBaseUrl(value, allowOtherOrigin = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SpacesSmokeError("authenticate", "invalid_base_url");
  }
  const local = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new SpacesSmokeError("authenticate", "invalid_base_url");
  }
  if (!allowOtherOrigin && !local && url.origin !== DefaultSpacesSmokeBaseUrl) {
    throw new SpacesSmokeError("authenticate", "origin_not_allowed");
  }
  return url.origin;
}

export async function runSpacesSmoke(options) {
  const baseUrl = normalizeSpacesSmokeBaseUrl(
    options.baseUrl ?? DefaultSpacesSmokeBaseUrl,
    options.allowOtherOrigin ?? false,
  );
  if (!options.credential) throw new SpacesSmokeError("authenticate", "credential_required");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const cookies = new Map();
  let runId = null;
  let stage = "authenticate";
  let primaryFailure = null;
  const completedStages = [];

  const request = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    const csrfToken = cookies.get("__Host-spaces-csrf");
    if (csrfToken && init.mutating) {
      headers.set("Origin", baseUrl);
      headers.set("X-CSRF-Token", csrfToken);
    }
    if (runId && init.smoke !== false) headers.set("X-Spaces-Smoke-Run", runId);
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers,
      redirect: "manual",
    });
    storeCookies(response.headers, cookies);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code = typeof body?.error?.code === "string" ? body.error.code : "request_failed";
      throw new SpacesSmokeError(stage, code, response.status);
    }
    return response;
  };

  try {
    const authenticated = await request("/api/smoke/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${options.credential}` },
      smoke: false,
    });
    const authenticatedBody = await authenticated.json();
    runId = requireString(authenticatedBody.runId, stage, "invalid_smoke_session");
    requireCookie(cookies, "__Host-spaces-session", stage);
    requireCookie(cookies, "__Host-spaces-csrf", stage);
    completedStages.push("authenticate");

    const root = await readDirectory(request, "/");
    const folderName = `release-smoke-${runId.slice(-12)}`;
    const folderPath = `/${folderName}`;
    await jsonRequest(request, "/api/folders", {
      parentPath: "/",
      name: folderName,
      revision: root.revision,
    });
    const emptyFolder = await readDirectory(request, folderPath);
    assert(emptyFolder.entries.length === 0, "verify", "folder_not_empty");

    stage = "hash";
    const bytes = deterministicBytes(runId, options.payloadBytes ?? SpacesSmokePayloadBytes);
    const expectedDigest = createHash("sha256").update(bytes).digest("hex");
    completedStages.push("hash");

    stage = "lease";
    const firstName = `payload-${runId.slice(-8)}.bin`;
    const firstUpload = await upload(request, folderPath, firstName, bytes, emptyFolder.revision);
    assert(firstUpload.rootRetained === true, "commit", "root_ref_not_positive");
    assertFirstUploadEvidence(firstUpload.uploadEvidence);
    completedStages.push("lease", "upload", "commit");

    stage = "verify";
    const originalPath = `${folderPath}/${firstName}`;
    const renamedName = `verified-${runId.slice(-8)}.bin`;
    const renamedPath = `${folderPath}/${renamedName}`;
    const renamed = await jsonRequest(request, "/api/files", {
      path: originalPath,
      name: renamedName,
      revision: firstUpload.revision,
    }, "PATCH");
    assert(renamed.rootRetained === true, stage, "rename_not_committed");
    await expectMissing(request, originalPath);
    await verifyDownload(request, renamedPath, bytes.length, expectedDigest);

    stage = "lease";
    const secondName = `reused-${runId.slice(-8)}.bin`;
    const secondUpload = await upload(request, folderPath, secondName, bytes, renamed.revision);
    assertReadyReuse(secondUpload.uploadEvidence);
    assert(secondUpload.rootRetained === true, "commit", "root_ref_not_positive");
    await verifyDownload(request, `${folderPath}/${secondName}`, bytes.length, expectedDigest);

    stage = "verify";
    const isolation = await request("/api/smoke/isolation", { method: "POST", mutating: true });
    const isolationBody = await isolation.json();
    assert(isolationBody.authority?.status === 403
      && isolationBody.authority?.code === "insufficient_permission", stage, "authority_isolation_failed");
    assert(isolationBody.space?.status === 403
      && isolationBody.space?.code === "resource_scope_mismatch", stage, "space_isolation_failed");
    completedStages.push("verify");
  } catch (error) {
    primaryFailure = toSmokeError(error, stage);
  } finally {
    if (runId && cookies.has("__Host-spaces-session")) {
      stage = "cleanup";
      try {
        let successfulCleanups = 0;
        let lastCleanupError = null;
        for (let attempt = 0; attempt < 3 && successfulCleanups < 2; attempt += 1) {
          try {
            const cleaned = await jsonRequest(request, "/api/smoke/cleanup", { runId });
            assert(cleaned.cleanupState === "complete", stage, "cleanup_incomplete");
            successfulCleanups += 1;
          } catch (error) {
            lastCleanupError = error;
          }
        }
        if (successfulCleanups < 2) throw lastCleanupError ?? new SpacesSmokeError(stage, "cleanup_incomplete");
        completedStages.push("cleanup");
      } catch (error) {
        if (!primaryFailure) primaryFailure = toSmokeError(error, stage);
      }
    }
  }

  if (primaryFailure) throw Object.assign(primaryFailure, { runId });
  return { runId, completedStages };
}

async function readDirectory(request, path) {
  const response = await request(`/api/entries?path=${encodeURIComponent(path)}`, { smoke: false });
  const body = await response.json();
  if (!Number.isSafeInteger(body.revision) || !Array.isArray(body.entries)) {
    throw new SpacesSmokeError("verify", "invalid_directory_response");
  }
  return body;
}

async function jsonRequest(request, path, body, method = "POST") {
  const response = await request(path, {
    method,
    mutating: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function upload(request, parentPath, name, bytes, revision) {
  const form = new FormData();
  form.set("parentPath", parentPath);
  form.set("revision", String(revision));
  form.set("name", name);
  form.set("file", new File([bytes], name, { type: "application/octet-stream" }));
  const response = await request("/api/files", { method: "POST", mutating: true, body: form });
  return response.json();
}

async function expectMissing(request, path) {
  const response = await request(`/api/files/content?path=${encodeURIComponent(path)}`, {
    smoke: false,
    allowFailure: true,
  }).catch((error) => {
    if (error instanceof SpacesSmokeError && error.status === 404 && error.code === "path_not_found") return null;
    throw error;
  });
  if (response !== null) throw new SpacesSmokeError("verify", "old_path_still_exists", response.status);
}

async function verifyDownload(request, path, expectedLength, expectedDigest) {
  const response = await request(`/api/files/content?path=${encodeURIComponent(path)}`, { smoke: false });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length === expectedLength, "verify", "download_length_mismatch");
  assert(createHash("sha256").update(bytes).digest("hex") === expectedDigest, "verify", "download_digest_mismatch");
}

function assertFirstUploadEvidence(evidence) {
  assert(evidence && Number.isSafeInteger(evidence.nodeCount) && evidence.nodeCount > 1, "lease", "file_was_not_multi_node");
  assert(evidence.uploadRequiredNodes > 0, "upload", "presigned_upload_not_exercised");
  assert(evidence.readyNodes === evidence.nodeCount, "lease", "uploaded_nodes_not_ready");
  assert(evidence.leaseRequests > evidence.nodeCount, "lease", "identical_lease_not_repeated");
}

function assertReadyReuse(evidence) {
  assert(evidence && evidence.nodeCount > 1, "lease", "reuse_was_not_multi_node");
  assert(evidence.uploadRequiredNodes === 0, "upload", "ready_nodes_were_reuploaded");
  assert(evidence.readyNodes === evidence.nodeCount, "lease", "ready_nodes_not_reused");
}

function deterministicBytes(runId, length) {
  const seed = createHash("sha256").update(runId).digest();
  const bytes = Buffer.allocUnsafe(length);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = seed[index % seed.length] ^ (index & 0xff);
  return bytes;
}

function storeCookies(headers, cookies) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : splitSetCookie(headers.get("set-cookie"));
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue) cookies.set(name, cookieValue);
    else cookies.delete(name);
  }
}

function splitSetCookie(value) {
  return value ? value.split(/,(?=\s*[^;,=]+=[^;,]*)/) : [];
}

function requireCookie(cookies, name, stage) {
  if (!cookies.has(name)) throw new SpacesSmokeError(stage, "session_cookie_missing");
}

function requireString(value, stage, code) {
  if (typeof value !== "string" || value.length === 0) throw new SpacesSmokeError(stage, code);
  return value;
}

function assert(condition, stage, code) {
  if (!condition) throw new SpacesSmokeError(stage, code);
}

function toSmokeError(error, stage) {
  return error instanceof SpacesSmokeError
    ? error
    : new SpacesSmokeError(stage, "unexpected_failure");
}

export function parseSmokeArgs(argv) {
  let baseUrl = DefaultSpacesSmokeBaseUrl;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--base-url" || !argv[index + 1]) {
      throw new SpacesSmokeError("authenticate", "invalid_arguments");
    }
    baseUrl = argv[index + 1];
    index += 1;
  }
  return { baseUrl };
}

async function main() {
  let result;
  try {
    const args = parseSmokeArgs(process.argv.slice(2));
    result = await runSpacesSmoke({
      ...args,
      credential: process.env.SPACES_SMOKE_CREDENTIAL,
      allowOtherOrigin: process.env.SPACES_SMOKE_ALLOW_OTHER_ORIGIN === "true",
    });
    console.log(JSON.stringify({ result: "pass", runId: result.runId, stages: result.completedStages }));
  } catch (error) {
    const failure = toSmokeError(error, "authenticate");
    console.error(JSON.stringify({
      result: "fail",
      runId: failure.runId ?? null,
      stage: failure.stage,
      code: failure.code,
      status: failure.status,
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();