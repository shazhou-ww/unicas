import type { ManualTracingPort } from "@unicas/observability";

export interface TimingSink {
  time<T>(name: string, operation: () => Promise<T>): Promise<T>;
}

const D1Operations = new Map<string, { operation: string; result: "read" | "write" }>([
  ["cas_d1_lease", { operation: "lease", result: "read" }],
  ["cas_d1_refs", { operation: "refs", result: "read" }],
  ["cas_d1_ready", { operation: "ready", result: "read" }],
  ["cas_d1_renew", { operation: "renew", result: "write" }],
  ["cas_d1_reserve", { operation: "reserve", result: "write" }],
  ["cas_d1_upload_session", { operation: "upload_session", result: "read" }],
  ["cas_d1_upload_session_reserve", { operation: "upload_session_reserve", result: "write" }],
  ["cas_d1_node_upload", { operation: "node_upload", result: "read" }],
  ["cas_d1_node_upload_count", { operation: "node_upload_count", result: "read" }],
  ["cas_d1_node_upload_replace", { operation: "node_upload_replace", result: "write" }],
  ["cas_d1_node_upload_validate", { operation: "node_upload_validate", result: "write" }],
  ["cas_d1_node_upload_cleanup_ack", { operation: "node_upload_cleanup_ack", result: "write" }],
  ["cas_d1_node_upload_delete", { operation: "node_upload_delete", result: "write" }],
  ["cas_d1_node_upload_cleanup_scan", { operation: "node_upload_cleanup_scan", result: "read" }],
  ["cas_d1_node_upload_cleanup", { operation: "node_upload_cleanup", result: "write" }],
  ["cas_d1_node_upload_cleanup_queue", { operation: "node_upload_cleanup_queue", result: "read" }],
  ["cas_d1_upload_session_delete", { operation: "upload_session_delete", result: "write" }],
  ["cas_d1_commit", { operation: "commit", result: "write" }],
  ["cas_d1_node", { operation: "node", result: "read" }],
]);

const R2Operations = new Map<string, string>([
  ["cas_r2_head", "head"],
  ["cas_r2_read", "read"],
  ["cas_r2_prefix", "prefix"],
  ["cas_r2_upload_head", "upload_head"],
  ["cas_r2_upload_read", "upload_read"],
  ["cas_r2_upload_delete", "upload_delete"],
  ["cas_r2_put", "put"],
  ["cas_r2_get", "get"],
]);

interface TimingEntry {
  durationMs: number;
  count: number;
}

/** Per-request Server-Timing collector. Repeated operations are aggregated. */
export class ServerTiming implements TimingSink {
  readonly #entries = new Map<string, TimingEntry>();

  record(name: string, durationMs: number): void {
    const current = this.#entries.get(name);
    if (current) {
      current.durationMs += durationMs;
      current.count++;
    } else {
      this.#entries.set(name, { durationMs, count: 1 });
    }
  }

  async time<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.record(name, performance.now() - started);
    }
  }

  headerValue(): string {
    return [...this.#entries].map(([name, entry]) => {
      const count = entry.count === 1 ? "" : `;desc=\"${entry.count} calls\"`;
      return `${name};dur=${entry.durationMs.toFixed(1)}${count}`;
    }).join(", ");
  }

  decorate(response: Response): Response {
    const headers = new Headers(response.headers);
    const value = this.headerValue();
    if (value) {
      const existing = headers.get("Server-Timing");
      headers.set("Server-Timing", existing ? `${existing}, ${value}` : value);
      headers.set("Timing-Allow-Origin", "*");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export function timeOperation<T>(
  timing: TimingSink | undefined,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? timing.time(name, operation) : operation();
}

export function withStorageTracing(timing: TimingSink, tracing: ManualTracingPort): TimingSink {
  return {
    time<T>(name: string, operation: () => Promise<T>): Promise<T> {
      const d1 = D1Operations.get(name);
      const r2 = R2Operations.get(name);
      if (!d1 && !r2) return timing.time(name, operation);
      return timing.time(name, () => tracing.enterSpan(d1 ? "unicas.d1" : "unicas.r2", async (span) => {
        span.setAttribute("unicas.operation", d1?.operation ?? r2);
        try {
          const result = await operation();
          span.setAttribute("unicas.outcome", "ok");
          if (d1?.result === "read") span.setAttribute("unicas.rows.read", readCount(result));
          if (d1?.result === "write") span.setAttribute("unicas.rows.written", writeCount(result));
          return result;
        } catch (error) {
          span.setAttribute("unicas.outcome", "failed");
          throw error;
        }
      }));
    },
  };
}

function readCount(value: unknown): number | undefined {
  if (value === null) return 0;
  if (hasResults(value)) return value.results.length;
  return typeof value === "object" && value !== null ? 1 : undefined;
}

function writeCount(value: unknown): number | undefined {
  const results = Array.isArray(value) ? value : [value];
  let changes = 0;
  let found = false;
  for (const result of results) {
    if (!hasChanges(result)) continue;
    changes += result.meta.changes;
    found = true;
  }
  return found && Number.isSafeInteger(changes) && changes >= 0 ? changes : undefined;
}

function hasResults(value: unknown): value is { readonly results: readonly unknown[] } {
  return typeof value === "object"
    && value !== null
    && "results" in value
    && Array.isArray(value.results);
}

function hasChanges(value: unknown): value is { readonly meta: { readonly changes: number } } {
  if (typeof value !== "object" || value === null || !("meta" in value)) return false;
  const meta = value.meta;
  return typeof meta === "object"
    && meta !== null
    && "changes" in meta
    && Number.isSafeInteger(meta.changes)
    && (meta.changes as number) >= 0;
}