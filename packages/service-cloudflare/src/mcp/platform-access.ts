import type { AccountId, CasAdminErrorResponse, PlatformAuthority } from "@unicas/admin-protocol";
import { AccountServiceError, PlatformAccessError, PlatformAccessService, type AccountService } from "@unicas/service";
import { resolveLegacyAccountCredential } from "../identity-migration.js";

interface McpPrincipalProps {
  readonly identityIssuer: string;
  readonly subject: string;
}

export interface McpAccountCredential extends McpPrincipalProps {
  readonly accountId?: AccountId;
  readonly externalIdentityId?: string;
  readonly credentialVersion?: number;
}

export async function checkMcpAccountAccess(
  accounts: Pick<AccountService, "authorizeCredential">,
  props: McpAccountCredential,
  authority?: PlatformAuthority,
): Promise<Response | null> {
  if (!props.accountId || !props.externalIdentityId || !Number.isSafeInteger(props.credentialVersion)
    || props.credentialVersion! < 1) {
    return Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 });
  }
  try {
    const resolved = await accounts.authorizeCredential({
      accountId: props.accountId,
      externalIdentityId: props.externalIdentityId,
      credentialVersion: props.credentialVersion!,
    });
    if (resolved.authenticatedIdentity.issuer !== props.identityIssuer
      || resolved.authenticatedIdentity.subject !== props.subject
      || (!resolved.hasAppMembership && resolved.platformAuthorities.length === 0)
      || authority !== undefined && !resolved.platformAuthorities.includes(authority)) {
      return Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 });
    }
    return null;
  } catch (error) {
    return error instanceof AccountServiceError
      ? Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 })
      : Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }
}

export async function checkMcpPlatformAccess(
  platformAccess: PlatformAccessService,
  props: McpPrincipalProps,
): Promise<Response | null> {
  try {
    await platformAccess.requireAccess({ issuer: props.identityIssuer, subject: props.subject });
    return null;
  } catch (error) {
    if (error instanceof PlatformAccessError && error.code === "SERVICE_UNAVAILABLE") {
      return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
    }
    return Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 });
  }
}

export async function authorizeMcpPlatformOperation(
  platformAccess: PlatformAccessService,
  principal: { readonly issuer: string; readonly subject: string },
  authority: PlatformAuthority,
): Promise<CasAdminErrorResponse | null> {
  try {
    await platformAccess.requireAccess(principal, authority);
    return null;
  } catch (error) {
    if (error instanceof PlatformAccessError) {
      return { error: error.code as CasAdminErrorResponse["error"] };
    }
    return { error: "SERVICE_UNAVAILABLE" };
  }
}

export async function bindLegacyMcpCredential<Grant extends McpAccountCredential>(
  database: D1Database,
  props: Grant,
): Promise<Grant | null> {
  if (props.accountId !== undefined || props.externalIdentityId !== undefined || props.credentialVersion !== undefined) return props;
  const mapping = await resolveLegacyAccountCredential(database, props.identityIssuer, props.subject);
  return mapping ? { ...props, ...mapping, credentialVersion: 1 } : null;
}