export class CasClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(
    status: number,
    statusText: string,
    operation: string,
    detail?: string,
    code?: string,
  ) {
    super(`CAS ${operation} failed: ${status} ${statusText}${detail ? `: ${detail}` : ""}`);
    this.name = "CasClientError";
    this.status = status;
    this.code = code;
  }
}

export type CasCapabilityErrorCode =
  | "PROVIDER_FAILED"
  | "INVALID_CAPABILITY_METADATA"
  | "UNSATISFIED_CAPABILITY_REQUIREMENT";

export class CasCapabilityError extends Error {
  readonly code: CasCapabilityErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: CasCapabilityErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CasCapabilityError";
    this.code = code;
    this.cause = cause;
  }
}