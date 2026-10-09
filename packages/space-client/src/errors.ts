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