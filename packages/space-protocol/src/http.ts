/** Headers and error response shared by the current Space and frozen v1 contracts. */

export const CasLeaseDurationHeader = "X-CAS-Lease-Duration";
export const CasUploadLengthHeader = "X-CAS-Upload-Length";
export const CasUploadIdHeader = "X-CAS-Upload-Id";

export interface CasErrorResponse {
  readonly error: string;
}
