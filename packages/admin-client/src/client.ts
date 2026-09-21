/**
 * `createAdminClient` — typed HTTP transport for the `/admin` control-plane
 * API (the BFF surface). One plain function per operation, paths built from
 * `appAdminRoutes` and request/response types from `@unicas/admin-protocol`.
 *
 * The session provider yields the BFF session cookie + CSRF token; mutations
 * send `If-Match` (ETag preconditions) and `Idempotency-Key` where the
 * contract allows. Non-2xx responses surface as `AdminClientError`.
 */

import {
  appAdminRoutes,
  AppAdminMeResponseSchema,
  AppUsageSchema,
  CasAdminETagHeader,
  CasAdminIdempotencyKeyHeader,
  CasAdminIfMatchHeader,
  CasAdminErrorCodes,
} from "@unicas/admin-protocol";
import type {
  CasAdminCreateHeaders,
  AppPeopleQuery,
  PlatformPeopleQuery,
  AppPerson,
  PlatformPerson,
  PeoplePage,
  CasAdminMutationPreconditions,
  CasAdminPage,
  CasAdminPageQuery,
} from "@unicas/admin-protocol";
import type {
  AccountSelf,
  AccountId,
  App,
  AppAdminMeResponse,
  AppControlAuditEvent,
  AppId,
  AppMemberInvitation,
  AppMembership,
  AppOAuthIssuer,
  AppOAuthIssuerInspection,
  AppRefDomain,
  AppUsage,
  PlatformAccountDetail,
  PlatformAccountPage,
  PlatformAuditAction,
  PlatformAccountAuditPage,
  PlatformAuthority,
  PlatformInvitation,
  PlatformInvitationPage,
  SpaceRootRefBalance,
  SpaceRootRefEvent,
} from "@unicas/admin-protocol";
import { AdminClientError } from "./errors.js";
import type {
  AdminClientConfig,
  AdminClientRead,
  AdminClientSession,
  AdminHttpFetcher,
} from "./types.js";

