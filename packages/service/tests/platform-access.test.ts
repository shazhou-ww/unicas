import { describe, expect, test, vi } from "vitest";
import { PlatformAccessService, type PlatformAccessRepository } from "../src/platform-access.js";

const principal = { issuer: "https://identity.example.test", subject: "synthetic" };

function fixture() {
  const repository: PlatformAccessRepository = {
    getAccess: vi.fn(async () => null), hasMembership: vi.fn(async () => false),
    getPrincipal: vi.fn(async () => null), listPrincipals: vi.fn(async () => []),
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
});