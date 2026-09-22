export interface ManualTraceEnvironment {
  readonly UNICAS_MANUAL_TRACE_SAMPLE_RATE?: string;
  readonly UNICAS_OTLP_TRACES_ENDPOINT?: string;
  readonly UNICAS_OTLP_AUTHORIZATION?: string;
  readonly UNICAS_TRACE_HMAC_KEYS?: string;
}

export function parseManualTraceSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new TypeError("UNICAS_MANUAL_TRACE_SAMPLE_RATE must be between 0 and 1");
  }
  return parsed;
}

export function parseTraceHmacKeyRing(value: string | undefined): {
  readonly version: string;
  readonly key: Uint8Array;
  readonly keys: ReadonlyMap<string, Uint8Array>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requiredTraceConfig(value, "UNICAS_TRACE_HMAC_KEYS"));
  } catch (error) {
    throw new TypeError("UNICAS_TRACE_HMAC_KEYS must be valid JSON", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("UNICAS_TRACE_HMAC_KEYS must be an object");
  }
  const candidate = parsed as { active?: unknown; keys?: unknown };
  if (
    typeof candidate.active !== "string"
    || !/^[A-Za-z0-9._-]{1,32}$/.test(candidate.active)
    || !candidate.keys
    || typeof candidate.keys !== "object"
    || Array.isArray(candidate.keys)
  ) {
    throw new TypeError("UNICAS_TRACE_HMAC_KEYS must name an active key version");
  }
  const entries = Object.entries(candidate.keys as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 3) {
    throw new TypeError("UNICAS_TRACE_HMAC_KEYS must contain 1-3 key versions");
  }
  const keys = new Map<string, Uint8Array>();
  for (const [version, encoded] of entries) {
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(version) || typeof encoded !== "string") {
      throw new TypeError("UNICAS_TRACE_HMAC_KEYS contains an invalid key version");
    }
    const decoded = decodeBase64Url(encoded);
    if (decoded.byteLength < 32) throw new TypeError("UNICAS_TRACE_HMAC_KEYS contains a short key");
    keys.set(version, decoded);
  }
  const key = keys.get(candidate.active);
  if (!key) throw new TypeError("UNICAS_TRACE_HMAC_KEYS active key is missing");
  return { version: candidate.active, key, keys };
}

export function requiredTraceConfig(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") throw new TypeError(`${name} is required when manual tracing is sampled`);
  return value.trim();
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("trace HMAC key is not base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch (error) {
    throw new TypeError("trace HMAC key is not base64url", { cause: error });
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
