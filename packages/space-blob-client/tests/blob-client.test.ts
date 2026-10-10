/**
 * Functional blob-layer tests: `createCasBlobClient` over an in-memory
 * `AppCasClient` (no HTTP, no transport). Covers deterministic chunk-tree
 * store, handle-shaped reads (whole / ranged / bounded), retention operations,
 * and access to the underlying App client.
 */

import { describe, expect, it, vi } from "vitest";
import {
  hashToHex,
  parseNodeBytes,
  sha256,
} from "@unicas/codec";
import type {
  AppCasClient,
  CasGcOptions,
  CasGcResult,
  CasNodeMetadata,
  CasNodeRange,
  CasRootRefUpdate,
  CasRootRefsResult,
  CasUsage,
  HttpFetcher,
  SpaceNodeLeaseOptions,
  SpaceNodeLeaseResult,
} from "@unicas/space-client";
import { createCasBlobClient, storeNodeContent } from "../src/index.js";

const SPACE_ID = "/space-1";

class MemoryCas implements AppCasClient, HttpFetcher {
  readonly nodes = new Map<string, { content: Uint8Array; contentType: string; refs: string[] }>();
  readonly uploads = new Map<string, Uint8Array>();
  readonly rootRefUpdates: CasRootRefUpdate[] = [];
  gcCalls: { maxNodes?: number }[] = [];

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
    expect(spaceId).toBe(SPACE_ID);
    if (this.nodes.has(hash)) {
      return { hash, state: "ready", leaseStartedAt: 0, leaseExpiresAt: Date.now() + 60_000 };
    }
    const canonical = this.uploads.get(hash);
    if (canonical !== undefined) {
      const parsed = parseNodeBytes(canonical);
      this.nodes.set(hash, {
        content: parsed.content,
        contentType: parsed.contentType,
        refs: parsed.childHashes.map(hashToHex),
      });
      return { hash, state: "ready", leaseStartedAt: 0, leaseExpiresAt: Date.now() + 60_000 };
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
    if (this.uploads.has(hash)) return new Response(null, { status: 412 });
    this.uploads.set(hash, new Uint8Array(await request.arrayBuffer()));
    return new Response(null, { status: 200 });
  }

