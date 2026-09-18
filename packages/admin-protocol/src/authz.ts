/**
 * Authorization-plane separation for administrator and tenant credentials.
 * Runtime enforcement lives in the service and platform adapter; this module
 * is the contract those implementations and presentation clients must satisfy.
 */


/** Credential classes accepted by each authentication plane. */
export const casAuthPlanePolicy = {
  tenantDataPlane: {
    pathPrefix: "/stacks",
    credential: "stack_issuer_jwt_capability",
    rejects: ["oidc_bff_session", "platform_operator_session"] as const,
  },
  appAdminPlane: {
    pathPrefix: "/admin",
    credential: "google_oidc_bff_session",
    rejects: ["stack_issuer_jwt_capability"] as const,
  },
  platformOperatorPlane: {
    pathPrefix: null,
    credential: "cas_platform_operator",
    rejects: ["stack_issuer_jwt_capability", "stack_membership_alone"] as const,
  },
} as const;
