import { decodeTime, isValid, ulid } from "ulid";

export const TraceIdHeader = "X-Trace-Id";
export const TraceUlidMaximumAgeMs = 10 * 60 * 1000;
export const TraceUlidMaximumFutureSkewMs = 60 * 1000;

const CrockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CrockfordValues = new Map(
  [...CrockfordAlphabet].map((character, value) => [character, value]),
);

declare const TraceUlidBrand: unique symbol;
export type TraceUlid = string & { readonly [TraceUlidBrand]: true };

export interface TraceScope {
  readonly kind: "app" | "account" | "service";
  readonly id: string;
}

export function createTraceUlid(now = Date.now()): TraceUlid {
  return ulid(now) as TraceUlid;
}

export function normalizeTraceUlid(
  value: string | null | undefined,
  now = Date.now(),
): TraceUlid | null {
  if (!value) return null;
  const canonical = value.toUpperCase();
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(canonical) || canonical[0]! > "7" || !isValid(canonical)) {
    return null;
  }
  const timestamp = decodeTime(canonical);
  if (
    timestamp < now - TraceUlidMaximumAgeMs
    || timestamp > now + TraceUlidMaximumFutureSkewMs
  ) {
    return null;
  }
  return canonical as TraceUlid;
}

export function resolveTraceUlid(
  value: string | null | undefined,
  now = Date.now(),
): TraceUlid {
  return normalizeTraceUlid(value, now) ?? createTraceUlid(now);
}

export function traceUlidToHex(value: TraceUlid): string {
  let decoded = 0n;
  for (const character of value) {
    const digit = CrockfordValues.get(character);
    if (digit === undefined) throw new TypeError("trace ULID is not canonical");
    decoded = decoded * 32n + BigInt(digit);
  }
  if (decoded >= 1n << 128n) throw new TypeError("trace ULID exceeds 128 bits");
  return decoded.toString(16).padStart(32, "0");
}

export async function deriveScopedTraceId(input: {
  readonly key: Uint8Array;
  readonly keyVersion: string;
  readonly scope: TraceScope;
  readonly traceUlid: TraceUlid;
}): Promise<string> {
  if (input.key.byteLength < 32) throw new TypeError("trace HMAC key must contain at least 32 bytes");
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(input.keyVersion)) {
    throw new TypeError("trace HMAC key version is invalid");
  }
  if (!input.scope.id || /[\r\n\0]/.test(input.scope.id)) {
    throw new TypeError("trace scope ID is invalid");
  }
  const keyBytes = new Uint8Array(input.key.byteLength);
  keyBytes.set(input.key);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = new TextEncoder().encode(
    `${input.keyVersion}\0${input.scope.kind}\0${input.scope.id}\0${input.traceUlid}`,
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  return bytesToHex(signature.subarray(0, 16));
}

export function shouldSampleTrace(traceId: string, rate: number): boolean {
  if (!/^[0-9a-f]{32}$/.test(traceId)) throw new TypeError("trace ID must be 16 lowercase hex bytes");
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError("trace sample rate must be between 0 and 1");
  }
  if (rate === 0) return false;
  if (rate === 1) return true;
  const bucket = Number.parseInt(traceId.slice(0, 12), 16);
  return bucket / 0x1_0000_0000_0000 < rate;
}

export function createSpanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  if (bytes.every((value) => value === 0)) bytes[7] = 1;
  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}