export interface AdminClient {
  listAppPeople(path: { readonly appId: AppId }, query?: AppPeopleQuery): Promise<PeoplePage<AppPerson>>;
  listPlatformPeople(query?: PlatformPeopleQuery): Promise<PeoplePage<PlatformPerson>>;
  getCurrentAdministrator(): Promise<AppAdminMeResponse>;
  getCurrentAccount(): Promise<AccountSelf>;
  listCurrentAccountIdentities(): Promise<AccountSelf["identities"]>;
  patchCurrentAccountProfile(body: {
    readonly displayName?: string | null;
    readonly avatarExternalIdentityId?: string | null;
  }): Promise<void>;
  listApps(query?: CasAdminPageQuery): Promise<CasAdminPage<App>>;
  createApp(
    body: { readonly displayName: string },
    headers?: CasAdminCreateHeaders,
  ): Promise<AdminClientRead<{ readonly appId: AppId }>>;
  getApp(path: { readonly appId: AppId }): Promise<AdminClientRead<App>>;
  getAppUsage(path: { readonly appId: AppId }): Promise<AppUsage>;
  patchApp(
    path: { readonly appId: AppId },
    body: { readonly displayName?: string; readonly description?: string; readonly status?: App["status"] },
    ifMatch: string,
  ): Promise<{ readonly etag: string }>;
  listAppMembers(
    path: { readonly appId: AppId },
    query?: CasAdminPageQuery,
  ): Promise<CasAdminPage<AppMembership>>;
  deleteAppMember(
    path: { readonly appId: AppId; readonly accountId: AccountId },
  ): Promise<{ readonly ok: true }>;
  createAppMemberInvitation(
    path: { readonly appId: AppId },
    body?: { readonly emailConstraint?: string },
    headers?: CasAdminCreateHeaders,
  ): Promise<{ readonly invitationId: string; readonly acceptUrl: string; readonly expiresAt: number; readonly etag: string }>;
  acceptAppMemberInvitation(path: { readonly token: string }): Promise<{ readonly appId: AppId }>;
  listAppMemberInvitations(
    path: { readonly appId: AppId },
    query?: CasAdminPageQuery & { readonly status?: AppMemberInvitation["status"] },
  ): Promise<CasAdminPage<AppMemberInvitation>>;
  revokeAppMemberInvitation(
    path: { readonly appId: AppId; readonly invitationId: string },
    ifMatch: string,
  ): Promise<{ readonly etag: string }>;
  listPlatformAccounts(query?: {
    readonly query?: string;
    readonly effectiveAccess?: "active" | "blocked" | "no_access";
    readonly authority?: PlatformAuthority | "none";
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<PlatformAccountPage>;
  getPlatformAccount(path: { readonly accountId: AccountId }): Promise<PlatformAccountDetail>;
  grantPlatformAccountAuthority(path: { readonly accountId: AccountId; readonly authority: PlatformAuthority }): Promise<void>;
  revokePlatformAccountAuthority(path: { readonly accountId: AccountId; readonly authority: PlatformAuthority }): Promise<void>;
  blockPlatformAccount(path: { readonly accountId: AccountId }): Promise<void>;
  restorePlatformAccount(path: { readonly accountId: AccountId }): Promise<void>;
  listPlatformInvitations(query?: {
    readonly query?: string;
    readonly status?: PlatformInvitation["status"];
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<PlatformInvitationPage>;
  createPlatformInvitation(
    body: { readonly emailConstraint: string; readonly authorities: readonly PlatformAuthority[] },
    idempotencyKey: string,
  ): Promise<{ readonly invitationId: string; readonly acceptUrl: string; readonly expiresAt: number; readonly etag: string }>;
  revokePlatformInvitation(path: { readonly invitationId: string }, ifMatch: string): Promise<{ readonly etag: string }>;
  acceptPlatformInvitation(path: { readonly token: string }): Promise<void>;
  listPlatformAuditEvents(query?: {
    readonly action?: PlatformAuditAction;
    readonly actorAccountId?: AccountId;
    readonly targetAccountId?: AccountId;
    readonly createdAfter?: number;
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<PlatformAccountAuditPage>;
  getAppOAuthIssuer(
    path: { readonly appId: AppId },
    query?: { readonly optional?: boolean },
  ): Promise<AdminClientRead<AppOAuthIssuer | null>>;
  inspectAppOAuthIssuer(
    path: { readonly appId: AppId },
    body: { readonly issuer: string },
  ): Promise<AppOAuthIssuerInspection>;
  activateAppOAuthIssuer(
    path: { readonly appId: AppId },
    body: { readonly inspectionId: string; readonly activationProof: string },
    precondition: string | { readonly ifNoneMatch: "*" },
  ): Promise<{ readonly etag: string }>;
  listAppRefDomains(path: { readonly appId: AppId }): Promise<{ readonly domains: readonly AppRefDomain[] }>;
  listAppControlAuditEvents(
    path: { readonly appId: AppId },
    query?: CasAdminPageQuery & {
      readonly after?: string;
      readonly actorAccountId?: AccountId;
      readonly targetAccountId?: AccountId;
    },
  ): Promise<CasAdminPage<AppControlAuditEvent>>;
  listSpaceRootDomainRefs(
    path: { readonly appId: AppId; readonly refDomain: string },
    query?: { readonly spaceId?: string; readonly limit?: number; readonly cursor?: string },
  ): Promise<{ readonly revision: number; readonly refs: readonly SpaceRootRefBalance[]; readonly nextCursor: string | null }>;
  listSpaceRootDomainEvents(
    path: { readonly appId: AppId; readonly refDomain: string },
    query?: { readonly spaceId?: string; readonly after?: number; readonly limit?: number },
  ): Promise<{ readonly events: readonly SpaceRootRefEvent[]; readonly latestRevision: number; readonly nextAfter: number }>;
}

export function createAdminClient(config: AdminClientConfig): AdminClient {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const baseOrigin = new URL(baseUrl).origin;
  const fetcher: AdminHttpFetcher = config.fetcher ?? globalThis.fetch.bind(globalThis);

  let session: AdminClientSession | null = null;
  const sessionProvider = async (): Promise<AdminClientSession> => {
    if (session === null) session = await config.getSession();
    return session;
  };

  const request = async (route: string, init: RequestInit = {}): Promise<Response> => {
    const current = await sessionProvider();
    const headers = new Headers(init.headers);
    headers.set("Cookie", current.cookie);
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      headers.set("Origin", baseOrigin);
      headers.set("X-CSRF-Token", current.csrfToken);
    }
    const response = await fetcher(`${baseUrl}${route}`, { ...init, headers });
    const csrfToken = response.headers.get("X-CSRF-Token");
    const cookieName = current.cookie.split("=", 1)[0]?.trim();
    const replacement = response.headers.getSetCookie()
      .map(value => value.split(";", 1)[0]!.trim())
      .find(value => cookieName && value.startsWith(`${cookieName}=`));
    if (replacement && csrfToken) {
      const next = { cookie: replacement, csrfToken };
      await config.onSessionChanged?.(next);
      session = next;
    }
    if (response.status === 401) {
      // The session expired or the operator was removed; force re-login.
      session = null;
    }
    return response;
  };

  const requireOk = async (response: Response, operation: string): Promise<Response> => {
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null) as { error?: unknown; message?: unknown } | null;
      const code = typeof body?.error === "string" ? body.error : String(response.status);
      const message = typeof body?.message === "string" ? body.message : undefined;
      throw new AdminClientError(response.status, code, message);
    }
    return response;
  };

  const readEtag = (response: Response): string => {
    const etag = response.headers.get(CasAdminETagHeader) ?? "";
    const weakenedRevision = /^W\/("(?:0|[1-9][0-9]*)")$/.exec(etag);
    return weakenedRevision?.[1] ?? etag;
  };
  const queryString = (query: object | undefined): string => {
    if (query === undefined) return "";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    }
    const encoded = params.toString();
    return encoded.length === 0 ? "" : `?${encoded}`;
  };
  const pageQuery = (query: CasAdminPageQuery | undefined): Record<string, unknown> => {
    if (query === undefined) return {};
    return {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    };
  };
  const mutationHeaders = (
    headers: CasAdminCreateHeaders | undefined,
  ): Record<string, string> => {
    if (headers?.idempotencyKey === undefined) return {};
    return { [CasAdminIdempotencyKeyHeader]: headers.idempotencyKey };
  };
  const ifMatchHeader = (ifMatch: string): Record<string, string> => ({ [CasAdminIfMatchHeader]: ifMatch });

  return {
    async getCurrentAdministrator() {
      const response = await requireOk(
        await request(appAdminRoutes.me()),
        "getCurrentAdministrator",
      );
      const body: unknown = await response.json();
      const parsed = AppAdminMeResponseSchema.safeParse(body);
      if (!parsed.success) throw new AdminClientError(502, "ADMIN_CONTRACT_MISMATCH", "Account administrator response was not returned");
      return parsed.data;
    },

    async getCurrentAccount() {
      const response = await requireOk(
        await request(appAdminRoutes.account()),
        "getCurrentAccount",
      );
      return await response.json() as AccountSelf;
    },

    async listCurrentAccountIdentities() {
      const response = await requireOk(
        await request(appAdminRoutes.accountIdentities()),
        "listCurrentAccountIdentities",
      );
      const body = await response.json() as { readonly identities: AccountSelf["identities"] };
      return body.identities;
    },

    async patchCurrentAccountProfile(body) {
      await requireOk(await request(appAdminRoutes.accountProfile(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }), "patchCurrentAccountProfile");
    },

    async listApps(query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.apps()}${queryString(pageQuery(query))}`),
        "listApps",
      );
      return response.json();
    },

    async createApp(body, headers) {
      const response = await requireOk(
        await request(appAdminRoutes.apps(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...mutationHeaders(headers),
          },
          body: JSON.stringify(body),
        }),
        "createApp",
      );
      return { value: await response.json(), etag: readEtag(response) };
    },

    async getApp(path) {
      const response = await requireOk(await request(appAdminRoutes.app(path)), "getApp");
      return { value: await response.json(), etag: readEtag(response) };
    },

    async getAppUsage(path) {
      const response = await requireOk(await request(appAdminRoutes.usage(path)), "getAppUsage");
      const body: unknown = await response.json();
      const parsed = AppUsageSchema.safeParse(body);
      if (!parsed.success) {
        throw new AdminClientError(502, "ADMIN_CONTRACT_MISMATCH", "App usage response was invalid");
      }
      return parsed.data;
    },

    async patchApp(path, body, ifMatch) {
      const response = await requireOk(
        await request(appAdminRoutes.app(path), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...ifMatchHeader(ifMatch) },
          body: JSON.stringify(body),
        }),
        "patchApp",
      );
      return { etag: readEtag(response) };
    },

    async listAppMemberInvitations(path, query) {
      const response = await requireOk(await request(`${appAdminRoutes.memberInvitations(path)}${queryString(query)}`), "listAppMemberInvitations");
      return response.json();
    },

    async listAppPeople(path, query) {
      const response = await requireOk(await request(`${appAdminRoutes.people(path)}${queryString(query)}`), "listAppPeople");
      return response.json();
    },

    async listPlatformPeople(query) {
      const response = await requireOk(await request(`${appAdminRoutes.platformPeople()}${queryString(query)}`), "listPlatformPeople");
      return response.json();
    },

    async revokeAppMemberInvitation(path, ifMatch) {
      const response = await requireOk(await request(appAdminRoutes.memberInvitation(path), {
        method: "DELETE", headers: ifMatchHeader(ifMatch),
      }), "revokeAppMemberInvitation");
      return { etag: readEtag(response) };
    },

    async listAppMembers(path, query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.members(path)}${queryString(pageQuery(query))}`),
        "listAppMembers",
      );
      return response.json();
    },

