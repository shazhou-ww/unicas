/**
 * @unicas/codec — Wire-format encodings for the App/Space data plane.
 *
 * Pure encoding, no I/O, no platform binding, no HTTP contracts. Split out of
 * `@unicas/space-protocol` (2026-08-29) so the encoding layer can be
 * published and tested independently; `@unicas/space-protocol` now focuses on
 * HTTP request/response types and does NOT re-export these symbols.
 *
 * Consumers that only need node/blob encoding depend on this package alone.
 */
export { HEADER_SIZE, SIGNATURE, VERSION, MAX_CONTENT_TYPE_LENGTH, MIN_CONTENT_TYPE_LENGTH, HASH_SIZE, HASH_HEX_LENGTH, encodeHeader, decodeHeader, concatenateNodeBytes, parseNodeBytes, } from "./binary.js";
export { sha256, computeNodeDigest, hashToHex, hexToHash, } from "./digest.js";
export { CanonicalNodeContentType, parseCanonicalNodeStream, } from "./canonical-stream.js";
export type { ParsedCanonicalNodeStream } from "./canonical-stream.js";
export { MAX_CANONICAL_NODE_BYTES, MAX_NODE_REFS, validateCanonicalNodeSize, validateHash, validateRawHash, validateContentType, validateDecodedHeader, validateChildRefs, validateContentLength, } from "./validation.js";
export type { CanonicalNodeLimits } from "./validation.js";
