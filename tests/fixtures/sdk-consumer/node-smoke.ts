import assert from "node:assert/strict";
import {
  computeNodeDigest,
  concatenateNodeBytes,
  encodeHeader,
  hashToHex,
  parseNodeBytes,
} from "@unicas/codec";
import {
  appSpaceRoutes,
  SpaceIdSchema,
} from "@unicas/space-protocol";
import {
  createSpaceCasClient,
  type CasGcOptions,
  type CasGcResult,
  type CasNodeMetadata,
  type CasNodeRange,
  type CasRootRefUpdate,
  type CasRootRefsResult,
  type CasUsage,
  type HttpFetcher,
  type SpaceCasClient,
  type SpaceNodeLeaseOptions,
  type SpaceNodeLeaseResult,
} from "@unicas/space-client";
import { createCasBlobClient } from "@unicas/space-blob-client";
import {
  createSpaceFileSystem,
  type SpaceFileRootCatalog,
  type SpaceFileRootInfo,
} from "@unicas/space-file-client";

class MemoryCas implements SpaceCasClient, HttpFetcher {
  readonly nodes = new Map<string, { content: Uint8Array; contentType: string; refs: string[] }>();
  readonly uploads = new Map<string, Uint8Array>();
  readonly rootRefUpdates: CasRootRefUpdate[] = [];

  leaseNode(hash: string): Promise<SpaceNodeLeaseResult>;
  leaseNode(hash: string, options: SpaceNodeLeaseOptions): Promise<SpaceNodeLeaseResult>;
  async leaseNode(hash: string, _options?: SpaceNodeLeaseOptions): Promise<SpaceNodeLeaseResult> {
    if (this.nodes.has(hash)) {
      return { hash, state: "ready", leaseStartedAt: 1, leaseExpiresAt: Date.now() + 60_000 };
    }
    const canonical = this.uploads.get(hash);
    if (canonical !== undefined) {
      const parsed = parseNodeBytes(canonical);
      this.nodes.set(hash, {
        content: parsed.content,
        contentType: parsed.contentType,
        refs: parsed.childHashes.map(hashToHex),
      });
      return { hash, state: "ready", leaseStartedAt: 1, leaseExpiresAt: Date.now() + 60_000 };
    }
    return {
      hash,
      state: "awaiting_upload",
      upload: {
        method: "PUT",
        url: `https://uploads.test/${hash}`,
        expiresAt: Date.now() + 60_000,
        headers: { "If-None-Match": "*" },
      },
    };
  }

  async fetch(input: string | Request, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init);
    const hash = new URL(request.url).pathname.slice(1);
    this.uploads.set(hash, new Uint8Array(await request.arrayBuffer()));
    return new Response(null, { status: 200 });
  }

  async readMetadata(hash: string): Promise<CasNodeMetadata> {
    const node = this.nodes.get(hash);
    if (node === undefined) throw new Error(`missing node ${hash}`);
    return { hash, size: node.content.length, contentType: node.contentType, refs: node.refs };
  }

  async readContent(hash: string, range?: CasNodeRange): Promise<ReadableStream<Uint8Array>> {
    const node = this.nodes.get(hash);
    if (node === undefined) throw new Error(`missing node ${hash}`);
    const bytes = range === undefined
      ? node.content
      : node.content.slice(range.offset, range.length === undefined ? undefined : range.offset + range.length);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer]).stream();
  }

  async updateRootRefs(update: CasRootRefUpdate): Promise<CasRootRefsResult> {
    this.rootRefUpdates.push(update);
    return { success: true, revision: this.rootRefUpdates.length };
  }

  async listRootRefs(): Promise<{ refDomain: string; revision: number; items: []; nextCursor: null }> {
    return { refDomain: "docs", revision: this.rootRefUpdates.length, items: [], nextCursor: null };
  }

  async usage(): Promise<CasUsage> {
    return {
      nodeCount: this.nodes.size,
      readyContentBytes: [...this.nodes.values()].reduce((total, node) => total + node.content.length, 0),
      readyStoredBytes: 0,
      reservedBytes: 0,
      notReadyNodeCount: 0,
      leasedNodeCount: this.nodes.size,
    };
  }

  async gc(_options?: CasGcOptions): Promise<CasGcResult> {
    return { examined: this.nodes.size, deleted: 0, reclaimedContentBytes: 0 };
  }
}

