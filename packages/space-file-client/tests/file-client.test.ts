import { beforeEach, describe, expect, test, vi } from "vitest";
import { createCasBlobClient, storeNodeContent } from "@unicas/space-blob-client";
import type { AppCasClient } from "@unicas/space-client";
import type { SpaceFileRootCatalog, SpaceFileRootInfo } from "../src/index.js";

const state = vi.hoisted(() => ({
  manifests: new Map<string, { content: Uint8Array; contentType: string; refs: readonly string[] }>(),
  blobs: new Map<string, Uint8Array>(),
  retained: [] as string[],
  released: [] as string[],
  sequence: 0,
}));
const SPACE_ID = "/space-1";

vi.mock("@unicas/space-blob-client", () => ({
  storeNodeContent: vi.fn(async (
    _client,
    _spaceId: string,
    content: Uint8Array,
    contentType: string,
    refs: readonly string[],
  ) => {
    const hash = `manifest-${++state.sequence}`;
    state.manifests.set(hash, { content, contentType, refs });
    return hash;
  }),
  createCasBlobClient: vi.fn(() => ({
    storeBlob: async (source: Blob, options: { contentType: string }) => {
      const hash = `blob-${++state.sequence}`;
      const bytes = new Uint8Array(await source.arrayBuffer());
      state.blobs.set(hash, bytes);
      return { hash, size: bytes.length, contentType: options.contentType };
    },
    openBlob: async (hash: string) => ({
      ref: { hash, size: state.blobs.get(hash)?.length ?? 0, contentType: "application/octet-stream" },
      read: () => new Blob([state.blobs.get(hash)!]).stream(),
    }),
    retain: async ({ references }: { references: Record<string, number> }) => {
      state.retained.push(...Object.keys(references));
      return { success: true };
    },
    release: async ({ references }: { references: Record<string, number> }) => {
      state.released.push(...Object.keys(references));
      return { success: true };
    },
  })),
}));

import { createSpaceFileSystem } from "../src/index.js";

function catalogFixture(): SpaceFileRootCatalog & { readonly records: Map<string, SpaceFileRootInfo> } {
  const records = new Map<string, SpaceFileRootInfo>();
  return {
    records,
    list: async () => [...records.values()],
    async create(input) {
      const record = { ...input, revision: 1, createdAt: 1, updatedAt: 1 };
      records.set(record.rootId, record);
      return record;
    },
    async update(input) {
      const current = records.get(input.rootId);
      if (!current || current.revision !== input.revision) throw new Error("revision mismatch");
      const record = { ...current, name: input.name, manifestHash: input.manifestHash, revision: current.revision + 1, updatedAt: current.updatedAt + 1 };
      records.set(record.rootId, record);
      return record;
    },
    async delete(input) {
      const current = records.get(input.rootId);
      if (!current || current.revision !== input.revision) throw new Error("revision mismatch");
      records.delete(input.rootId);
    },
  };
}

function casFixture(): AppCasClient {
  return {
    async readNode(spaceId, hash) {
      expect(spaceId).toBe(SPACE_ID);
      const manifest = state.manifests.get(hash)!;
      return {
        metadata: {
          hash,
          size: manifest.content.length,
          contentType: manifest.contentType,
          refs: manifest.refs,
        },
        content: new Blob([manifest.content]).stream(),
      };
    },
    async readMetadata(spaceId, hash) {
      expect(spaceId).toBe(SPACE_ID);
      const manifest = state.manifests.get(hash)!;
      return { hash, size: manifest.content.length, contentType: manifest.contentType, refs: manifest.refs };
    },
    async readContent(spaceId, hash) {
      expect(spaceId).toBe(SPACE_ID);
      return new Blob([state.manifests.get(hash)!.content]).stream();
    },
  } as AppCasClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.manifests.clear();
  state.blobs.clear();
  state.retained.length = 0;
  state.released.length = 0;
  state.sequence = 0;
});

