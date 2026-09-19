import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const BASE = "https://api.unicas.work";
const RESOURCE = `${BASE}/mcp`;
const CALLBACK_PORT = 43128;
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

async function json(response, operation) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
  return body;
}

async function registerClient() {
  const response = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "UniCAS production OAuth smoke",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const client = await json(response, "dynamic client registration");
  assert(typeof client.client_id === "string" && client.client_id.length > 0, "dynamic client registration");
  return client.client_id;
}

function waitForAuthorizationCode(expectedState) {
  let server;
  const code = new Promise((resolve, reject) => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      const error = url.searchParams.get("error");
      const value = url.searchParams.get("code");
      if (error || !value || url.searchParams.get("state") !== expectedState) {
        response.writeHead(400, { "Content-Type": "text/plain" }).end("Authorization failed");
        reject(new Error(error ?? "authorization callback validation failed"));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" }).end("Authorization complete. Return to the terminal.");
      resolve(value);
    });
    server.once("error", reject);
    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
  return {
    code,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function authorize(clientId) {
  const state = base64Url(randomBytes(24));
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const callback = waitForAuthorizationCode(state);
  const url = new URL(`${BASE}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "control:read");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", RESOURCE);
  console.log("Open this URL in your browser:");
  console.log(url.toString());
  try {
    const code = await callback.code;
    const response = await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        resource: RESOURCE,
      }),
    });
    return json(response, "authorization code exchange");
  } finally {
    await callback.close();
  }
}

function parseMcpBody(text) {
  if (text.trim().startsWith("{")) return JSON.parse(text);
  const data = text.split(/\r?\n/)
    .find((line) => line.startsWith("data:"))
    ?.slice("data:".length).trim();
  if (!data) throw new Error("MCP response did not contain JSON data");
  return JSON.parse(data);
}

async function mcpRequest(accessToken, body, sessionId) {
  const response = await fetch(RESOURCE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP request failed with HTTP ${response.status}`);
  return { body: text ? parseMcpBody(text) : null, sessionId: response.headers.get("Mcp-Session-Id") ?? sessionId };
}

async function callReadTools(accessToken) {
  const initialized = await mcpRequest(accessToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "unicas-production-smoke", version: "1.0.0" },
    },
  });
  assert(!initialized.body?.error, "MCP initialize");
  const account = await mcpRequest(accessToken, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "get_current_account", arguments: {} },
  }, initialized.sessionId);
  assert(!account.body?.error, "MCP get_current_account");
  const apps = await mcpRequest(accessToken, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_apps", arguments: { limit: 1 } },
  }, account.sessionId);
  assert(!apps.body?.error, "MCP paginated App read");
}

async function refresh(clientId, refreshToken) {
  const response = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      resource: RESOURCE,
    }),
  });
  return json(response, "refresh token exchange");
}

async function revoke(clientId, token) {
  const response = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, client_id: clientId }),
  });
  assert(response.ok, "RFC 7009 revocation");
}

async function main() {
  const metadata = await json(await fetch(`${BASE}/.well-known/oauth-authorization-server`), "authorization metadata");
  assert(metadata.issuer === BASE, "authorization metadata uses API origin");
  assert(metadata.revocation_endpoint === `${BASE}/oauth/token`, "revocation endpoint uses token route");

  const clientId = await registerClient();
  const tokens = await authorize(clientId);
  assert(typeof tokens.access_token === "string", "authorization code exchange");
  assert(typeof tokens.refresh_token === "string", "refresh token issued");
  await callReadTools(tokens.access_token);

  const refreshed = await refresh(clientId, tokens.refresh_token);
  assert(typeof refreshed.access_token === "string", "refresh token exchange");
  assert(typeof refreshed.refresh_token === "string", "refresh token rotation");
  await revoke(clientId, refreshed.refresh_token);

  const rejected = await fetch(RESOURCE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${refreshed.access_token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
  });
  assert(rejected.status === 401, "revoked grant rejects its access token");

  const reauthorized = await authorize(clientId);
  assert(typeof reauthorized.access_token === "string", "reauthorization code exchange");
  assert(typeof reauthorized.refresh_token === "string", "reauthorization refresh token issued");
  await callReadTools(reauthorized.access_token);
  await revoke(clientId, reauthorized.refresh_token);
  console.log("MCP OAUTH SMOKE PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});