import { pathToFileURL } from "node:url";
import { signIssuerChallenge } from "../../../packages/spaces/scripts/sign-issuer-challenge.mjs";
import { parseOAuthIssuerInspectionChallenge } from "../../../packages/service/src/oauth-discovery.ts";

export function appSpaceV1Audience(publicOrigin, appId) {
  return `${new URL(publicOrigin).origin}/v1/apps/${encodeURIComponent(appId)}`;
}

export async function cutOverAppSpaceV1Issuers({
  adminOrigin,
  publicOrigin,
  session,
  issuers,
  fetchImpl = fetch,
}) {
  const currentSession = { cookie: session.cookie, csrfToken: session.csrfToken };
  const request = async (path, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("Cookie", currentSession.cookie);
    if (method !== "GET" && method !== "HEAD") {
      headers.set("Origin", new URL(adminOrigin).origin);
      headers.set("X-CSRF-Token", currentSession.csrfToken);
    }
    const response = await fetchImpl(`${adminOrigin.replace(/\/$/, "")}${path}`, { ...init, headers });
    const replacement = response.headers.getSetCookie()
      .map((value) => value.split(";", 1)[0].trim())
      .find((value) => value.startsWith(`${currentSession.cookie.split("=", 1)[0]}=`));
    const csrfToken = response.headers.get("X-CSRF-Token");
    if (replacement && csrfToken) {
      currentSession.cookie = replacement;
      currentSession.csrfToken = csrfToken;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = typeof body.error === "string" ? ` ${body.error}` : "";
      throw new Error(`issuer cutover request failed with HTTP ${response.status}${code}`);
    }
    return response;
  };

  const results = [];
  for (const issuer of issuers) {
    const path = `/admin/apps/${encodeURIComponent(issuer.appId)}/oauth-issuer`;
    const currentResponse = await request(path);
    const current = await currentResponse.json();
    const targetAudience = appSpaceV1Audience(publicOrigin, issuer.appId);
    if (current.audience === targetAudience) {
      results.push({ appId: issuer.appId, audience: targetAudience, status: "current" });
      continue;
    }
    if (current.issuer !== issuer.issuer || current.status !== "active") {
      throw new Error(`issuer cutover precondition failed for ${issuer.appId}`);
    }
    const etag = currentResponse.headers.get("ETag");
    if (!etag) throw new Error(`issuer cutover received no ETag for ${issuer.appId}`);

    const inspectionResponse = await request(`${path}/inspections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuer: issuer.issuer }),
    });
    const inspection = await inspectionResponse.json();
    const parsedChallenge = typeof inspection.challenge === "string"
      ? parseOAuthIssuerInspectionChallenge(inspection.challenge)
      : null;
    if (
      typeof inspection.inspectionId !== "string"
      || parsedChallenge?.inspectionId !== inspection.inspectionId
      || parsedChallenge.appId !== issuer.appId
      || parsedChallenge.issuer !== issuer.issuer
      || parsedChallenge.audience !== targetAudience
    ) {
      throw new Error(`issuer inspection returned an unexpected contract for ${issuer.appId}`);
    }
    const activationProof = await signIssuerChallenge({
      challenge: inspection.challenge,
      keyId: issuer.keyId,
      privateKeyPem: issuer.privateKeyPem,
    });
    await request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": etag },
      body: JSON.stringify({ inspectionId: inspection.inspectionId, activationProof }),
    });

    const verified = await (await request(path)).json();
    if (verified.audience !== targetAudience || verified.status !== "active") {
      throw new Error(`issuer cutover verification failed for ${issuer.appId}`);
    }
    results.push({ appId: issuer.appId, audience: targetAudience, status: "updated" });
  }
  return results;
}

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required for the App/Space v1 issuer cutover`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const environment = process.env;
    const results = await cutOverAppSpaceV1Issuers({
      adminOrigin: environment.ADMIN_PUBLIC_ORIGIN ?? "https://console.unicas.work",
      publicOrigin: environment.CAS_PUBLIC_ORIGIN ?? "https://api.unicas.work",
      session: JSON.parse(required(environment, "UNICAS_RELEASE_ADMIN_SESSION")),
      issuers: [
        {
          appId: required(environment, "UNICAS_SMOKE_APP_ID"),
          issuer: required(environment, "UNICAS_SMOKE_ISSUER"),
          keyId: required(environment, "UNICAS_SMOKE_KID"),
          privateKeyPem: required(environment, "UNICAS_SMOKE_PRIVATE_KEY_PKCS8"),
        },
        {
          appId: required(environment, "SPACES_BOOTSTRAP_APP_ID"),
          issuer: environment.SPACES_ISSUER ?? "https://spaces.unicas.work",
          keyId: required(environment, "SPACES_SIGNING_KID"),
          privateKeyPem: required(environment, "SPACES_SIGNING_PRIVATE_KEY_PKCS8"),
        },
      ],
    });
    for (const result of results) {
      console.log(`${result.appId}: ${result.status} at ${result.audience}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}