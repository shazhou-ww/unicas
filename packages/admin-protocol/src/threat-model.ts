/**
 * Frozen threat mitigations for the CAS control plane. Implementations must
 * preserve these invariants; this module is the contract checklist.
 */
export const casAdminThreatModel = {
  oidcAccountLinking: {
    identityKey: "(identityIssuer, subject)",
    emailIsDisplayOnly: true,
    banEmailAsOwnershipKey: true,
  },
  appTakeover: {
    requireMembershipForAppRoutes: true,
    invitationBindsImmutableOidcIdentity: true,
    lastMemberCannotBeDeleted: true,
    managementTransferRequiresAddThenRemove: true,
  },
  issuerJwksSubstitution: {
    registryAuthoritativeInControlDb: true,
    neverFetchTokenSuppliedJwksUrl: true,
    neverAcceptAdministratorSuppliedJwksUrl: true,
    discoveryIssuerMustExactlyMatchRegisteredIssuer: true,
    issuerControlProofUsesDiscoveredJwks: true,
    oauthAudienceDerivedFromAppResource: true,
    oauthMaximumLifetimeIsServerPolicy: true,
    issuerGloballyUnique: true,
    oneActiveIssuerPerApp: true,
  },
  jwksRotation: {
    jwksUriAlwaysFromVerifiedMetadata: true,
    snapshotRefreshedOnScheduleAndUnknownKid: true,
    keysRemovedOnRefreshStopValidatingImmediately: true,
    overlapRequiredForZeroDowntimeRotation: true,
    neverFallBackToLegacyManualKeys: true,
  },
  confusedDeputy: {
    spaceCapabilityNeverAcceptedOnAdminRoutes: true,
    adminSessionNeverAcceptedOnSpaceRoutes: true,
    stripSpaceAuthorizationOnAdminDispatch: true,
    stripAdminSessionOnSpaceDispatch: true,
  },
  webuiCsrfSessionTheft: {
    sessionCookie: "HttpOnly+Secure+SameSite",
    csrfAndOriginChecksRequired: true,
    noLongLivedBearerInBrowser: true,
    noGoogleClientSecretInBrowser: true,
  },
  controlAuditTampering: {
    appendOnlyEvents: true,
    mutationAndAuditSameTransaction: true,
    appMembersCannotRewriteHistory: true,
  },
} as const;
