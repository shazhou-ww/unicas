import { expect, test, vi } from "vitest";
import { PeopleService, type PeopleRepository } from "../src/people.js";

test("people cursors bind scope, filters, snapshot and invitation expiry", async () => {
  const repository: PeopleRepository = {
    readSnapshot: vi.fn(async () => 1),
    nextExpiry: vi.fn(async () => 2000),
    list: vi.fn(async () => [1, 2].map(index => ({ key: `invitation:${index}`, time: 1000, item: { kind: "invitation" as const, invitation: { appId: "cas_one", invitationId: String(index), status: "pending" as const, emailConstraint: null, expiresAt: 2000, createdAt: 1000, revision: 1 } } }))),
  };
  const prepare = vi.fn(async () => { });
  let clock = 1000;
  const service = new PeopleService(repository, prepare, () => clock);
  const scope = { appId: "cas_one" };
  const first = await service.list(scope, { limit: 1, query: "中文" });
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  await service.list(scope, { limit: 1, query: "中文", cursor: first.nextCursor });
  expect(repository.list).toHaveBeenLastCalledWith(expect.objectContaining({ after: { key: "invitation:1", time: 1000 } }));
  for (const [target, query] of [[{ appId: "cas_two" }, { query: "中文" }], [scope, { filter: "history" }], [{ platform: true }, {}]] as const) {
    await expect(service.list(target, { ...query, cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  }
  clock = 2000;
  await expect(service.list(scope, { query: "中文", cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  clock = 1000;
  vi.mocked(repository.readSnapshot).mockResolvedValue(2);
  await expect(service.list(scope, { query: "中文", cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  prepare.mockRejectedValueOnce(new Error("denied"));
  await expect(service.list(scope, {})).rejects.toThrow("denied");
});