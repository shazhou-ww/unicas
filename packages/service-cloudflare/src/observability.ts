import { CapabilityError, type AppSpaceRoute } from "@unicas/space-protocol";

export type UnexpectedErrorEvent =
  | { readonly event: "unicas_authorization_failed"; readonly plane: "space" }
  | { readonly event: "unicas_service_actor_failed" }
  | { readonly event: "unicas_admin_request_failed" }
  | { readonly event: "unicas_app_usage_read_failed" }
  | { readonly event: "unicas_space_operation_failed" }
  | { readonly event: "unicas_r2_canonical_upload_failed" };

export function logUnexpectedError(
  event: UnexpectedErrorEvent,
  error: unknown,
  write: (message: string) => void = console.error,
): void {
  void error;
  write(JSON.stringify(event));
}

export interface TraceSpan {
  readonly isTraced: boolean;
  setAttribute(key: string, value?: boolean | number | string): void;
}

export interface TracingPort {
  enterSpan<T>(name: string, callback: (span: TraceSpan) => T): T;
}

export interface NodeValidationResult {
  readonly ok: boolean;
  readonly validation?: {
    readonly storedBytes: number;
    readonly refs: readonly unknown[];
  };
}

export interface CleanupSpanCounts {
  readonly examined?: number;
  readonly deleted?: number;
  readonly failed?: number;
}

export function traceCapabilityVerification<T>(
  tracing: TracingPort | undefined,
  operation: AppSpaceRoute["operation"],
  verify: () => Promise<T>,
): Promise<T> {
  return traceOperation(
    tracing,
    "unicas.capability.verify",
    verify,
    () => ({ "unicas.operation": operation }),
    (error) => error instanceof CapabilityError ? "rejected" : "failed",
  );
}

export function traceNodeValidation<T extends NodeValidationResult>(
  tracing: TracingPort | undefined,
  validate: () => Promise<T>,
): Promise<T> {
  return traceOperation(
    tracing,
    "unicas.node.validate",
    validate,
    (result): SpanAttributes => result.ok && result.validation
      ? {
        "unicas.node.bytes": result.validation.storedBytes,
        "unicas.node.refs": result.validation.refs.length,
      }
      : {},
    () => "failed",
    (result) => result.ok ? "ok" : "rejected",
  );
}

export function traceRootRefCommit<T>(
  tracing: TracingPort | undefined,
  mutationCount: number,
  commit: () => Promise<T>,
): Promise<T> {
  return traceOperation(
    tracing,
    "unicas.root_refs.commit",
    commit,
    () => ({ "unicas.root_refs.mutations": mutationCount }),
    () => "failed",
  );
}

export function traceCleanupRun<T extends CleanupSpanCounts>(
  tracing: TracingPort | undefined,
  cleanup: () => Promise<T>,
): Promise<T> {
  return traceOperation(
    tracing,
    "unicas.cleanup.run",
    cleanup,
    (result): SpanAttributes => ({
      ...(result.examined === undefined ? {} : { "unicas.cleanup.examined": result.examined }),
      ...(result.deleted === undefined ? {} : { "unicas.cleanup.deleted": result.deleted }),
      ...(result.failed === undefined ? {} : { "unicas.cleanup.failed": result.failed }),
    }),
    () => "failed",
  );
}

type SpanOutcome = "ok" | "rejected" | "failed";
type SpanAttributes = Readonly<Record<string, boolean | number | string>>;

async function traceOperation<T>(
  tracing: TracingPort | undefined,
  name: string,
  operation: () => Promise<T>,
  attributes: (result: T) => SpanAttributes,
  errorOutcome: (error: unknown) => SpanOutcome,
  resultOutcome: (result: T) => SpanOutcome = () => "ok",
): Promise<T> {
  if (!tracing) return operation();
  return tracing.enterSpan(name, async (span) => {
    try {
      const result = await operation();
      setTracedAttributes(span, {
        ...attributes(result),
        "unicas.outcome": resultOutcome(result),
      });
      return result;
    } catch (error) {
      setTracedAttributes(span, { "unicas.outcome": errorOutcome(error) });
      throw error;
    }
  });
}

function setTracedAttributes(span: TraceSpan, attributes: SpanAttributes): void {
  if (!span.isTraced) return;
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }
}