import { describe, expect, test, vi } from "vitest";
import { PlatformAccessService, type PlatformAccessRepository } from "../src/platform-access.js";

const principal = { issuer: "https://identity.example.test", subject: "synthetic" };

function fixture() {
  const repository: PlatformAccessRepository = {
    getAccess: vi.fn(async () => null), hasMembership: vi.fn(async () => false),
    getAppInvitationByTokenHash: vi.fn(async () => null),
    getPrincipal: vi.fn(async () => null), listPrincipals: vi.fn(async () => []),
    getAccessSummary: vi.fn(async () => ({ activePrincipalCount: 0, platformAdminCount: 0, appCreatorCount: 0, blockedPrincipalCount: 0 })),
    patchAccess: vi.fn(async () => "updated"), appendAudit: vi.fn(async () => undefined),
  };
  return { repository, service: new PlatformAccessService(repository, () => 1000) };
}

describe("platform access service", () => {
  test("denies an authenticated unknown Principal without creating records", async () => {
    const { repository, service } = fixture();
    await expect(service.requireAccess(principal)).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED", status: 403 });
    expect(repository.patchAccess).not.toHaveBeenCalled();
    expect(repository.appendAudit).not.toHaveBeenCalled();
  });

  test("membership permits admission but never App creation, with non-secret denial audit", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.hasMembership).mockResolvedValue(true);
    await expect(service.requireAccess(principal)).resolves.toBeNull();
    await expect(service.requireAccess(principal, "apps.create")).rejects.toMatchObject({ code: "APP_CREATION_AUTHORITY_REQUIRED" });
    expect(repository.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ actorPrincipal: principal, action: "app.create_denied", result: "denied" }));
  });

  test("a failed authoritative read is denied rather than cached indefinitely", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.getAccess).mockRejectedValue(new Error("offline"));
    await expect(service.requireAccess(principal)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });
  });

  test("revocation and blocking take effect on the next operation", async () => {
    const { repository, service } = fixture();
    const state = { principal, principalRef: "synthetic-ref", status: "active" as const, authorities: ["apps.create" as const], revision: 1, createdAt: 1, updatedAt: 1 };
    vi.mocked(repository.getAccess).mockResolvedValue(state);
    await service.requireAccess(principal, "apps.create");
    vi.mocked(repository.getAccess).mockResolvedValue({ ...state, status: "blocked" });
    vi.mocked(repository.hasMembership).mockResolvedValue(true);
    await expect(service.requireAccess(principal)).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
    await expect(service.assertNotBlocked(principal)).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
  });

  test("admits only a pending email-bound invitation for an otherwise unadmitted Principal", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.getAppInvitationByTokenHash).mockResolvedValue({
      invitationId: "invitation-1",
      appId: "app-1",
      status: "pending",
      emailConstraint: "alice@example.com",
      expiresAt: 2000,
    });

    await expect(service.authorizeAppInvitationLogin(
      principal,
      "Alice@Example.com",
      true,
      "a".repeat(32),
    )).resolves.toMatchObject({ mode: "invitation", invitation: { invitationId: "invitation-1" } });
    await expect(service.authorizeAppInvitationLogin(
      principal,
      "other@example.com",
      true,
      "a".repeat(32),
    )).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
    await expect(service.authorizeAppInvitationLogin(
      principal,
      "alice@example.com",
      false,
      "a".repeat(32),
    )).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
  });

  test("allows an admitted Principal to continue with an unconstrained invitation", async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.hasMembership).mockResolvedValue(true);
    vi.mocked(repository.getAppInvitationByTokenHash).mockResolvedValue({
      invitationId: "invitation-1",
      appId: "app-1",
      status: "pending",
      emailConstraint: null,
      expiresAt: 2000,
    });

    await expect(service.authorizeAppInvitationLogin(
      principal,
      null,
      false,
      "a".repeat(32),
    )).resolves.toMatchObject({ mode: "full" });
  });

  test("fails closed for blocked, elapsed, malformed, and unavailable invitation admission", async () => {
    const { repository, service } = fixture();
    const pending = {
      invitationId: "invitation-1",
      appId: "app-1",
      status: "pending" as const,
      emailConstraint: "alice@example.com",
      expiresAt: 2000,
    };
    vi.mocked(repository.getAppInvitationByTokenHash).mockResolvedValue(pending);
    vi.mocked(repository.getAccess).mockResolvedValue({
      principal,
      principalRef: "principal-1",
      status: "blocked",
      authorities: [],
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await expect(service.authorizeAppInvitationLogin(
      principal,
      "alice@example.com",
      true,
      "a".repeat(32),
    )).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });

    vi.mocked(repository.getAppInvitationByTokenHash).mockResolvedValue({ ...pending, expiresAt: 1000 });
    await expect(service.resolveAppInvitation("a".repeat(32))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.resolveAppInvitation("short")).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.mocked(repository.getAppInvitationByTokenHash).mockRejectedValue(new Error("offline"));
    await expect(service.resolveAppInvitation("a".repeat(32))).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});