  async readMetadata(spaceId: string, hash: string): Promise<CasNodeMetadata> {
    expect(spaceId).toBe(SPACE_ID);
    const node = this.nodes.get(hash);
    if (node === undefined) throw new Error(`node not found: ${hash}`);
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
    _options?: { readonly signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>> {
    expect(spaceId).toBe(SPACE_ID);
    const node = this.nodes.get(hash);
    if (node === undefined) throw new Error(`node not found: ${hash}`);
    const content = range === undefined
      ? node.content
      : node.content.slice(range.offset, range.length === undefined ? undefined : range.offset + range.length);
    return streamBytes(content);
  }

  async updateRootRefs(
    spaceId: string,
    update: CasRootRefUpdate,
  ): Promise<CasRootRefsResult> {
    expect(spaceId).toBe(SPACE_ID);
    this.rootRefUpdates.push(update);
    return { success: true, revision: this.rootRefUpdates.length };
  }

  async listRootRefs() {
    return { refDomain: "test", revision: 0, items: [], nextCursor: null };
  }

  async usage(spaceId: string): Promise<CasUsage> {
    expect(spaceId).toBe(SPACE_ID);
    return {
      nodeCount: this.nodes.size,
      readyContentBytes: [...this.nodes.values()].reduce((total, node) => total + node.content.length, 0),
      readyStoredBytes: 0,
      reservedBytes: 0,
      notReadyNodeCount: 0,
      leasedNodeCount: this.nodes.size,
    };
  }

  async gc(spaceId: string, options?: CasGcOptions): Promise<CasGcResult> {
    expect(spaceId).toBe(SPACE_ID);
    this.gcCalls.push(options ?? {});
    return { examined: this.nodes.size, deleted: 0, reclaimedContentBytes: 0 };
  }
}

describe("functional blob client", () => {
  it("stores and reads deterministic chunk-tree blobs", async () => {
    const cas = new MemoryCas();
    const leaseNode = vi.spyOn(cas, "leaseNode");
    const chunkBytes = 4;
    const blobs = createCasBlobClient({
      client: cas,
      spaceId: SPACE_ID,
      chunkBytes,
      indexFanout: 2,
      uploadFetcher: cas,
    });
    const bytes = Uint8Array.from([
      0x61, 0x61, 0x61, 0x61,
      0x62, 0x62, 0x62, 0x62,
      0x63, 0x64, 0x65,
    ]);
    const progress = vi.fn();

    const ref = await blobs.storeBlob(streamOf(bytes, 1024 * 1024 + 1), {
      contentType: "application/octet-stream",
      size: bytes.length,
      leaseDurationMs: 30 * 60 * 1000,
      onProgress: progress,
    });
    expect(leaseNode).toHaveBeenCalledTimes(cas.nodes.size * 2);
    expect(leaseNode).toHaveBeenCalledWith(
      SPACE_ID,
      expect.any(String),
      { durationMs: 30 * 60 * 1000, signal: null },
    );
    expect(leaseNode.mock.calls.every(call => call[2]?.durationMs === 30 * 60 * 1000)).toBe(true);
    const handle = await blobs.openBlob(ref.hash);
    expect(handle.ref).toEqual(ref);
    const opened = new Uint8Array(await new Response(handle.read()).arrayBuffer());
    expect(opened.length).toBe(bytes.length);
    expect(hashToHex(await sha256(opened))).toBe(hashToHex(await sha256(bytes)));
    const ranged = new Uint8Array(await new Response(handle.read({
      offset: chunkBytes - 2,
      length: 4,
    })).arrayBuffer());
    expect(ranged).toEqual(Uint8Array.from([0x61, 0x61, 0x62, 0x62]));
    const bounded = await handle.readBytes({ offset: chunkBytes - 2, length: 4 });
    expect(bounded).toEqual(ranged);
    expect(blobs.unicasClient).toBe(cas);
    expect(blobs.spaceId).toBe(SPACE_ID);
    await expect(blobs.unicasClient.usage(SPACE_ID)).resolves.toBeDefined();
    await expect(blobs.unicasClient.gc(SPACE_ID, { maxNodes: 25 })).resolves.toBeDefined();
    expect(progress).toHaveBeenLastCalledWith(bytes.length);
  }, 20_000);

  it("resolves single-node metadata when opening a blob", async () => {
    const cas = new MemoryCas();
    const blobs = createCasBlobClient({
      client: cas,
      spaceId: SPACE_ID,
      chunkBytes: 1024,
      indexFanout: 2,
      uploadFetcher: cas,
    });
    const bytes = new TextEncoder().encode("small");
    const ref = await blobs.storeBlob(streamOf(bytes, 3), {
      contentType: "text/plain",
      size: bytes.length,
    });
    expect(ref.size).toBe(bytes.length);
    expect(ref.contentType).toBe("text/plain");
    expect((await blobs.openBlob(ref.hash)).ref).toEqual(ref);
  });

  it("separates batch retain and release while exposing the App client", async () => {
    const cas = new MemoryCas();
    const blobs = createCasBlobClient({
      client: cas,
      spaceId: SPACE_ID,
      uploadFetcher: cas,
    });
    const bytes = new TextEncoder().encode("abc");
    const hash = await storeNodeContent(
      cas,
      SPACE_ID,
      bytes,
      "text/plain",
      [],
      undefined,
      cas,
    );

    await expect(blobs.unicasClient.leaseNode(SPACE_ID, hash))
      .resolves.toMatchObject({ hash, state: "ready" });
    await expect(blobs.retain({ requestId: "retain-1", references: { [hash]: 2 } }))
      .resolves.toMatchObject({ success: true, revision: 1 });
    await expect(blobs.release({ requestId: "release-1", references: { [hash]: 1 } }))
      .resolves.toMatchObject({ success: true, revision: 2 });
    await expect(blobs.unicasClient.gc(SPACE_ID, { maxNodes: 25 })).resolves.toBeDefined();
    expect(cas.rootRefUpdates).toEqual([
      { requestId: "retain-1", changes: { [hash]: 2 } },
      { requestId: "release-1", changes: { [hash]: -1 } },
    ]);
    expect(cas.gcCalls).toEqual([{ maxNodes: 25 }]);
  });

  it("rejects non-positive retention counts before calling the App client", async () => {
    const cas = new MemoryCas();
    const blobs = createCasBlobClient({
      client: cas,
      spaceId: SPACE_ID,
      uploadFetcher: cas,
    });

    await expect(blobs.retain({ requestId: "invalid", references: { bad: 0 } }))
      .rejects.toThrow("positive safe integer");
    expect(cas.rootRefUpdates).toEqual([]);
  });
});

function streamOf(bytes: Uint8Array, fragmentSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + fragmentSize, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}
