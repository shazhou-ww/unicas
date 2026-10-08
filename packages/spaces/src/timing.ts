export interface SpacesTimingSink {
  time<T>(name: SpacesTimingName, operation: () => Promise<T>): Promise<T>;
}

export type SpacesTimingName =
  | "spaces_session"
  | "spaces_root"
  | "spaces_manifest"
  | "spaces_unicas";

const DownstreamTimingNames = new Set([
  "cas_schema",
  "cas_auth",
  "cas_do",
  "cas_d1_node",
  "cas_d1_refs",
  "cas_r2_get",
  "cas_do_route",
  "cas_edge",
]);
const MaximumTimingDurationMs = 300_000;

interface TimingEntry {
  durationMs: number;
  count: number;
}

export class SpacesServerTiming implements SpacesTimingSink {
  readonly #entries = new Map<string, TimingEntry>();

  record(name: SpacesTimingName, durationMs: number): void {
    this.#add(name, durationMs);
  }

  async time<T>(name: SpacesTimingName, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.record(name, performance.now() - started);
    }
  }

  absorbDownstream(value: string | null): void {
    if (!value) return;
    for (const part of value.split(",")) {
      const match = /^\s*([a-z0-9_]+);dur=([0-9]+(?:\.[0-9]+)?)(?:;.*)?\s*$/.exec(part);
      if (!match || !DownstreamTimingNames.has(match[1])) continue;
      this.#add(match[1], Number(match[2]));
    }
  }

  headerValue(): string {
    return [...this.#entries].map(([name, entry]) => {
      const count = entry.count === 1 ? "" : `;desc="${entry.count} calls"`;
      return `${name};dur=${entry.durationMs.toFixed(1)}${count}`;
    }).join(", ");
  }

  decorate(response: Response): Response {
    const value = this.headerValue();
    if (!value) return response;
    const headers = new Headers(response.headers);
    headers.set("Server-Timing", value);
    headers.set("Timing-Allow-Origin", "*");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  #add(name: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MaximumTimingDurationMs) return;
    const current = this.#entries.get(name);
    if (current) {
      current.durationMs += durationMs;
      current.count++;
    } else {
      this.#entries.set(name, { durationMs, count: 1 });
    }
  }
}

export function timeSpacesOperation<T>(
  timing: SpacesTimingSink | undefined,
  name: SpacesTimingName,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? timing.time(name, operation) : operation();
}
