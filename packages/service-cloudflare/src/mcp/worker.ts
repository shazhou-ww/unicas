/** OAuth-protected remote MCP ingress for the UniCAS control plane. */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import {
  PlatformAccessError,
  PlatformAccessService,
  PlatformAuditService,
  PlatformInvitationService,
  type ControlPlaneOperations,
} from "@unicas/service";
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
  authorizeMcpPlatformOperation,
  checkMcpPlatformAccess,
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
) {
  const mcpApiHandler = {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<Response> {
      const requestConfig = mcpConfigFromEnv(env);
      const props = (ctx as ExecutionContextWithProps).props;
      if (!props)
        return Response.json(
          { error: "MCP_AUTH_CONTEXT_MISSING" },
          { status: 500 },
        );
      const platformRepository = new D1PlatformAccessRepository(env.CAS_CONTROL_DB);
      const platformAccess = new PlatformAccessService(platformRepository);
      const platformInvitations = new PlatformInvitationService(
        platformRepository,
        platformAccess,
        new InvitationTokenCrypto(parseInvitationEncryptionKeys(env.SESSION_ENCRYPTION_KEYS)),
      );
      const platformAudit = new PlatformAuditService(platformRepository, platformAccess);
      const accessError = await checkMcpPlatformAccess(platformAccess, props);
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
            authorizePlatformOperation: (grant, authority) =>
              authorizeMcpPlatformOperation(
                platformAccess,
                { issuer: grant.identityIssuer, subject: grant.subject },
                authority,
              ),
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
      authorizePrincipal: async (env, principal) => {
        if (!env.CAS_CONTROL_DB) return "unavailable";
        const platformAccess = new PlatformAccessService(
          new D1PlatformAccessRepository(env.CAS_CONTROL_DB),
        );
        try {
          await platformAccess.requireAccess(principal);
          return "allowed";
        } catch (error) {
          return error instanceof PlatformAccessError &&
            error.code !== "SERVICE_UNAVAILABLE"
            ? "denied"
            : "unavailable";
        }
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
    tokenExchangeCallback: ({ props, requestedScope }) => ({
      accessTokenProps: {
        ...(props as ControlPlaneMcpGrantProps),
        scopes: requestedScope,
      },
    }),
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
