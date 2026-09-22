/**
 * Authorization-plane separation for administrator and data-plane credentials.
 * Runtime enforcement lives in the service and platform adapter; this module
 * is the contract those implementations and presentation clients must satisfy.
 */


/** Credential classes accepted by each authentication plane. */
export const casAuthPlanePolicy = {
  spaceDataPlane: {
    pathPrefix: "/v1/apps",
    credential: "app_issuer_space_capability",
    rejects: ["oidc_bff_session", "platform_operator_session"] as const,
  },
  appAdminPlane: {
    pathPrefix: "/admin",
    credential: "google_oidc_bff_session",
    rejects: ["app_issuer_space_capability"] as const,
  },
  platformOperatorPlane: {
    pathPrefix: null,
    credential: "cas_platform_operator",
    rejects: [
      "app_issuer_space_capability",
      "app_membership_alone",
    ] as const,
  },
} as const;