function catalogFixture(): SpaceFileRootCatalog {
  const roots = new Map<string, SpaceFileRootInfo>();
  return {
    list: async () => [...roots.values()],
    async create(input) {
      const record = { ...input, revision: 1, createdAt: 1, updatedAt: 1 };
      roots.set(record.rootId, record);
      return record;
    },
    async update(input) {
      const current = roots.get(input.rootId);
      if (current === undefined || current.revision !== input.revision) throw new Error("revision mismatch");
      const record = { ...current, name: input.name, manifestHash: input.manifestHash, revision: current.revision + 1, updatedAt: current.updatedAt + 1 };
      roots.set(record.rootId, record);
      return record;
    },
    async delete(input) {
      const current = roots.get(input.rootId);
      if (current === undefined || current.revision !== input.revision) throw new Error("revision mismatch");
      roots.delete(input.rootId);
    },
  };
}

const content = new TextEncoder().encode("packed SDK consumer");
const contentType = "text/plain";
const header = encodeHeader(content.length, contentType, 0);
const digest = await computeNodeDigest(header, contentType, [], content);
const canonical = concatenateNodeBytes(header, new TextEncoder().encode(contentType), [], content);
assert.equal(hashToHex(digest).length, 64);
assert.equal(parseNodeBytes(canonical).contentType, contentType);
assert.equal(SpaceIdSchema.safeParse("space-1").success, true);
assert.equal(
  appSpaceRoutes.usage({ appId: "app/1", spaceId: "space/1" }),
  "/v1/apps/app%2F1/spaces/space%2F1/cas/usage",
);

let transportRequest: Request | undefined;
const transport = createSpaceCasClient({
  baseUrl: "https://api.example",
  appId: "app-1",
  spaceId: "space-1",
  getToken: async () => "capability",
  fetcher: {
    async fetch(input, init) {
      transportRequest = input instanceof Request ? input : new Request(input, init);
      return Response.json({ metadata: { hash: "a".repeat(64), size: 1, contentType: "text/plain", refs: [] } });
    },
  },
});
await transport.readMetadata("a".repeat(64));
assert.equal(transportRequest?.headers.get("Authorization"), "Bearer capability");
assert.equal(new URL(transportRequest!.url).pathname, `/v1/apps/app-1/spaces/space-1/cas/nodes/${"a".repeat(64)}/metadata`);

const cas = new MemoryCas();
const blobs = createCasBlobClient(cas, { chunkBytes: 4, indexFanout: 2, uploadFetcher: cas });
const blobRef = await blobs.storeBlob(new Blob(["blob payload"]), { contentType: "text/plain" });
assert.equal(await new Response((await blobs.openBlob(blobRef.hash)).read()).text(), "blob payload");
await blobs.retain({ requestId: "retain-1", references: { [blobRef.hash]: 1 } });

const fileSystem = createSpaceFileSystem({
  cas,
  catalog: catalogFixture(),
  blobOptions: { chunkBytes: 4, indexFanout: 2, uploadFetcher: cas },
  createId: () => "root-1",
  createRequestId: () => "request-1",
});
const root = await fileSystem.createRoot("Documents");
await root.mkdir("/notes");
await root.write("/notes/today.txt", new Blob(["hello"]), { contentType: "text/plain" });
const committed = await root.commit();
assert.equal(committed.revision, 2);
assert.equal(await new Response(await root.read("/notes/today.txt")).text(), "hello");

console.log("SDK NODE CONSUMER PASS");
