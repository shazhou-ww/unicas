import type {
  App,
  AppMemberInvitation,
  CasAdminPageQuery,
  CasAdminAcceptMemberInvitationRequest,
  CasAdminAcceptMemberInvitationResponse,
  CasAdminActivateOAuthIssuerRequest,
  CasAdminActivateOAuthIssuerResponse,
  CasAdminCreateMemberInvitationRequest,
  CasAdminCreateMemberInvitationResponse,
  CasAdminCreateStackRequest,
  CasAdminCreateStackResponse,
  CasAdminCreatePlaygroundFileRootRequest,
  CasAdminCreatePlaygroundFileRootResponse,
  CasAdminDeletePlaygroundFileRootRequest,
  CasAdminDeletePlaygroundFileRootResponse,
  CasAdminDeleteMemberRequest,
  CasAdminDeleteMemberResponse,
  CasAdminErrorResponse,
  CasAdminGetOAuthIssuerRequest,
  CasAdminGetOAuthIssuerResponse,
  CasAdminGetManagedIssuerRequest,
  CasAdminGetManagedIssuerResponse,
  CasAdminMintManagedCapabilityRequest,
  CasAdminMintManagedCapabilityResponse,
  CasAdminInspectOAuthIssuerRequest,
  CasAdminInspectOAuthIssuerResponse,
  CasAdminGetStackRequest,
  CasAdminGetStackResponse,
  CasAdminListControlAuditEventsRequest,
  CasAdminListControlAuditEventsResponse,
  CasAdminListMembersRequest,
  CasAdminListMembersResponse,
  CasAdminListPlaygroundFileRootsRequest,
  CasAdminListPlaygroundFileRootsResponse,
  CasAdminListStacksRequest,
  CasAdminListStacksResponse,
  CasAdminMeResponse,
  CasAdminPatchStackRequest,
  CasAdminPatchStackResponse,
  CasAdminPatchPlaygroundFileRootRequest,
  CasAdminPatchPlaygroundFileRootResponse,
  CasAdminPatchManagedIssuerRequest,
  CasAdminPatchManagedIssuerResponse,
  CasOperatorIdentityKey,
  AppOAuthIssuerInspection,
  ManagedSpaceCapability,
} from "@unicas/admin-protocol";
import type { ControlAuditAction } from "./control-audit.js";
import type { VerifiedEmailEvidence } from "./authentication.js";

/** Authenticated caller context supplied by an ingress after session checks. */
export interface ControlPlaneCallContext {
  readonly identity: CasOperatorIdentityKey;
  readonly account?: {
    readonly accountId: string;
    readonly externalIdentityId: string;
    readonly credentialVersion: number;
  };
  readonly verifiedEmailEvidence?: readonly VerifiedEmailEvidence[];
  /** Display metadata from the verified identity profile (email is display-only). */
  readonly profile?: {
    readonly displayName: string | null;
    readonly emailForDisplay: string | null;
  };
  readonly requestId?: string;
  readonly traceId?: string;
  readonly caller?: {
    readonly channel: "admin-webui" | "mcp";
    readonly oauthClientHandle?: string;
    readonly toolName?: string;
  };
}

/** Service-level mutation input: raw precondition headers, parsed by the service. */
export interface ServiceMutationInput {
  readonly ifNoneMatch?: string;
  /** Raw `If-Match` header value; absent means "no precondition". */
  readonly ifMatch?: string;
  /** Raw `Idempotency-Key` header value for creation endpoints. */
  readonly idempotencyKey?: string;
}

