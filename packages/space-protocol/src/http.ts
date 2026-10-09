/** Error response shared by Space data-plane operations. */

export interface CasErrorResponse {
  readonly error: string;
  readonly message?: string;
}

export const CasNodeRefsHeader = "X-CAS-Refs";

const CasHashPattern = /^[0-9a-f]{64}$/;
const MaximumNodeRefs = 256;

export function formatCasNodeRefsHeader(refs: readonly string[]): string {
  if (refs.length > MaximumNodeRefs || refs.some((ref) => !CasHashPattern.test(ref))) {
    throw new TypeError("CAS node refs are invalid");
  }
  return refs.join(",");
}

export function parseCasNodeRefsHeader(value: string | null): readonly string[] {
  if (value === null) throw new TypeError(`${CasNodeRefsHeader} is required`);
  if (value === "") return [];
  const refs = value.split(",");
  if (refs.length > MaximumNodeRefs || refs.some((ref) => !CasHashPattern.test(ref))) {
    throw new TypeError(`${CasNodeRefsHeader} is invalid`);
  }
  return refs;
}
