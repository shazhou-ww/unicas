import { describe, expect, test, vi } from "vitest";
import type { SpaceCasClient } from "@unicas/space-client";
import type {
  SpaceFileRoot,
  SpaceFileRootInfo,
  SpaceFileStat,
  SpaceFileSystem,
} from "@unicas/space-file-client";
import {
  FileServiceError,
  SpacesFileService,
  childPath,
  createLeaseEvidenceClient,
  normalizeAbsolutePath,
} from "../src/file-service.js";

function fixture(options: {
  readonly revision?: number;
  readonly entries?: readonly SpaceFileStat[];
  readonly rootCount?: number;
  readonly retained?: boolean;
} = {}) {
  let info: SpaceFileRootInfo = {
    rootId: "root-a",
    name: "Files",
    manifestHash: "manifest-a",
    revision: options.revision ?? 3,
    createdAt: 1,
    updatedAt: 1,
  };
  const entries = new Map((options.entries ?? []).map((entry) => [entry.path, entry]));
  const root: SpaceFileRoot = {
    get info() { return info; },
    dirty: false,
    stat: vi.fn(async (path: string) => {
      const entry = entries.get(path);
      if (!entry) throw new TypeError(`Path not found: ${path}`);
      return entry;
    }),
    readdir: vi.fn(async () => [...entries.values()]),
    read: vi.fn(async () => new Blob(["bytes"]).stream()),
    write: vi.fn(async (path: string, content: Blob, writeOptions) => {
      entries.set(path, {
        path,
        name: path.slice(path.lastIndexOf("/") + 1),
        type: "file",
        size: content.size,
        mediaType: writeOptions.contentType,
      });
    }),
    mkdir: vi.fn(async (path: string) => {
      entries.set(path, { path, name: path.slice(path.lastIndexOf("/") + 1), type: "directory" });
    }),
    move: vi.fn(async (from: string, to: string) => {
      const entry = entries.get(from)!;
      entries.delete(from);
      entries.set(to, { ...entry, path: to, name: to.slice(to.lastIndexOf("/") + 1) });
    }),
    copy: vi.fn(),
    remove: vi.fn(async (path: string) => {
      entries.delete(path);
      for (const entryPath of entries.keys()) {
        if (entryPath.startsWith(`${path}/`)) entries.delete(entryPath);
      }
    }),
    rename: vi.fn(),
    commit: vi.fn(async () => {
      info = { ...info, manifestHash: "manifest-next", revision: info.revision + 1 };
      return info;
    }),
    discard: vi.fn(),
  };
  const roots = Array.from({ length: options.rootCount ?? 1 }, (_, index) => ({
    ...info,
    rootId: index === 0 ? info.rootId : `root-${index}`,
  }));
  const fileSystem: SpaceFileSystem = {
    listRoots: vi.fn(async () => roots),
    openRoot: vi.fn(async () => root),
    createRoot: vi.fn(),
    deleteRoot: vi.fn(),
  };
  const cas = {
    updateRootRefs: vi.fn(async () => ({ success: true, revision: 1 })),
    listRootRefs: vi.fn(async () => ({
      refDomain: "spaces",
      revision: 1,
      items: options.retained === false ? [] : [{ hash: "manifest-next", refCount: 1 }],
      nextCursor: null,
    })),
  } as unknown as SpaceCasClient;
  return { service: new SpacesFileService(cas, fileSystem, 10), root, cas };
}