/** Cloud-neutral control-plane operations consumed by admin presentation layers. */
export interface ControlPlaneOperations {
  inspectAppOAuthIssuer(ctx: ControlPlaneCallContext, appId: string, issuer: string): Promise<AppOAuthIssuerInspection | CasAdminErrorResponse>;
  activateAppOAuthIssuer(
    ctx: ControlPlaneCallContext, appId: string,
    body: { readonly inspectionId: string; readonly activationProof: string }, mutation: ServiceMutationInput,
  ): Promise<{ readonly revision: number } | CasAdminErrorResponse>;
  me(ctx: ControlPlaneCallContext): Promise<CasAdminMeResponse | CasAdminErrorResponse>;
  listStacks(ctx: ControlPlaneCallContext, request: CasAdminListStacksRequest): Promise<CasAdminListStacksResponse>;
  createStack(
    ctx: ControlPlaneCallContext,
    request: Omit<CasAdminCreateStackRequest, "headers">,
    mutation?: ServiceMutationInput,
  ): Promise<CasAdminCreateStackResponse>;
  getStack(ctx: ControlPlaneCallContext, request: CasAdminGetStackRequest): Promise<CasAdminGetStackResponse>;
  patchStack(
    ctx: ControlPlaneCallContext,
    request: Omit<CasAdminPatchStackRequest, "headers">,
    mutation: ServiceMutationInput,
  ): Promise<CasAdminPatchStackResponse>;
  patchApp(
    ctx: ControlPlaneCallContext,
    appId: string,
    patch: Readonly<Partial<Pick<App, "displayName" | "description" | "status">>>,
    mutation: ServiceMutationInput,
  ): Promise<{ readonly revision: number } | CasAdminErrorResponse>;
  listMembers(ctx: ControlPlaneCallContext, request: CasAdminListMembersRequest): Promise<CasAdminListMembersResponse>;
  listPlaygroundFileRoots(ctx: ControlPlaneCallContext, request: CasAdminListPlaygroundFileRootsRequest): Promise<CasAdminListPlaygroundFileRootsResponse>;
  createPlaygroundFileRoot(ctx: ControlPlaneCallContext, request: CasAdminCreatePlaygroundFileRootRequest): Promise<CasAdminCreatePlaygroundFileRootResponse>;
  patchPlaygroundFileRoot(
    ctx: ControlPlaneCallContext,
    request: Omit<CasAdminPatchPlaygroundFileRootRequest, "headers">,
    mutation: ServiceMutationInput,
  ): Promise<CasAdminPatchPlaygroundFileRootResponse>;
  deletePlaygroundFileRoot(
    ctx: ControlPlaneCallContext,
    request: Omit<CasAdminDeletePlaygroundFileRootRequest, "headers">,
    mutation: ServiceMutationInput,
  ): Promise<CasAdminDeletePlaygroundFileRootResponse>;
  deleteMember(
    ctx: ControlPlaneCallContext,
    request: Omit<CasAdminDeleteMemberRequest, "headers">,
    mutation: ServiceMutationInput,
  ): Promise<CasAdminDeleteMemberResponse>;
  createMemberInvitation(
    ctx: ControlPlaneCallContext,
    request: Omit<CasAdminCreateMemberInvitationRequest, "headers">,
    mutation?: ServiceMutationInput,
  ): Promise<CasAdminCreateMemberInvitationResponse>;
  listAppMemberInvitations(
    ctx: ControlPlaneCallContext,
    appId: string,
    query: CasAdminPageQuery & { readonly status?: AppMemberInvitation["status"] },
  ): Promise<{ readonly items: readonly AppMemberInvitation[]; readonly nextCursor: string | null } | CasAdminErrorResponse>;
  revokeAppMemberInvitation(
    ctx: ControlPlaneCallContext,
    appId: string,
    invitationId: string,
    mutation: ServiceMutationInput,
  ): Promise<{ readonly revision: number } | CasAdminErrorResponse | { readonly error: "INVITATION_NOT_PENDING" }>;
  acceptMemberInvitation(
    ctx: ControlPlaneCallContext,
    request: CasAdminAcceptMemberInvitationRequest,
  ): Promise<CasAdminAcceptMemberInvitationResponse>;
  getOAuthIssuer(
    ctx: ControlPlaneCallContext,
    request: CasAdminGetOAuthIssuerRequest,
  ): Promise<CasAdminGetOAuthIssuerResponse>;
  getManagedOAuthIssuer(
    ctx: ControlPlaneCallContext,
    request: CasAdminGetManagedIssuerRequest,
  ): Promise<CasAdminGetManagedIssuerResponse>;
  patchManagedOAuthIssuer(
    ctx: ControlPlaneCallContext,
    request: Omit<CasAdminPatchManagedIssuerRequest, "headers">,
    mutation: ServiceMutationInput,
  ): Promise<CasAdminPatchManagedIssuerResponse>;
  mintManagedCapability(
    ctx: ControlPlaneCallContext,
    request: CasAdminMintManagedCapabilityRequest,
  ): Promise<CasAdminMintManagedCapabilityResponse>;
  mintManagedSpaceCapability(
    ctx: ControlPlaneCallContext,
    appId: string,
  ): Promise<ManagedSpaceCapability | CasAdminErrorResponse | { readonly error: "APP_SUSPENDED"; readonly message: string }>;
  inspectOAuthIssuer(
    ctx: ControlPlaneCallContext,
    request: CasAdminInspectOAuthIssuerRequest,
  ): Promise<CasAdminInspectOAuthIssuerResponse>;
  activateOAuthIssuer(
    ctx: ControlPlaneCallContext,
    request: Omit<CasAdminActivateOAuthIssuerRequest, "headers">,
    mutation: ServiceMutationInput,
  ): Promise<CasAdminActivateOAuthIssuerResponse>;
  listControlAuditEvents(
    ctx: ControlPlaneCallContext,
    request: CasAdminListControlAuditEventsRequest,
  ): Promise<CasAdminListControlAuditEventsResponse>;
  recordSessionAudit(
    ctx: ControlPlaneCallContext,
    action: ControlAuditAction,
    target: string,
    stackId?: string | null,
  ): Promise<void>;
}

/** Opaque encrypted browser session persisted by a platform adapter. */
export interface StoredSession {
  readonly sessionId: string;
  readonly encryptedPayload: string;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

/** Cloud-neutral persistence port for BFF login and authenticated sessions. */
export interface ControlSessionRepository {
  create(sessionId: string, encryptedPayload: string, ttlMs: number, account?: {
    readonly accountId: string;
    readonly externalIdentityId: string;
    readonly credentialVersion: number;
  }): Promise<void>;
  read(sessionId: string): Promise<StoredSession | null>;
  touch(sessionId: string, ttlMs: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
  pruneExpired(): Promise<number>;
  rotateLegacy?(input: {
    readonly previousSessionId: string;
    readonly previousEncryptedPayload: string;
    readonly sessionId: string;
    readonly encryptedPayload: string;
    readonly accountId: string;
    readonly externalIdentityId: string;
    readonly credentialVersion: number;
  }): Promise<boolean>;
}
