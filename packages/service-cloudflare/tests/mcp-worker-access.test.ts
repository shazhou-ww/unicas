import { describe, expect, test, vi } from "vitest";
import {
  AccountServiceError,
  type AccountResolution,
  PlatformAccessService,
  type PlatformAccessRepository,
} from "@unicas/service";
import type { PlatformAccessState } from "@unicas/admin-protocol";
import { checkMcpAccountAccess, checkMcpPlatformAccess } from "../src/mcp/platform-access.js";

const principal = { issuer: "https://accounts.example", subject: "alice-sub" };
const props = { identityIssuer: principal.issuer, subject: principal.subject };

function repositoryFixture() {
  let state: PlatformAccessState | null = {
    principal,
    principalRef: "principal-1",
    status: "active",
    authorities: ["apps.create"],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  let unavailable = false;
  const repository: PlatformAccessRepository = {
    readSnapshot: async () => 0,
    getAccess: async () => {
      if (unavailable) throw new Error("offline");
      return state;
    },
    hasMembership: async () => false,
    getAppInvitationByTokenHash: async () => null,
    getPrincipal: async () => null,
    listPrincipals: async () => [],
    getAccessSummary: async () => ({
      activePrincipalCount: 0,
      platformAdminCount: 0,
      appCreatorCount: 0,
      blockedPrincipalCount: 0,
    }),
    patchAccess: async () => "updated",
    appendAudit: async () => undefined,
  };
  return {
    service: new PlatformAccessService(repository),
    revoke: () => { state = { ...state!, authorities: [], revision: 2 }; },
    failReads: () => { unavailable = true; },
  };
}

describe("MCP platform access", () => {
  test("checks Account credential generation, exact identity, and current authority on every request", async () => {
    const credential = {
      ...props,
      accountId: `acct_${"a".repeat(22)}`,
      externalIdentityId: "external-1",
      credentialVersion: 1,
    };
    const resolution = {
      authenticatedIdentity: { issuer: principal.issuer, subject: principal.subject },
      platformAuthorities: ["apps.create"],
      hasAppMembership: false,
    } as AccountResolution;
    const accounts = { authorizeCredential: vi.fn(async () => resolution) };
    expect(await checkMcpAccountAccess(accounts, credential)).toBeNull();
    expect(accounts.authorizeCredential).toHaveBeenCalledWith({
      accountId: credential.accountId, externalIdentityId: "external-1", credentialVersion: 1,
    });
    expect((await checkMcpAccountAccess(accounts, credential, "platform.admin"))?.status).toBe(403);
    expect((await checkMcpAccountAccess(accounts, { ...credential, subject: "other" }))?.status).toBe(403);
    expect((await checkMcpAccountAccess(accounts, props))?.status).toBe(403);
    accounts.authorizeCredential.mockResolvedValue({ ...resolution, platformAuthorities: [] });
    expect((await checkMcpAccountAccess(accounts, credential))?.status).toBe(403);
    accounts.authorizeCredential.mockRejectedValue(new AccountServiceError("CREDENTIAL_VERSION_MISMATCH"));
    expect((await checkMcpAccountAccess(accounts, credential))?.status).toBe(403);
    accounts.authorizeCredential.mockRejectedValue(new Error("offline"));
    expect((await checkMcpAccountAccess(accounts, credential))?.status).toBe(503);
  });

  test("rejects an existing OAuth grant on the first request after admission is revoked", async () => {
    const fixture = repositoryFixture();
    await expect(checkMcpPlatformAccess(fixture.service, props)).resolves.toBeNull();

    fixture.revoke();

    const response = await checkMcpPlatformAccess(fixture.service, props);
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "MCP_ACCESS_NOT_ALLOWED" });
  });

  test("returns service unavailable when current admission cannot be read", async () => {
    const fixture = repositoryFixture();
    fixture.failReads();

    const response = await checkMcpPlatformAccess(fixture.service, props);
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ error: "SERVICE_UNAVAILABLE" });
  });
});