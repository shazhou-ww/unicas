/**
 * Node write helpers: raw content → canonical node → lease.
 *
 * These encode the canonical node wire format (via @unicas/codec) and store
 * it through the tenant-client's `leaseNode`. They live in the blob layer
 * (not tenant-client) because tenant-client is a pure 1:1 mapping of the
 * HTTP API and does no encoding.
 */

import {
  computeNodeDigest,
  concatenateNodeBytes,
  encodeHeader,
  hashToHex,
  hexToHash,
} from "@unicas/codec";
import type {
  CasLeaseOptions,
  HttpFetcher,
  SpaceCasClient,
  SpaceNodeLeaseOptions,
  SpaceNodeLeaseResult,
} from "@unicas/tenant-client";
import {
  CasClientError,
  DEFAULT_SPACE_NODE_LEASE_OPTIONS,
} from "@unicas/tenant-client";

async function encodeCanonicalNode(
  content: Uint8Array,
  contentType: string,
  refs: readonly string[],
): Promise<{ readonly hash: string; readonly bytes: Uint8Array }> {
  const childHashes = refs.map(hexToHash);
  const header = encodeHeader(content.length, contentType, childHashes.length);
  return {
    hash: hashToHex(await computeNodeDigest(header, contentType, childHashes, content)),
    bytes: concatenateNodeBytes(
      header,
      new TextEncoder().encode(contentType),
      childHashes,
      content,
    ),
  };
}

export async function leaseNodeContent(
  cas: Pick<SpaceCasClient, "leaseNode">,
  hash: string,
  content: Uint8Array,
  contentType: string,
  refs: readonly string[] = [],
  options?: CasLeaseOptions,
  uploadFetcher: HttpFetcher = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<Extract<SpaceNodeLeaseResult, { state: "ready" }>> {
  const canonical = await encodeCanonicalNode(content, contentType, refs);
  if (canonical.hash !== hash) {
    throw new Error(`CAS node digest mismatch: expected ${hash}, got ${canonical.hash}`);
  }
  return uploadCanonicalNode(cas, canonical.hash, canonical.bytes, options, uploadFetcher);
}

export async function storeNodeContent(
  cas: Pick<SpaceCasClient, "leaseNode">,
  content: Uint8Array,
  contentType: string,
  refs: readonly string[] = [],
  options?: CasLeaseOptions,
  uploadFetcher: HttpFetcher = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<string> {
  const canonical = await encodeCanonicalNode(content, contentType, refs);
  await uploadCanonicalNode(cas, canonical.hash, canonical.bytes, options, uploadFetcher);
  return canonical.hash;
}

async function uploadCanonicalNode(
  cas: Pick<SpaceCasClient, "leaseNode">,
  hash: string,
  bytes: Uint8Array,
  options: CasLeaseOptions | undefined,
  uploadFetcher: HttpFetcher,
): Promise<Extract<SpaceNodeLeaseResult, { state: "ready" }>> {
  const leaseOptions: SpaceNodeLeaseOptions = {
    durationMs: options?.durationMs ?? DEFAULT_SPACE_NODE_LEASE_OPTIONS.durationMs,
    signal: options?.signal ?? null,
  };
  let result = await cas.leaseNode(hash, leaseOptions);
  let uploaded = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (result.state === "ready") return result;
    if (result.state === "validated_awaiting_children") {
      for (const childHash of result.childHashes) {
        const child = await cas.leaseNode(childHash, leaseOptions);
        if (child.state !== "ready") {
          throw new Error(`CAS child node ${childHash} is not ready`);
        }
      }
      result = await cas.leaseNode(hash, leaseOptions);
      continue;
    }
    if (result.state === "awaiting_replacement_upload" && uploaded) {
      throw new Error(`${result.rejection.code}: ${result.rejection.message}`);
    }

    const uploadResponse = await uploadFetcher.fetch(result.upload.url, {
      method: result.upload.method,
      headers: result.upload.headers,
      body: bytes.slice().buffer,
      signal: leaseOptions.signal,
    });
    await uploadResponse.body?.cancel("Direct CAS upload response consumed").catch(() => undefined);
    if (!uploadResponse.ok && uploadResponse.status !== 412) {
      throw new CasClientError(uploadResponse.status, uploadResponse.statusText, "upload");
    }
    uploaded = true;
    result = await cas.leaseNode(hash, leaseOptions);
  }
  if (result.state === "awaiting_replacement_upload") {
    throw new Error(`${result.rejection.code}: ${result.rejection.message}`);
  }
  throw new Error(`CAS node ${hash} did not become ready`);
}