describe("SpacesFileService", () => {
  test("sorts directories before files and then by name", async () => {
    const { service } = fixture({
      entries: [
        { path: "/z.txt", name: "z.txt", type: "file", size: 1, mediaType: "text/plain" },
        { path: "/beta", name: "beta", type: "directory" },
        { path: "/alpha", name: "alpha", type: "directory" },
        { path: "/a.txt", name: "a.txt", type: "file", size: 1, mediaType: "text/plain" },
      ]
    });
    expect((await service.list("/")).entries.map((entry) => entry.name))
      .toEqual(["alpha", "beta", "a.txt", "z.txt"]);
  });

  test("rejects a stale revision before changing the working tree", async () => {
    const { service, root } = fixture({ revision: 3 });
    await expect(service.createFolder({ parentPath: "/", name: "docs", revision: 2 }))
      .rejects.toMatchObject({ code: "root_revision_conflict", status: 409 });
    expect(root.mkdir).not.toHaveBeenCalled();
  });

  test("commits an upload and confirms its positive Root Ref", async () => {
    const { service, root, cas } = fixture();
    await expect(service.uploadFile({
      parentPath: "/",
      name: "notes.txt",
      contentType: "text/plain",
      content: new Blob(["hello"]),
      revision: 3,
    })).resolves.toMatchObject({
      revision: 4,
      rootRetained: true,
      entry: { path: "/notes.txt", size: 5 },
    });
    expect(root.write).toHaveBeenCalled();
    expect(root.commit).toHaveBeenCalled();
    expect(cas.listRootRefs).toHaveBeenCalled();
  });

  test("rejects oversized content before opening or writing the Root", async () => {
    const { service, root } = fixture();
    await expect(service.uploadFile({
      parentPath: "/",
      name: "large.bin",
      contentType: "application/octet-stream",
      content: new Blob([new Uint8Array(11)]),
      revision: 3,
    })).rejects.toMatchObject({ code: "file_too_large", status: 413 });
    expect(root.write).not.toHaveBeenCalled();
  });

  test("fails closed when a Principal does not own exactly one Root", async () => {
    await expect(fixture({ rootCount: 0 }).service.list("/"))
      .rejects.toMatchObject({ code: "root_not_provisioned", status: 503 });
    await expect(fixture({ rootCount: 2 }).service.list("/"))
      .rejects.toMatchObject({ code: "root_not_provisioned", status: 503 });
  });

  test("cleans parent paths before children and tolerates already absent resources", async () => {
    const { service, root } = fixture({
      entries: [
        { path: "/smoke", name: "smoke", type: "directory" },
        { path: "/smoke/file.bin", name: "file.bin", type: "file", size: 1, mediaType: "application/octet-stream" },
      ]
    });
    await expect(service.cleanupPaths(["/smoke/file.bin", "/smoke", "/smoke"]))
      .resolves.toMatchObject({ revision: 4, rootRetained: true });
    expect(root.remove).toHaveBeenCalledTimes(1);
    expect(root.remove).toHaveBeenCalledWith("/smoke");
    await expect(service.cleanupPaths(["/smoke"])).resolves.toMatchObject({ rootRetained: true });
  });

  test("normalizes only absolute paths and single-segment child names", () => {
    expect(normalizeAbsolutePath("/projects/releases", false)).toBe("/projects/releases");
    expect(childPath("/projects", "release.txt")).toBe("/projects/release.txt");
    expect(() => childPath("/projects", "../escape")).toThrow(FileServiceError);
    expect(() => normalizeAbsolutePath("relative", true)).toThrow(FileServiceError);
  });

  test("reports aggregate lease evidence without exposing node identities", async () => {
    const leases = new Map<string, number>();
    const baseCas = {
      leaseNode: vi.fn(async (hash: string) => {
        const attempt = (leases.get(hash) ?? 0) + 1;
        leases.set(hash, attempt);
        return attempt === 1
          ? { hash, state: "awaiting_upload" as const, upload: { method: "PUT" as const, url: "https://upload.test", expiresAt: 1, headers: {} } }
          : { hash, state: "ready" as const, leaseStartedAt: 1, leaseExpiresAt: 2 };
      }),
    } as unknown as SpaceCasClient;
    const { cas, evidence } = createLeaseEvidenceClient(baseCas);
    const mark = evidence.mark();
    await cas.leaseNode("node-a");
    await cas.leaseNode("node-a");
    await cas.leaseNode("node-b");
    await cas.leaseNode("node-b");

    expect(evidence.summarize(mark)).toEqual({
      leaseRequests: 4,
      nodeCount: 2,
      readyNodes: 2,
      uploadRequiredNodes: 2,
    });
    expect(JSON.stringify(evidence.summarize(mark))).not.toContain("node-a");

    const reuseMark = evidence.mark();
    await cas.leaseNode("node-a");
    await cas.leaseNode("node-b");
    expect(evidence.summarize(reuseMark)).toEqual({
      leaseRequests: 2,
      nodeCount: 2,
      readyNodes: 2,
      uploadRequiredNodes: 0,
    });
  });

  test("creates an ephemeral smoke Root and releases its final manifest idempotently", async () => {
    const { cas } = fixture();
    const rootInfo: SpaceFileRootInfo = {
      rootId: "smoke-root",
      name: "Release smoke",
      manifestHash: "smoke-manifest",
      revision: 3,
      createdAt: 1,
      updatedAt: 1,
    };
    const fileSystem = {
      listRoots: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([rootInfo]),
      createRoot: vi.fn(async () => ({ info: rootInfo })),
      openRoot: vi.fn(),
      deleteRoot: vi.fn(),
    } as unknown as SpaceFileSystem;
    const catalog = {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      listPendingReleases: vi.fn(async () => []),
      completePendingRelease: vi.fn(),
    };
    vi.mocked(cas.updateRootRefs).mockResolvedValue({ success: true, idempotent: false, revision: 4 });
    const service = new SpacesFileService(cas, fileSystem, 10, undefined, catalog);

    await service.ensureSmokeRoot();
    await service.releaseSmokeRoot("run-a");

    expect(fileSystem.createRoot).toHaveBeenCalledWith("Release smoke");
    expect(cas.updateRootRefs).toHaveBeenCalledWith({
      requestId: "spaces-smoke:run-a:release-root",
      changes: { "smoke-manifest": -1 },
    });
    expect(catalog.delete).toHaveBeenCalledWith({ rootId: "smoke-root", revision: 3 });
  });

  test("reconciles a persisted previous-manifest release with its stable request ID", async () => {
    let oldRefCount = 1;
    const cas = {
      listRootRefs: vi.fn(async () => ({
        refDomain: "spaces",
        revision: 1,
        items: oldRefCount > 0 ? [{ hash: "manifest-old", refCount: oldRefCount }] : [],
        nextCursor: null,
      })),
      updateRootRefs: vi.fn(async () => {
        oldRefCount = 0;
        return { success: true, revision: 2 };
      }),
    } as unknown as SpaceCasClient;
    const completePendingRelease = vi.fn();
    const catalog = {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      listPendingReleases: vi.fn(async () => [{
        requestId: "spaces-root:root-a:revision:4:release",
        rootId: "root-a",
        manifestHash: "manifest-old",
      }]),
      completePendingRelease,
    };
    const fileSystem = {
      listRoots: vi.fn(async () => []),
      createRoot: vi.fn(),
      openRoot: vi.fn(),
      deleteRoot: vi.fn(),
    } as unknown as SpaceFileSystem;
    const service = new SpacesFileService(cas, fileSystem, 10, undefined, catalog);

    await expect(service.reconcilePendingReleases()).resolves.toBe(1);
    expect(cas.updateRootRefs).toHaveBeenCalledWith({
      requestId: "spaces-root:root-a:revision:4:release",
      changes: { "manifest-old": -1 },
    });
    expect(completePendingRelease).toHaveBeenCalledWith("spaces-root:root-a:revision:4:release");
  });

  test("keeps a pending release when Root Ref pagination exceeds the scan bound", async () => {
    const cas = {
      listRootRefs: vi.fn(async () => ({
        refDomain: "spaces",
        revision: 1,
        items: [],
        nextCursor: "more",
      })),
      updateRootRefs: vi.fn(),
    } as unknown as SpaceCasClient;
    const completePendingRelease = vi.fn();
    const catalog = {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      listPendingReleases: vi.fn(async () => [{
        requestId: "release-a",
        rootId: "root-a",
        manifestHash: "manifest-old",
      }]),
      completePendingRelease,
    };
    const fileSystem = {
      listRoots: vi.fn(async () => []),
      createRoot: vi.fn(),
      openRoot: vi.fn(),
      deleteRoot: vi.fn(),
    } as unknown as SpaceFileSystem;
    const service = new SpacesFileService(cas, fileSystem, 10, undefined, catalog);

    await expect(service.reconcilePendingReleases()).rejects.toMatchObject({
      code: "root_release_pending",
      status: 503,
    });
    expect(cas.listRootRefs).toHaveBeenCalledTimes(10);
    expect(cas.updateRootRefs).not.toHaveBeenCalled();
    expect(completePendingRelease).not.toHaveBeenCalled();
  });
});