/** OAuth-protected remote MCP ingress for the UniCAS control plane. */

import { OAuthError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import {
  AccountService,
  PlatformAccessService,
  PlatformAuditService,
  PlatformInvitationService,
  type ControlPlaneOperations,
} from "@unicas/service";
import { D1AccountRepository } from "../account-repository.js";
import { D1PlatformAccessRepository } from "../platform-access-repository.js";
import { InvitationTokenCrypto, parseInvitationEncryptionKeys } from "../invitation-token-crypto.js";
import { createOAuthAuthorizationHandler } from "./auth.js";
import {
  CONTROL_PLANE_MCP_PATH,
  CONTROL_PLANE_MCP_SCOPES,
  mcpConfigFromEnv,
} from "./config.js";
import type { ControlPlaneMcpEnvConfig } from "./config.js";
import { createControlPlaneMcpServer } from "./server.js";
import type { ControlPlaneMcpGrantProps } from "./server.js";
import {
  bindLegacyMcpCredential,
  checkMcpAccountAccess,
} from "./platform-access.js";

export interface Env extends ControlPlaneMcpEnvConfig {
  OAUTH_KV: KVNamespace;
  CAS_CONTROL_DB: D1Database;
  CAS_TENANT_AUDIT_READER?: Fetcher;
}

export type ControlPlaneOperationsFactory = (
  env: Env,
) => ControlPlaneOperations;

type ExecutionContextWithProps = ExecutionContext & {
  props?: ControlPlaneMcpGrantProps;
};

const VERIFIED_OAUTH_CONTEXT = Symbol.for(
  "cloudflare.workers-oauth-provider.verified-context.v1",
);

function attachVerifiedOAuthContext(
  request: Request,
  ctx: ExecutionContext,
  props: ControlPlaneMcpGrantProps,
  resource: string,
): void {
  const target = ctx as ExecutionContext & Record<PropertyKey, unknown>;
  if (VERIFIED_OAUTH_CONTEXT in target) return;
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token)
    throw new Error("validated MCP request is missing its bearer token");
  target[VERIFIED_OAUTH_CONTEXT] = {
    version: 1,
    token,
    clientId: props.oauthClientId,
    scopes: [...props.scopes],
    resource,
    props,
  };
}

export function createControlPlaneMcpWorker(
  config: ReturnType<typeof mcpConfigFromEnv>,
  operationsForEnv: ControlPlaneOperationsFactory,
  database: D1Database,
) {
  const mcpApiHandler = {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<Response> {
      const requestConfig = mcpConfigFromEnv(env);
      const originalProps = (ctx as ExecutionContextWithProps).props;
      if (!originalProps)
        return Response.json(
          { error: "MCP_AUTH_CONTEXT_MISSING" },
          { status: 500 },
        );
      const props = await bindLegacyMcpCredential(env.CAS_CONTROL_DB, originalProps);
      if (!props) return Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 });
      const platformRepository = new D1PlatformAccessRepository(env.CAS_CONTROL_DB);
      const platformAccess = new PlatformAccessService(platformRepository);
      const accountService = new AccountService(new D1AccountRepository(env.CAS_CONTROL_DB));
      const platformInvitations = new PlatformInvitationService(
        platformRepository,
        platformAccess,
        new InvitationTokenCrypto(parseInvitationEncryptionKeys(env.SESSION_ENCRYPTION_KEYS)),
      );
      const platformAudit = new PlatformAuditService(platformRepository, platformAccess);
      const accessError = await checkMcpAccountAccess(accountService, props);
      if (accessError) return accessError;
      attachVerifiedOAuthContext(request, ctx, props, requestConfig.resource);
      const handler = createMcpHandler(
        () =>
          createControlPlaneMcpServer(operationsForEnv(env), {
            auditReader: env.CAS_TENANT_AUDIT_READER,
            auditReaderKey: env.CAS_AUDIT_READER_KEY,
            publicOrigin: requestConfig.publicOrigin,
            mutationsEnabled: env.MCP_MUTATIONS_ENABLED === "true",
            platformInvitations,
            platformAudit,
            platformAccess,
            accountService,
            authorizePlatformOperation: async (grant, authority) => {
              const error = await checkMcpAccountAccess(accountService, grant, authority);
              return error ? { error: error.status === 503 ? "SERVICE_UNAVAILABLE" : "PLATFORM_ACCESS_REQUIRED" } : null;
            },
          }),
        {
          route: CONTROL_PLANE_MCP_PATH,
          allowedOriginHostnames: [...requestConfig.allowedOriginHostnames],
          authContext: { props },
        },
      );
      return handler(request, env, ctx);
    },
  };

  return new OAuthProvider<Env>({
    apiRoute: CONTROL_PLANE_MCP_PATH,
    apiHandler: mcpApiHandler,
    defaultHandler: createOAuthAuthorizationHandler({
      accountServiceFactory: env => {
        if (!env.CAS_CONTROL_DB) throw new Error("Account storage is unavailable");
        return new AccountService(new D1AccountRepository(env.CAS_CONTROL_DB));
      },
    }),
    authorizeEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    clientIdMetadataDocumentEnabled: true,
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    accessTokenTTL: 15 * 60,
    refreshTokenTTL: 8 * 60 * 60,
    scopesSupported: [...CONTROL_PLANE_MCP_SCOPES],
    tokenExchangeCallback: async ({ props, requestedScope }) => {
      if (!props || typeof props.identityIssuer !== "string" || typeof props.subject !== "string") {
        throw new OAuthError("invalid_grant", { description: "Account credential is unavailable" });
      }
      const bound = await bindLegacyMcpCredential(database, props as ControlPlaneMcpGrantProps);
      if (!bound) throw new OAuthError("invalid_grant", { description: "Account credential is unavailable" });
      const accessError = await checkMcpAccountAccess(new AccountService(new D1AccountRepository(database)), bound);
      if (accessError) throw new OAuthError(accessError.status === 503 ? "temporarily_unavailable" : "invalid_grant", {
        description: "Account credential is unavailable",
      });
      return { newProps: bound, accessTokenProps: { ...bound, scopes: requestedScope } };
    },
    resourceMetadata: {
      resource: config.resource,
      authorization_servers: [config.publicOrigin],
      scopes_supported: [...CONTROL_PLANE_MCP_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "UniCAS control plane",
    },
  });
}
export { mcpConfigFromEnv } from "./config.js";
