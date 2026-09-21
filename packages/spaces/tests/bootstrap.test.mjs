import { exportPKCS8, exportSPKI, generateKeyPair, importSPKI, compactVerify } from "jose";
import { describe, expect, test } from "vitest";
import {
  bootstrapInsertSql,
  bootstrapSpacesPrincipal,
  bootstrapStateQuery,
  classifyBootstrapState,
  parseD1Rows,
  readBootstrapConfig,
} from "../scripts/bootstrap.mjs";
import { signIssuerChallenge } from "../scripts/sign-issuer-challenge.mjs";
import {
  smokePreflightQuery,
  validateSmokePreflightRow,
} from "../scripts/preflight.mjs";

function environment(overrides = {}) {
  return {
    SPACES_BOOTSTRAP_APP_ID: "app-a",
    SPACES_BOOTSTRAP_SPACE_ID: "space-a",
    SPACES_BOOTSTRAP_PRINCIPAL_ID: "principal-a",
    SPACES_BOOTSTRAP_DISPLAY_NAME: "Ada",
    SPACES_BOOTSTRAP_GOOGLE_SUBJECT: "google-subject",
    SPACES_BOOTSTRAP_KEY_FILE: "test-key.pem",
    SPACES_SIGNING_KID: "spaces-key",
    SPACES_UNICAS_AUDIENCE: "https://api.example.test",
    ...overrides,
  };
}

describe("Spaces bootstrap", () => {
  test("models Google and smoke Principals without fabricating a smoke identity", () => {
    const google = readBootstrapConfig("google", environment());
    expect(google).toMatchObject({
      mode: "google",
      googleSubject: "google-subject",
      refDomain: "spaces:files",
    });
    const smoke = readBootstrapConfig("smoke", environment({
      SPACES_BOOTSTRAP_PRINCIPAL_ID: "smoke-principal",
      SPACES_BOOTSTRAP_SPACE_ID: "smoke-space",
      SPACES_BOOTSTRAP_GOOGLE_SUBJECT: "",
    }));
    expect(smoke).toMatchObject({
      mode: "smoke",
      googleSubject: null,
      privateKeyFile: null,
      refDomain: "spaces:smoke",
    });
    expect(bootstrapStateQuery(smoke)).toContain("NULL AS identity_owner");
  });

  test("accepts only an exact complete rerun state", async () => {
    const config = readBootstrapConfig("google", environment());
    const existing = {
      principal_status: "active",
      display_name: "Ada",
      app_id: "app-a",
      space_id: "space-a",
      ref_domain: "spaces:files",
      root_id: "root-a",
      identity_count: 1,
      identity_owner: "principal-a",
      space_owner: "principal-a",
    };
    expect(classifyBootstrapState(config, existing)).toBe("existing");
    expect(classifyBootstrapState(config, Object.fromEntries(Object.keys(existing).map((key) => [key, null]))))
      .toBe("create");
    expect(classifyBootstrapState(config, {
      principal_status: null,
      display_name: null,
      app_id: null,
      space_id: null,
      ref_domain: null,
      root_id: null,
      identity_count: 0,
      identity_owner: null,
      space_owner: null,
    })).toBe("create");
    expect(() => classifyBootstrapState(config, { ...existing, space_id: "other" }))
      .toThrow("conflicting or partial state");
    await expect(bootstrapSpacesPrincipal(config, async () => [existing]))
      .resolves.toEqual({ status: "existing" });

    const smoke = readBootstrapConfig("smoke", environment({
      SPACES_BOOTSTRAP_PRINCIPAL_ID: "smoke-principal",
      SPACES_BOOTSTRAP_SPACE_ID: "smoke-space",
      SPACES_BOOTSTRAP_GOOGLE_SUBJECT: "",
      SPACES_BOOTSTRAP_KEY_FILE: "",
    }));
    expect(classifyBootstrapState(smoke, {
      ...existing,
      space_id: "smoke-space",
      ref_domain: "spaces:smoke",
      root_id: null,
      identity_count: 0,
      identity_owner: null,
      space_owner: "smoke-principal",
    })).toBe("existing");
    expect(() => classifyBootstrapState(smoke, {
      ...existing,
      space_id: "smoke-space",
      ref_domain: "spaces:smoke",
      root_id: null,
      identity_count: 1,
      identity_owner: null,
      space_owner: "smoke-principal",
    })).toThrow("conflicting or partial state");
  });

  test("escapes bootstrap values and never writes capability or key material", () => {
    const config = readBootstrapConfig("google", environment({
      SPACES_BOOTSTRAP_DISPLAY_NAME: "Ada's files",
    }));
    const sql = bootstrapInsertSql(config, {
      rootId: "root-a",
      name: "Files",
      manifestHash: "manifest-a",
      revision: 1,
      createdAt: 10,
      updatedAt: 10,
    }, 10);
    expect(sql).toContain("'Ada''s files'");
    expect(sql).toContain("spaces_external_identities");
    expect(sql).not.toMatch(/Bearer|PRIVATE KEY|capability/i);
  });

  test("signs the exact issuer inspection challenge as an ES256 compact JWS", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const challenge = "cas-oauth-issuer-inspection-v1\nexact challenge bytes";
    const proof = await signIssuerChallenge({
      challenge,
      keyId: "spaces-key",
      privateKeyPem: await exportPKCS8(pair.privateKey),
    });
    const publicKey = await importSPKI(await exportSPKI(pair.publicKey), "ES256");
    const verified = await compactVerify(proof, publicKey, { algorithms: ["ES256"] });
    expect(new TextDecoder().decode(verified.payload)).toBe(challenge);
    expect(verified.protectedHeader).toMatchObject({ alg: "ES256", kid: "spaces-key" });
  });

  test("preflights an identity-free smoke mapping with no retained Root or open run", () => {
    const query = smokePreflightQuery("smoke'principal");
    expect(query).toContain("smoke''principal");
    expect(query).not.toMatch(/credential|private|token/i);
    expect(validateSmokePreflightRow({
      principal_id: "smoke-principal",
      principal_status: "active",
      app_id: "app-a",
      space_id: "smoke-space",
      ref_domain: "spaces:smoke",
      identity_count: 0,
      root_count: 0,
      blocking_run_count: 0,
      recoverable_run_count: 0,
    })).toEqual({
      principalId: "smoke-principal",
      appId: "app-a",
      spaceId: "smoke-space",
      refDomain: "spaces:smoke",
    });
    expect(() => validateSmokePreflightRow({
      principal_status: "active",
      app_id: "app-a",
      space_id: "smoke-space",
      ref_domain: "spaces:smoke",
      identity_count: 1,
      root_count: 0,
      blocking_run_count: 0,
      recoverable_run_count: 0,
    })).toThrow("smoke_principal_has_external_identity");
    expect(validateSmokePreflightRow({
      principal_id: "smoke-principal",
      principal_status: "active",
      app_id: "app-a",
      space_id: "smoke-space",
      ref_domain: "spaces:smoke",
      identity_count: 0,
      root_count: 1,
      blocking_run_count: 0,
      recoverable_run_count: 1,
    })).toMatchObject({ principalId: "smoke-principal" });
  });

  test("parses Wrangler file-execution JSON after progress output", () => {
    expect(parseD1Rows(`├ Checking if file needs uploading
│
├ Uploading complete.
│
[
  {"results":[{"ok":1}],"success":true}
]`)).toEqual([{ ok: 1 }]);
    expect(() => parseD1Rows("no JSON response")).toThrow("Unexpected D1 response");
  });
});