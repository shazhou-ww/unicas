import { parseTraceHmacKeyRing } from "./trace-config.js";
import type { ManualTraceContext } from "./manual-tracing.js";
import { normalizeTraceUlid } from "./trace-identity.js";

export const InternalTraceContextHeader = "X-UniCAS-Trace-Context";
const MaximumInternalTraceContextLength = 1024;

export type InternalTraceAudienceKind = "unicas_request" | "space_do" | "root_ref_domain_do";

export function createInternalTraceAudience(
  kind: InternalTraceAudienceKind,
  ...components: readonly string[]
): string {
  if (components.length === 0 || components.some((component) => component.length === 0)) {
    throw new TypeError("internal trace audience components must not be empty");
  }
  const audience = [kind, ...components].join("\0");
  if (audience.length > 4096) throw new TypeError("internal trace audience is too long");
  return audience;
}

export async function createInternalTraceContextHeader(
  context: ManualTraceContext,
  encodedKeyRing: string | undefined,
  audience: string,
  now = Date.now(),
): Promise<string | null> {
  if (!context.sampled) return null;
  const keyRing = parseTraceHmacKeyRing(encodedKeyRing);
  const encoded = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    v: 1,
    k: keyRing.version,
    u: context.correlationUlid,
    t: context.traceId,
    p: context.spanId,
    e: now + 60_000,
  })));
  return `${encoded}.${await sign(authenticatedValue(encoded, audience), keyRing.key)}`;
}

export async function parseInternalTraceContextHeader(
  value: string | null | undefined,
  encodedKeyRing: string | undefined,
  audience: string,
  now = Date.now(),
): Promise<ManualTraceContext | null> {
  if (!value || value.length > MaximumInternalTraceContextLength || !validAudience(audience)) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    payload["v"] !== 1
    || typeof payload["k"] !== "string"
    || typeof payload["u"] !== "string"
    || typeof payload["t"] !== "string"
    || typeof payload["p"] !== "string"
    || typeof payload["e"] !== "number"
    || !Number.isSafeInteger(payload["e"])
    || payload["e"] < now
    || payload["e"] > now + 60_000
    || !/^(?!0{32})[0-9a-f]{32}$/.test(payload["t"])
    || !/^(?!0{16})[0-9a-f]{16}$/.test(payload["p"])
  ) return null;
  const keyRing = parseTraceHmacKeyRing(encodedKeyRing);
  const key = keyRing.keys.get(payload["k"]);
  if (!key || !await verify(authenticatedValue(encoded, audience), signature, key)) return null;
  const correlationUlid = normalizeTraceUlid(payload["u"], now);
  if (!correlationUlid) return null;
  return {
    correlationUlid,
    traceId: payload["t"],
    spanId: payload["p"],
    sampled: true,
  };
}

async function sign(value: string, rawKey: Uint8Array): Promise<string> {
  const key = await importHmacKey(rawKey, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(value),
  ));
  return encodeBase64Url(signature);
}

async function verify(value: string, signature: string, rawKey: Uint8Array): Promise<boolean> {
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBase64Url(signature);
  } catch {
    return false;
  }
  const verifiedSignature = new Uint8Array(signatureBytes.byteLength);
  verifiedSignature.set(signatureBytes);
  const key = await importHmacKey(rawKey, ["verify"]);
  return crypto.subtle.verify(
    "HMAC", key, verifiedSignature, new TextEncoder().encode(value),
  );
}

function importHmacKey(rawKey: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(rawKey.byteLength);
  keyBytes.set(rawKey);
  return crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, usages,
  );
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function authenticatedValue(encoded: string, audience: string): string {
  if (!validAudience(audience)) throw new TypeError("internal trace audience is invalid");
  return `${encoded}\0${audience}`;
}

function validAudience(audience: string): boolean {
  return audience.length > 0 && audience.length <= 4096;
}