import { describe, expect, test, vi } from "vitest";
import {
  AccountServiceError,
  type AccountResolution,
} from "@unicas/service";
import { checkMcpAccountAccess } from "../src/mcp/platform-access.js";

const principal = { issuer: "https://accounts.example", subject: "alice-sub" };
const props = { identityIssuer: principal.issuer, subject: principal.subject };

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

});