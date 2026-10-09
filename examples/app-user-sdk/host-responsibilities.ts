import type { CasBlobClient } from "@unicas/space-blob-client";
import type {
  SpaceFileRoot,
  SpaceFileRootCatalog,
  SpaceFileRootInfo,
} from "@unicas/space-file-client";

export function createCapabilityProvider(endpoint: string): () => Promise<string> {
  return async () => {
    const response = await fetch(endpoint, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`capability request failed with HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (
      typeof body !== "object"
      || body === null
      || !("capability" in body)
      || typeof body.capability !== "string"
    ) {
      throw new TypeError("capability response is invalid");
    }
    return body.capability;
  };
}

export async function storeBusinessBlob(
  blobs: CasBlobClient,
  source: Blob,
  persistHash: (hash: string) => Promise<void>,
  requestId: string,
): Promise<string> {
  const stored = await blobs.storeBlob(source, {
    contentType: source.type || "application/octet-stream",
    size: source.size,
  });
  await persistHash(stored.hash);
  await blobs.retain({ requestId, references: { [stored.hash]: 1 } });
  return stored.hash;
}

export async function commitFileChange(
  root: SpaceFileRoot,
  path: string,
  content: Blob,
): Promise<SpaceFileRootInfo> {
  await root.write(path, content, {
    contentType: content.type || "application/octet-stream",
  });
  return root.commit();
}

export class MemoryRootCatalog implements SpaceFileRootCatalog {
  readonly #roots = new Map<string, SpaceFileRootInfo>();

  async list(): Promise<SpaceFileRootInfo[]> {
    return [...this.#roots.values()];
  }

  async create(input: Omit<SpaceFileRootInfo, "revision" | "createdAt" | "updatedAt">): Promise<SpaceFileRootInfo> {
    if (this.#roots.has(input.rootId)) throw new Error(`root ${input.rootId} already exists`);
    const now = Date.now();
    const root = { ...input, revision: 1, createdAt: now, updatedAt: now };
    this.#roots.set(root.rootId, root);
    return root;
  }

  async update(
    input: Pick<SpaceFileRootInfo, "rootId" | "name" | "manifestHash" | "revision">,
  ): Promise<SpaceFileRootInfo> {
    const current = this.#roots.get(input.rootId);
    if (current === undefined || current.revision !== input.revision) {
      throw new Error(`root ${input.rootId} revision conflict`);
    }
    const updated = {
      ...current,
      name: input.name,
      manifestHash: input.manifestHash,
      revision: current.revision + 1,
      updatedAt: Date.now(),
    };
    this.#roots.set(updated.rootId, updated);
    return updated;
  }

  async delete(input: Pick<SpaceFileRootInfo, "rootId" | "revision">): Promise<void> {
    const current = this.#roots.get(input.rootId);
    if (current === undefined || current.revision !== input.revision) {
      throw new Error(`root ${input.rootId} revision conflict`);
    }
    this.#roots.delete(input.rootId);
  }
}
