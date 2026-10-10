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
  parseSpaceSelector,
  SpaceIdSchema,
} from "@unicas/space-protocol";
import {
  createAppCasClient,
  type AppCasClient,
  type CasGcOptions,
  type CasGcResult,
  type CasNodeMetadata,
  type CasNodeRange,
  type CasRootRefUpdate,
  type CasRootRefsResult,
  type CasUsage,
  type HttpFetcher,
  type SpaceNodeLeaseOptions,
  type SpaceNodeLeaseResult,
} from "@unicas/space-client";
import { createCasBlobClient } from "@unicas/space-blob-client";
import {
  createSpaceFileSystem,
  type SpaceFileRootCatalog,
  type SpaceFileRootInfo,
} from "@unicas/space-file-client";

const SPACE_ID = "/space-1";

class MemoryCas implements AppCasClient, HttpFetcher {
  readonly nodes = new Map<string, { content: Uint8Array; contentType: string; refs: string[] }>();
  readonly uploads = new Map<string, Uint8Array>();
  readonly rootRefUpdates: CasRootRefUpdate[] = [];

  leaseNode(spaceId: string, hash: string): Promise<SpaceNodeLeaseResult>;
  leaseNode(
    spaceId: string,
    hash: string,
    options: SpaceNodeLeaseOptions,
  ): Promise<SpaceNodeLeaseResult>;
  async leaseNode(
    spaceId: string,
    hash: string,
    _options?: SpaceNodeLeaseOptions,
  ): Promise<SpaceNodeLeaseResult> {
    assert.equal(spaceId, SPACE_ID);
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

  async readMetadata(spaceId: string, hash: string): Promise<CasNodeMetadata> {
    assert.equal(spaceId, SPACE_ID);
    const node = this.nodes.get(hash);
    if (node === undefined) throw new Error(`missing node ${hash}`);
    return { hash, size: node.content.length, contentType: node.contentType, refs: node.refs };
  }

  async readNode(spaceId: string, hash: string) {
    return {
      metadata: await this.readMetadata(spaceId, hash),
      content: await this.readContent(spaceId, hash),
    };
  }

  async readContent(
    spaceId: string,
    hash: string,
    range?: CasNodeRange,
  ): Promise<ReadableStream<Uint8Array>> {
    assert.equal(spaceId, SPACE_ID);
    const node = this.nodes.get(hash);
    if (node === undefined) throw new Error(`missing node ${hash}`);
    const bytes = range === undefined
      ? node.content
      : node.content.slice(range.offset, range.length === undefined ? undefined : range.offset + range.length);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer]).stream();
  }

  async updateRootRefs(
    spaceId: string,
    update: CasRootRefUpdate,
  ): Promise<CasRootRefsResult> {
    assert.equal(spaceId, SPACE_ID);
    this.rootRefUpdates.push(update);
    return { success: true, revision: this.rootRefUpdates.length };
  }

  async listRootRefs(
    spaceId: string,
  ): Promise<{ refDomain: string; revision: number; items: []; nextCursor: null }> {
    assert.equal(spaceId, SPACE_ID);
    return { refDomain: "docs", revision: this.rootRefUpdates.length, items: [], nextCursor: null };
  }

  async usage(spaceId: string): Promise<CasUsage> {
    assert.equal(spaceId, SPACE_ID);
    return {
      nodeCount: this.nodes.size,
      readyContentBytes: [...this.nodes.values()].reduce((total, node) => total + node.content.length, 0),
      readyStoredBytes: 0,
      reservedBytes: 0,
      notReadyNodeCount: 0,
      leasedNodeCount: this.nodes.size,
    };
  }

  async gc(spaceId: string, _options?: CasGcOptions): Promise<CasGcResult> {
    assert.equal(spaceId, SPACE_ID);
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
assert.equal(SpaceIdSchema.safeParse("/space-1").success, true);
assert.equal(
  appSpaceRoutes.usage({ appId: "app/1", spaceId: "/space/1" }),
  "/v1/cas/usage?appId=app%2F1&spaceId=%2Fspace%2F1",
);

let transportRequest: Request | undefined;
const selector = parseSpaceSelector(SPACE_ID);
if (!selector) throw new Error("fixture Space ID is invalid");
const transport = createAppCasClient({
  baseUrl: "https://api.example",
  appId: "app-1",
  capabilityProvider: {
    async acquire(requirement) {
      return {
        bearerToken: "capability",
        metadata: {
          version: 2,
          expiresAt: Math.floor(Date.now() / 1000) + 300,
          grants: [{ selector: selector.selector, permissions: [requirement.permission] }],
          refDomain: "docs",
        },
      };
    },
  },
  fetcher: {
    async fetch(input, init) {
      transportRequest = input instanceof Request ? input : new Request(input, init);
      return Response.json({ metadata: { hash: "a".repeat(64), size: 1, contentType: "text/plain", refs: [] } });
    },
  },
});
await transport.readMetadata(SPACE_ID, "a".repeat(64));
assert.equal(transportRequest?.headers.get("Authorization"), "Bearer capability");
assert.equal(new URL(transportRequest!.url).pathname, `/v1/cas/nodes/${"a".repeat(64)}/metadata`);
assert.equal(new URL(transportRequest!.url).searchParams.get("appId"), "app-1");
assert.equal(new URL(transportRequest!.url).searchParams.get("spaceId"), "/space-1");

const cas = new MemoryCas();
const blobs = createCasBlobClient({
  client: cas,
  spaceId: SPACE_ID,
  chunkBytes: 4,
  indexFanout: 2,
  uploadFetcher: cas,
});
const blobRef = await blobs.storeBlob(new Blob(["blob payload"]), { contentType: "text/plain" });
assert.equal(await new Response((await blobs.openBlob(blobRef.hash)).read()).text(), "blob payload");
await blobs.retain({ requestId: "retain-1", references: { [blobRef.hash]: 1 } });

const fileSystem = createSpaceFileSystem({
  client: cas,
  spaceId: SPACE_ID,
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
