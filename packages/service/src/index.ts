export { PeopleService } from "./people.js";
export type { PeopleRepository, PeopleScope, PeopleEntry } from "./people.js";
export {
  AUTHENTICATION_FLOW_TTL_MS,
  EmailEvidenceError,
  normalizeEmail,
  ProviderRegistry,
  requireInvitationEmailEvidence,
  verifiedProviderEmailEvidence,
} from "./authentication.js";
export type {
  AuthenticatedProviderResult,
  EmailEvidenceErrorCode,
  ProviderAdapter,
  ProviderCallbackInput,
  ProviderFlowContext,
  ProviderFlowPurpose,
  VerifiedEmailEvidence,
} from "./authentication.js";
export {
  EMAIL_CHALLENGE_MAX_ATTEMPTS,
  EMAIL_CHALLENGE_MAX_SENDS,
  EMAIL_CHALLENGE_RESEND_INTERVAL_MS,
  EMAIL_CHALLENGE_TTL_MS,
  EmailChallengeError,
  EmailChallengeService,
} from "./email-challenge.js";
export type {
  EmailChallengeBinding,
  EmailChallengeRecord,
  EmailChallengeRepository,
  EmailChallengeServiceOptions,
  EmailChallengeStart,
} from "./email-challenge.js";
export { AccountService, AccountServiceError, projectAccountSummary } from "./account.js";
export type {
  AccountAppMembershipRecord,
  AccountAppIdempotencyRecord,
  AccountAppInvitationCreateResponse,
  AccountAppInvitationIdempotencyRecord,
  AccountAppInvitationRecord,
  AccountManagedCapabilityIssuer,
  AccountPlatformViewRecord,
  AccountAuditActorRecord,
  AppAccountAuditRecord,
  PlatformAccountAuditRecord,
  AccountCreateInput,
  AccountProfileRecord,
  AccountRecord,
  AccountRepository,
  AccountResolution,
  AccountServiceErrorCode,
  AccountWithIdentityCreate,
  ExternalIdentityRecord,
} from "./account.js";
export { PlatformAccessService, PlatformAccessError } from "./platform-access.js";
export type {
  AppInvitationAdmission,
  AppInvitationAdmissionRecord,
  PlatformAccessRepository,
  PlatformAuditRecord,
} from "./platform-access.js";
export { PlatformInvitationService } from "./platform-invitations.js";
export type {
  PlatformInvitationIdempotencyRecord,
  PlatformInvitationRepository,
  PlatformInvitationSecrets,
  PlatformInvitationServiceOptions,
  StoredPlatformInvitation,
} from "./platform-invitations.js";
export { PlatformAuditService } from "./platform-audit.js";
export type { PlatformAuditRepository } from "./platform-audit.js";
export {
  createUniCasService,
  matchUniCasServiceRoute,
} from "./actor.js";
export type {
  AppAdminRequestContext,
  AdminRequestContext,
  AuthorizedSpaceCall,
  AuthorizedTenantCall,
  HttpActor,
  ServiceContext,
  SpaceRequestContext,
  TenantRequestContext,
  UniCasServiceRoute,
} from "./actor.js";
export type {
  BlobObject,
  BlobRange,
  BlobStore,
  KeyedActorPort,
  ServicePlatform,
  SqlDatabase,
  SqlResult,
  SqlStatement,
} from "./ports.js";
export {
  permissionFor,
  StackCapabilityVerifier,
} from "./tenant-auth.js";
export type {
  JwksFetcher,
  ResolvedStackAuthority,
  StackAuthEvent,
  StackAuthorityResolver,
  StackVerifierOptions,
  VerifiedStackCall,
} from "./tenant-auth.js";
export {
  appSpacePermissionFor,
  AppSpaceCapabilityVerifier,
} from "./app-space-auth.js";
export type {
  AppAuthorityResolver,
  AppSpaceAuthEvent,
  AppSpaceVerifierOptions,
  ResolvedAppAuthority,
  VerifiedAppSpaceCall,
} from "./app-space-auth.js";
export {
  applyRootRefsUpdate,
  canonicalizeRootRefsUpdate,
  CAS_MAX_REQUEST_ID_LENGTH,
  CAS_MAX_ROOT_REF_CHANGES,
  CAS_MAX_ROOT_REF_DELTA,
  parseRootRefsBody,
  RootRefsErrorCodes,
  RootRefsRetryableError,
  RootRefsValidationError,
  withDomainRetry,
} from "./root-refs.js";
export type {
  CanonicalRootRefsUpdate,
  DomainRetryOptions,
  DomainUpdateResult,
  RootRefCommitPlan,
  RootRefDomainState,
  RootRefsErrorCode,
  RootRefNodeState,
  RootRefProjectionChange,
  RootRefRepository,
  RootRefRequestRecord,
  RootRefScope,
} from "./root-refs.js";
export {
  collectExpiredUnreferencedNodes,
  DEFAULT_GC_MAX_NODES,
} from "./gc.js";
export type {
  NodeGcCandidate,
  NodeGcChildReference,
  NodeGcDeletion,
  NodeGcRepository,
  NodeGcScope,
} from "./gc.js";
export { readNodeUsage } from "./node-usage.js";
export type {
  NodeUsageEntry,
  NodeUsageRepository,
  NodeUsageScope,
} from "./node-usage.js";
export { NodeOpError, NodeOpErrorCodes } from "./node-errors.js";
export type { NodeOpErrorCode } from "./node-errors.js";
export {
  parseNodeContentRange,
  readNodeContent,
  readNodeMetadata,
} from "./node-read.js";
export type {
  NodeContentStream,
  NodeReadRecord,
  NodeReadRepository,
  NodeReadScope,
} from "./node-read.js";
export {
  admitCanonicalNodeUploadFinalization,
  beginCanonicalNodeLease,
  clampLeaseDuration,
  DEFAULT_LEASE_MS,
  DEFAULT_UPLOAD_SESSION_MS,
  finalizeCanonicalNodeLease,
  leaseCanonicalNode,
  leaseReadyNode,
  MAX_LEASE_MS,
  MIN_LEASE_MS,
  nextNodeLease,
  parseLeaseDuration,
  prepareCanonicalNodeUpload,
  uploadCanonicalNode,
} from "./node-lease.js";
export type {
  AdoptedCanonicalNodePlan,
  CanonicalDirectUploadFinalizeAdmission,
  CanonicalDirectUploadPrepareResult,
  CanonicalDirectUploadRepository,
  CanonicalDirectUploadSession,
  CanonicalNodeLeaseBeginResult,
  CanonicalNodeLeaseRecord,
  CanonicalNodeLeaseRepository,
  CanonicalNodeUploadPlan,
  CanonicalOrphanObject,
  CanonicalUploadReservation,
  NodeLeaseRecord,
  NodeLeaseRepository,
  NodeLeaseScope,
  ParsedUploadedNodeMetadata,
  UploadedCanonicalNodeCommit,
} from "./node-lease.js";

