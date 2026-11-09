export async function runCrossSpaceRootRefSmoke({ client, hash, spaceIds, requestId, assert }) {
  assert(spaceIds.length === 2 && new Set(spaceIds).size === 2, "cross-Space smoke uses two distinct Spaces");
  const before = [];
  for (const spaceId of spaceIds) {
    const page = await client.listRootRefs(spaceId, { limit: 100 });
    assert(Array.isArray(page.items) && Number.isSafeInteger(page.revision) && page.revision >= 0,
      "cross-Space smoke reads a valid revision snapshot");
    before.push(page);
  }
  const updates = [];
  for (const spaceId of spaceIds) {
    const result = await client.updateRootRefs(spaceId, { requestId, changes: { [hash]: 1 } });
    assert(result.success === true && result.idempotent === false
      && Number.isSafeInteger(result.revision) && result.revision > before[updates.length].revision,
    "same requestId applies independently in each Space");
    updates.push(result);
  }
  assert(updates[1].revision > updates[0].revision, "cross-Space writes advance one App-global revision");
  for (const [index, spaceId] of spaceIds.entries()) {
    const replay = await client.updateRootRefs(spaceId, { requestId, changes: { [hash]: 1 } });
    assert(replay.idempotent === true && replay.revision === updates[index].revision,
      "same payload replay retains its own Space revision");
    let rejected = false;
    try {
      await client.updateRootRefs(spaceId, { requestId, changes: { [hash]: 2 } });
    } catch (error) {
      assert(error?.status === 409 && error?.code === "IDEMPOTENCY_CONFLICT",
        "different payload replay returns 409 IDEMPOTENCY_CONFLICT");
      rejected = true;
    }
    assert(rejected, "different payload replay is rejected in each Space");
  }
  for (const [index, spaceId] of spaceIds.entries()) {
    const after = await client.listRootRefs(spaceId, { limit: 100 });
    const originalCount = before[index].items.find(item => item.hash === hash)?.refCount ?? 0;
    assert(after.revision === updates[1].revision,
      "replay and conflict do not advance the App-global revision");
    assert(after.items.find(item => item.hash === hash)?.refCount === originalCount + 1,
      "replay and conflict do not change the Space projection");
  }
}

export async function cleanupSmokeRoots({ client, spaceIds, hashes, requestId, assert }) {
  const failures = [];
  for (const spaceId of spaceIds) {
    try {
      const roots = await client.listRootRefs(spaceId, { limit: 100 });
      const changes = Object.fromEntries(roots.items
        .filter(item => hashes.includes(item.hash) && item.refCount > 0)
        .map(item => [item.hash, -item.refCount]));
      if (Object.keys(changes).length > 0) {
        const cleanup = await client.updateRootRefs(spaceId, { requestId, changes });
        assert(cleanup.success === true, "Root Ref cleanup releases smoke roots");
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Root Ref smoke cleanup failed");
}
