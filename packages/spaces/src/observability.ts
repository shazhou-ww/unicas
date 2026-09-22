export type SpacesEvent =
  | {
    readonly event: "spaces_request_failed";
    readonly code: string;
    readonly status: number;
  }
  | {
    readonly event: "spaces_root_release_reconciliation_failed";
    readonly code: "root_release_pending";
  }
  | {
    readonly event: "spaces_smoke_cleanup_failed";
    readonly stage: "cleanup";
    readonly code: "cleanup_failed";
  };

export function logSpacesEvent(
  event: SpacesEvent,
  write: (message: string) => void = console.error,
): void {
  write(JSON.stringify(event));
}

export interface TraceSpan {
  readonly isTraced: boolean;
  setAttribute(key: string, value?: boolean | number | string): void;
}

export interface TracingPort {
  enterSpan<T>(name: string, callback: (span: TraceSpan) => T): T;
}

export function traceCleanupRun<T extends { readonly examined: number; readonly failed: number }>(
  tracing: TracingPort | undefined,
  cleanup: () => Promise<T>,
): Promise<T> {
  if (!tracing) return cleanup();
  return tracing.enterSpan("unicas.cleanup.run", async (span) => {
    try {
      const result = await cleanup();
      if (span.isTraced) {
        span.setAttribute("unicas.cleanup.examined", result.examined);
        span.setAttribute("unicas.cleanup.failed", result.failed);
        span.setAttribute("unicas.outcome", "ok");
      }
      return result;
    } catch (error) {
      if (span.isTraced) span.setAttribute("unicas.outcome", "failed");
      throw error;
    }
  });
}