export { ControlAuditActions } from "./control-audit.js";
export type { ControlAuditAction } from "./control-audit.js";
export { managedAccountOwnerKey, managedIdentityOwnerKey } from "./control-validation.js";
export {
  decodeControlListCursor,
  encodeControlListCursor,
} from "./control-cursor.js";
export type { ControlListCursor } from "./control-cursor.js";
export {
  adminError,
  ControlPlaneError,
  httpStatusForCode,
  toAdminError,
} from "./control-errors.js";
export {
  generateAccountId,
  generateEventId,
  generateExternalIdentityId,
  generateInvitationId,
  generateInvitationToken,
  generateNonce,
  generateOAuthInspectionId,
  generatePrincipalRef,
  generateSessionId,
  generateStackId,
} from "./control-ids.js";
export {
  extractJwsPayload,
  extractJwsProtectedHeader,
  validatePublicJwk,
  verifyCompactJwsProof,
} from "./control-possession.js";
export {
  canonicalJson,
  CONTROL_LIST_DEFAULT_LIMIT,
  CONTROL_LIST_MAX_LIMIT,
  OAUTH_CAPABILITY_MAX_LIFETIME_SECONDS,
  INVITATION_TTL_MS,
  isSupportedKeyAlgorithm,
  LEGACY_DOMAIN,
  normalizeEmailConstraint,
  parseControlListLimit,
  sha256Hex,
  stackOAuthResource,
  STACK_ID_PATTERN,
  SUPPORTED_KEY_ALGORITHMS,
  validateDisplayName,
  validateEmailConstraint,
  validateInvitationToken,
} from "./control-validation.js";
export type { SupportedKeyAlgorithm } from "./control-validation.js";
export {
  buildOAuthIssuerInspectionChallenge,
  canonicalizeOAuthIssuer,
  OAUTH_DISCOVERY_MAX_KEYS,
  OAUTH_ISSUER_INSPECTION_CHALLENGE_VERSION,
  OAUTH_ISSUER_INSPECTION_TTL_MS,
  oauthDiscoveryCandidates,
  parseOAuthIssuerInspectionChallenge,
  parseOAuthJwks,
  parseOAuthMetadata,
} from "./oauth-discovery.js";
export type {
  DiscoveredOAuthJwk,
  DiscoveredOAuthMetadata,
  OAuthDiscoveryCandidate,
  OAuthDiscoveryPort,
  OAuthDiscoveryResult,
  OAuthIssuerInspectionChallengeInput,
  OAuthMetadataType,
} from "./oauth-discovery.js";
export type {
  ControlPlaneCallContext,
  ControlPlaneOperations,
  ControlSessionRepository,
  ServiceMutationInput,
  StoredSession,
} from "./control-plane.js";
export { ControlPlaneAdminService } from "./control-admin.js";
export type {
  ControlActivateOAuthIssuerCommitResult,
  ControlActivateOAuthIssuerPlan,
  ControlAcceptMemberInvitationCommitResult,
  ControlAcceptMemberInvitationPlan,
  ControlAuditRecord,
  ControlCreateMemberInvitationCommitResult,
  ControlCreateMemberInvitationPlan,
  ControlCreateStackCommitResult,
  ControlCreateStackPlan,
  ControlDeleteMemberCommitResult,
  ControlDeleteMemberPlan,
  ControlIdempotencyRecord,
  ControlIdentityPlan,
  ControlIdentityRecord,
  ControlInspectOAuthIssuerCommitResult,
  ControlInspectOAuthIssuerPlan,
  ControlOAuthIssuerRecord,
  ControlOAuthIssuerInspectionRecord,
  ControlMembershipRecord,
  ManagedCapabilityIssuer,
  ManagedOAuthIssuerProvisioner,
  ControlMemberInvitationRecord,
  ControlMemberInvitationResponse,
  ControlPatchStackCommitResult,
  ControlPatchStackPlan,
  ControlPatchManagedIssuerCommitResult,
  ControlPatchManagedIssuerPlan,
  ControlPlaneAdminRepository,
  ControlPlaneAdminServiceOptions,
  ControlStackRecord,
} from "./control-admin.js";