describe("Space file system", () => {
  test("edits a working tree and switches the catalog only on commit", async () => {
    const catalog = catalogFixture();
    const fileSystem = createSpaceFileSystem({
      client: casFixture(),
      spaceId: SPACE_ID,
      catalog,
      createId: () => "root-1",
      createRequestId: () => "request-1",
    });
    const root = await fileSystem.createRoot("Project files");
    const initialHash = root.info.manifestHash;

    await root.mkdir("/docs");
    await root.write("/docs/readme.txt", new Blob(["hello"]), { contentType: "text/plain" });
    await root.copy("/docs/readme.txt", "/copy.txt");
    await root.move("/docs", "/archive");

    expect(root.dirty).toBe(true);
    expect(catalog.records.get("root-1")?.manifestHash).toBe(initialHash);
    expect(await root.readdir("/")).toEqual([
      { path: "/archive", name: "archive", type: "directory" },
      { path: "/copy.txt", name: "copy.txt", type: "file", size: 5, mediaType: "text/plain" },
    ]);
    expect(new TextDecoder().decode(await new Response(await root.read("/archive/readme.txt")).arrayBuffer())).toBe("hello");

    const committed = await root.commit();
    expect(committed.revision).toBe(2);
    expect(committed.manifestHash).not.toBe(initialHash);
    expect(root.dirty).toBe(false);
    expect(state.retained).toContain(committed.manifestHash);
    expect(state.released).toContain(initialHash);
  });

  test("discard restores the last committed snapshot", async () => {
    const fileSystem = createSpaceFileSystem({
      client: casFixture(),
      spaceId: SPACE_ID,
      catalog: catalogFixture(),
      createId: () => "root-1",
    });
    const root = await fileSystem.createRoot("Files");
    await root.mkdir("/temporary");
    await root.rename("Renamed");
    root.discard();

    expect(root.dirty).toBe(false);
    expect(root.info.name).toBe("Files");
    await expect(root.stat("/temporary")).rejects.toThrow("Path not found");
  });

  test("preserves mixed-case path references after reopening a committed Root", async () => {
    const fileSystem = createSpaceFileSystem({
      client: casFixture(),
      spaceId: SPACE_ID,
      catalog: catalogFixture(),
      createId: () => "root-1",
    });
    const root = await fileSystem.createRoot("Files");
    await root.write("/a.txt", new Blob(["lowercase"]), { contentType: "text/plain" });
    await root.write("/B.txt", new Blob(["uppercase"]), { contentType: "text/plain" });
    await root.commit();

    const reopened = await fileSystem.openRoot("root-1");
    await expect(new Response(await reopened.read("/a.txt")).text()).resolves.toBe("lowercase");
    await expect(new Response(await reopened.read("/B.txt")).text()).resolves.toBe("uppercase");
  });

  test("opens a catalog snapshot with one manifest read and no second catalog lookup", async () => {
    const catalog = catalogFixture();
    const cas = casFixture();
    const list = vi.spyOn(catalog, "list");
    const readNode = vi.spyOn(cas, "readNode");
    const fileSystem = createSpaceFileSystem({
      client: cas,
      spaceId: SPACE_ID,
      catalog,
      createId: () => "root-1",
    });
    await fileSystem.createRoot("Files");
    readNode.mockClear();

    const [snapshot] = await fileSystem.listRoots();
    await fileSystem.openRoot(snapshot);

    expect(list).toHaveBeenCalledOnce();
    expect(readNode).toHaveBeenCalledOnce();
  });

  test("passes bounded blob options to the public blob client", () => {
    const cas = casFixture();
    const blobOptions = { chunkBytes: 1024, indexFanout: 4 };
    createSpaceFileSystem({
      client: cas,
      spaceId: SPACE_ID,
      catalog: catalogFixture(),
      blobOptions,
    });

    expect(vi.mocked(createCasBlobClient)).toHaveBeenLastCalledWith({
      client: cas,
      spaceId: SPACE_ID,
      ...blobOptions,
    });
  });

  test("uses the injected upload transport for file manifests", async () => {
    const uploadFetcher = { fetch: vi.fn() };
    const fileSystem = createSpaceFileSystem({
      client: casFixture(),
      spaceId: SPACE_ID,
      catalog: catalogFixture(),
      blobOptions: { uploadFetcher },
      createId: () => "root-1",
    });

    await fileSystem.createRoot("Files");

    expect(vi.mocked(storeNodeContent)).toHaveBeenCalledWith(
      expect.anything(),
      SPACE_ID,
      expect.any(Uint8Array),
      expect.any(String),
      [],
      undefined,
      uploadFetcher,
    );
  });
});