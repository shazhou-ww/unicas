/**
 * Canonical stack-scoped CAS tenant HTTP contracts.
 *
 * Every tenant service route carries `stackId + tenantId`; the tenant
 * matcher never recognizes `/admin` (that plane belongs to
 * `@unicas/admin-protocol`). The retired owner-assignment and
 * portable-node and pre-stack HTTP contracts are removed.
 */

export const CasLeaseDurationHeader = "X-CAS-Lease-Duration";
export const CasUploadLengthHeader = "X-CAS-Upload-Length";
export const CasUploadIdHeader = "X-CAS-Upload-Id";

export interface CasErrorResponse {
  readonly error: string;
}