    async deleteAppMember(path) {
      const response = await requireOk(
        await request(`${appAdminRoutes.members(path)}${queryString({ accountId: path.accountId })}`, {
          method: "DELETE",
        }),
        "deleteAppMember",
      );
      return response.json();
    },

    async createAppMemberInvitation(path, body, headers) {
      const response = await requireOk(
        await request(appAdminRoutes.memberInvitations(path), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...mutationHeaders(headers),
          },
          body: JSON.stringify(body ?? {}),
        }),
        "createAppMemberInvitation",
      );
      const receipt: { invitationId: string; acceptUrl: string; expiresAt: number } = await response.json();
      return { ...receipt, etag: readEtag(response) };
    },

    async acceptAppMemberInvitation(path) {
      const response = await requireOk(
        await request(appAdminRoutes.acceptMemberInvitation(path), { method: "POST" }),
        "acceptAppMemberInvitation",
      );
      return response.json();
    },

    async listPlatformAccounts(query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.platformAccounts()}${queryString(query)}`),
        "listPlatformAccounts",
      );
      return response.json();
    },

    async getPlatformAccount(path) {
      const response = await requireOk(await request(appAdminRoutes.platformAccount(path)), "getPlatformAccount");
      return response.json();
    },

    async grantPlatformAccountAuthority(path) {
      await requireOk(await request(appAdminRoutes.platformAccountAuthority(path), { method: "PUT" }), "grantPlatformAccountAuthority");
    },

    async revokePlatformAccountAuthority(path) {
      await requireOk(await request(appAdminRoutes.platformAccountAuthority(path), { method: "DELETE" }), "revokePlatformAccountAuthority");
    },

    async blockPlatformAccount(path) {
      await requireOk(await request(appAdminRoutes.platformAccountBlock(path), { method: "PUT" }), "blockPlatformAccount");
    },

    async restorePlatformAccount(path) {
      await requireOk(await request(appAdminRoutes.platformAccountBlock(path), { method: "DELETE" }), "restorePlatformAccount");
    },

    async listPlatformInvitations(query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.platformInvitations()}${queryString(query)}`),
        "listPlatformInvitations",
      );
      return response.json();
    },

    async createPlatformInvitation(body, idempotencyKey) {
      const response = await requireOk(
        await request(appAdminRoutes.platformInvitations(), {
          method: "POST",
          headers: { "Content-Type": "application/json", [CasAdminIdempotencyKeyHeader]: idempotencyKey },
          body: JSON.stringify(body),
        }),
        "createPlatformInvitation",
      );
      const receipt: { invitationId: string; acceptUrl: string; expiresAt: number } = await response.json();
      return { ...receipt, etag: readEtag(response) };
    },

    async revokePlatformInvitation(path, ifMatch) {
      const response = await requireOk(
        await request(appAdminRoutes.platformInvitation(path), {
          method: "DELETE",
          headers: ifMatchHeader(ifMatch),
        }),
        "revokePlatformInvitation",
      );
      return { etag: readEtag(response) };
    },

    async acceptPlatformInvitation(path) {
      await requireOk(
        await request(appAdminRoutes.acceptPlatformInvitation(path), { method: "POST" }),
        "acceptPlatformInvitation",
      );
    },

    async listPlatformAuditEvents(query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.platformAuditEvents()}${queryString(query)}`),
        "listPlatformAuditEvents",
      );
      return response.json();
    },

    async getAppOAuthIssuer(path, query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.oauthIssuer(path)}${queryString(query)}`),
        "getAppOAuthIssuer",
      );
      return { value: await response.json(), etag: readEtag(response) };
    },

    async inspectAppOAuthIssuer(path, body) {
      const response = await requireOk(
        await request(appAdminRoutes.oauthIssuerInspections(path), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        "inspectAppOAuthIssuer",
      );
      return response.json();
    },

    async activateAppOAuthIssuer(path, body, precondition) {
      const response = await requireOk(
        await request(appAdminRoutes.oauthIssuer(path), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...(typeof precondition === "string" ? ifMatchHeader(precondition) : { "If-None-Match": precondition.ifNoneMatch }) },
          body: JSON.stringify(body),
        }),
        "activateAppOAuthIssuer",
      );
      return { etag: readEtag(response) };
    },

    async listAppRefDomains(path) {
      const response = await requireOk(
        await request(appAdminRoutes.refDomains(path)),
        "listAppRefDomains",
      );
      return response.json();
    },

    async listAppControlAuditEvents(path, query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.controlAuditEvents(path)}${queryString(query)}`),
        "listAppControlAuditEvents",
      );
      return response.json();
    },

    async listSpaceRootDomainRefs(path, query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.rootDomainRefs(path)}${queryString(query)}`),
        "listSpaceRootDomainRefs",
      );
      return response.json();
    },

    async listSpaceRootDomainEvents(path, query) {
      const response = await requireOk(
        await request(`${appAdminRoutes.rootDomainEvents(path)}${queryString(query)}`),
        "listSpaceRootDomainEvents",
      );
      return response.json();
    },

  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
